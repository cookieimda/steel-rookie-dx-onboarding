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
| `stage_offsets` | 단계별 시작 시각(요청 시작부터 ms). 2026-10-18부터. LLM 호출에는 `start_ms`가 붙는다(아래 'Langfuse' 타임라인용) |
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
| `low_support` | 모델은 grounded라 했지만 답 문장이 근거와 하나도 겹치지 않아 서버가 낮춤(로컬 모델만, 아래 '근거 겹침') | `grounding.weakest`, 모델이 지어낸 수치·설명 |
| `cached` | 저장한 답 사용 | 처음 받은 trace |

## 근거 겹침 (`llm/src/grounding.ts`)

답을 문장으로 나눠 각 문장의 글자 2-gram 중 인용한 조각 본문에 있는 비율을 센다. 0.4(`SUPPORT_THRESHOLD`) 이상이면 근거와 겹친 문장으로 본다. 공백·문장부호를 뺀 8글자 미만 문장("네.", "좋은 질문이에요.")은 세지 않는다.

- **Gemini에서는 관찰용 지표다.** 답의 status를 바꾸지 않고 전체 통과에도 넣지 않는다. 출처 링크가 있다고 답 전체가 검증된 것은 아니라는 점(로드맵 '유지할 경계')을 숫자로 보려는 것이다.
- **로컬 모델(Ollama)은 status에 반영한다(2026-10-16, `profileFor().groundingCheck`).** 2문장 이상인데 이번에 검색한 근거 전체와 겹치는 문장이 하나도 없으면(`lowSupport`) 서버가 `unverified`(`low_support`)로 낮추고 키워드 카드를 빼며, 답은 남긴 채 "자료에서 확인하지 못한 내용이 섞여 있을 수 있어요" 안내(`grounding_note`)를 붙인다(`learning-chat.js`가 답 끝에 붙여 보여 줌).
  - 근거: 저장된 로컬 qwen2.5:3b 답(10/15 `eval:learning`, grounded 31개)을 다시 계산하니 겹침 0이 3개였다. 2문장 이상인 2개(`here-bf`: 근거에 없는 "부생가스가 혼합", `unknown-cost`: 근거 없는 고로 건설비)는 지어낸 답이었고, 1문장인 1개(`overview-bf`)는 맞는 답이었다. 그래서 한 문장 답은 보지 않는다. 표본이 작아 놓친 답(재현율)은 모른다.
  - 비교 대상은 인용한 조각이 아니라 검색한 근거 전체다. 측정 세션(로컬 3B, 한 세션 12문항)에서 인용 기준이면 5개를 낮췄는데 그중 "출선구는 뭐야?"·"코크스는 왜 넣어?"는 내용은 맞고 인용만 엉뚱했다. 검색 기준으로는 3개(틀린 답 "미분탄은 부생가스로 불어 넣는다", 자료에 없는 고로 건설비, 받은 자료에 없는 고로 설명)만 낮췄다.
  - Gemini는 같은 기준에서 맞는 답 1개(10/06 제선 28개 중 `overview-bf`, 2문장)를 낮춰서 켜지 않는다.
- 임계값: 2026-10-13 `eval:learning` Gemini 답(gemini-3.5-flash-lite) grounded 95개·157문장으로 정했다. 문장 겹침 분위수는 p10 0.41, p25 0.55, p50 0.68. 0.4~0.5 문장은 대부분 근거를 바꿔 쓴 것이고, 0.4 아래(14문장, 8.9%)는 근거에 없는 수식어("제철소의 심장으로 불리는"), 오개념 부정문("~은 아니에요"), 근거 밖 연결 설명이었다. 0.4 기준으로 모든 문장이 겹친 답은 81/95(85%).
- 한계: 같은 뜻을 다른 낱말로 쓰면 낮게 나오고(오개념을 바로잡는 부정문이 대표적), 근거의 낱말을 섞어 틀린 문장을 만들면 높게 나온다. 낮은 문장 목록은 사람이 보는 후보이지 판정이 아니다.
- 기준을 넓히거나(예: 겹친 문장 비율이 낮으면 unverified) Gemini에도 켜려면 사람 라벨을 붙인 더 큰 표본으로 정밀도를 먼저 잰다.

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

## 화면 표시 단계 (`learning-ui`)

프런트(`learning-chat.js`의 `reportUi`)가 최종 답을 말풍선에 그리고 3D 조작을 실행한 뒤, 같은 trace id로 `POST /api/chat/trace/:traceId/ui`를 보낸다. 서버는 `data/traces/learning-ui-날짜.jsonl`에 남기고 `trace:report`가 trace id로 이어 붙인다.

| 필드 | 내용 |
|---|---|
| `client_ms` | 질문을 보낸 때부터 최종 답·3D 조작까지(브라우저 기준) |
| `first_partial_ms` | 스트리밍 첫 글자를 그린 시각(스트리밍이 아니면 null) |
| `error` | 답을 못 받아 오류 문장을 보여 줬는지 |
| `actions` | 3D 조작별 `succeeded`·`failed`(예: 2D 화면에서 `show_operation`은 실패) |

- 그 사용자에게 최근 발급한 trace id만, 한 번만 받는다(다른 사람의 기록에 끼워 넣지 못하게). 서버가 기억하는 id는 최근 2,000개이고 재시작하면 비운다.
- 보고는 기다리지 않고 실패해도 화면에 알리지 않는다.
- 요약: 화면 표시 p50/p95, 첫 글자 p50, 서버 밖 시간(브라우저 시간 - 서버 `total_ms`: 네트워크·그리기·3D 조작), 3D 조작 종류별 성공률.

## 체크포인트·보충학습·시험 (`checkpoint`·`supplement`·`exam`)

학습 모드 밖에서 모델을 부르는 경로도 같은 sink에 남긴다. 단계별 필드는 없고, 요청(작업) 하나의 시간과 그 안의 LLM 호출(provider·모델·시간·실패·토큰)을 남긴다.

| 종류 | 감싸는 곳 | 추가 필드 |
|---|---|---|
| `checkpoint` | `/api/checkpoints` 요청(`traceMiddleware`, `backend/src/app.ts`) | `request.method`·`request.route`(UUID는 `:id`), `http_status`, `outcome`(`ok`·`http_4xx` 등) |
| `supplement` | `/api/learning/supplements` 요청(`ironmaking-server.ts`) | 위와 같음 |
| `exam` | 시험 작업 하나(`EducationJobs.run`, 요청은 작업 id만 바로 돌려주고 채점은 대기열에서 돌아서 작업을 감싼다) | `job.id`·`job.kind`·`job.queue_ms`(대기 시간), `outcome`(`succeeded`·`failed`·`cancelled`), `error` |

`trace:report`는 이 셋을 "[종류] 요청 수 · 결과 · 전체 p50/p95 · 경로별 수 · 모델별 호출 수·호출당 p50·토큰"으로 요약한다. 시험 채점 이력(`exam_events`의 metadata)에는 이제 실제 provider·모델과 채점 보강 여부가 남는다(전에는 Ollama로 채점해도 gemini로 남았다).

## Langfuse (선택, 로컬 대시보드)

같은 trace를 [Langfuse](https://langfuse.com)(오픈소스 LLM 관측 도구)로 보내 웹 화면에서 질문 하나씩 타임라인으로 본다. 기본은 꺼져 있고, 켜도 파일 기록(`data/traces`)과 `trace:report`는 그대로다. 개발자가 튜터 품질을 보는 도구라 관리자 화면에는 붙이지 않는다.

| 우리 기록 | Langfuse |
|---|---|
| 요청 하나(`trace_id`) | trace 하나. 이름 `learning`·`checkpoint POST /api/checkpoints/:id/answer`·`exam:exam-start` 등, 세션은 `request.session_id` |
| 루트 입력·출력 | 학습: 질문·공정·설비 → 결과(`status`·`source_ids`·`scene_actions`). 그 밖: 요청 경로·작업 → `outcome` |
| `stages` | 하위 span(`context`·`retrieve`(retriever, 조각 id·점수)·`llm`·`save`). `stage_offsets` 자리에 놓는다(예전 기록은 차례로) |
| `llm_calls` | generation(모델·토큰·실패면 ERROR). 학습은 `llm` 단계 아래, 체크포인트·시험은 루트 아래 |
| `outcome`, `grounding.rate` | 점수 `outcome`(범주), `grounding_rate`(숫자) |
| `outcome`이 `error`·`failed`·`http_5xx` / `unverified`·`http_4xx` | 레벨 ERROR / WARNING |

- 보내는 방법: Langfuse v4가 받는 OpenTelemetry(`/api/public/otel/v1/traces`, OTLP/HTTP JSON, Basic 인증 + `x-langfuse-ingestion-version: 4`)와 점수 API(`/api/public/scores`). SDK 없이 `fetch`로 보낸다(`llm/src/langfuse.ts`).
- span id는 trace id에서 정해서 같은 기록을 다시 보내도 겹치지 않는다.
- 2초마다 모아 보낸다. 보내기에 실패하면 경고를 한 번 남기고 버린다(요청은 막지 않는다, 파일 기록은 남는다).
- 학습자 질문 문장이 들어가므로 `LANGFUSE_HOST`가 이 컴퓨터(`localhost`·`127.0.0.1`)가 아니면 `LANGFUSE_ALLOW_REMOTE=1`이 있어야 보낸다(없으면 서버가 시작하지 않는다). Langfuse Cloud는 이 값을 켜야 쓸 수 있다.

### 켜는 순서 (로컬, Docker)

Langfuse는 Postgres·ClickHouse·Redis·MinIO와 함께 돌아 메모리를 4GB 안팎 쓴다. 시연 PC에서는 끈다.

1. Docker Desktop을 켠다.
2. Langfuse를 저장소 밖에 받는다: `git clone --depth 1 https://github.com/langfuse/langfuse.git ../langfuse`
3. 우리 설정을 겹쳐 켠다(화면 3100, 이 컴퓨터에서만, 처음 켤 때 프로젝트·키·계정 생성):
   `docker compose -f ../langfuse/docker-compose.yml -f tools/langfuse/docker-compose.override.yml up -d`
4. `.env`에 넣는다(키는 `tools/langfuse/docker-compose.override.yml`의 로컬 전용 값):
   ```
   LANGFUSE_HOST=http://localhost:3100
   LANGFUSE_PUBLIC_KEY=pk-lf-st-rookie-local
   LANGFUSE_SECRET_KEY=sk-lf-st-rookie-local
   ```
5. 서버를 다시 켜면 시작 로그에 `trace를 Langfuse로도 보냅니다`가 나온다. 쌓여 있던 기록은 `npm run trace:langfuse`(`--since`·`--until`, 보내지 않고 확인만 하려면 `--dry-run`)로 보낸다.
6. http://localhost:3100 에 `admin@st-rookie.local` / `st-rookie-langfuse`로 들어가 Tracing 화면을 본다.

끌 때: `.env`의 `LANGFUSE_*`를 지우고 `docker compose -f ../langfuse/docker-compose.yml -f tools/langfuse/docker-compose.override.yml down`.

## 통합 확인 (2026-10-16)

실제 서버(`npm run start:ollama`, qwen2.5:3b, 빈 DB)에 학습 질문 → 화면 표시 보고 → 대화 복원 → 이해도 확인(준비 → 답 채점 → 재확인 단계) → 보충학습 목록 → 로그인 → 시험 시작 작업을 차례로 보내 6가지 기록(`learning`·`learning-ui`·`learning-restore`·`checkpoint`·`supplement`·`exam`)이 모두 남고 `trace:report`가 요약하는 것을 확인했다. 이해도 확인 답 채점 한 번은 3b 호출 5회(호출당 p50 약 10초, 채점 보강의 핵심 요소 재확인 포함)였다.

## 다음

- 실제 사용 기록이 쌓이면 trace:report로 기준선(지연 p50/p95, 토큰, unverified 원인 비율)을 [agent-roadmap.md](agent-roadmap.md) Stage 3 표에 적는다.
