# ST-Rookie — Harvard CS2680 관점의 Agent 실행 계획

FloodOps 저장소에 임시로 올렸던 계획(`docs/HARVARD_AGENT_ROADMAP_ST-Rookie_TEMP.md`)을 이 저장소로 옮겼다. 진행 상황은 바로 아래 '현재 진행'에 적고, 본문 체크박스도 함께 고친다.

## 현재 진행 (2026-10-15)

| 로드맵 항목 | 상태 | 위치 |
|---|---|---|
| Stage 1 요청별 trace | 학습 모드(`/api/chat`) 완료: 서버 단계·LLM 호출·화면 표시(`learning-ui`)·대화 복원(`learning-restore`) | [agent-observability.md](agent-observability.md), `npm run trace:report` |
| 답변 사실 평가 | `facts`(필수 사실)·`must_not`(하면 안 되는 주장), 제선 11문항 | [learning-mode.md](learning-mode.md) '품질 평가' |
| 작동 보기(`show_operation`) | 튜터가 설비 작동 단계를 3D로 보여 줌. 작동 질문은 서버 규칙으로도 붙임 | [learning-mode.md](learning-mode.md) '화면 조작' |
| 근거 겹침(답변 근거성) 지표 | 관찰용 지표 완료, status에는 반영 안 함 | `llm/src/grounding.ts`, trace·`eval:learning` 보고서 |
| 교육용 평가 세트 | 학습 답변 86개 + 추천 질문 칩, 검색 41개(제선 27 + 후속 질문 14) | `llm/eval/learning/`, `llm/eval/retrieval/` |
| Recall@5·MRR | 있음 | `npm run eval:retrieval` |
| 잘못된 source/concept/scene action 차단 테스트 | 있음 | `backend/test/learning-agent.test.ts`, `learning-route.test.ts` |
| 비용·지연 기준선 | trace로 수집 시작. 실제 사용 기록이 쌓이면 적는다 | 아래 Stage 3 |
| provider 계층(Gemini·Ollama) | 완료. 같은 에이전트·같은 평가 세트를 `LLM_PROVIDER`로 바꿔 돌림, Ollama는 짧은 프롬프트·채점 보강 | [llm-providers.md](llm-providers.md) |
| 모델 비교 | Ollama(qwen2.5:3b) 측정 기록 있음. Gemini는 유료 평가 중단으로 예전 기록과 비교 | [llm-providers.md](llm-providers.md) '측정 기록' |

유료 Gemini 평가 실행은 하지 않기로 했다(2026-10-14). 기준선은 서버 trace(실제 사용)와 이미 있는 평가 기록으로 만든다.

## 목적
ST-Rookie를 근거 기반 제선 교육 튜터로 발전시킨다. 검색 근거의 적절성, 답변의 근거성, 오개념 기록, 3D 화면 조작, 비용과 지연을 반복 측정한다.

Harvard CS2680의 다섯 축인 Mads-Lens(관찰), Mads-Loop(실행 흐름과 실패 정책), Mads-Opt(비용·지연 최적화), Mads-Serve(모델 비교), Mads-Stack(전체 경로 최적화)을 적용한다.

ST-Rookie는 FloodOps와 다르다. 현재 구조는 일반적인 다중 도구 분석 Agent가 아니라 검색 결과를 근거로 Gemini가 답하고 서버가 결과를 검증하는 교육 파이프라인이다. 평가 없이 tool-calling loop나 멀티 에이전트를 추가하지 않는다.

## 1. 현재 구조
학습 모드 문서에 정리된 흐름:

질문 + 선택적 화면 컨텍스트
→ 안전 질문 분기
→ Retriever가 관련 근거 조각 최대 5개 검색
→ 최근 대화·미해결 오개념·체크포인트 컨텍스트 구성
→ GeminiLearningAgent.reply()
→ source_ids / concept_id / scene_actions / keyword_card 검증
→ 오개념·대화 저장, 루브릭에서 키워드 카드 조회
→ 답변·출처·후속 질문·3D 화면 조작 표시

주요 코드:
- 학습 라우트: `backend/src/learning/routes.ts`
- 검색: `llm/src/retrieval.ts`
- 학습 튜터: `llm/src/learning-agent.ts`
- 설계: [learning-mode.md](learning-mode.md)

### 유지할 경계
- source ID는 이번 검색 결과에 포함된 근거와 일치해야 한다.
- scene_actions는 허용된 액션과 실제 공정·설비 목록으로 검증한 뒤 실행한다.
- 키워드 카드 내용은 모델이 임의 생성하지 않고 서버 루브릭에서 가져온다.
- 오개념 감지는 사실 단정과 단순 질문/가설을 구분한다.
- 근거가 부족하면 기존 unverified 상태 계약을 유지한다.
- 안전·운전 조작 요청과 일반 교육 질문을 구분한다.
- 출처 링크가 있다는 이유만으로 답변 전체가 검증됐다고 판단하지 않는다.

## 2. 우선순위
| 우선순위 | 작업 | 산출물 | 완료 조건 |
|---|---|---|---|
| P0 | 검색→생성→검증 경로 계측 | trace와 단계별 지표 | 질문 하나의 실패 지점을 추적 |
| P0 | 교육용 평가 세트 | 40개 이상 질문과 근거 라벨 | 반복 평가 및 회귀 탐지 |
| P1 | 검색 품질 측정 | Recall@5/MRR 결과 | 정답 근거의 검색 순위 확인 |
| P1 | 답변·오개념·화면 액션 테스트 | 계약/회귀 테스트 | 잘못된 ID와 액션 차단 |
| P1 | 비용·지연 최적화 | 기준선과 실험 보고서 | 품질을 유지한 변경만 채택 |
| P2 | 모델 대안 비교 | benchmark 결과표 | 근거를 바탕으로 전환 결정 |

## Stage 1 — Mads-Lens: 관찰 가능성
- [x] 요청별 trace ID로 프런트와 백엔드 이벤트를 연결한다. (`X-Trace-Id` 헤더·응답 `trace_id`, 프런트의 화면 표시 보고 `learning-ui`)
- [x] 질문 → 안전 분기 → 검색 후보/점수 → 선택 근거 → Gemini 호출/재시도 → 응답 파싱 → 서버 검증 → DB 저장 → UI 표시(첫 글자·최종 답·3D 조작 성공/실패)를 기록한다.
- [x] 검색 조각 ID, 점수, source ID를 기록한다. 원문 전체를 운영 로그에 복제하지 않는다.
- [x] Gemini 호출 수, 토큰(제공되는 경우), 단계별 시간, 재시도 사유, 오류를 기록한다.
- [x] unverified 응답을 검색 부족(`no_chunks`), 근거 밖 답변(`model_unverified`), 출처 검증 실패(`invalid_sources`)로 분류한다. 형식 오류·연결 오류는 `error.kind`.
- [x] 모델이 제안한 scene_actions와 서버 검증 후 액션을 분리해 기록한다.
- [ ] 대화 복원, 세션 경계, 저장 실패도 측정한다. (세션 id·새 세션 여부·저장 시간은 기록. 복원 요청은 아직)

**완료 기준:** 검색 실패, 생성 실패, 검증 실패, 저장/UI 실패를 trace로 구분할 수 있다. → 완료(대화 복원 측정만 남음).

## Stage 2 — Mads-Loop 원칙: 현재 파이프라인의 실패 정책
현재의 고정 파이프라인을 먼저 평가한다. 무조건 자율 반복 Agent로 바꾸지 않는다.

### 검색 평가
- [x] 제선 핵심 질문을 수집한다: 코크스 역할, 소결, 열풍로, 토페도카, 고로와 FINEX 구분 등. (`llm/eval/retrieval/ironmaking.jsonl`)
- [x] 후속 대명사 질문, 화면 설비명이 포함된 질문, 화면 컨텍스트가 없는 질문을 구분한다. (`ironmaking-followup.jsonl`)
- [x] 질문별 정답 근거 조각 ID를 사람이 라벨링한다. (`expected_source_ids`)
- [x] Recall@5로 정답 근거가 상위 5개에 들어오는 비율을 측정한다.
- [x] MRR로 근거 순위를 평가한다.
- [ ] 검색 실패에 따라 키워드, 태그, 화면 가중치, 청크 구성을 조정한다. (trace의 `no_chunks`·낮은 1위 점수 질문을 세트에 옮겨 계속)

### 답변 평가
- [x] 질문별 필수 사실, 필수 출처, 금지할 과장 표현을 정의한다. (`expect.facts`·`must_not` 제선 11문항, `sources_any` 9문항)
- [~] 출처가 핵심 사실을 실제로 뒷받침하는지 평가한다. (근거 겹침 지표로 관찰 시작, 사람 라벨 정밀도 측정 전)
- [ ] 공개 자료를 넘어선 사실이나 근거 없는 운전 지시를 덧붙이지 않는지 확인한다.
- [x] 잘못된 source ID, concept ID, 응답 스키마를 테스트한다.
- [x] 프롬프트·모델 변경 후 같은 질문의 품질 퇴행을 확인한다. (`eval:learning --resume`)

### 안전·교육 기능 평가
- [x] 일반 공정 설명 질문이 안전 분기에 잘못 걸리지 않는지 확인한다. (`learning-safety.test.ts`)
- [x] 실제 운전·조작 및 비상 대응 요청이 현재 안전 정책에 맞게 처리되는지 확인한다.
- [x] 오개념 감지가 사실 단정과 질문/가설을 구분하는지 평가한다. (`eval:learning` 오개념 케이스)
- [x] 같은 미해결 오개념의 중복 저장과 해결 후 재발 기록을 테스트한다. (중복은 갱신, 체크포인트에서 해결된 뒤 재발하면 학습·체크포인트 모두 새 미해결 행, 옛 행은 해결 상태 그대로: `learning-repository.test.ts`)
- [x] scene_actions의 액션 종류와 설비 ID를 검증하고 공정 이동이 올바른지 테스트한다.

평가 데이터 필드 권장안: id, question, screen, expected_evidence_ids, required_facts, must_not_claim, expected_status. 실제 ID와 정답은 저장소 자료에 맞춰 작성한다.

**완료 기준:** 40개 이상 질문으로 검색, 답변 근거성, 안전 분기, 스키마, 오개념, 화면 조작을 반복 평가한다.

## Stage 3 — Mads-Opt: 품질을 유지하며 비용·지연 개선
- [~] Gemini 호출 수, 재시도, 토큰, 검색 시간, p50/p95 응답 시간을 기준선으로 측정한다. (trace로 수집 시작, `trace:report`)
- [ ] 현재 코드의 대화·오개념 컨텍스트 상한이 실제로 어떻게 적용되는지 확인한다. (trace `context`·`agent.prompt_chars`로 볼 수 있음)
- [ ] 중복 프롬프트와 반복 컨텍스트를 줄이되 근거·단위·자료 한계는 유지한다.
- [~] 검색 결과 5개가 항상 필요한지 실험한다. 줄일 때는 Recall@k와 답변 근거성을 함께 평가한다.
  - 2026-10-15 `eval:retrieval --max-results k`(모델 호출 없음): 단독 질문 Recall@1 77.8%, @2 92.6%, @3 96.3%, @5 100%(27개), 이어지는 질문은 @2부터 100%(14개). MRR @3 0.790, @5 0.798.
  - 로컬 모델(compact)이 실제로 받는 근거(최대 3개·2,200자) 기준 Recall 24/25(평균 2.92개 전송). 놓친 질문은 "출선구는 어떻게 막아?" 하나.
  - 결론: Gemini는 5개 유지(토큰 여유가 있고 1개를 더 잡는다). 로컬은 3개로 근거 손실 4%를 감수하고 지연을 줄인다. 답변 근거성까지 비교하는 것은 다음 단계.
- [x] 근거 검색 0건일 때 다시 찾기가 필요한지 측정: 학습 평가 84문항 중 0건은 안전 질문 1개뿐(검색 전에 차단됨)이라 만들지 않는다. 실제 사용의 `no_chunks`는 trace로 본다.
- [ ] 캐시를 도입한다면 화면 컨텍스트, 대화, 오개념, 자료·루브릭 버전을 고려해 오래된 결과가 재사용되지 않게 한다. (답 저장은 이미 있음: `answer-cache.ts`, 모델·프롬프트·자료 버전 키)
- [ ] 재시도가 비용과 호출 한도에 미치는 영향을 측정한다.
- [ ] 최적화는 같은 평가 세트에서 품질을 확인한 뒤 적용한다.

기준선(실제 사용 trace가 쌓이면 채운다):

| 지표 | 값 | 기간·표본 |
|---|---|---|
| total p50 / p95 | - | - |
| 첫 글자 p50 / p95 | - | - |
| grounded 답 하나당 토큰 | - | - |
| unverified 원인 비율 | - | - |
| 근거 겹침(모든 문장) | 81/95 (평가 기록) | 2026-10-13 eval:learning |

핵심 지표:
- Retrieval Recall@5 — 정답 근거가 상위 5개에 포함되는 비율
- Evidence support rate — 답변 핵심 사실을 근거가 뒷받침하는 비율
- Unsupported-claim rate — 근거 없는 주장 비율
- Grounded/unverified rate — 상태별 비율과 unverified 원인
- Schema validity — 응답 형식과 ID 검증 통과율
- Scene action validity — 허용 액션 통과 및 잘못된 액션 차단율
- Misconception precision — 기록된 오개념 중 실제 오개념 비율
- Latency p50/p95 — 검색·모델·검증·전체 응답 시간
- Tokens per successful answer — 성공적인 근거 기반 답변당 토큰

검색 품질과 생성 품질을 분리해 진단한다. 하나의 정답률로 튜터 품질을 축약하지 않는다.

## Stage 4 — Mads-Serve: 모델 대안 비교
지금은 Gemini 구조를 유지한다. 자체 서빙이 교육 품질을 자동으로 높이지는 않는다.
- [x] provider 계층: `LLM_PROVIDER=gemini|ollama`로 모든 에이전트가 같은 클라이언트를 쓴다. 응답 검증은 provider와 상관없이 서버가 한다. ([llm-providers.md](llm-providers.md))
- [~] 동일 평가 질문·검색 결과·응답 스키마로 모델을 비교한다. (모든 `eval:*`가 provider를 따름. Ollama 측정 완료, Gemini는 예전 기록)
- [ ] 검색 결과를 고정한 모델 비교와 retrieval부터 포함한 end-to-end 비교를 분리한다.
- [ ] 한국어 제선 설명, 출처 선택, 구조화 응답, 오개념 감지, 안전 분기, scene action을 평가한다.
- [ ] GPU 비용뿐 아니라 배포·모니터링·모델 로딩·장애 대응을 계산한다.
- [ ] 근거 기반 답변과 스키마 유효성 기준을 충족하지 못하면 모델을 바꾸지 않는다.

당장 할 일은 GPU 서빙이 아니라 Gemini 기준선과 평가 세트 확보다.

## Stage 5 — Mads-Stack: 전체 경로 프로파일링
- [~] 프런트 → API → 안전 분기 → retrieval → Gemini → 검증 → DB → UI 시간을 단계별로 측정한다. (API~DB 완료, 프런트·UI 아직)
- [ ] 모델 대기, 검색/자료 로딩, DB 저장, UI 복원 중 실제 병목을 확인한다.
- [ ] 변경 전에 검증 가능한 성능 가설을 쓴다.
- [ ] 한 번에 주요 변수 하나를 바꾸고 같은 평가 세트를 재실행한다.
- [ ] 성능뿐 아니라 근거성, 안전 분기, 오개념, UI 행동도 비교한다.

## 4주 실행안
### 1주차 — 평가 세트와 관찰
- [x] 현재 코드 경로와 지표 문서화 ([agent-observability.md](agent-observability.md))
- [x] 검색 후보·모델 응답·검증 결과를 연결하는 trace 추가
- [~] 제선 질문 40개와 정답 근거 라벨 작성 (검색 41개 라벨 있음)
- [ ] 기준선 검색 결과·답변·토큰·지연 저장

### 2주차 — 검색과 답변 품질
- [~] Recall@5와 답변 근거성 분리 측정 (Recall@5는 `eval:retrieval`, 근거성은 겹침 지표)
- [~] 자료 부족·후속 질문 실패 분류 (`unverified_reason`)
- [x] 잘못된 source ID, concept ID, scene action, 안전 분기 테스트 자동화

### 3주차 — 최적화 실험
- [ ] 컨텍스트 길이, 검색 결과 수, 프롬프트 중 하나씩 실험
- [ ] 토큰·지연과 품질 변화를 비교
- [ ] 근거성이나 안전성이 낮아지는 변경은 되돌림

### 4주차 — 전체 경로와 보고
- [ ] 프런트부터 DB까지 병목 측정
- [ ] 기준선·가설·변경점·결과·한계를 Markdown으로 기록
- [ ] README와 학습 모드 문서가 실제 동작과 일치하는지 갱신

## 완료 정의
- [x] 40개 이상 질문으로 반복 평가 가능
- [x] 검색 실패와 생성 실패를 구분
- [~] 근거성, unverified 원인, 안전 분기, scene action 유효성 측정
- [ ] 최적화 전후 품질·토큰·지연 비교
- [ ] 결과와 한계를 재현 가능한 문서로 남김

## 정한 것 (2026-10-15)
- 학습 채팅 안의 확인 문제(연습 퀴즈)는 만들지 않는다. 평가는 시험 탭(`/exam`)이 맡고, 튜터는 질문·답·3D 설명에 집중한다(학습자가 "시험이 두 군데"로 헷갈리지 않게). 오개념이 있는 개념의 보충학습(#157)은 그대로 둔다.
- 근거 검색 0건일 때 다시 찾기는 측정상 필요 없어 만들지 않는다(Stage 3).
- 로컬 모델 오개념 힌트(루브릭 흔한 오개념을 프롬프트에)는 맞는 말을 틀렸다고 정정해서 넣지 않는다([llm-providers.md](llm-providers.md)).

## 지금 하지 않을 일
- 평가 없이 멀티 에이전트나 tool-calling loop 추가
- 이유 없이 복잡한 장기 기억 시스템 도입
- 출처 링크만으로 답변 검증 완료 처리
- 학습자 실험 없이 교육 효과가 입증됐다고 주장
- 기준선 없이 Gemini를 오픈웨이트 모델로 교체
- 모델이 낸 3D 액션을 검증 없이 실행

## 참고 자료
- [Harvard CS2680 개요](https://cs2680.seas.harvard.edu/)
- [Harvard CS2680 과제](https://cs2680.seas.harvard.edu/assignments/)
- [Harvard CS2680 프로젝트](https://cs2680.seas.harvard.edu/project)
