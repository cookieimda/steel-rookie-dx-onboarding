# 학습 모드 관찰(trace)과 근거 겹침 지표

[agent-roadmap.md](agent-roadmap.md) Stage 1(Mads-Lens)의 구현이다. 질문 하나가 검색·모델·검증·저장 중 어디서 실패하거나 느려졌는지 나중에 찾을 수 있게 요청마다 기록을 남긴다. 모델을 더 부르지 않으므로 비용이 들지 않는다.

## 흐름

```
POST /api/chat
  └ Trace 생성(id: 클라이언트 X-Trace-Id 또는 새 UUID) → runWithTrace
      ├ context   체크포인트 진행·최근 대화·미해결 오개념 읽기
      ├ retrieve  retrieveWithHistory(조각 id·점수 기록)
      ├ llm       GeminiLearningAgent.reply
      │   ├ GeminiClient: 호출마다 모델·시간·성공/실패 종류·HTTP 상태·토큰(usageMetadata)
      │   └ 튜터: 과부하 재시도 이유, 형식 오류, 모델 제안(서버 검증 전 status·source_ids·scene_actions·오개념·카드)
      ├ save      오개념·대화 저장
      └ result    최종 status, unverified 원인, 서버 검증 뒤 값, 근거 겹침
  └ traceSink(record) → data/traces/learning-YYYY-MM-DD.jsonl
```

- 코드: `llm/src/trace.ts`(Trace, `runWithTrace`, `currentTrace`, `TraceLog`), `llm/src/grounding.ts`, `backend/src/learning/routes.ts`(기록 지점), `llm/src/gemini.ts`(호출 기록), `llm/src/learning-agent.ts`(재시도·제안 기록), `llm/eval/trace-report.ts`(요약).
- 함수 인자를 늘리지 않으려고 `AsyncLocalStorage`로 넘긴다. trace 밖(평가 스크립트, 서버 시작 때 추천 질문 미리 받기)에서는 아무것도 남기지 않는다.
- 응답 헤더 `X-Trace-Id`와 응답 본문 `trace_id`(스트리밍은 마지막 `done` 줄의 `body.trace_id`)로 id를 돌려준다. 메인 페이지 개발자 패널의 마지막 응답(lastRes)에서 바로 보인다. 서버 오류 로그에도 trace id를 붙인다.
- 파일 날짜는 서버 시간대 기준이다. `TRACE_LOG=off`면 남기지 않고, 위치는 `TRACE_DIR`(기본 `data/traces`, Git 제외). 쓰기에 실패해도 요청은 막지 않고 경고를 한 번 남긴다.

## 기록 필드

| 필드 | 내용 |
|---|---|
| `trace_id`, `kind`, `at`, `total_ms` | 기본 정보. `kind`는 `learning` |
| `stages` | 단계별 ms: `context`, `retrieve`, `llm`, `save` |
| `first_text_ms` | 스트리밍에서 첫 답 글자를 보낸 시각(체감 대기) |
| `request` | `session_id`, `new_session`, `section`, `process_id`, `equipment_id`, `question`, `stream` |
| `context` | 넘긴 대화 수, 미해결 오개념 수, 재도전 개념 수, 체크포인트 진행 중 여부 |
| `retrieval` | `count`, `results: [{id, score}]` |
| `cache` | `hit` · `miss` · `personal`(개인 기록이 있어 저장한 답을 보지 않음) · `off` |
| `llm_calls`, `llm_tokens` | 호출마다 `model`, `ms`, `ok`, `failure`, `http_status`, `streamed`, `tokens`. `llm_tokens`는 total 합(정보가 없으면 null) |
| `agent` | `prompt_chars`, `retries`(`overload_503`·`network`), `format_problems`, `proposal`(모델 제안) |
| `result` | 최종 `status`, `unverified_reason`, `source_ids`, `scene_actions`, `misconception`, `keyword_card`, `answer_chars`, `follow_up` 여부 |
| `grounding` | grounded 답의 근거 겹침(아래) |
| `outcome`, `http_status`, `error` | `grounded`·`unverified`·`safety_redirect`·`error`·`bad_request`·`not_found`·`busy`, 오류 종류(`usage_limit`·`llm_not_configured`·`llm_unavailable`·`format_error`·`internal`) |

남기지 않는 것: 근거 조각 원문, 답변 원문, 사용자 id(세션 id로 DB와 잇는다). 질문 원문은 실패한 질문을 검색 평가 세트(`llm/eval/retrieval/`)로 옮기려고 남긴다.

### unverified 원인

| 값 | 뜻 | 볼 곳 |
|---|---|---|
| `no_chunks` | 검색된 근거가 없음 | 검색(`retrieval.ts`의 키워드·태그·화면 가중치), 자료 부족 |
| `model_unverified` | 근거가 있었지만 모델이 근거로 답할 수 없다고 함 | 1위 점수가 낮으면 검색, 높으면 자료 범위 밖 질문이거나 프롬프트 |
| `invalid_sources` | 모델은 grounded라 했지만 이번 검색 결과에 없는 조각만 인용 | 응답 형식·출처 검증 |
| `cached` | 저장한 답 사용 | 처음 받은 trace |

## 근거 겹침 (`llm/src/grounding.ts`)

답을 문장으로 나눠 각 문장의 글자 2-gram 중 인용한 조각 본문에 있는 비율을 센다. 0.4(`SUPPORT_THRESHOLD`) 이상이면 근거와 겹친 문장으로 본다. 공백·문장부호를 뺀 8글자 미만 문장("네.", "좋은 질문이에요.")은 세지 않는다.

- **관찰용 지표다.** 답의 status를 바꾸지 않고 전체 통과에도 넣지 않는다. 출처 링크가 있다고 답 전체가 검증된 것은 아니라는 점(로드맵 '유지할 경계')을 숫자로 보려는 것이다.
- 임계값: 2026-10-13 `eval:learning` Gemini 답(gemini-3.5-flash-lite) grounded 95개·157문장으로 정했다. 문장 겹침 분위수는 p10 0.41, p25 0.55, p50 0.68. 0.4~0.5 문장은 대부분 근거를 바꿔 쓴 것이고, 0.4 아래(14문장, 8.9%)는 근거에 없는 수식어("제철소의 심장으로 불리는"), 오개념 부정문("~은 아니에요"), 근거 밖 연결 설명이었다. 0.4 기준으로 모든 문장이 겹친 답은 81/95(85%).
- 한계: 같은 뜻을 다른 낱말로 쓰면 낮게 나오고(오개념을 바로잡는 부정문이 대표적), 근거의 낱말을 섞어 틀린 문장을 만들면 높게 나온다. 낮은 문장 목록은 사람이 보는 후보이지 판정이 아니다.
- 상태를 바꾸는 데(예: 겹침이 낮으면 unverified) 쓰려면 사람 라벨을 붙인 표본으로 정밀도를 먼저 잰다.

## 요약 보기 (`npm run trace:report`)

```
npm run trace:report -- [--dir data/traces] [--since 2026-10-15] [--until 2026-10-31] [--list 10]
```

- 결과별 수, unverified 원인, 오류 종류, 저장한 답 사용
- 지연 p50/p95: total(답한 요청), 첫 글자, 단계별
- LLM: 호출 수·실패, 재시도 이유, 형식 오류, grounded 답 하나당 토큰, 프롬프트 글자 수 p50
- 검색: 결과 없음 비율, 1위 점수 p50
- 서버 검증: 버린 source id, 화면 조작 제안 → 실행 수(질문 속 설비 이름으로 붙인 수), 버린 오개념·카드
- 근거 겹침: 모든 문장 겹침 비율·평균, 겹침이 낮은 답(근거 밖 문장 후보)
- 최근 unverified 질문(검색 평가 세트 후보)

`npm run eval:learning` 보고서에도 근거 겹침 줄이 붙는다(같은 함수, 관찰용).

## 다음

- 실제 사용 기록이 쌓이면 trace:report로 기준선(지연 p50/p95, 토큰, unverified 원인 비율)을 [agent-roadmap.md](agent-roadmap.md) Stage 3 표에 적는다.
- 화면 표시(UI) 단계: 프런트가 답을 그리고 화면 조작을 실행한 시각을 같은 trace id로 보내는 것은 아직 없다.
- 체크포인트·시험·보충학습 경로는 아직 trace를 만들지 않는다(GeminiClient는 trace가 있으면 기록하므로 라우트에서 감싸면 된다).
