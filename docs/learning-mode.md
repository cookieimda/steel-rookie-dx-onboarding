# 학습 모드 설계

튜터의 학습 모드(자유 질문, 점수 없음)를 Gemini에 연결하는 설계와 결정 사항. 체크포인트 모드는 [checkpoint-api.md](checkpoint-api.md).

체크포인트 작업은 PR #13으로 `dev`에 들어갔다. 학습 모드 구현은 `dev`에서 새 브랜치로 시작한다. 시작 안내는 [onboarding-learning-mode.md](onboarding-learning-mode.md).

## 현재 상태

- 서버 `/api/chat`은 학습 모드 라우터(`backend/src/learning/routes.ts`)가 답한다. 예전 제선 Q&A(`ironmaking-agent.ts`, 공개 자료 메모를 통째로 프롬프트에 넣어 Gemini를 1회 호출하고 대화를 서버 메모리에 보관)는 지웠다. 기본 모델 상수 `DEFAULT_GEMINI_MODEL`은 `llm/src/gemini.ts`로 옮겼다.
- 화면(최종 페이지 v2)의 학습 모드 입력은 `frontend/3d-demo/learning-chat.js`가 `/api/chat`으로 보내고, 튜터가 답과 함께 보낸 3D 화면 조작(`scene_actions`)을 실행한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 3D 화면 조작(`scene_actions`) | 튜터가 답과 함께 보낸다. 설비 목록은 서버가 `data_v2.js`를 읽기만 한다(아래 '화면 조작'). "재학습 시 3D 하이라이트"는 다음 단계. |
| 오개념 감지 | 답변과 **같은 응답**에서 감지한다. 학습자가 무언가를 **사실로 단정할 때만** 기록한다. |
| 체크포인트 `conceptOrder` | 루브릭 순서를 유지한다. 학습 모드 오개념은 체크포인트 **튜터의 context로만** 쓴다. |
| 대화 저장 | DB에 저장하고 보관 기간은 두지 않는다. |
| 근거 문서 | `section.md` 작성 전까지 공개 자료 메모로 먼저 연결한다. 검색은 `retrieve()`로 분리한다. |
| 개인 페이지 | `source`가 `learning`인 오개념은 "대화 중 감지됨" 라벨로 구분한다. |
| 키워드 카드 | 튜터가 같은 응답에서 카드를 띄울 개념만 고르고, 내용은 서버가 루브릭에서 꺼낸다. 호출은 1회 그대로다. 연습 문제·채점·도구 호출 루프는 두지 않는다([#67](https://github.com/steel-rookie/ST-ROOKIE/issues/67)). |

## 흐름

```
POST /api/chat { question, session_id?, screen?: { process_id, equipment_id } }
  → 안전 질문 차단 (mockTutor의 키워드 규칙을 서버로 옮김, LLM 호출 없음)
  → retrieve(section, question, screen): 근거 조각 3~5개
  → 학습자 메모: 이 섹션의 미해결 오개념 요약(학습·체크포인트 모두)
  → 체크포인트 상태: 아직 만점이 아닌 개념(retry_concept_ids), 진행 중 여부(진행 중이면 카드 개념 목록을 비움)
  → Gemini 1회 (GeminiClient, responseSchema, temperature 0.3)
      { answer, status, source_ids, follow_up, scene_actions: [{ type, target_id }], detected_misconception: { concept_id, summary } | null, keyword_card: { concept_id } | null }
  → 검증: source_ids가 이번에 검색한 조각인지, concept_id가 루브릭 개념인지, scene_actions가 화면 목록의 공정·설비인지, keyword_card가 카드 개념인지
  → keyword_card가 있으면 루브릭에서 카드 내용을 꺼낸다(keywords.ts)
  → detected_misconception이 있으면 misconceptions에 기록(source: learning, 점수 반영 없음)
  → 대화 저장(learning_turns)
응답 { answer, status, sources, follow_up, scene_actions, keyword_card, session_id }
```

- 기존 `/api/chat` 요청·응답 필드는 유지하고 새 필드는 모두 선택값으로 추가한다.
- 사용자 구분(`X-User-Id`, 로그인 후에는 JWT), 접속 비밀번호, 하루 LLM 호출 한도는 체크포인트와 같은 장치를 쓴다.
- 학습 모드는 채점하지 않으므로 오개념을 해결 처리하지 않는다. 해결은 체크포인트에서 맞혔을 때만 일어난다.

### 라우트 구현 (`backend/src/learning/routes.ts`)

- `createLearningRouter({ repo, retriever, agent, rubrics, scene, checkpointProgress })`를 `createApp({ learning })`에 넘긴다. `POST /api/chat`은 학습 모드가 답한다(예전 제선 Q&A 핸들러는 지웠다).
- 요청 `{ question, session_id?, screen?: { process_id, equipment_id } }`, 응답 `{ answer, status, sources, follow_up, scene_actions, keyword_card, session_id }`. `process_id`가 없으면 답은 제선 기준이고, 화면 조작은 전체 공정 화면 기준이다.
- 세션은 DB(`learning_turns`)로 이어진다. 없는 세션·다른 사람의 세션은 404, 같은 세션에서 답변 중 다시 질문하면 409.
- `GET /api/chat/sessions/:sessionId`: 저장된 대화를 오래된 것부터 최근 50개(`RESTORE_TURNS`) `{ session_id, turns: [{ question, answer, status, section, equipment_id, sources }] }`로 돌려준다. 출처는 저장된 조각 id를 `Retriever.sourceIdsOf()`로 자료 id로 바꿔 POST와 같은 모양으로 만든다. `follow_up`·`scene_actions`·`keyword_card`는 저장하지 않아 돌려주지 않는다(새로고침하면 카드는 다시 보이지 않는다). 없는 세션·다른 사람의 세션·잘못된 id는 404. 오류로 끝난 질문은 저장하지 않으므로 다시 보이지 않는다.
- 안전 질문(`safety.ts`)은 튜터를 부르지 않고 `safety_redirect`로 저장한다. 조작 방법·허락("밸브를 열어도 돼요?", "정지시키는 방법")과 비상 대응("비상 정지 버튼")만 막고, "고로가 정지하면 어떻게 되나요?" 같은 교육 질문은 통과시킨다(단어 하나로 막지 않음).
- 프롬프트의 학습자 메모는 `latestPerConcept`로 개념당 최근 1개, 최대 5개만 넣는다(`buildLearnerNotes`와 같은 기준).
- 같은 사용자·섹션·개념에 미해결 learning 오개념이 이미 있으면 새로 넣지 않고 summary·답변 원문만 갱신한다. 해결된 뒤 다시 나오면 새로 넣는다.
- 질문만으로 근거를 못 찾고 직전 대화가 있으면, 직전 질문·답변을 붙여 한 번 더 검색한다("그럼 그건요?" 같은 후속 질문).
- 오류: 하루 한도 429, Gemini 키 없음 503, 연결·형식 오류 502. 오류 때는 대화를 저장하지 않는다.
- 화면: `frontend/3d-demo/learning-chat.js`의 `ask()`가 `/api/chat`을 부른다. `session_id`는 탭의 sessionStorage(`st-rookie:learning-session`)에 두고 이어 쓰며, 서버에 없는 세션(404)이면 새 대화로 한 번 다시 묻는다. 페이지를 열 때 `restore()`가 저장된 대화를 불러와 메시지 앞에 붙인다(페이지 로딩을 기다리게 하지 않고, 화면 조작은 다시 하지 않는다). 404면(로그인 사용자가 바뀜 등) id를 지우고 새 대화로 시작한다. 요청은 `request(method, path, body)` 하나로 보내는데, `api-client.js`의 `request`와 같은 모양이라 그쪽으로 바꿀 때 이 함수만 바꾸면 된다. 전체 보기(`site`)에서는 `process_id`를 보내지 않는다(서버 기본: 제선). 사용자 구분은 체크포인트 테스트 페이지와 같이 `?user=`와 저장된 접속 비밀번호를 쓴다. `tutor_v2.js`(가짜 튜터)는 더 이상 부르지 않는다.

### 튜터 구현 (`llm/src/learning-agent.ts`)

- `LearningAgent.reply(input)` → `{ answer, status, source_ids, follow_up, detected_misconception, scene_actions, keyword_card }`. 구현은 `GeminiLearningAgent`, 프롬프트는 `llm/prompts/learning-system.md`.
- 입력: 섹션, 질문, 화면(공정·설비), `retrieve()` 조각, 같은 세션 최근 대화, 미해결 오개념(학습자 메모), 체크포인트 재도전 개념(`<checkpoint_retry>`), 루브릭 개념 목록·용어집, 카드 개념 목록.
- `responseSchema`의 enum으로 `source_ids`는 이번 조각 id, `concept_id`는 루브릭 개념만 고르게 하고, 서버에서 한 번 더 걸러 낸다. grounded인데 남는 근거가 없으면 unverified 고정 답변으로 바꾼다.
- 형식 오류는 1회 다시 부르고(`LearningFormatError`), 연결 오류는 다시 부르지 않는다(`LlmUnavailableError`). 단, Gemini 과부하(HTTP 503 "high demand")와 순간적인 연결 끊김(fetch failed)은 몇 초 사이에도 풀려서 1초·2초 뒤 최대 2번 다시 부른다(시간 초과는 다시 부르지 않음)(`OVERLOAD_RETRY_DELAYS_MS`). 다시 부를 때마다 하루 호출 수에 들어간다. 체크포인트 쪽 호출에는 적용하지 않았다.
- `source_ids`는 조각 id(`자료id#번호`)다. 화면의 출처 링크는 라우트가 조각의 `source_ids`(자료 id)로 `ironmaking-sources.json`에서 찾는다.

### 화면 조작 (`scene_actions`)

- 튜터가 답과 함께 `[{ type, target_id }]`를 보내면 화면의 `runActions`(`learning-chat.js`)가 차례로 실행한다. `type`은 `goto_process`(공정 이동), `focus`(카메라 이동), `highlight`(설비 선택·정보 표시), `play_animation`(소재 흐름 재생).
- 설비 목록: 서버 시작 때 `backend/src/learning/scene-catalog.ts`가 `frontend/3d-demo/data_v2.js`의 `PROCESSES`에서 공정 4개·설비 24개의 id·이름만 읽는다(프론트 파일은 고치지 않음). 형식이 틀리거나 설비 id가 겹치면 서버가 시작하지 않는다.
- 프롬프트에 화면 목록(`id (이름)`)을 넣고, `responseSchema`의 enum으로 `target_id`를 목록 안에서만 고르게 한다. 규칙: 설비를 다루면 `focus`+`highlight`, 다른 공정을 물으면 `goto_process`, 흐름·순서를 물으면 `play_animation`, 이미 보고 있는 설비면 빈 배열, 조작은 2개 이하. 근거가 없어 unverified로 답해도 화면 조작은 한다(화면을 보여 주는 것은 사실 주장이 아니고, 지금은 제선 밖 공정에 근거 자료가 없다).
- 서버 정리(`normalizeSceneActions`): 목록에 없는 id·조작은 버린다. 다른 공정의 설비·공정이면 `goto_process`를 앞에 끼우고, 이미 그 공정이면 `goto_process`를 뺀다(같은 공정으로 이동하면 화면이 초기화된다). `focus`에는 `highlight`를 붙인다. 중복은 빼고 최대 4개.
- 형식이 틀린 `scene_actions`는 답변을 살리고 빈 배열로 본다. grounded인데 근거가 없어 고정 답변으로 바꾸면 조작도 버린다. 안전 질문은 빈 배열.
- 화면은 다른 공정으로 이동한 뒤 3D 모델을 불러오도록 900ms 기다린다(공정 목록에서 다른 공정의 설비를 누를 때와 같은 값).

### 키워드 카드 (`keyword_card`)

- 튜터는 답변이 '카드 개념 목록'의 한 개념을 직접 설명할 때 그 개념을 `keyword_card.concept_id`로 고른다. 요약을 원하거나 재도전·미해결 오개념 개념과 관련된 질문이면 띄우기를 권한다. 고를 수 있는 개념은 `responseSchema` enum으로 묶는다(final 루브릭 개념만, 시연 목록의 개념은 들어오지 않는다).
- 카드 내용(`backend/src/learning/keywords.ts`): 개념 이름, `answer_terms`(용어), 섹션 용어집의 같은 말(예: 일산화탄소 (CO)), 루브릭 `source.ref`의 자료(출처 링크). LLM이 내용을 만들지 않는다.
- `answer_terms`는 원래 "질문에 쓰면 안 되는 말" 목록이라 유출을 막으려고 다른 공정 용어를 넣어 둔 개념이 있다(예: `blast_furnace_hot_metal`의 전로·제강·용강). 그래서 루브릭 담당과 확인한 개념만 `KEYWORD_CARD_CONCEPTS`에 둔다. 지금은 `coke_reduction` 하나. 허용 개념이 final 루브릭에 없거나 `answer_terms`가 없으면 테스트가 실패한다. `section.md`가 생기면 카드 내용은 그쪽에서 꺼내는 것으로 바꾼다.
- 카드는 grounded 답변에만 붙인다. unverified, 근거 없는 grounded(고정 답변으로 바뀜), 형식이 틀린 카드, 목록에 없는 개념은 버리고 답변은 살린다.
- 체크포인트 진행 중이면 서버가 카드 개념 목록을 비우고 카드를 붙이지 않는다(정답 용어가 모여 있어서). 화면에서는 이미 받은 카드를 `checkpoint-chat.js`의 `lockLearning()`이 숨긴다. 메시지의 카드 필드는 `hasKeywordCard`·`keywordCard`(`learning-chat.js`의 `vals()`)다.
- 체크포인트 상태는 서버가 엔진의 `sectionProgress`(실제 기록만, 이해도는 `summarizeSection`)로 넘긴다(`ironmaking-server.ts`). 루브릭이 없는 섹션은 null이고 카드도 없다.

### 오개념 감지 기준

- 기록한다: 학습자가 틀린 내용을 사실로 단정한 경우. 예: "코크스가 불순물 없애는 거죠?", "소결은 쇳물 만드는 거잖아요."
- 기록하지 않는다: 열린 질문("코크스가 뭐예요?"), 확인을 구하는 중립 질문, 모델이 추측한 오해.
- `concept_id`는 루브릭 개념 목록 안에서만 고른다(responseSchema enum). 해당 개념이 없으면 기록하지 않는다.

## 근거 문서와 검색

- 기준 문서는 `content/materials/{섹션}/section.md`(CLAUDE.md의 단일 기준). 아직 없다.
- 그 전까지는 `backend/data/ironmaking-sources.json`의 공개 자료 메모를 조각으로 쓴다(지금과 같은 근거).
- `retrieve(section, query, screen)` 인터페이스를 먼저 만든다. 데이터 원천만 바꾸면 `section.md`로 넘어갈 수 있게 한다.
  - `section.md` 조각: 제목(H2/H3) 하나가 조각 하나(300~600자). 제목에 개념·설비 id(`{#coke_reduction}`), 문단 끝에 공개 자료 id(`[src:...]`)를 단다. 출처 링크는 지금처럼 `ironmaking-sources.json`에서 가져온다.
  - 검색: 같은 섹션 안에서 키워드 점수(용어집 동의어 포함), 현재 설비 관련 조각에 가중치. 조각이 100개를 넘으면 임베딩 검색으로 바꾼다.
- `section.md`가 생기면 루브릭의 `quote`도 그 문서 기준으로 다시 만든다.

구현(`llm/src/retrieval.ts`)

- `new Retriever({ glossaryFor }).retrieve(section, question, screen)` → 점수 순 조각 최대 5개(`MAX_RESULTS`). 겹치는 조각이 없으면 빈 배열이고, 이때 모델은 `unverified`로 답한다. 개수를 채우려고 관련 없는 조각을 넣지 않는다.
- 공개 자료 메모는 메모 하나가 조각 하나이고, 자료의 `section`(없으면 제선) 공정에 속한다. 메모에 나온 말로 그 공정의 설비 태그를 붙인다(`EQUIPMENT_WORDS`, 4개 공정·24개 설비). 설비 24개 모두 메모가 있고, 설비 이름으로 물으면 그 설비 메모가 맨 위에 오는지 테스트로 막는다.
- 규모: 66개 자료·메모 200개. 제선 23개 자료·81개, 제강 20·50, 연주 13·34, 열간압연 10·35.
- 자료 범위(포스코 공개 자료만 쓰던 것을 넓힘): 포스코그룹 뉴스룸, 현대제철, 한국철강협회, 철강 전문지(철강금속신문·스틸데일리), 해외 제철사·교육 자료(일본제철 기술보고서, 고베제강, JFE 21세기재단, 아르셀로미탈, 미국 압연공장 설비 자료, 독일 제강사), 설비 제작사 설명 페이지(Primetals·SMS group·Lechler, 일반 설명 문장만), 국제기구·정부 문서(worldsteel, EU 공동연구센터 철강 BAT 기준서), 학회 논문(koreascience, 일본기계학회), 일본 철강슬래그협회, 신문 기사. 영문 위키백과는 공정마다 1개 이하로만 썼다.
- 쓰지 않는 곳: 나무위키·개인 블로그·카페·브런치·velog(테스트로 막음), 특허, 출처가 불분명한 개인 사이트.
- 메모마다 원문 문장 `evidence`를 하나씩 둔다(메모 수와 같은지 테스트로 확인). 원문을 내려받아 문장이 그대로 있는지 확인한 뒤 넣었다. 떨어진 두 문장을 이을 때는 " … "로 표시한다. 메모는 원문을 한국어로 옮겨 정리한 것이고, 원문에 없는 설명을 더하지 않는다.
- 출처마다 숫자가 다를 수 있다(코크스 건류 온도: 포스코 1,300℃, 철강금속신문 1,000~1,300℃). 메모는 출처 표현 그대로 두고 하나로 맞추지 않는다. 숫자는 `section.md`를 만들 때 정리한다.
- 원문 단위가 의심스러운 숫자는 메모에 넣지 않았다(한국철강협회 빌릿 "약 120~160cm", RIST 논문 "재결정 온도 1200℃").
- 앞서 찾지 못한 근거: 소결의 통기성(가루 원료를 그대로 넣으면 고로를 막아 가스 흐름을 방해함)은 일본제철 기술보고서 No.123, 열풍로 축열 원리는 JFE 21세기재단과 EU JRC에서 찾았다. 루브릭 초안 `draft/sinter_purpose.v2.json`의 근거로도 쓸 수 있다(루브릭 담당자 확인 필요).
- 아직 약한 곳: 디스케일러의 국내 설명 자료가 없어 영문 자료만 있다. 연주 배출 롤러, LF 슬래그의 역할(아크 덮개·탈황)을 일반적으로 설명한 자료는 찾지 못했다. 제강 메모 50개 중 9개가 EU JRC 기준서라 유럽 기준 표현("현대 제철소에서는", "보통")을 원문대로 살렸다.
- 점수: 질문과 조각의 두 글자 조각(bigram) 겹침 비율. 조사가 붙어도(고로에서·고로를) 맞도록 단어 대신 bigram을 쓴다. 제목은 같은 자료의 메모가 공유하므로 0.3배로 센다. 용어집 동의어를 질문에 붙여 넣는다(쇳물 → 용선). 섹션과 상관없는 질문 말도 같은 방식으로 넓힌다(`QUESTION_WORDS`: "몇 도" → 온도·고온, 메모가 "1,300℃의 고온"처럼 적기 때문). 현재 설비 태그가 있는 조각은 +0.15(질문과 겹칠 때만). 0.08 미만은 버린다.
- `loadSectionChunks(section)`: `content/materials/{섹션}/section.md`가 있으면 `parseSectionMarkdown`으로 나누고, 없으면 그 공정의 공개 자료 메모를 쓴다.

## 학습자 메모 (체크포인트와 공유)

- 새 테이블 없이 `misconceptions`(`source`: learning | checkpoint)를 중심으로 쓴다.
- `buildLearnerNotes(userId, section)` → `LearnerNotes { conceptOrder, context }`
  - `conceptOrder`: 루브릭 순서 그대로.
  - `context`: 미해결 오개념 요약.
- 학습 모드 → 체크포인트: 엔진이 부가 설명(첫 판정이 correct가 아닐 때)을 할 때 메모를 읽어 **튜터에게만** 주고, 부가 설명에서 알려진 오해를 짚게 한다. **평가자에게는 넘기지 않는다**(평가자 입력은 루브릭·질문·답변뿐, 과거 기록으로 채점이 치우치지 않게).
- 구현(`backend/src/learning/notes.ts`): 서버 시작 때 `useLearnerNotesSource(...)`로 기록 저장소를 넘긴다(시그니처가 고정이라 인자로 받을 수 없어서). 서버(`ironmaking-server.ts`)는 `learningRepo`를 감싸 지금 final 루브릭에 없는 개념의 오개념을 빼고 넘긴다. `buildLearnerNotes`는 섹션의 미해결 오개념을 최근 것부터 개념당 하나, 최대 5개를 출처 라벨(대화 중 감지됨·이해도 확인)과 함께 `context`로 요약한다. `conceptOrder`는 넣지 않는다(루브릭 순서). 저장소가 없거나 오개념이 없으면 빈 메모.
- 체크포인트 쪽 연결(체크포인트 담당, #48): 서버가 `buildLearnerNotes`를 엔진 의존성 `learnerNotes`로 넘긴다. 엔진은 부가 설명 때만 이 함수를 불러(`respond`·`retryEvaluation`에 `options.notes`를 주면 그 메모를 우선) `context`를 `Tutor.explanation`의 `learnerNotes`로 넘긴다. 튜터 프롬프트(`tutor-explanation.md`, `tutor-correction.md`)에는 `<learner_notes>` 구분자로 감싸 이스케이프해 넣고, 이 개념과 관련된 항목만 짚게 한다.
- 체크포인트 → 학습 모드: 체크포인트에서 나온 미해결 오개념을 학습 모드 프롬프트에 넣어, 관련 질문이 오면 먼저 바로잡게 한다. 화면에는 "지난번 헷갈린 개념" 추천 질문으로 보여 준다.

## 저장

`backend/src/db/migrations/004_learning.sql` (`003_users.sql`은 로그인 계정)

```sql
CREATE TABLE learning_turns (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,       -- 세션 안 순서(1부터), UNIQUE (session_id, seq)
  section     TEXT,
  equipment_id TEXT,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  status      TEXT NOT NULL,          -- grounded | unverified | safety_redirect (CHECK)
  source_ids  TEXT NOT NULL,          -- JSON 배열
  created_at  TEXT NOT NULL
);
```

보관 기간은 두지 않는다. 사용자 기록 삭제(`npm run db:reset-user`)에 이 테이블도 포함한다.

- 저장소: `backend/src/learning/repository.ts`(`LearningRepository`). 대화 저장(`saveTurn`), 세션의 최근 대화(`recentTurns`), 세션 주인 확인(`sessionOwner`), 학습 모드 오개념 기록(`recordMisconception`, source=learning), 섹션의 미해결 오개념(`openMisconceptions`, 학습·체크포인트 모두).
- 정렬은 SQLite 전용 `rowid` 대신 `seq`로 한다.

## 개인 페이지 표시

- 오개념 목록에서 `source = learning`은 "대화 중 감지됨", `source = checkpoint`는 "이해도 확인"으로 라벨을 붙인다.
- 상태(미해결/해결됨)는 두 출처 모두 같은 규칙: 체크포인트에서 그 개념을 맞히면 해결됨.

## 파일

| 파일 | 역할 |
|---|---|
| `llm/src/learning-agent.ts` | `ironmaking-agent.ts`(삭제) 대체. `GeminiClient` 사용, `LearningAgent` 인터페이스(테스트용 가짜 구현) |
| `llm/src/retrieval.ts` | `retrieve()`: 섹션 문서 조각 나누기와 검색 |
| `backend/src/learning/scene-catalog.ts` | 화면 조작용 공정·설비 목록(`data_v2.js`를 읽기만 함) |
| `backend/src/learning/keywords.ts` | 키워드 카드 내용(루브릭 `answer_terms`·용어집·근거 자료), 카드 허용 개념 `KEYWORD_CARD_CONCEPTS` |
| `llm/prompts/learning.md` | 학습 모드 프롬프트 |
| `backend/src/learning/` | 라우트, 안전 규칙, `buildLearnerNotes`(`notes.ts`, 시그니처 고정), 대화 저장소 |
| `frontend/3d-demo/learning-chat.js`의 `ask()` | `mockTutor` 대신 `/api/chat`. `session_id` 유지, 상태 표시와 출처 링크 |
| `llm/eval/run-learning.ts`, `llm/eval/learning/ironmaking.jsonl` | 학습 모드 품질 평가(`npm run eval:learning`) |
| `frontend/3d-demo/learning-suggestions.js` | 화면(공정·설비)별 추천 질문 |

## 품질 평가 (`npm run eval:learning`)

- 제선 질문 24개(설비 6·지시어 2·흐름 2·다른 공정 2·전체 화면 1·용어집 2·오개념 4·FINEX 1·근거 없음 2·안전 2)를 실제 Gemini로 돌려 세 가지를 센다: 근거 판정(`grounded`·`unverified`·`safety_redirect`), 화면 조작, 오개념 감지.
- 라우트와 같은 순서(안전 질문 차단 → `retrieve()` → 튜터 1회)로 부르고, 이전 대화·학습자 메모는 넣지 않는다. 공정·설비 목록은 서버처럼 `data_v2.js`에서 읽는다.
- 케이스 형식: `expect.scene`은 들어 있어야 하는 조작(순서 무관, 더 있어도 됨)이고 `[]`이면 조작이 없어야 하며 `"any"`면 보지 않는다. `expect.misconception`은 감지돼야 하는 개념 id 또는 `null`. 선택 필드 `expect.answer_any`는 답에 하나라도 들어 있어야 하는 말이다(오개념 케이스에서 바로잡았는지 보려고 "아니"·"아닙" 등. 낱말 검사라 같은 뜻의 다른 표현은 놓칠 수 있다). 케이스의 id·개념·안전 기대가 실제 목록·루브릭·안전 규칙과 맞는지 `npm test`로 확인한다.
- 결과 기록·`--resume`·연결 재시도는 `eval:evaluator`와 같은 `run-log.ts`를 쓴다(기본 기록 `llm/eval/results/learning-ironmaking.jsonl`). 채점은 보고서를 만들 때 하므로 기대값만 고치면 `--resume`으로 다시 부르지 않고 다시 채점된다.
- 추천 질문(`frontend/3d-demo/learning-suggestions.js`)도 케이스로 만든다(유형 `chip`, grounded 기대, 화면 조작은 보지 않음). `--follow-up`이면 grounded 답의 '생각해 보기'를 같은 화면에서 다시 물어 근거 있는 답이 나오는지 센다.
- 첫 측정(2026-10-06, `gemini-3.5-flash-lite`, 1회): 전체 통과 23/24(95.8%), 근거 판정 24/24, 화면 조작 16/17, 오개념 감지 24/24. 틀린 1개는 "용광로에서 나온 쇳물은 어떻게 옮겨?"에서 토페도카 대신 출선구로 카메라를 옮긴 것(답은 출선구 → 토페도카를 모두 설명).
- 프롬프트 수정 뒤(질문이 묻는 대상 설비 하나만 보여 주기, '생각해 보기'는 근거로 답할 수 있는 질문만) 추천 질문 22개를 더해 `--follow-up`으로 측정(같은 날, 1회): 전체 통과 46/46, 화면 조작 17/17, 꼬리 질문 grounded 41/42. 남은 1개는 전체 공정 화면의 고로 답에서 나온 "고로에 들어가는 열풍은 어떻게 만들어지나요?"가 unverified.
- 자료 5건 추가·자료 질문 5개(유형 `material`) 추가·프롬프트 예시(다음 공정 이동, 꼬리 질문은 지금 섹션 안에서만) 뒤(같은 날, 1회): 전체 통과 51/51, 화면 조작 17/17, 꼬리 질문 grounded 45/46. 남은 1개는 "고로 안으로 불어넣는 뜨거운 바람은 어떻게 만드나요?"(열풍로 축열 원리 자료가 없음).
- 시연 리허설에서 "코크스는 불순물 없애려고 넣는 거죠?"에 오개념은 기록됐지만 답이 바로잡지 않아, 프롬프트에 "오개념을 감지하면 답 첫 문장에서 부드럽게 바로잡기"를 넣고 오개념 케이스 2개에 `answer_any`를 붙였다. 다시 측정(같은 날, 1회): 전체 통과 51/51, 답변 내용 2/2, 꼬리 질문 grounded 46/46.
- 학습 프롬프트·검색·공개 자료 메모·추천 질문을 바꾸면 다시 돌려 확인한다.

## 추천 질문 (`frontend/3d-demo/learning-suggestions.js`)

- 튜터 패널의 질문 버튼. 제선은 설비를 고르지 않았을 때 4개, 설비 6개마다 3개씩 두고, 공개 자료로 답할 수 있는 질문만 넣는다(`eval:learning`의 `chip` 케이스로 확인).
- `learning-chat.js`의 `vals()`가 `suggestionsFor(공정, 설비)`로 고르고, 정해 둔 것이 없는 공정(제강·연주·압연)은 `data_v2.js`의 `SUGGESTED`를 그대로 쓴다.

## 다음 단계로 미룬 것

- 재학습 시 3D 하이라이트: 오개념이 있는 개념과 관련된 설비를 3D에서 강조해 다시 보게 한다.
