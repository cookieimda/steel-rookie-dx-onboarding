# 평가 시험 페이지와 교육 운영 백엔드

2026-10-14. `feature/exam-backend`에서 구현했다. 학습 기록 화면의 AI 튜터 안에 있던 체크포인트 UI를 독립적인 `/exam` 페이지로 옮겼다. 기존 Node/Express·SQLite·바닐라 HTML 구조와 로그인 토큰을 사용한다.

## 화면 흐름

홈 로그인 → 3D 학습/학습 기록의 **평가 시험** 링크 → 공정 선택 → 응시 준비 → 문제 → 답안 제출 → 필요하면 설명과 추가 확인 → 결과.

- 디자인은 학습 기록(`frontend/login_ui/Trainee Dashboard.dc.html`)과 같은 체계다: 같은 색 토큰(다크/라이트)·글꼴, 둥근 헤더(로고 · ST-ROOKIE · TRAINEE · '● 평가 시험' 알약 · 테마 · 로그아웃 · [학습 화면] · [학습 기록]), `[ TRAINEE ]` 눈썹 + 영어 제목 **PROVE & PASS.**, 통계 카드 묶음(통과 기준 80% · 통과한 공정 · 응시 가능), 학습 기록과 같은 공정 카드(번호 · 이름 · 상태 칩 · 이해도 · 막대), `.card` 패널. 오렌지 강조는 쓰지 않는다. 화면 제목과 응시 문구는 **평가 시험**으로 통일했다. 기존 API의 `understanding` 값은 호환성을 위해 유지했다.
- 시험 패널에는 **포석호**(`frontend/3d-demo/cp-character.js`, 한 개만 만들어 `motion` 속성만 바꾼다)와 흰 말풍선이 있다. 말풍선에는 이번 차례의 반응(정답·거의·아쉬움·핵심 정리)과 질문이 들어가고, 질문 줄은 한 글자씩 적는다(최대 2.4초, 동작 축소 설정이면 바로). 설명(`explanation`)은 '포석호의 설명' 블록으로 아래에 둔다. 동작은 `checkpoint-chat.js`의 `motionFor`(마지막 발화 type)이고, 반응 발화가 있으면 그 동작을 2.2초 먼저 보여 준다. 처리 중에는 `thinking`, 결과는 `result`(통과 여부). 효과음은 `tutor-sfx.js`로 새 발화일 때 한 번만 내고(복원한 발화는 내지 않음) 패널 머리의 토글로 끈다.
- 요청 처리 중에는 흐린 페이지 위에 같은 체계의 카드로 망치·달군 쇠·불꽃 애니메이션과 **담금질 하기.**를 띄운다(`dialog#forge`, 다크·라이트 모두 토큰 색, 달군 쇠·불꽃만 `--mid` 계열 호박색). 작업의 실제 단계 문구와 경과 시간, 그리고 **지나온 단계 칸**(준비 → 답안 채점 → 설명 정리 → 추가 확인 문제처럼 작업 상태의 `phase`가 바뀔 때마다 한 칸씩 늘어남)을 보여 주고 취소할 수 있다. 임의의 완료율은 표시하지 않는다. 한 단계가 LLM 호출 1~3회라 Gemini `gemini-3.5-flash-lite`가 느린 날(2026-10-14, 호출당 15~33초)에는 단계당 30~60초가 걸린다.
- 답안 초안·진행 중 작업 ID·요청 키를 사용자별 sessionStorage에 저장한다. 새로고침이나 연결 재시도에서 같은 요청 키를 사용해 중복 채점을 막는다.
- 시험을 잠시 멈추고 학습 화면으로 돌아갈 수 있다. 취소한 요청은 시험을 다음 문제로 진행시키지 않는다.
- 오른쪽에 복습 일정·배정된 시험·최근 평가 기록을 표시한다. 모바일과 동작 축소 설정을 지원한다.

현재 `content/rubrics/final/`에 제선 루브릭만 있어 **제선 3개 개념만 실제 응시 가능**하다. 제강·연주·열간압연은 준비 중으로 표시한다.

## 반영한 백엔드 기능

| 기능 | 동작 | 구현 위치 |
|---|---|---|
| 시험 작업 관리 | SQLite 작업 상태 저장, 단일 작업자 큐, 같은 요청 키 재사용, 사용자별 조회·취소, AbortSignal로 추론 취소 | `backend/src/education/jobs.ts` |
| 개인별 복습 | 최종 오답/부분 정답 1일, 재확인 정답 3일, 첫 정답 7일 후 일정. 한국 시간 날짜, 완료 표시, 새 시험에서 갱신 | `education/repository.ts` |
| 채점 이력 | 요청별 루브릭 원문과 SHA-256 버전, provider/model, 프롬프트 해시, 시험 결과 저장. 완료 결과는 당시 스냅샷으로 조회 | `education/repository.ts`, `education/routes.ts` |
| 교육 그룹·배정 | 관리자만 그룹/구성원/공정 시험/마감일 등록. 학습자는 자신의 배정 조회. 통과 상태로 완료·대기·마감 지남 표시 | `education/routes.ts` |
| 교육 자료 검수 | 관리자 텍스트/Markdown 등록 → 승인/반려. 승인본만 검색·출처 목록에 추가하고 검색/답변 캐시 무효화 | `education/repository.ts`, `ironmaking-server.ts` |

그룹 관리와 자료 검수는 **관리자 API까지 구현**했다. 관리자용 등록·승인 화면은 후속 작업이다. 배정 상태는 해당 공정의 기존 통과 여부를 기준으로 하며 배정마다 새 시험을 강제하지 않는다. 복습 완료는 학습자가 직접 표시하는 기능으로 재채점 합격을 뜻하지 않는다.

## API

모든 새 API는 로그인 JWT가 필요하다. 관리 API는 관리자 권한도 검사한다. 시험 등록과 시험 명령은 `Idempotency-Key` 헤더(8~80자 영문·숫자·`_`·`-`)가 필요하다. 같은 사용자와 같은 키의 요청은 기존 작업을 반환하고, 같은 키에 다른 내용은 409로 거절한다.

| 요청 | 용도/본문 |
|---|---|
| `GET /api/exams/sections` | 공정·응시 가능 여부·진행 상태·최근 완료 시도 |
| `POST /api/exams` | `{ "section": "ironmaking" }`, 202 작업 ID 반환 |
| `GET /api/exams/:id` | 본인 시험 문제·전체 대화·완료 결과 |
| `POST /api/exams/:id/commands` | `{ "action": "answer", "text": "답안" }` 또는 `resume`/`retry-evaluation`, 202 반환 |
| `POST /api/exams/:id/pause` | 시험 일시 정지 |
| `GET /api/exam-jobs/:id` | 상태·단계·결과·오류, 1초 간격 조회 |
| `DELETE /api/exam-jobs/:id` | 본인 작업 취소 |
| `GET /api/me/exam-history` | 본인 채점 이력. `?attempt=...`로 한 시험 선택 |
| `GET /api/admin/exam-history/:id` | 관리자가 학습자 채점 이력과 루브릭 원문 확인 |
| `GET /api/me/reviews` | 본인 복습 일정 |
| `POST /api/me/reviews/:id/complete` | 복습 완료 표시 |
| `GET /api/me/assignments` | 본인에게 배정된 시험 |
| `GET/POST /api/admin/education/groups` | 그룹 목록/`{ "name": "신입사원 기초반" }` 등록 |
| `PUT /api/admin/education/groups/:id/members` | `{ "users": ["학습자 UUID"] }`, 구성원 교체 |
| `GET/POST /api/admin/education/assignments` | 현황/`{ "group_id": "...", "section": "ironmaking", "title": "제선 평가", "due_date": "2026-10-30" }` 배정 |
| `GET/POST /api/admin/education/materials` | 목록/`{ "section": "ironmaking", "title": "...", "body": "Markdown 본문", "source_url": "https://...", "publisher": "교육팀" }` 등록 |
| `POST /api/admin/education/materials/:id/review` | `{ "decision": "approved" }` 또는 `rejected` |

답안은 1,000자, 교육 자료는 20,000자까지 받는다. 자료는 파일 업로드/PDF OCR 없이 본문을 등록하는 방식이다. 승인본은 수정하지 않고 수정본을 새 초안으로 등록한다. 출처 URL을 서버가 다운로드하지는 않는다.

## 저장·운영 범위

`010_education_workflow.sql`을 기존 001~009 다음에 자동 적용한다(009는 보충학습 `learning_supplements`). 기존 시도·계정·학습 대화는 유지한다. 기록 초기화 도구는 새 시험 이력과 복습 외래 키를 먼저 정리하도록 수정했고, seed/live 범위와 다른 사용자의 기록을 보존한다.

작업은 단일 서버 프로세스에서 순차 실행한다. 서버 재시작으로 메모리 큐를 잃으면 기존 미완료 작업을 실패로 표시하고 사용자가 다시 요청하도록 안내한다. 자동 이어 실행·분산 큐는 아직 구현하지 않았다. 학습 채팅과 시험 사이에 전체 Ollama 추론을 공통 큐로 묶은 것은 아니다.

루브릭 스냅샷은 이 기능을 통한 새 시험 요청부터 남긴다. 예전 완료 시도는 기존 기록으로 조회하되 당시 모델/프롬프트 정보를 소급해서 만들어 넣지 않는다. 모델 기록은 설정된 태그이며 모델 가중치의 digest를 기록하지 않는다. 이 기능은 **Ollama로 공개 모델을 자체 서빙하는 교육 서비스**이며 모델을 직접 학습했다는 의미는 아니다.

## 검증

- `npm test`: **345개 통과**(2026-10-14, `integrate/exam-sleek`), 빌드 포함.
- HTTP 통합 테스트: 로그인/권한, 사용자 격리, 요청 키 재사용, 오답 → 설명 → 재확인 → 완료, 복습 일정, 루브릭 스냅샷, 교육 배정, 승인 자료 검색, 취소와 상태 유지.
- 실제 Ollama 연결 브라우저 검증: 작업 접수·문제 준비 단계·망치 애니메이션·취소 후 준비 상태 유지·모바일·동작 축소.
- 답안/완료 화면은 명시적인 UI fixture로 렌더링을 검증했다. 실제 모델의 시험 전체 채점 정확도를 이번 변경에서 다시 측정한 것은 아니다.

선택적 브라우저 검사:

```powershell
npm install --prefix data/browser-tools playwright --no-package-lock --ignore-scripts
# 설치된 Chromium 경로와 테스트 서버 URL을 scripts/check-exam-ui.mjs에서 확인한다.
$env:EXAM_QA_URL = "http://localhost:3011"
node scripts/check-exam-ui.mjs
```

이 스크립트는 QA 계정을 만든다. 실제 사용자 DB 대신 별도 테스트 서버와 DB에서 실행한다.

스크린샷(2026-10-14, 학습 기록 체계로 바꾼 뒤): [시험 화면](screenshots/exam/desktop.png), [담금질 로딩](screenshots/exam/loading-desktop.png), [답안 입력](screenshots/exam/question-desktop.png), [결과(라이트)](screenshots/exam/result-desktop.png), [모바일 결과](screenshots/exam/result-mobile.png).
