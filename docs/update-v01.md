# ST-ROOKIE update v01 — 참고 ERP에서 가져온 설계 패턴

> 철강 ERP 오픈 프로젝트(이하 "참고 ERP")를 분석해서, **ST-ROOKIE에 맞게 바꿔 적용할 수 있는 패턴**을 정리했다.
> 코드를 복사한 게 아니라 **생각(설계 원칙)을 가져와 우리 도메인(교육·튜터)으로 바꿔 쓴 것**이다.
> 브랜치: `strookie/update-v01` · 기준: dev `90e05a5`(PR #198) · 테스트 535개 → **541개 모두 통과**

---

## 1. 가져올 수 있는 것 전체 목록

| # | 패턴 | 참고 ERP에서는 | ST-ROOKIE 맥락으로 바꾸면 | v01 |
|---|---|---|---|---|
| 1 | AI가 꺼져도 멈추지 않는 길 | Agent 설명이 실패하면 규칙 요약을 그대로 보여 주고 "AI 연결 없음" 표시 | 튜터가 실패하면 **검색한 교육 자료 원문**을 보여 주고 "AI가 쓴 답이 아니에요" 표시 | ✅ |
| 2 | 오류 응답 하나로 | 오류 코드 표 1개 + 예외 1개 + 전역 필터 1개 | `ERRORS` 표 + `AppError` + `errorHandler` 1개, 응답은 항상 `{ error, code }` | ✅ |
| 3 | 로그인 시도 제한 | 계정당 5분 5회·IP당 20회, **확인 전에 실패를 먼저 기록** | 로그인·아이디 찾기·비밀번호 재설정에 같은 규칙 | ✅ |
| 4 | 운영 비밀키 검사 | 운영 모드에서 기본 비밀키면 서버가 안 뜸 | 공개 모드(운영·터널 공유)에서 JWT_SECRET이 없거나 짧으면 안 뜸 | ✅ |
| 5 | 트랜잭션 방식 하나 | 모든 저장소 함수가 첫 인자로 tx를 받음 | `withTransaction(db, fn)` 하나로 통일 | ✅ (2곳) |
| 6 | PR마다 자동 검사(CI) | GitHub Actions로 타입 검사 + 테스트 | 같은 구성. DB가 SQLite라 더 간단 | ✅ |
| 7 | 사람이 확정하는 AI | AI는 초안만, 실행은 사람이 [확정] | 오개념 기록·보충학습 시작을 "제안 → 학습자 확인"으로 | ⬜ v02 |
| 8 | AI 경유 기록 | 모든 거래 로그에 `is_ai_assisted` | 채점·오개념 기록에 "AI 판정 / 규칙 판정" 표시 | ⬜ v02 |
| 9 | 라우터 → 서비스 → 저장소 | 컨트롤러는 한 줄, SQL은 저장소에만 | `extras-routes.ts`(SQL 29개)·`education/routes.ts`(11개)를 저장소로 | ⬜ v02 |
| 10 | 기준값은 한 곳에서 | 날짜 함수·번호 규칙·오류 표가 각각 1개 | 한국 날짜 함수 5개 → 1개, 80% 기준 3곳 → 1곳 | ⬜ v02 |
| 11 | 요구사항 ID | 코드 주석에 REQ-xxx 820곳 | 문서에 `REQ-LRN-001` 등을 붙이고 주석에서 인용 | ⬜ v02 |
| 12 | 기준 문서 잠금 | `.claude/settings.json`로 설계 문서 편집 금지 | 루브릭 final·API 명세 편집 금지 | ⬜ v02 |
| 13 | 시나리오 E2E 테스트 | 수주→출고→추적 한 줄로 이어 보는 테스트 | 로그인→학습→체크포인트→통과→대시보드 | ⬜ v02 |
| 14 | 불변식 점검 스크립트 | DB를 읽기만 해서 규칙 13개 검사 | "해금된 섹션은 이해도 ≥ 80%" 등 | ⬜ v02 |

---

## 2. v01에서 적용한 것 — 맥락 변환과 코드 변환

### 2-1. AI가 꺼져도 학습 화면이 멈추지 않게

**맥락 변환**
- 참고 ERP: 공장 위험을 **규칙이 감지**하고 AI는 설명만 한다. AI가 없으면 규칙이 만든 요약을 그대로 보여 준다.
- ST-ROOKIE: 학습 질문의 **근거는 검색(코드)이 찾고** AI는 그걸 말로 풀어 줄 뿐이다. 그러니 AI가 없으면 **찾은 근거 원문을 그대로** 보여 주면 된다.
- 시연 효과: 시연 중 Gemini가 느리거나 끊겨도 화면이 멈추지 않는다. 오히려 "AI가 꺼져도 동작한다"를 보여 줄 수 있다.

**Before** — `backend/src/learning/routes.ts` (LLM 실패 시)
```ts
} else if (error instanceof LlmUnavailableError) {
  send(error.status, error.status === 503
    ? { error: "튜터 모델이 연결되지 않았어요. …", code: "LLM_NOT_CONFIGURED" }
    : { error: "튜터 모델 연결 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요." });
```

**After**
```ts
const canFallback = fallbackOnLlmError && retrieved.length > 0
  && (error instanceof LlmUnavailableError || error instanceof LearningFormatError);
if (canFallback) {
  const { answer, source_ids } = evidenceFallback(retrieved);   // 검색한 근거 앞 3개
  send(200, { answer, status: "unverified", sources: toSources(source_ids),
    grounding_note: FALLBACK_NOTE, generated_by_ai: false, fallback_reason: errorKind(error), … });
}
```

**규칙**
- 근거가 하나도 없으면 원래대로 오류(503/502)
- 하루 호출 한도 초과(429)는 정책이라 대신 답하지 않음
- 대화 기록에 저장하지 않음 (AI 답이 아니라서 다음 질문의 맥락에 넣지 않음)
- 서버 기본은 켜짐, `LEARNING_FALLBACK=off`로 끔
- 화면(`Steel Academy v4.dc.html`): AI가 끊겨도 질문 입력·추천 질문·전송을 막지 않고, 안내를 "질문하면 교육 자료 원문으로 대신 답해 드려요"로 바꿈

### 2-2. 오류 응답 하나로

**맥락 변환**
- 참고 ERP: `throw new AppException('SO-002')` 한 줄이면 문구·HTTP 상태가 표에서 정해지고, 응답 모양은 늘 같다.
- ST-ROOKIE: 같은 "LLM 연결 실패"가 API마다 code가 있거나 없거나 문구가 달랐다. `handle()`이 5벌이었고, 공통 오류 미들웨어는 0개였다.

**Before** — 라우터마다 따로
```ts
// checkpoint/routes.ts
function sendError(res, error) {
  if (error instanceof CheckpointError) res.status(error.status).json({ error: error.message });   // code 없음
  else if (error instanceof LlmUnavailableError) res.status(error.status).json({ error: "…", code: "LLM_UNAVAILABLE" });
  …
}
// education/job-routes.ts — await 없이 감싸서 async 핸들러 오류가 빠져나갈 수 있었음
const handle = (fn) => (req, res) => { try { fn(req, res); } catch (error) { … } };
```

**After** — `backend/src/http/errors.ts` 하나
```ts
export const ERRORS = {
  NOT_FOUND: { status: 404, message: "찾지 못했어요." },
  TOO_MANY_ATTEMPTS: { status: 429, message: "시도가 너무 많아요. 5분 뒤 다시 시도해 주세요." },
  LLM_UNAVAILABLE: { status: 502, message: "튜터에 연결하지 못했어요. …" },
  … };
export class AppError extends Error { constructor(readonly code: ErrorCode, message?: string) { … } }
export const handle = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { … errorResponse(e) … } };
export function errorHandler(error, _req, res, next) { … }   // 서버 맨 마지막에 한 번
```

**적용 범위**
- `checkpoint/routes.ts`, `education/job-routes.ts`, `education/workflow-routes.ts`가 공용 `handle`을 씀
- 서버 맨 끝에 `app.use(errorHandler)` — 어느 라우터에서 던진 오류든 HTML 500 대신 `{ error, code }` JSON
- 기존 `CheckpointError`는 그대로 쓰되 상태에 맞는 code를 자동으로 붙임(예: 404 → `NOT_FOUND`)

### 2-3. 로그인·아이디 찾기·비밀번호 재설정 시도 제한

**맥락 변환**
- 참고 ERP: 사내 IP로 접속하는 ERP라 사원번호 무차별 대입을 막는다.
- ST-ROOKIE: 시연 서버를 터널로 **공개 주소**에 연다. 비밀번호 재설정이 "이름 + 사번"만으로 되므로 사번을 바꿔 가며 맞혀 보는 시도를 막아야 한다.

**핵심 아이디어** — 확인하기 **전에** 실패를 먼저 적는다
```ts
// backend/src/auth/login-attempts.ts
begin(account, ip) {
  if (최근 5분 계정 실패 >= 5 || IP 실패 >= 20) return null;   // → 429 TOO_MANY_ATTEMPTS
  실패 1회를 먼저 기록;
  return { succeeded: () => 방금 기록 지우기 };
}
```
- 확인한 뒤에 기록하면, 동시에 온 요청 여러 개가 모두 "아직 4번"을 보고 통과한다.
- `app.set("trust proxy", "loopback")` — 터널(cloudflared)이 넘긴 실제 IP로 센다.

### 2-4. 공개 모드 비밀키 검사

**Before** — `auth/tokens.ts`: JWT_SECRET이 없으면 경고만 찍고 임시 키로 실행
**After** — `assertPublicSecrets()`를 서버 시작 맨 앞에서 호출
```ts
const isPublic = env.NODE_ENV === "production" || Boolean(env.TEST_PASSCODE?.trim());
if (isPublic && (env.JWT_SECRET?.trim() ?? "").length < 32) throw new Error("공개 모드에서는 32자 이상의 JWT_SECRET이 있어야 …");
```
- 로컬 개발(공개 모드 아님)은 지금처럼 임시 키를 쓴다.

### 2-5. 트랜잭션 방식 하나

**Before** — 같은 BEGIN/COMMIT/ROLLBACK 코드가 9곳(이름도 `transaction`, `tx`, 인라인 제각각)
**After** — `backend/src/db/tx.ts`
```ts
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T { … }
```
- v01: `checkpoint/repository.ts`, `learning/supplement-repository.ts`가 이 함수를 쓰도록 바꿈. 나머지 7곳은 v02.
- 규칙(주석에 명시): LLM 호출은 트랜잭션 안에서 하지 않는다 — 먼저 부르고 쓰기만 묶는다(체크포인트 엔진이 이미 지키는 규칙).

### 2-6. CI

`.github/workflows/ci.yml` — PR과 `dev`·`main`·`strookie/**` push에서 `npm ci → typecheck → test`. 병합 충돌을 풀다 빌드가 깨져 테스트가 0개 도는 사고(#34)를 PR 단계에서 잡는다.

---

## 3. 확인 결과

- [x] `npm run typecheck` 통과
- [x] `npm test` — 기존 535개 + 새 6개 = **541개 통과** (기존 테스트 수정 없음)
- [x] 새 테스트 `backend/test/update-v01.test.ts`
  - 튜터 실패 → 근거 원문 200, `generated_by_ai: false`, 대화 저장 안 함
  - 근거 없음 → 503, 한도 초과 → 429, 옵션 끔 → 502
  - 오류 응답 모양 `{ error, code }`
  - 로그인 6번째 실패 → 429 `TOO_MANY_ATTEMPTS`, 성공 시 기록 삭제, 5분 뒤 풀림
  - 공개 모드 비밀키 검사
- [x] 데모(AI 키 없이 서버 실행)
  - 학습 화면에서 "코크스는 왜 넣어?" → 교육 자료 원문 3개 + 근거 4개 + "AI가 쓴 답이 아니에요"
  - 없는 체크포인트 조회 → `{"error":"이해도 확인을 찾지 못했어요.","code":"NOT_FOUND"}`
  - 같은 계정 로그인 6번 틀림 → `401 ×5, 429`

## 4. 데모 실행 방법

```bash
npm ci
GEMINI_API_KEY= WARM_ANSWERS=off PORT=3100 npm start
```
브라우저에서 `http://localhost:3100` → 시작하기 → 신입사원 1 → LOGIN → 3D 화면 오른쪽 위 🤖(AI 튜터) → 추천 질문 클릭.

## 5. 다음(v02) 후보

- [ ] 사람이 확정하는 AI (#7), AI 경유 기록 (#8)
- [ ] 라우터 SQL을 저장소로, N+1 쿼리를 JOIN으로 (#9)
- [ ] 날짜·통과 기준 상수 통일 (#10)
- [ ] 나머지 트랜잭션 7곳, 보충학습 "LLM 먼저, 쓰기는 한 번에"
- [ ] 시나리오 E2E 테스트 (#13)
- [ ] 대체 답의 번호 목록이 화면에서 한 문단으로 붙어 보이는 문제(줄바꿈 표시) 다듬기
