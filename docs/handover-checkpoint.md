# 인수인계: 체크포인트(이해도 확인)·평가자·관리자 대시보드

수민이 프로젝트에서 빠지면서 맡던 영역을 **박소영(ssoyoum)** 에게 넘긴다. 작성일 2026-10-11, 기준은 `dev`(#84 병합까지)와 열린 PR #86.
CLAUDE.md 파일 담당 표도 이 PR에서 `ssoyoum`으로 바꾼다.

비밀 정보(API 키, 접속 비밀번호, DB 파일과 그 내용)는 이 문서에 적지 않는다. 필요하면 팀 안에서 따로 주고받는다.

## 1. 넘기는 담당 영역

CLAUDE.md '파일 담당' 표 기준.

| 영역 | 파일 |
|---|---|
| 체크포인트 백엔드 | `backend/src/checkpoint/`(엔진·저장소·라우트·`section-summary.ts`), `backend/src/rubrics.ts`, 마이그레이션 `001_checkpoint.sql`·`007_checkpoint_pause.sql` |
| 평가자·튜터·질문 검사 | `llm/src/evaluator.ts`, `llm/src/tutor.ts`, `llm/src/question-check.ts`, `llm/prompts/evaluator.md`, `llm/prompts/tutor-*.md` |
| 루브릭·질문 은행 | `content/rubrics/`(`schema.json` 제외) |
| 평가 세트 | `llm/eval/`(smoke·hard, `eval:evaluator`·`eval:questions`·`eval:export-human`) |
| 화면(체크포인트) | `frontend/3d-demo/checkpoint-chat.js`, `cp-character.js`(오버레이 캐릭터), `checkpoint-test.html`, 문구 `tutor-text.js` |
| 원격 테스트 장치 | `backend/src/test-access.ts`, `usage.ts`, `request-user.ts`, `db/migrations/002_llm_usage.sql`, `scripts/tunnel.mjs` |
| 관리자 대시보드 | `backend/src/admin/`, `frontend/login_ui/Admin Dashboard.dc.html`, 시연 개념 목록 `content/demo/sections.json`·`backend/src/demo-sections.ts` |
| 위 파일들의 테스트 | `backend/test/checkpoint*.test.ts`, `cp-character.test.ts`, `rubrics.test.ts`, `question-check.test.ts`, `admin*.test.ts` 등 |

함께 넘기는 약속:

- `misconceptions` 테이블은 체크포인트 담당이 관리한다. 다른 모듈은 정해진 쓰기 함수로만 쓴다(CLAUDE.md '데이터 저장').
- 학습 모드의 `LearnerNotes` 타입과 `buildLearnerNotes` 시그니처는 체크포인트 엔진(학습자 메모)도 쓴다. 학습 모드와 체크포인트를 같은 사람이 맡게 되었으니, 바꿀 때 양쪽을 함께 고친다.
- 개념 ↔ 설비 연결(`equipment_ids`)은 체크포인트 담당의 다음 작업으로 잡혀 있다(CLAUDE.md '다음 단계').

## 2. 진행 중인 것

| 항목 | 상태 | 할 일 |
|---|---|---|
| #86 오버레이 PR 4 | 열림, viiin2 리뷰 대기. 튜터 패널 모드 탭·`tutorMode` 제거, v2 페이지 삭제(viiin2 확인 완료), 모델 README 삭제 | 승인 후 병합할 사람을 정한다. 병합 방식은 지금까지와 같은 merge commit |
| 이 인수인계 PR | CLAUDE.md 담당 표를 `ssoyoum`으로 바꿈 | #86도 CLAUDE.md 담당 표를 고친다(바로 옆 줄). 나중에 병합하는 쪽에서 충돌을 한 번 정리해야 할 수 있다 |

## 3. 남은 일

이해도 확인 오버레이(설계 [checkpoint-overlay.md](checkpoint-overlay.md)):

- 좁은 화면(rail) 공정 메뉴에 [담금질 시작하기] 버튼이 없다.
- 통과 화면(`celebrate`)은 실제 화면에서 확인하지 못했다(단위 테스트만).
- 루브릭이 없는 공정(제강·연주·압연)의 진행 상태 요청이 404로 콘솔에 남는다([checkpoint-integration.md](checkpoint-integration.md) '알려진 문제', ⑤로 계획됨).

콘텐츠:

- `content/rubrics/final/01_제선.json`은 `reviewed: false`인 임시 루브릭이고 질문 은행도 검수 전 초안이다. `content/materials/{섹션}/section.md`가 생기면 그 문서를 근거로 다시 만든다.
- 소결 개념 재설계 초안(`draft/sinter_purpose.v2.json`)은 통기성 근거 문장이 생기기 전까지 final로 옮기지 않는다.
- 평가자 프롬프트나 루브릭을 바꾸면 `eval:evaluator`를 smoke·hard로 다시 돌린다.

계획만 있는 작업:

- 로그인 필수화와 `TEST_PASSCODE`·`?user=` 방식 제거([checkpoint-integration.md](checkpoint-integration.md) 'PR 순서' ④·'접속 비밀번호 정리').
- 개념 ↔ 설비 연결(`equipment_ids`)과 재학습 시 3D 하이라이트(CLAUDE.md '다음 단계').

이슈:

- #14 체크포인트 HTTP 테스트가 전체 실행에서 가끔 실패
- #15 v2 `componentDidUpdate` 오류: #86 병합으로 v2가 지워지면 닫는다
- #16 제강 신규 설비 3개의 앵커가 `anchors-v2b.json`에 없음(v3가 쓰는 파일이라 유효)
- #17 `models/README.md`의 `EQ_<id>` 규칙이 현재 앵커 방식과 다름

## 4. 미정 사항

[checkpoint-overlay.md](checkpoint-overlay.md) '미정 사항'에서 아직 정하지 않은 것. 구현할 때 추측하지 말고 팀에 확인한다.

1. 오버레이 중 상단 바(홈·전체 공정·경로 표시)도 막을지. 3D 화면·공정 메뉴·하단 재생 바는 막기로 확정
2. 좁은 화면(rail)에서 [담금질 시작하기] 위치
3. 말풍선 넘김 방식([다음] 버튼 / 자동 넘김 + 클릭으로 건너뛰기). 지금은 [다음] 버튼
4. 오버레이가 열려 있을 때 튜터 패널을 함께 열 수 있게 할지. 지금은 열 수 있고, 답하는 중이면 학습 입력이 잠긴다
5. 캐릭터 동작 대체 매핑(`greet`→`praise`, `ask`→`idle`, `encourage`→`explain`, `cheer_retry`→`praise`, `sorry`→`thinking`). 지금은 이 제안값으로 동작
6. 통과한 섹션에 루브릭 변경으로 새로 생긴 개념을 다시 묻는 재응시 경로(CLAUDE.md '미정 사항')

(v2 탭 처리와 `cp-character.js` 담당은 정해졌다: v2 삭제, `cp-character.js`는 체크포인트 담당(ssoyoum).)

## 5. 라이선스 결정: 캐릭터 모델

- 모델 `frontend/3d-demo/models/character/tutor.glb`는 Tripo AI 무료 플랜으로 만들었고(2026-10-08), 라이선스는 CC BY 4.0이다.
- **팀 결정으로 서비스 화면에는 출처를 표기하지 않는다.** 모델 README는 지웠고(#86), 출처·라이선스는 [checkpoint-overlay.md](checkpoint-overlay.md) '캐릭터 모델 현황'에 한 줄로 남아 있다.
- **CC BY 4.0의 출처 표기 의무는 그대로 남아 있다.** 화면에 표기하지 않는 것은 이 의무를 지키지 않는 상태다. 시연 범위를 넘어 공개하거나 배포하게 되면 표기 방법(화면·정보 페이지 등)을 다시 정하거나, 유료 플랜으로 다시 만들거나, 직접 만든 모델로 바꾼다.

## 6. 서버와 DB 옮기기

시연 서버는 지금까지 수민의 컴퓨터에서 켰다. ssoyoum(또는 시연할 사람)은 자기 컴퓨터에서 아래처럼 켠다.

1. 저장소를 받고 `dev`로 맞춘 뒤 `npm ci`. 외부 공유가 필요하면 `cloudflared`를 설치한다.
2. `.env`를 만든다(`.env.example` 참고). `GEMINI_API_KEY`는 팀 키를 쓴다. 개인 키를 쓰던 경우 그 키는 공유하지 말고 폐기한다.
3. `caffeinate -i npm start`로 켠다(macOS 절전 방지). 기본 포트 3000, DB는 `data/st-rookie.sqlite`.
4. 외부 공유는 [team-test.md](team-test.md)대로 `TEST_PASSCODE`를 정한 뒤 `caffeinate -i npm run tunnel`.

DB:

- `data/`는 Git에서 제외되어 있다. DB 파일은 서버를 켠 컴퓨터마다 따로 생기고, 서버가 시작할 때 시연 계정(`trainee01`~`20`, `admin01`)을 만든다.
- 시연 기록(`origin = 'seed'`)은 `npm run db:seed-demo`로 언제든 다시 만들 수 있다.
- 실제 기록(`origin = 'live'`)은 수민의 컴퓨터에 체크포인트 시도 몇 건뿐이다. 평가자 eval의 사람 답변 재료는 `npm run eval:export-human`으로 내보내 따로 전달한다(판정 빈칸, 사용자 id 익명화). 받은 파일은 판정을 채운 뒤 `llm/eval/hard/`로 옮긴다([llm/eval/README.md](../llm/eval/README.md)).
- 다른 사람의 DB나 시연 DB를 건드리지 않고 시험하려면 복사본과 다른 포트로 띄운다(`PORT=3100 DB_PATH=data/복사본.sqlite`).

작업 방식(CLAUDE.md): 시연 서버가 서빙하는 메인 폴더는 `dev`에 두고, 작업은 `git worktree add -b <브랜치> ../ST-ROOKIE-<작업> origin/dev`로 만든 별도 폴더에서 한다. PR은 최신 `dev`에서 브랜치를 만들고 base는 `dev`(스택 PR 금지).

## 7. 읽을 문서 순서

1. [CLAUDE.md](../CLAUDE.md): 전체 규칙, 파일 담당, 점수 규칙, 튜터·평가자 규칙
2. [checkpoint-api.md](checkpoint-api.md): 체크포인트 API·상태 머신·DB·프롬프트 설계, '나중에 이어 풀기'
3. [checkpoint-overlay.md](checkpoint-overlay.md): 이해도 확인 오버레이 설계, 잠금 규칙, 캐릭터, 미정 사항
4. [checkpoint-integration.md](checkpoint-integration.md): v3 페이지 연결, `checkpoint-chat.js` 메서드와 `vals()` 키
5. [team-test.md](team-test.md): 서버·터널 띄우는 법, 팀원 테스트
6. [llm/eval/README.md](../llm/eval/README.md): 평가 세트 형식과 실행
7. [auth-api.md](auth-api.md): 로그인·관리자 API(관리자 대시보드)
