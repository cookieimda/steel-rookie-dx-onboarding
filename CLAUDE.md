# ST-ROOKIE

제철소 신입사원 기초교육용 3D 시연 사이트. 공정 4개(제선 → 제강 → 연주 → 열간압연)를 3D로 보여 주고, AI 튜터가 설명하고 이해도를 확인한다.

커밋 메시지 규칙은 [agent.md](agent.md)를 따른다.
보고는 한국어로 한다.
작업 시작 전과 커밋 전에 현재 브랜치를 확인한다(`git branch --show-current`). IDE 등에서 브랜치가 바뀌어 커밋이 엉뚱한 브랜치에 쌓인 적이 있다.
시연 서버가 서빙하는 메인 폴더는 `dev`에 둔다. 작업은 별도 worktree에서 한다(예: `git worktree add -b <브랜치> ../ST-ROOKIE-<작업> origin/dev`). 서버는 실행 폴더의 `frontend/`를 그대로 서빙하므로, 메인 폴더에서 브랜치를 바꾸면 시연 화면도 바뀐다.

## 현재 상태와 목표

| | 현재 | 목표 |
|---|---|---|
| 프론트 | `frontend/3d-demo` (바닐라 HTML + Three.js, 최종 페이지 `Steel Academy v3.dc.html`) | 유지. React로 전환하지 않는다 |
| 백엔드 | Node/Express + Gemini (`backend/src/ironmaking-server.ts`) | Node/Express 유지 + SQLite |
| 튜터 | 학습 모드: `learning-chat.js` → `POST /api/chat`. 체크포인트: `checkpoint-chat.js` → Gemini 평가자·튜터 | 학습 모드 + 체크포인트 모드 |
| 교육 내용 | `frontend/3d-demo/data_v2.js` (샘플, 미검증) | `content/materials/{섹션}/section.md` |

채점 로직은 `backend/src/scoring.ts`, 루브릭 로드·검증은 `backend/src/rubrics.ts`에 있다. 서버는 시작할 때 `final/` 루브릭을 모두 검증하고, 형식이 틀리면 시작하지 않는다.

## 프론트 구조 (`frontend/3d-demo`)

**최종 페이지는 `Steel Academy v3.dc.html`(v3)이고, 서버 `/`가 이 페이지를 연다.** v3는 v2를 개편해 따로 만든 페이지다(3D는 `scene_v3.js`). v2 페이지(`Steel Academy v2.dc.html`, `scene_v2.js`)는 이해도 확인을 v3 오버레이로 옮긴 뒤 지웠다. v1 페이지(`Steel Academy.dc.html`)는 지웠고, 남은 `data.js`·`tutor.js`·`scene.js`는 옛 버전이라 고치지 않는다.

- `Steel Academy v3.dc.html`: 화면 템플릿과 로직. 로직은 `<script type="text/x-dc">` 안의 `class Component extends DCLogic`에 있고, `support.js`가 읽어서 실행한다(에디터에서 문법 강조가 안 됨). 주소는 `/Steel%20Academy%20v3.dc.html`.
  - `componentDidMount`: `data_v2.js`, `learning-chat.js`, `checkpoint-chat.js`를 불러와 `this.chat`(학습)과 `this.checkpoint`(이해도 확인)를 만들고 3D 이벤트를 구독한다.
  - `ask(text)`: `this.checkpoint.runLearning(() => this.chat.ask(text))`. 체크포인트 진행 중에는 학습 질문을 막는다(설비 패널 '튜터에게 묻기'·튜터 패널 전송이 부른다). `screenContext()`는 `this.chat`에 넘기는 위임.
  - `goProcess(id)`: 공정을 옮길 때 `this.checkpoint.refresh(id)`로 그 공정의 진입 상태를 다시 읽는다.
  - `renderVals()`: 템플릿 값과 클릭 핸들러(공정 탭, 설비 목록, 재생 제어, 튜터 패널, 개발자 패널). 튜터 패널(학습 전용) 값은 `...this.checkpoint.lockLearning(this.chat.vals(D))`, 공정 목록 배지와 [담금질 시작하기]는 `this.checkpoint.sectionBadge(id)`, 3D 화면 위 이해도 확인 오버레이 값은 `...this.checkpoint.vals()`.
- `learning-chat.js`(ssoyoum): 학습 모드 채팅. `createLearningChat(c)`가 `ask`(질문 → 학습 모드 API `POST /api/chat` → 화면 조작 → 메시지), `runActions`(`goto_process`, `highlight`, `focus`, `play_animation`), `screenContext`, `vals`(메시지·추천 질문·입력창)를 돌려준다. 상태는 페이지 컴포넌트 state에 그대로 있다. 추천 질문은 `learning-suggestions.js`.
- `checkpoint-chat.js`(수민): 이해도 확인. `createCheckpointChat(c)`가 진입 상태·시작·답변·재채점·결과, 3D 화면 위 오버레이 값(말풍선, 캐릭터 동작 이름표 `motionFor`), 공정 목록 배지와 섹션 버튼(`sectionBadge`), 학습 잠금(`runLearning`, `lockLearning`)을 맡는다. 튜터 패널은 학습 전용이다(모드 탭과 `tutorMode`는 지웠다). 캐릭터는 `cp-character.js`(`<cp-character motion model>`, 모델 `models/character/tutor.glb`). 상태 키와 `vals()` 키는 `cp`로 시작한다. 요청은 `api-client.js`(로그인 토큰), 문장은 `tutor-text.js`. 설계는 [docs/checkpoint-integration.md](docs/checkpoint-integration.md), [docs/checkpoint-overlay.md](docs/checkpoint-overlay.md).
- `data_v2.js`: `PROCESSES`(공정 4개·설비 24개), `SUGGESTED`, `findProcess`, `findEquipment`. 3D 표시용 값과 교육 내용이 섞여 있다. v3가 쓴다. `tutor_v2.js`(`mockTutor`, 가짜 튜터)는 이제 어느 페이지도 부르지 않는다.
- `scene_v3.js`: `<steel-scene>` 커스텀 엘리먼트(Three.js). 메서드 `tour`, `jumpTo`, `next`, `stopTour`, `walk`(설비 작동 보기), `layer`(단면 층), `play`, `stop`, `toggle`, `focus`, `overview`, `reset`, `setDrawMode`(2D 뷰), `setLeftLimit`, `setNavWidth`. 이벤트 `steel-select`, `steel-goto`, `steel-overview`, `steel-layer`, `steel-layout`, `steel-model`, `steel-progress`, `steel-tour`, `steel-tour-end`. `step-fx.js`는 작동 보기·단면 보기의 단계별 시각화(`data_v2.js`의 `steps[i]` 기준). 2D 팝업 `steel-2d.js`·`steel-2d-popup.js`는 v3가 쓰지 않는다.
- `models/`: 공정별 GLB, 앵커 `anchors-v2b.json`(v3가 쓴다, v1은 `anchors.json`). 현재 GLB에는 `EQ_<설비 id>` 노드가 없고 앵커로 설비 위치를 잡는다.
- `checkpoint-test.html`: 체크포인트(이해도 확인) 테스트용 단독 페이지(`/checkpoint-test.html`). 메인 페이지에서 링크하지 않는다. 입장 화면(이름·접속 비밀번호), 섹션별 진입 상태(`/api/sections/:section/progress`), 진행(`/api/checkpoints`, 새로고침 시 진행 중 시도 복원), 재채점, 결과 차트를 포함한다. 바닐라 HTML+JS라 `support.js`를 쓰지 않는다. 메인 페이지(v3)는 같은 기능을 3D 화면 위 오버레이로 보여 준다(`checkpoint-chat.js`).

설비 `id`(예: `blast_furnace`)는 화면 선택, 튜터 화면 조작, 3D 앵커, 콘텐츠를 잇는 키다. 바꾸지 않는다. 기준은 `data_v2.js`의 24개이고, v1·루브릭과의 차이는 [docs/equipment-ids.md](docs/equipment-ids.md).

## 파일 담당

여러 사람이 같은 파일을 고치면 병합 충돌이 나므로 담당을 나눈다. 담당이 아닌 파일을 고쳐야 하면 담당자에게 먼저 알리고 그 변경만 담은 작은 PR로 낸다.

| 담당 | 파일 |
|---|---|
| 수민: 체크포인트·평가자·튜터·질문 은행·eval | `backend/src/checkpoint/`, `backend/src/rubrics.ts`, `backend/src/db/migrations/001_checkpoint.sql`·`007_checkpoint_pause.sql`, `llm/src/evaluator.ts`, `llm/src/tutor.ts`, `llm/src/question-check.ts`, `llm/prompts/evaluator.md`, `llm/prompts/tutor-*.md`, `llm/eval/`, `content/rubrics/`(`schema.json` 제외), `frontend/3d-demo/checkpoint-test.html`, `frontend/3d-demo/checkpoint-chat.js`, `frontend/3d-demo/cp-character.js`(이해도 확인 캐릭터), 원격 테스트 장치(`backend/src/test-access.ts`, `usage.ts`, `request-user.ts`, `db/migrations/002_llm_usage.sql`, `scripts/tunnel.mjs`), 이 파일들의 테스트 |
| ssoyoum: 학습 모드 | `llm/src/learning-agent.ts`·`llm/src/retrieval.ts`(둘 다 새로 만듦), `llm/prompts/learning*.md`, `backend/src/learning/`(단, `notes.ts`의 `LearnerNotes` 타입과 `buildLearnerNotes` 시그니처는 수민과 합의 후 변경), `frontend/3d-demo/learning-chat.js`, `frontend/3d-demo/tutor_v2.js`, 학습 모드 마이그레이션(`004`부터, `003_users.sql`은 로그인), 이 파일들의 테스트 |
| 공용: 고치면 작은 PR + 팀 공유 | `llm/src/gemini.ts`, `backend/src/scoring.ts`, `content/rubrics/schema.json`, `backend/src/app.ts`(라우트 등록), `backend/src/db/database.ts`, `backend/src/checkpoint/types.ts`, `package.json`, `CLAUDE.md`, 마이그레이션 번호 |
| 프론트(viiin2) | `Steel Academy v3.dc.html`, `scene_v3.js`, `step-fx.js`, `data_v2.js`, `steel-2d*.js`, `models/`, `frontend/login_ui/`(`Admin Dashboard.dc.html` 제외) |
| 수민: 관리자 대시보드 | `backend/src/admin/`, `frontend/login_ui/Admin Dashboard.dc.html`, 시연 개념 목록 `content/demo/sections.json`·`backend/src/demo-sections.ts`, 이 파일들의 테스트 |

- 마이그레이션 번호 규칙: `backend/src/db/migrations/NNN_이름.sql`을 파일 이름 순서로 한 번씩 적용하고 `schema_migrations`에 이름을 남긴다. 001~007은 사용 중이다(005: 기록 출처 `origin`, 006: 시연 계정 `users.is_demo`, 007: 이어 풀기 질문 기록 `attempt_questions`). 새 번호는 지금 가장 큰 번호 + 1로 정하고, 같은 번호를 두 사람이 쓰지 않게 PR을 열기 전에 팀에 알린다. 이미 병합된 마이그레이션 파일은 고치지 않고 새 번호로 추가한다.
- 기존 `/api/chat`(`llm/src/ironmaking-agent.ts`)은 학습 모드로 대체되어 지웠다. 기본 모델 상수 `DEFAULT_GEMINI_MODEL`은 `llm/src/gemini.ts`에 있다. `ironmaking-sources.ts`(공개 자료 메모)는 학습 모드 검색(`retrieval.ts`)과 출처 표시(`learning/routes.ts`)가 쓰므로 남긴다.
- 학습 모드 시작 안내: [docs/onboarding-learning-mode.md](docs/onboarding-learning-mode.md).

## 학습 구조

- **섹션 = 공정 하나.** `ironmaking`, `steelmaking`, `continuous_casting`, `rolling` 순서. 코드의 섹션 목록·순서는 `backend/src/checkpoint/types.ts`의 `SECTION_ORDER` 하나만 쓴다(루브릭 스키마 `section` enum과 같은지 테스트로 확인).
- 각 섹션 마지막에 **이해도 확인 체크포인트**가 있고, 결과를 차트로 보여 준다.
- 다음 섹션은 앞 섹션의 체크포인트를 통과해야 열린다.

## 튜터

튜터는 1명이고 모드가 2개다.

### 학습 모드
- 자유 질문에 RAG로 답한다. 근거는 해당 섹션의 `section.md`.
- 점수를 매기지 않는다.
- 답변 중 오개념이 감지되면 기록만 하고 점수에는 반영하지 않는다.

### 체크포인트 모드
1. 튜터가 "제선 질문 시작할게요, 준비됐나요?"처럼 시작한다.
2. 개념별로 질문한다.
3. 평가자 LLM이 사용자 답변을 판정해 JSON을 돌려준다. `concept_id`는 평가자가 내지 않고 서버가 붙인다.
   ```json
   {
     "verdict": "correct | partial | wrong | assisted",
     "misconception": "string | null",
     "explain_from": "number | null",
     "evidence": "string"
   }
   ```
   `explain_from`은 학습자가 처음 놓친 `key_points`의 인덱스(0부터)다. 핵심 요소를 모두 맞혔지만 사실 오류로 partial이면 `null`이고 `misconception`이 있어야 한다(서버가 검증, `explainFromProblem`). 되묻거나 힌트를 요청하면 `assisted`다.
4. `correct`가 아니면(`partial`, `wrong`, `assisted`) `explain_from`부터 부가 설명을 한 뒤 **다른 각도의 질문으로 한 번** 재확인한다. `explain_from`이 `null`이면 핵심 요소를 다시 설명하지 않고 오개념만 바로잡는다(`llm/prompts/tutor-correction.md`). 재확인은 개념당 1회뿐이다.
5. 재확인 단계의 평가자는 `responseSchema`의 verdict에서 `assisted`를 빼고, 프롬프트에 "되묻기·힌트 요청은 wrong"을 명시한다(판정 뒤 변환하지 않는다).

평가자는 `content/rubrics/final/`만 읽는다. `draft/`는 읽지 않는다.

평가자 판정 순서(개념별 기준보다 먼저, 이 순서대로 적용, `llm/prompts/evaluator.md`):
1. 맞게 설명한 핵심 요소가 하나도 없고 루브릭의 partial 기준에도 해당하지 않으면 wrong. 다른 개념·공정을 설명한 경우도 wrong. 루브릭의 wrong 문장은 핵심 요소 없이 그 오개념만 있을 때의 예시다.
2. 핵심 요소를 하나 이상 맞게 설명했으면 최소 partial. 이 경우에만 오개념이 함께 있어도 wrong으로 내리지 않는다.
3. 사실 오류가 하나라도 있으면 핵심 요소를 다 말했어도 최대 partial이고, 오류는 misconception에 기록한다. 루브릭에 없더라도 맞는 설명은 감점하지 않는다.

튜터 질문은 루브릭의 **질문 은행**에서 고른다(`llm/src/tutor.ts`).
- 개념별 `questions`(첫 질문 2~3개)와 `recheck_questions`(재확인 2개). 핵심 요소 전체를 묻고, 핵심 요소·정답 용어·그 동의어 표현을 쓰지 않는다(테스트로 유출 검사 통과 확인, 핵심 요소 문장과의 겹침도 검사).
- 튜터는 고른 질문의 말투만 다듬는다(`llm/prompts/tutor-polish.md`, 의미 변경 금지). 다듬기 프롬프트에는 핵심 요소와 정답 용어를 주지 않는다. 다듬은 문장이 유출 검사에 걸리거나 다듬기 호출이 실패하면 은행 원문을 쓴다.
- 재확인은 `recheck_questions`에서 고른다. 루브릭 로드 때 `questions`와 겹치면 오류로 막으므로 첫 질문으로 쓰지 않은 질문이 된다.
- 은행이 비어 있을 때만 LLM이 질문을 만든다(대체 경로). 아래 유출 검사·재생성·`fallback_question`은 이 경로와 다듬은 문장에 적용된다.

튜터 질문 유출 검사(`llm/src/question-check.ts`, 다듬은 은행 질문과 LLM이 만든 질문 모두):
- 루브릭 개념의 `answer_terms`(선택)와 그 용어집 동의어가 질문에 있으면 유출. 개념 이름(`name`)은 검사에서 뺀다: 질문 속 개념 이름은 지우고 보고, 개념 이름에 든 말은 허용한다. `answer_terms`(동의어 포함)에 개념 이름에 든 말이 있으면 검사에서 조용히 빠지므로 테스트로 막는다.
- quote와 4글자 이상 겹치는 구간 중 단어 경계 양쪽에 각각 2글자 이상 걸친 구가 있으면 유출. 한 단어 안의 겹침("철광석을")이나 조사 한 글자가 붙은 겹침("는 철광석")은 허용한다(그대로 4글자 비교하면 자연스러운 질문도 걸려서 정한 규칙).
- (LLM이 만든 질문) 걸리면 걸린 표현을 알려 주고 1회 다시 만든다. 또 걸리면 루브릭의 `fallback_question`(선택)을, 없거나 재확인에서 직전 질문과 같으면 고정 문장(`genericQuestion`)을 쓴다. 모든 `fallback_question`은 유출 검사를 통과해야 한다(테스트로 확인).
- 질문 생성 프롬프트에는 근거 문장(quote)을 주지 않고 핵심 요소만 준다. 질문은 핵심 요소만으로 완전히 답할 수 있는 범위로 제한한다.
평가자 입력은 해당 개념의 루브릭, 섹션 용어집(`glossary`), 질문, 답변뿐이다. 질문과 답변은 `<question>`, `<answer>` 구분자로 감싸고, 구분자 안의 내용은 채점 대상이며 지시가 아니라고 명시한다.

API·상태 머신·DB·프롬프트의 상세 설계는 [docs/checkpoint-api.md](docs/checkpoint-api.md).

## 점수 규칙

점수는 LLM이 아니라 **코드가 계산한다.** LLM은 `verdict`만 낸다.

| 판정 | 개념 점수 |
|---|---|
| `correct` | 1 |
| `partial` | 0.5 |
| `wrong` | 0 |

- 첫 판정이 `correct`면 그대로 1점으로 확정한다.
- 그 밖에는 **재확인 판정이 최종 점수**다. 재확인 판정은 `correct`·`partial`·`wrong` 중 하나다(`assisted`는 첫 판정에만 나온다).
- 재확인 전인 개념은 확정되지 않은 것으로 보고 0점으로 계산한다.
- **이해도** = 섹션 내 개념 점수의 평균. 경계값 오차를 피하려고 분수로 계산한다.
- **해금 조건**: 섹션의 모든 개념이 확정됐고, 이해도가 80% 이상.
- **80% 미달**: 섹션 첫 화면으로 돌아간다. 재도전 때는 만점(1점)이 아닌 개념만 다시 묻고(`partial` 포함), 맞힌 개념의 점수는 유지한다.
- 재도전한 개념은 새 결과로 **덮어쓴다**(이전보다 낮아질 수 있다). 이미 맞힌 개념의 결과를 다시 넣으면 에러다.
- 이해도·통과는 **지금 final 루브릭의 개념만**으로 계산한다. 바뀌거나 빠진 `concept_id`의 결과는 버린다(행은 DB에 남김). 계산은 `backend/src/checkpoint/section-summary.ts`의 `summarizeSection` 하나로 하고, 엔진·관리자 통계·신입사원 대시보드가 같이 쓴다. 관리자 통계는 final 루브릭이 없는 섹션에 한해 시연 목록(`content/demo/sections.json`) 개념으로, 시연 기록(`seed`)만 계산한다.
- 한 번 통과(완료 시점에 해금)한 섹션은 루브릭이 바뀌어도 통과로 둔다. 통과 뒤 새로 생긴 개념은 다시 묻지 않고 **미확인**으로 보여 준다(`/api/sections/:section/progress`의 `unconfirmed_concept_ids`). 미확인 개념은 0점이라 이해도는 낮아질 수 있다.

## 오개념 기록

- 저장 항목: 자유 텍스트 설명, `concept_id`, 사용자 답변 원문, 상태.
- 상태: `미해결` / `해결됨`. 해결은 개념 단위다: 체크포인트에서 그 개념이 1점으로 확정되면 그 사람의 그 개념 미해결 행을 출처(`checkpoint`·`learning`) 상관없이 모두 해결한다(`CheckpointRepository.resolveMisconceptions`). 학습 모드 메모도 해결해 같은 것을 다시 짚지 않게 한다.
- 저장은 출처마다 다르다: 체크포인트는 판정마다 새 행, 학습 모드는 같은 개념의 미해결 행이 있으면 그 행을 갱신. 행은 모두 남긴다.
- 용도가 다르다: `checkpoint`는 판정 결과, `learning`은 튜터가 설명할 때 참고하는 메모(학습자 메모, 점수 반영 없음).
- **개수는 체크포인트 기록(`source = checkpoint`)만으로 센다.** 행 수가 아니라 개념 수(`users.id` 기준 `COUNT(DISTINCT concept_id)`)다.
  - 미해결: 미해결 행이 하나라도 있는 개념의 수.
  - 해결: 체크포인트 오개념 기록이 있었고 지금 미해결 행이 하나도 없는 개념의 수. 미해결 + 해결 = 체크포인트 오개념이 있었던 개념 수.
  - 학습 모드 감지(`source = learning`)는 개수에 합치지 않고 출처별 비교도 하지 않는다. 필요하면 "튜터가 짚은 개념" 참고 목록으로만 따로 보여 준다.
- 오개념 내용(설명·답변 원문)은 개인 페이지에서 **본인 것만** 보인다. 개인 페이지는 개념별로 묶어 최근 설명을 먼저 보여 주고 이전 기록은 접어 둔다. 관리자 화면에는 사람별 미해결·해결 **개수만** 나온다.
- 관리자 화면은 신입사원 통계 조회만 한다(아래 "계정과 관리자").

## 콘텐츠

```
content/
  materials/{섹션}/section.md   # 웹 자료를 팀이 정리한 섹션별 단일 기준 문서. 튜터 답변의 근거
  rubrics/draft/                # LLM이 생성한 루브릭 초안
  rubrics/final/                # 팀 검수를 마친 루브릭. 평가자는 여기만 읽는다
```

- `section.md`가 교육 내용의 단일 기준이다. 다른 곳에 교육 내용을 중복해서 만들지 않는다.
- 루브릭은 `draft/` → 팀 검수 → `final/` 순서로만 옮긴다. 검수 없이 `final/`에 쓰지 않는다.
- `concept_id`는 섹션과 상관없이 전체에서 고유하다. 오개념 해결·점수가 `concept_id`로 이어지므로 `loadFinalRubrics()`가 겹치면 오류를 내고 서버가 시작하지 않는다.
- **`concept_id` 변경 규칙**: 핵심 요소(`key_points`)나 정답 기준(correct·partial·wrong 기준)이 바뀌면 새 `concept_id`를 만든다(예: `sinter_purpose` → `sinter_purpose_v2`). 문구 수정(오탈자, 질문 은행·`fallback_question` 다듬기, `quote` 출처 교체로 뜻이 같은 경우)은 id를 그대로 둔다. 예전 id의 기록은 지우지 않고, 읽는 쪽이 지금 final 루브릭의 개념만 본다('점수 규칙').
- 루브릭 형식은 `content/rubrics/schema.json`. 최상위 `reviewed`는 팀 검수 여부이고, `false`인 루브릭을 로드하면 경고 로그를 남긴다(`backend/src/rubrics.ts`의 `loadRubric`). 스키마 검증은 서버 실행 중에도 `ajv`로 한다.
- 개념의 선택 필드 `questions`·`recheck_questions`는 튜터 질문 은행이다(위 '튜터' 절).
- 루브릭 최상위의 선택 필드 `glossary: [{term, aliases}]`는 섹션 단위 용어집이다(예: 용선 = 쇳물). 평가자 프롬프트에 들어가 동의어를 같은 말로 본다.
- 현재 `final/01_제선.json`은 `reviewed: false`인 임시 루브릭이다. `section.md`가 생기면 그 문서를 근거로 다시 만든다. 질문 은행도 검수 전 초안이다.
- 소결 개념 재설계 초안(정의 → 이유: 가루 원료의 통기성 문제와 덩어리화): `draft/sinter_purpose.v2.json`. 통기성 근거 문장이 현재 자료에 없어 출처 확보 전에는 final로 옮기지 않는다. 옮기면 smoke·hard의 소결 케이스 기대 판정도 새 핵심 요소에 맞게 다시 쓴다.

## 계정과 관리자

- 역할은 `trainee`(신입사원)와 `admin`(관리자). 회원가입은 항상 `trainee`. API는 [docs/auth-api.md](docs/auth-api.md), 코드는 `backend/src/auth/`.
- 시연 계정 `trainee01`~`20`(신입사원 20명), `admin01`은 서버 시작 때 만든다(`DEMO_ACCOUNTS=off`로 끔).
- 아이디·비밀번호 찾기는 이름 + 사번으로 본인 확인을 한다(메일 발송 없음). 시연·사내용 수준이다.
- 관리자는 `GET /api/admin/trainees`로 신입사원별 섹션 이해도·통과 여부·시도 횟수·오개념 개수·마지막 학습일을 본다(`backend/src/admin/`). 체크포인트 테이블(`attempts`, `misconceptions`)이 없으면 계정 목록만 준다.
- 시연 계정은 `users.is_demo = 1`이다(`trainee11`~`20`, `006_demo_accounts.sql`, 서버 시작 때 `seedDemoAccounts`가 표시). 관리자 화면은 실제 계정과 섞어 보여 주고 시연 계정 이름 옆에 'demo' 배지를 붙인다. `?include_demo=false`면 실제 계정만 센다(`/api/admin/trainees`, `/api/admin/concepts`).
- 화면: `frontend/login_ui/My Page.dc.html`, 서버의 `/login`. 관리자로 로그인하면 개인 학습 기록 대신 통계를 보여 준다.
- `npm run db:seed-demo [seed]`: 시연 기록을 무작위로 다시 만든다(`backend/src/db/demo-records.ts`). 점수는 `scoring.ts` 규칙.
  - **계정 분리**: 시연 기록은 `trainee11`~`20`에만 넣는다. `trainee01`~`10`은 팀원 실제 테스트용이라 시연 기록이 없고, 실행할 때 남아 있는 `seed` 기록을 지운다.
  - 개념은 `loadFinalRubrics()`에서 읽고, final 루브릭이 없는 섹션은 시연용 개념 목록 `content/demo/sections.json`(id·이름만)으로 채운다. 이 파일은 시연 기록(`db:seed-demo`)과 관리자 통계만 읽는다. 평가자·체크포인트 엔진·`loadFinalRubrics()`는 읽지 않으므로 실제 계정의 그 섹션 체크포인트는 계속 404다(테스트로 확인). final 루브릭이 생기면 그 섹션은 루브릭 개념을 쓰고 시연 목록은 무시한다.
  - 시연 기록은 `attempts`·`misconceptions`의 `origin = 'seed'`이고, 실제 기록은 `live`(기본값, `005_record_origin.sql`)다. 시연 계정으로 실제 테스트도 하므로 계정이 아니라 기록 단위로 구분한다.
  - 다시 만들 때 `seed` 기록만 지운다. 실제 기록(`live`)과 다른 계정의 기록은 건드리지 않는다.
  - 실제 기록만 읽는 곳: 체크포인트 엔진(시작·진행·`sectionProgress`, `CheckpointRepository`의 시도 조회)과 학습 모드 오개념 조회(`LearningRepository.openMisconceptions`·`recordMisconception`, 학습자 메모 포함). 관리자 통계는 시연을 위해 `seed`도 센다.
  - `eval:export-human`은 `origin = 'live'`만 내보낸다.

## 튜토리얼

- 첫 로그인 때 driver.js 코치마크로 화면을 안내한다.
- 연습 질문 1개를 낸다. 점수에 포함하지 않는다.

## 데이터 저장

- SQLite로 시작한다(Node 내장 `node:sqlite`, 파일은 `DB_PATH`, 기본 `data/st-rookie.sqlite`). PostgreSQL로 옮길 수 있게 SQLite 전용 문법·타입에 의존하지 않고, SQL은 저장소 파일(`backend/src/checkpoint/repository.ts`)에만 둔다.
- 사용자 구분(`backend/src/request-user.ts`의 `withRequestUser`, 테스트 `backend/test/request-user.test.ts`):
  - 로그인 토큰(`Authorization: Bearer`)이 있으면 토큰의 `users.id`(UUID)로 구분하고 `X-User-Id`는 무시한다.
  - 토큰이 만료됐거나 잘못됐으면 헤더로 넘어가지 않고 401(`TOKEN_INVALID`)이다.
  - [임시] 토큰이 없을 때만 `X-User-Id` 헤더(없으면 `demo-user`)로 구분한다. 헤더 방식은 메인 페이지에 체크포인트 UI를 다시 붙일 때 지우기로 했다. 메인 페이지(v3)는 이제 체크포인트 UI가 있고 로그인 토큰만 쓰며, 헤더는 `checkpoint-test.html`만 보낸다.
- 공용 테이블의 `user_id`는 `users.id`(UUID)가 기준이다. 헤더 이름으로 쌓인 기록은 지우지 않고 그대로 둔다(eval 사람 답변 원천). 관리자 통계·개인 페이지에는 나오지 않아도 된다. 꼭 지워야 하면 `eval:export-human`으로 백업한 뒤 지운다.
- `misconceptions`는 체크포인트 담당(수민)이 관리한다. 다른 모듈은 정해진 쓰기 함수로만 쓰고, 읽기 SELECT는 각자 둘 수 있다.

## 원격 팀원 테스트 (임시 장치, 로그인이 생기면 지운다)

- 사용자: 테스트 페이지(`checkpoint-test.html`)가 URL의 `?user=이름`을 `encodeURIComponent`로 `X-User-Id`에 담는다. 없으면 입장 화면에서 이름을 받는다(`backend/src/request-user.ts`).
- 접속 비밀번호: `.env`의 `TEST_PASSCODE`가 있으면 `/api/access`를 뺀 모든 `/api` 요청에 `X-Test-Passcode`를 확인한다. 비어 있으면 검사하지 않는다(`backend/src/test-access.ts`).
- 사용량: 사용자별 하루 LLM 호출 수를 `llm_usage`에 세고 `LLM_DAILY_LIMIT`(기본 150, 0 이하면 무제한)를 넘으면 429(`backend/src/usage.ts`). `GeminiClient`의 `beforeCall` 훅으로 센다.
- 서버는 `127.0.0.1`에만 바인딩한다. 외부 공유는 `npm run tunnel`(cloudflared quick tunnel)로만 하고, `TEST_PASSCODE`가 없으면 터널이 열리지 않는다.
- 앱 구성은 `backend/src/app.ts`의 `createApp()`, 실행은 `ironmaking-server.ts`.
- 사용자 기록 삭제: `npm run db:reset-user -- 이름 --origin seed|live|all [--yes]`(`--origin` 필수, 없으면 사용법을 보이고 종료). 이름이 로그인 아이디면 그 계정(`users.id`)의 기록과 같은 이름의 헤더 기록을 함께 지운다. 계정은 지우지 않는다. 실제 기록(live)은 eval 사람 답변 원천이라 필요하면 `eval:export-human`으로 먼저 백업한다. 진행 방법은 `docs/team-test.md`.
- 사용자별 데이터(계정, 개념 점수, 판정 기록, 오개념, 진도, 튜토리얼 완료 여부)는 DB에 둔다.
- 교육 내용과 루브릭은 DB가 아니라 `content/` 파일로 관리한다.

## 확정

처음 설계 이후 팀이 정한 사항.

- 백엔드는 Node/Express를 유지한다(FastAPI로 옮기지 않는다).
- `partial`, `wrong`, `assisted` 모두 재확인 대상이고, 재확인은 1회다. 최종 점수는 재확인 판정 그대로다.
- 재도전 때 `partial` 개념도 다시 묻는다.
- 재도전 결과는 이전 결과를 덮어쓴다.
- 이미 맞힌 개념의 결과를 재도전에 넣으면 에러로 막는다.
- 루브릭에 `reviewed` 필드를 두고, 검수 전 루브릭은 경고 로그를 남긴다.
- 채점 로직은 Node(TypeScript)로 옮겼다. Python 버전은 없다.
- 로그인: 아이디 + 비밀번호(bcrypt 해시) + JWT.
- 관리자 통계 화면을 만든다(처음 설계의 "관리자 화면 없음"을 바꿈). 오개념은 개수만 보여 준다.
- LLM: Gemini를 유지한다. 평가자는 Gemini `responseSchema`로 판정 JSON 형식을 강제한다.
- 체크포인트 결과 차트: 개념별 가로 막대(맞음/부분/틀림) + 전체 이해도 게이지(80% 기준선 표시).
- 재확인 단계에서 되묻기·힌트 요청은 `wrong`이다(재확인 평가자 스키마에 `assisted` 없음).
- 재확인에도 맞히지 못하면 핵심 요소 요약(템플릿)을 보여 주고 다음 개념으로 넘어간다.
- "준비됐나요?"에는 어떤 응답이든 시작으로 본다.
- 이미 통과한 섹션은 다시 응시할 수 없다(409).
- 같은 시도 안에서 재확인으로 맞혀도 그 개념의 오개념은 해결됨으로 바꾼다.
- 재확인에서 나온 오개념도 기록한다.
- 이해도 확인 중간에 '나중에 이어 풀기'로 멈출 수 있다(새 상태 `paused`, `POST /api/checkpoints/:id/pause`·`resume`). 확정한 개념은 그대로 둔다. 상세는 [docs/checkpoint-api.md](docs/checkpoint-api.md) '나중에 이어 풀기'.
  - 답 대기 중에 멈추면 그 개념을 초기화하고, 이어 풀 때 이 시도에서 안 쓴 은행 질문으로 다시 묻는다. 은행을 다 썼으면 `fallback_question`을 다시 쓴다.
  - 재확인 대기 중에 멈추면 첫 판정을 유지하고, 이어 풀 때 안 쓴 재확인 질문으로 묻는다. 멈춰서 재확인을 건너뛰고 새 첫 질문으로 1점을 받는 우회를 막기 위해서다.
  - 멈춘 시도는 실패로 세지 않는다. 관리자 통계에는 '진행 중'으로 보인다(`in_progress_sections`).
  - 멈춘 동안 학습 채팅을 쓸 수 있다. 답하는 중(`awaiting_*`, `error`)에만 학습 채팅을 잠그고, 학습 채팅에 입력하려 하면 [멈추고 질문하기]를 안내한다.
  - 로그인·새로고침 때 이해도 확인 탭으로 자동으로 옮기지 않는다. 학습 탭에서 시작하고 "풀던 이해도 확인이 있어요 [이어 풀기]" 안내만 띄운다. 새로고침은 시도를 바꾸지 않는다.

## 브랜치와 병합 순서

- PR #9~#11(checkpoint-api → checkpoint-ui → evaluator-eval-sets)은 스택 PR의 base가 바뀌지 않은 채 앞 브랜치로 병합되어 dev에 들어가지 않았다. 그래서 `integrate/checkpoint`(dev 기준)에 `feature/checkpoint-ui`(전체 작업이 들어 있는 끝 브랜치)를 병합해 한 PR로 dev에 넣는다. 메인 페이지(`Steel Academy.dc.html`, v2)는 dev 버전을 그대로 두고, 체크포인트 UI는 `checkpoint-test.html`로 분리했다.
- 스택 PR을 다시 쓸 때는 앞 PR이 병합된 직후 다음 PR의 base를 dev로 바꾼 뒤 병합한다.
- 팀원 테스트는 통합 PR이 병합되기 전에는 `integrate/checkpoint`, 병합 뒤에는 `dev`로 진행한다.
- 학습 모드 구현은 통합 PR이 병합된 뒤 `dev`에서 새 브랜치로 시작한다.

## 다음 단계

- **학습자 메모**: 연결됨. 서버가 `buildLearnerNotes`를 엔진의 `learnerNotes`로 넘기고(`options.notes`를 주면 그것을 우선), 엔진은 부가 설명(첫 판정이 correct가 아닐 때)에서만 메모를 읽어 `context`를 튜터의 `explanation`에 `learnerNotes`로 넘긴다. 프롬프트(`tutor-explanation.md`, `tutor-correction.md`)에는 `<learner_notes>` 구분자로 넣고, 관련 있는 항목만 짚게 한다. 평가자에게는 넘기지 않는다. 메모는 지금 final 루브릭 개념의 미해결 오개념만 담는다(`ironmaking-server.ts`에서 거름). `conceptOrder`(개념 순서 조정)는 루브릭 순서를 유지하기로 해서 쓰지 않는다.
- **학습 모드 연결**: 설계와 결정은 `docs/learning-mode.md`. 오개념은 같은 응답에서 단정할 때만 감지하고, 대화는 DB에 저장(보관 기간 없음), 근거는 `retrieve()`로 분리해 공개 자료 메모로 먼저 연결한다. 학습 모드 오개념은 체크포인트 튜터의 context로만 쓰고 평가자에게는 넘기지 않는다. 개인 페이지에서 `source = learning`은 오개념 목록·개수에 섞지 않고 "튜터가 짚은 개념" 참고 목록으로 따로 보여 준다(위 '오개념 기록').
- **개념 ↔ 설비 연결(수민 담당)**: 루브릭 스키마의 개념에 `equipment_ids`(선택, `data_v2.js`의 설비 id 배열)를 추가한다. 재학습 시 3D 하이라이트(오개념이 있는 개념의 설비 강조)에 쓴다. 스키마는 공용 파일이므로 작은 PR로 내고 공유한다. id 목록은 [docs/equipment-ids.md](docs/equipment-ids.md).
- **3D 화면 조작**: 학습 모드의 `scene_actions`와 "재학습 시 3D 하이라이트"(오개념이 있는 개념의 설비를 강조)를 함께 진행한다.

## 알려진 문제

고치지 않고 이슈로 남긴 것. 고치면 이 목록에서 지운다.

- 테스트 `HTTP: 시작 201·재시작 200, 입력 오류 400, LLM 연결 실패 502`(`backend/test/checkpoint.test.ts`)가 전체 실행에서 가끔 실패한다(26회 중 1회, 단독 실행은 통과): [#14](https://github.com/viiin2/ST-ROOKIE/issues/14)
- v2 `componentDidUpdate` 콘솔 오류(`support.js`가 인자 하나만 넘김, 설비 선택 시 `setLeftLimit` 미실행): v2 삭제로 해결 [#15](https://github.com/viiin2/ST-ROOKIE/issues/15)
- 제강 신규 설비 3개(`oxygen_lance_offgas`, `tapping_ladle_crane`, `ladle_transfer`)의 앵커가 `anchors-v2b.json`에 없음: [#16](https://github.com/viiin2/ST-ROOKIE/issues/16)
- `models/README.md`의 `EQ_<id>` 노드 규칙이 현재 앵커 방식과 다름(GLB에 `EQ_` 노드 없음): [#17](https://github.com/viiin2/ST-ROOKIE/issues/17)

## 미정 사항

새로 생기면 여기에 적고, 구현할 때 추측하지 말고 팀에 확인한다.

- 통과한 섹션의 미확인 개념(루브릭 변경으로 새로 생긴 개념)을 다시 묻는 재응시 경로: 지금은 만들지 않고 미확인 표시만 한다. 실제 사용자가 생기면 다시 정한다.

## 테스트

- `npm test`: 빌드 후 `backend/test/*.test.ts`를 `node:test`로 실행한다.
- `npm run typecheck`: 타입 검사.
- `npm run eval:evaluator -- --set smoke|hard`: 실제 Gemini로 평가자 정확도를 잰다(기본 smoke). 비용과 요청 제한 때문에 `npm test`에는 넣지 않는다. 케이스 사이 대기는 `EVAL_DELAY_MS`(기본 1000, 무료 등급은 5000 권장).
  - `llm/eval/smoke/`: 회귀 테스트용. 루브릭 표현을 따른 쉬운 케이스라 거의 100%가 정상이고, 평가자 품질의 근거로 쓰지 않는다.
  - `llm/eval/hard/`: 품질 평가용. 공격 케이스(`source: synthetic`)와 사람 답변(`source: human`)을 source별로 따로 집계한다. 형식과 필드는 `llm/eval/README.md`.
  - 출력: 일치율(전체·단계·source·유형), source별 혼동 표, 평가자 형식 재시도(케이스별·전체 비율), 같은 뜻 쌍(`pair_id`) 일치율, 틀린 케이스.
- `npm run eval:export-human -- --db 파일 ...`: 체크포인트 DB의 첫 판정 답변을 `llm/eval/hard/pending/`에 내보낸다(판정 빈칸, 모델 판정은 별도 파일, 사용자 id 익명화). 팀원 테스트 안내는 `docs/team-test.md`.
- 평가자 프롬프트나 루브릭을 바꾸면 `eval:evaluator`를 smoke·hard로 다시 돌려 일치율을 확인한다.
- `npm run eval:questions -- --polish-count 3 --out 파일.md`: 질문 은행이 있는 개념은 은행 질문마다 말투 다듬기를 N회 돌려 원문·다듬은 결과의 유출 검사(완화·엄격 4글자)와 사용한 문장(다듬은 문장·원문)을 표로 출력한다. '의미 변경'은 사람이 채운다. 은행이 빈 개념은 `--count`(기본 10)개의 LLM 질문을 만들어 처리(통과·재생성·대체)를 기록하고 '범위 초과'는 사람이 채운다. 모든 Gemini 호출 사이에 `--gap`(기본 6000ms)을 둔다.
- 긴 실제 Gemini 실행(평가 여러 회차)은 컴퓨터가 절전에 들어가면 호출 시간 초과로 중단된다. macOS에서는 `caffeinate -i npm run eval:evaluator -- --set hard`처럼 앞에 `caffeinate -i`를 붙여 명령이 끝날 때까지 절전을 막는다(덮개를 닫으면 효과 없음). 팀원 테스트 서버·터널도 같은 방법으로 띄운다(`docs/team-test.md`).
- `eval:evaluator`, `eval:questions`는 케이스마다 결과를 `llm/eval/results/*.jsonl`(Git 제외, `--records`로 변경)에 바로 기록한다. 끊기면 `--resume`으로 이어서 실행한다. 같은 모델·프롬프트·루브릭으로 끝난 케이스만 건너뛰고, 보고서는 파일의 기록 전체로 만든다. `--resume` 없이 결과 파일이 있으면 덮어쓰지 않고 멈춘다.
- 429·시간 초과·연결 실패는 `EVAL_RETRY_BASE_MS`(기본 10000)부터 2배씩 늘려 최대 3회 다시 호출한다. 그래도 실패하면 `infra_error`로 기록해 평가자 형식 오류(`format_error`)와 따로 세고, 일치율·처리 비율에서 빼되 개수는 표시한다. 연속 3케이스가 `infra_error`면 멈춘다(`--resume`으로 다시 실행).
- `eval:questions` 보고서에는 유출 검사에 걸린 질문 문장과 걸린 표현(정답 용어·근거 문장 구)을 시도별로 함께 적는다.
- 평가자·튜터 프롬프트는 `llm/prompts/`에 있다. 평가자 프롬프트를 바꾸면 `eval:evaluator`로 일치율을 다시 확인한다.
- 소스를 지우거나 옮긴 뒤 테스트가 이상하면 `.build/`를 지우고 다시 실행한다(이전 빌드 결과가 남는다).
