# 로그인 API

아이디 + 비밀번호(bcrypt 해시) + JWT. 화면은 `frontend/login_ui/My Page.dc.html`.

## 엔드포인트

| 요청 | 본문 | 성공 | 실패 |
|---|---|---|---|
| `POST /api/auth/signup` | `{ username, password, name, employee_no }` | `201 { token, user }` | `400` 형식 오류, `409 USERNAME_TAKEN`, `409 EMPLOYEE_NO_TAKEN` |
| `POST /api/auth/login` | `{ username, password, remember? }` | `200 { token, user }` | `401 INVALID_CREDENTIALS` |
| `POST /api/auth/find-id` | `{ name, employee_no }` | `200 { username }` | `400`, `404 NOT_FOUND` |
| `POST /api/auth/reset-password` | `{ username, name, employee_no, password }` | `200 { ok: true }` | `400`, `404 NOT_FOUND`, `403 DEMO_ACCOUNT` |
| `GET /api/auth/demo-accounts` | 없음 | `200 { accounts, password }` | 꺼져 있으면 `{ accounts: [], password: null }` |
| `GET /api/auth/me` | 헤더 `Authorization: Bearer <token>` | `200 { user }` | `401 AUTH_REQUIRED`, `401 TOKEN_INVALID` |

- `user`는 `{ id, username, role, name, employee_no }`. `role`은 `trainee`(신입사원) 또는 `admin`(관리자). 회원가입은 항상 `trainee`로 만든다.
- `id`는 UUID이고, 다른 테이블의 `user_id`는 이 값을 쓴다.
- 실패 응답은 `{ error, code? }`. `error`는 화면에 그대로 보여 줄 수 있는 한국어 문장이다.
- 아이디: 영문 소문자·숫자·`_`, 4~20자. 비밀번호: 8자 이상, UTF-8 72바이트 이하(bcrypt 한도). 이름: 1~20자. 사번: 영문·숫자·`-` 3~20자, 대문자로 저장.
- 없는 아이디와 틀린 비밀번호는 같은 응답을 준다(아이디 존재 여부를 알려 주지 않는다).
- 토큰 유효기간: `remember: true`(로그인 상태 유지)면 7일, 아니면 12시간. 로그아웃은 프론트가 토큰을 지우는 것으로 한다.

## 관리자 통계

`GET /api/admin/trainees?include_demo=false` (토큰 필요, `admin`만. 아니면 `403 ADMIN_ONLY`. `include_demo`는 선택)

```json
{
  "checkpoint_data": true,
  "sections": ["ironmaking", "steelmaking", "continuous_casting", "rolling"],
  "demo_sections": ["steelmaking", "continuous_casting", "rolling"],
  "include_demo": true,
  "trainees": [{
    "id": "uuid", "username": "trainee01", "name": "김신입", "employee_no": "T2026001", "is_demo": false,
    "created_at": "ISO", "last_activity": "ISO | null",
    "sections": { "ironmaking": { "understanding": 0.92, "passed": true, "attempts": 1 }, "steelmaking": null },
    "passed_sections": 1,
    "misconceptions": { "open": 0, "resolved": 1 }
  }]
}
```

- `sections.{섹션}`: 끝낸 체크포인트가 없으면 `null`. `understanding`은 마지막으로 끝낸 시도의 이해도, `passed`는 한 번이라도 통과했는지.
- 오개념은 개수만 준다. 설명·답변 원문은 본인만 본다.
- 체크포인트 테이블(`attempts`, `misconceptions`)이 아직 없으면 `checkpoint_data: false`와 빈 기록을 준다.
- 실제 계정과 시연 계정을 섞어서 준다. `is_demo: true`는 시연 계정(`trainee02`~`20`, `users.is_demo`)이고 화면에서 'demo' 배지를 붙인다. `?include_demo=false`면 시연 계정을 빼고 실제 계정만 준다. `true`·`false` 밖의 값은 `400 INVALID_INCLUDE_DEMO`.
- `demo_sections`: final 루브릭이 없어 시연 개념 목록(`content/demo/sections.json`)으로 계산한 섹션. 이 섹션은 시연 기록(`origin = 'seed'`)만 센다.
- 시연 기록: `npm run db:seed-demo [seed]`가 `trainee02`~`20`의 시연 기록(`seed`)을 지우고 다시 만든다(`trainee01`은 실제 테스트 계정이라 만들지 않음). 11~14는 처음 정한 프로필, 나머지는 5가지 유형을 돌려 쓰며 실력을 조금씩 달리해 통과, 재도전 필요, 진행 중이 섞이게 한다. seed가 같으면 같은 기록이 나온다(예: `npm run db:seed-demo -- 58`).

`GET /api/admin/trainees/:id` (토큰 필요, `admin`만): 신입사원 한 명 상세. 관리자 화면에서 사람을 누르면 오른쪽 패널로 보여 준다(`backend/src/admin/trainee-detail.ts`). 신입사원이 아니거나 없으면 `404 TRAINEE_NOT_FOUND`.

- `trainee`: `/api/admin/trainees`의 그 사람 항목과 같다(같은 숫자).
- `sections[]`: 공정 순서대로 `{ section, name, demo, stat, in_progress, concepts, attempts }`. `stat`은 목록의 섹션 통계, `in_progress`는 끝나지 않은 시도의 `{ state, done, total }`, `concepts[]`는 지금 루브릭(없으면 시연 목록) 개념별 `{ concept_id, name, score, final_verdict }`(묻지 않은 개념은 `score: null`), `attempts[]`는 끝낸 시도 `{ kind, completed_at, understanding, unlocked }`(오래된 순서).
- 오개념은 `trainee.misconceptions`의 개수만 준다. 설명·답변 원문은 주지 않는다.

`GET /api/admin/concepts?section=ironmaking&include_demo=false` (토큰 필요, `admin`만. `section`·`include_demo`는 선택): 신입사원이 끝낸 체크포인트(재도전 포함)의 첫 질문 판정으로 섹션·개념별 `asked`, `partial`, `wrong`, `assisted`, `final_wrong`을 집계하고 미해결 오개념 수 `open`을 돌려준다. 지금 final 루브릭(없는 섹션은 시연 개념 목록)에 있는 개념은 화면용 개념 이름 `name`도 붙는다. `include_demo`는 `/api/admin/trainees`와 같다. 관리자 화면의 개념 순위는 이 DB 응답으로 계산한다.

- `final_wrong`: 재확인 판정도 `wrong`인 수. `open`: 신입사원 전체의 미해결 오개념 수(체크포인트·학습 모드 모두).
- `concept_id`는 루브릭 개념 id다(시연 기록은 설비 id). 답변 원문·오개념 설명·사용자 id는 주지 않는다.
- `section`이 섹션 4개 중 하나가 아니면 `400 INVALID_SECTION`. 체크포인트 테이블(`attempts`, `concept_results`)이 없으면 빈 목록을 준다.

`GET /api/admin/ai-summary?section=ironmaking` (토큰 필요, `admin`만. `section`은 선택): 오답률 높은 개념을 Gemini가 "보강할 내용" 1~2문장으로 정리한다.

```json
{ "summary": "고로에서 코크스의 역할은 …", "concepts": [{ "section": "ironmaking", "concept_id": "coke_reduction", "name": "고로에서 코크스의 역할" }],
  "generated_at": "2026-10-06T01:32:00.000Z", "cached": false }
```

- 입력은 `/api/admin/concepts`와 같은 집계에서 지금 final 루브릭 개념(`name` 있음) 중 정답이 아닌 첫 답변이 있는 개념 상위 5개의 숫자와 공정·개념 이름뿐이다. 답변 원문·오개념 설명·사용자 id는 LLM에 보내지 않는다.
- 집계할 기록이 없으면 LLM을 부르지 않고 `summary: null`.
- 같은 집계면 10분 동안 저장한 요약을 준다(`cached: true`). 기록이 바뀌면 새로 만든다.
- LLM 호출은 관리자 계정의 하루 호출 수(`LLM_DAILY_LIMIT`)에 함께 센다. 넘으면 `429 USAGE_LIMIT`.
- `GEMINI_API_KEY`가 없거나 호출이 실패하면 `503`/`502 LLM_UNAVAILABLE`. 화면은 요약 대신 안내 문장을 보여 주고 나머지는 그대로 쓴다.

## 아이디·비밀번호 찾기

메일 발송 수단이 없어서 **이름 + 사번**으로 본인 확인을 한다.

- 아이디 찾기: 이름과 사번이 맞으면 아이디를 그대로 보여 준다.
- 비밀번호 찾기: 아이디·이름·사번이 모두 맞으면 바로 새 비밀번호로 바꾼다.
- 확인에 실패하면 0.5초 늦게 답해 대입 시도를 느리게 한다.
- 이름과 사번을 아는 사람은 비밀번호를 바꿀 수 있으므로 시연·사내용 수준이다. 실제 운영 전에 메일·관리자 승인 같은 확인 수단을 팀에서 정한다.

## 시연 계정

서버가 시작할 때 없는 계정만 만든다. 비밀번호는 모두 같다(기본 `steel-2026-demo`, `.env`의 `DEMO_PASSWORD`로 변경).

| 아이디 | 역할 | 이름 | 사번 |
|---|---|---|---|
| `trainee01` ~ `trainee20` | trainee | 김신입, 이신입, 박신입, 최신입, 정다은 … 전소율(20명, `demo-accounts.ts`) | `T2026001` ~ `T2026020` |
| `admin01` | admin | 관리자 | `A2026001` |

- 로그인 화면의 일반 사용자 / 관리자 토글이 `GET /api/auth/demo-accounts`로 계정을 받아, 누르면 아이디·비밀번호 칸을 채운다. 목록에 사번은 내보내지 않는다.
- 시연 계정은 여럿이 같이 쓰므로 비밀번호 재설정을 막는다(`403 DEMO_ACCOUNT`).
- 외부에 열 때는 `DEMO_ACCOUNTS=off`로 끈다(계정 생성과 목록 모두 꺼짐).
- `DEMO_PASSWORD`는 새로 만드는 계정에만 적용된다. 이미 만든 계정의 비밀번호는 바꾸지 않는다.

## 화면 연결

- 서버가 `/login`을 `frontend/login_ui/My Page.dc.html`로 보낸다. 파일을 브라우저에서 바로 열면 API를 부를 수 없다.
- 토큰은 로그인 상태 유지면 `localStorage`, 아니면 `sessionStorage`의 `st-rookie-token`에 둔다.
- 첫 화면에서 `GET /api/auth/me`로 확인하고, `401`이면 토큰을 지우고 로그인 화면을 보여 준다.
- 다른 `/api` 요청에는 `Authorization: Bearer <token>` 헤더를 붙인다.

## 서버 설정

- `.env`의 `JWT_SECRET`으로 서명한다. 비어 있으면 실행할 때마다 임시 키를 만들어서, 서버를 다시 켜면 로그인이 모두 풀린다.
- 계정은 SQLite `users` 테이블(`backend/src/db/migrations/003_users.sql`)에 저장한다. DB 위치는 `DB_PATH`, 기본값 `data/st-rookie.sqlite`.

## 개인 페이지

`GET /api/me/misconceptions[?section=ironmaking]` (토큰 필요, 없으면 401 `AUTH_REQUIRED`)

- 로그인한 본인의 오개념만 최근 것부터 준다(라우트 `backend/src/me/routes.ts`, SQL은 `me/repository.ts`). 다른 사람의 기록은 어떤 값을 넣어도 볼 수 없다(사용자는 토큰으로만 정한다).
- 항목: `id, section, concept_id, source, label, summary, answer_text, resolved, created_at, resolved_at`.
- `label`: 학습 모드(`source=learning`)는 "대화 중 감지됨", 체크포인트는 "이해도 확인"(`backend/src/learning/labels.ts`, 학습자 메모와 같은 라벨).

`GET /api/me/dashboard` (토큰 필요, `trainee`만): 본인의 `trainee` 통계, `review_concepts`, `misconceptions`, 섹션 목록과 `checkpoint_data`를 돌려준다. 다른 신입사원의 이름이나 학습 기록은 포함하지 않는다.

## 요청 사용자 구분 (`backend/src/request-user.ts`)

- `/api` 요청에 `Authorization: Bearer <token>`이 있으면 토큰의 사용자 id(`users.id`)로 구분한다. 체크포인트(`userIdOf(req)`), 학습 모드·LLM 사용량(`currentUserId()`)이 모두 이 id를 쓴다. 토큰이 틀리거나 만료됐으면 401 `TOKEN_INVALID`.
- [임시] 토큰이 없으면 예전처럼 `X-User-Id` 헤더, 그것도 없으면 `demo-user`. 모든 화면이 토큰을 보내게 되면 지운다.
- 관리자 통계는 `users.id` 기준이므로, 토큰을 보내기 전에 헤더 이름으로 쌓인 기록은 통계에 잡히지 않는다.

## 남은 연결

- 화면이 저장된 토큰(`st-rookie-token`)을 `/api` 요청에 붙여야 한다: 3D 페이지 학습 채팅(`learning-chat.js`), 체크포인트 테스트 페이지(`checkpoint-test.html`).
- 새 신입사원 대시보드는 `/api/me/dashboard`, 관리자 대시보드는 `/api/admin/trainees`와 `/api/admin/concepts`의 DB 응답을 표시한다.
