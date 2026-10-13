# 보충학습 에이전트

작성: 2026-10-14. LLM 개발 문서(`docs/private-llm-development.md`) 4단계 "보충학습 Agent"를 학습 모드에 붙인 것이다. 모델(Gemini·로컬)과 상관없이 동작한다.

## 무엇을 하나

오개념이 있는 개념을 학습자가 스스로 다시 공부하게 이끈다.

```text
오개념/재도전 개념 → 학습 상태 확인 → 근거 검색 → 관련 설비 보여 주기 → 설명 + 확인 문제
  → 채점 → 맞음: 학습 메모 오개념 해결, 끝
         → 아님(첫 문제): 놓친 부분부터 다시 설명 + 다른 각도의 확인 문제 → 채점 → 맞음: 해결 / 아님: 핵심 정리, 끝
```

- 화면: 3D 화면(v4)과 마이페이지 튜터 패널의 추천 질문 앞에 `보충학습 · 개념` 칩(최대 2개)이 나온다. 페이지 템플릿은 고치지 않았다(`learning-chat.js`의 칩·메시지 값만 바꿈).
- 진행 중에는 입력창에 쓴 말을 확인 문제의 답으로 보내고, 칩은 `보충학습 그만하기` 하나만 보여 준다.
- 새로고침하면 "풀던 보충학습이 있어요 · 개념 + 지금 확인 문제"를 한 번 보여 주고 이어서 답할 수 있다.

## 정한 것

| 항목 | 결정 | 이유 |
|---|---|---|
| 도구 순서 | 서버가 정한 순서로 부른다. 모델은 설명·확인 문제·채점만 한다 | Gemini가 느릴 때(짧은 호출도 70초 넘음) 단계마다 모델에게 다음 도구를 물으면 한 번에 몇 분이 걸린다. 도구 계약·검증(`learning-tools.ts`)은 모델이 고르게 바꿔도 그대로 쓴다 |
| 확인 문제 | 체크포인트 질문 은행(`questions`·`recheck_questions`·`fallback_question`)을 쓰지 않고 LLM이 만든다(`GeminiTutor.practiceQuestion`). 같은 유출 검사를 거치고, 두 번 걸리면 고정 문장 | 연습에서 시험 문제를 미리 보면 체크포인트가 이해도를 재지 못한다 |
| 채점 | 체크포인트와 같은 평가자·루브릭. 두 번째 문제는 `recheck`(assisted 없음) | 판정 기준을 하나로 둔다 |
| 기회 | 확인 문제 최대 2번(처음 + 다시 설명한 뒤 1번) | 체크포인트의 "재확인 1회"와 같다 |
| 해결 | 맞히면 그 개념의 **학습 모드 오개념 메모(`source = learning`)만** 해결한다 | 체크포인트 오개념은 점수·관리자 통계의 근거라 체크포인트에서 맞혀야 해결된다(CLAUDE.md '오개념 기록'). **팀 확인 필요** |
| 점수 | 반영하지 않는다 | 점수는 체크포인트만 |
| 오개념 기록 | 채점에서 나온 오개념은 학습 메모(`source = learning`)로 남긴다(같은 개념 미해결 메모가 있으면 갱신) | 학습 모드 기록 규칙과 같다 |
| 후보 | 지금 final 루브릭 개념 중 미해결 오개념이 있거나 체크포인트 재도전 개념. 보충학습으로 해결한 뒤 새 오개념이 생기지 않은 개념은 뺀다 | 체크포인트 오개념은 해결로 바뀌지 않아도 같은 개념을 계속 권하지 않게 |
| 시연 기록 | 후보와 '지난번 기록'은 시연 기록(`origin = 'seed'`, 시연 계정 trainee02~20에만 있음)도 본다. 해결 처리는 실제 기록만 한다 | 시연 계정으로 보충학습을 보여 주려고(관리자 통계가 seed를 세는 것과 같은 이유). 학습 채팅 프롬프트·학습자 메모는 지금처럼 실제 기록만 본다 |
| 설비 | 루브릭 개념의 `equipment_ids`(선택, 스키마에 추가) 중 화면 목록에 있는 첫 설비를 보여 준다 | CLAUDE.md '다음 단계: 개념 ↔ 설비 연결' |
| 이해도 확인 중 | 답하는 중(`awaiting_*`·`error`)이면 시작·답하기 409(`CHECKPOINT_IN_PROGRESS`). '나중에 이어 풀기'로 멈춘 동안은 쓸 수 있다. 화면에서는 체크포인트 잠금(`lockLearning`)이 칩·입력을 막는다 | 시험 중 연습 금지. 멈춘 동안 학습 채팅을 쓸 수 있게 한 결정(CLAUDE.md '확정')과 맞춘다 |
| 오래 멈춤 | 마지막 활동 뒤 2시간이 지나면 다음 요청 때 끝낸다(`stopped`) | 오래된 문제에 답하지 않게 |
| 자료 부족 | 근거를 못 찾거나 튜터가 근거 없이 답하면 루브릭 핵심 요소를 정리해 보여 준다 | 근거 없는 설명을 하지 않는다 |

## 도구

계약: `llm/src/learning-tools.ts`, 실행: `backend/src/learning/agent-tools.ts`. 모든 호출은 형식 → 공정 범위(지금 공정만) → 설비·개념 존재를 확인한 뒤 실행하고, 거절도 실행 기록에 남긴다.

| 도구 | 입력 | 결과 |
|---|---|---|
| `get_learning_state` | section | 미해결 오개념(개념당 최근 1개, 지금 루브릭 개념만), 체크포인트 재도전 개념 |
| `search_materials` | section, query, equipment_id | 근거 조각(`retrieval.ts`) |
| `show_equipment` | section, equipment_id | 화면 조작(focus·highlight). 다른 공정 화면이면 서버가 goto_process를 앞에 붙인다 |
| `create_quiz` | section, concept_id, previous_question | 확인 문제, 고정 문장을 썼는지, 시도별 문장·유출 표현 |
| `evaluate_answer` | section, concept_id, question, answer, phase | 평가자 판정 |

모델 호출 수: 시작 2~3회(설명 1 + 확인 문제 1~2, 동시에), 답하기 1회(맞음·마지막) 또는 3~4회(채점 + 다시 설명 + 확인 문제). 모두 사용자 하루 호출 수에 들어간다.

## API

모두 `/api` 공통 처리(로그인 토큰, 임시 `X-User-Id`, 접속 비밀번호)를 거친다. 오류 본문은 `{ error, code }`.

| 요청 | 설명 |
|---|---|
| `GET /api/learning/supplements?section=` | `{ candidates: [{concept_id, name, reason: "misconception"\|"retry", summary}], active: 보기\|null }`. 루브릭 없는 공정은 빈 목록 |
| `POST /api/learning/supplements` `{section, concept_id, screen?: {process_id}}` | 시작(201). 같은 공정의 진행 중 보충학습은 끝낸다 |
| `POST /api/learning/supplements/:id/answer` `{answer}` | 확인 문제에 답하기. 채점이 실패하면(502·503·429) 답을 받지 않은 것으로 둬서 같은 문제에 다시 답한다 |
| `POST /api/learning/supplements/:id/stop` | 그만두기 |
| `POST /api/learning/supplements/:id/scene-results` `{results: [{type, target_id, status}]}` | 화면이 실제로 실행한 조작 결과(204). 도구가 만든 조작과 실제 성공을 따로 남긴다 |

보기(`SupplementView`): `id, section, concept_id, concept_name, state(awaiting_answer|awaiting_recheck|completed|stopped), outcome(resolved|not_resolved|null), question, messages[{role, type, text, sources?}], scene_actions`. 시작·답하기의 `messages`는 이번 요청에서 새로 생긴 말이고, `GET`의 `active.messages`는 지금까지의 말 전체다.

오류 코드: `NO_RUBRIC`·`UNKNOWN_CONCEPT`·`NOT_FOUND`(404), `CHECKPOINT_IN_PROGRESS`·`FINISHED`·`EXPIRED`·`BUSY`(409), `BAD_REQUEST`(400), `USAGE_LIMIT`(429).

## 저장

`009_learning_supplements.sql`.

- `learning_supplements`: 사용자·공정·개념·상태·결과·지금 확인 문제·시각.
- `learning_supplement_steps`: 실행 기록. `kind`는 `tool`(도구 이름, 입력·결과 요약, 성공 여부, 걸린 ms), `message`(주고받은 말), `scene_result`(화면 실행 결과). 순서대로 보면 한 보충학습을 다시 볼 수 있다. 시작 중 모델 호출이 실패하면 보충학습을 만들지 않으므로 기록도 남지 않는다.
- `npm run db:reset-user`(`deleteUserData`)는 live·all일 때 두 표를 함께 지운다.

## 확인

- 테스트: `backend/test/learning-supplement.test.ts`(후보, 시작, 맞음·틀림·재확인, 채점 실패 복구, 이해도 확인 중 409, 다른 사람 404, 이어 하기·그만두기·만료, 화면 결과, 도구 검증, 기록 삭제), `learning-chat-supplement.test.ts`(화면 흐름), `gemini-checkpoint.test.ts`(확인 문제가 은행을 쓰지 않음).
- 실제 Gemini(2026-10-14 밤, 응답이 매우 느림)로 '고로에서 코크스의 역할' 한 번을 끝까지 돌렸다. 각 단계 소요 시간과 결과:
  - 시작 52초: 오개념을 바로잡는 설명과 근거 3개가 나오고, 고로를 3D로 보여 줬다.
  - 틀린 답 153초: 다시 설명한 뒤 다른 각도로 다시 물었다.
  - 맞는 답 88초: 해결 처리했다.
  - 중간에 Gemini 503이 한 번 났다. 같은 문제에 다시 답해서 이어 갔다.
- 헤드리스 Chrome으로 3D 화면(칩 → 설명·확인 문제, 소결기 강조)과 마이페이지(새로고침 뒤 이어 하기 안내)를 확인했다. 콘솔 오류는 없었다.

## 남은 것

- 해결 규칙(학습 메모만 해결)은 팀 확인이 필요하다.
- 모델이 다음 도구를 고르는 방식(계획 루프)은 느린 모델에서는 쓰지 않는다. 빠른 자체 서빙이 생기면 같은 도구 계약으로 바꿀 수 있다.
- 확인 문제가 유출 검사에 자주 걸린다. 소결 개념은 두 번 모두 '소결광'·'전처리'를 써서 고정 문장이 나왔다. 프롬프트 개선이 필요하다(`eval:questions`로 측정).
- 다른 공정(제강·연주·압연)은 final 루브릭이 없어 후보가 없다.
