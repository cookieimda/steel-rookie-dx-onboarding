# 백엔드 남은 구현 목록

기준: `design/sleek-ui` 브랜치(2026-10-10), CLAUDE.md의 '다음 단계'·'알려진 문제'·'미정 사항'과 실제 코드 상태를 대조해 정리했다.
담당은 CLAUDE.md '파일 담당' 표를 따른다. 공용 파일은 작은 PR + 팀 공유.

## 한눈에 보기

| 우선 | 항목 | 담당 | 상태 |
|---|---|---|---|
| 1 | 교육 자료 `section.md` 4개 | 팀(내용) + ssoyoum(검색 연결) | 없음 |
| 1 | 제강·연주·열연 루브릭 | 수민 | 없음(제선만) |
| 1 | 제선 루브릭 검수 | 팀 | `reviewed: false` |
| 2 | 튜토리얼 완료 여부 저장 + 연습 질문 | 수민/공용 | 없음 |
| 2 | 개념 ↔ 설비 연결(`equipment_ids`) | 수민(+공용 스키마) | 없음 |
| 2 | 재학습 3D 하이라이트용 응답 | 수민 | 없음 |
| 2 | `JWT_SECRET` 운영값 | 공용 | 비어 있음 |
| 3 | 임시 장치 제거(`X-User-Id` 헤더, 접속 비밀번호, 터널) | 수민 | 임시 유지 중 |
| 3 | 메인 페이지 라우트(`/`) | 공용(`app.ts`) | v4로 바꿈(팀 공유 필요) |
| 3 | 학습 진도 저장 | 공용(마이그레이션) | 없음 |
| 4 | 알려진 문제 #14(가끔 실패하는 테스트) | 수민 | 열림 |

---

## 1순위: 없으면 제선 외 공정이 동작하지 않음

### 1-1. 교육 자료 `content/materials/{섹션}/section.md`
- **현재**: `content/materials/` 폴더가 없다. 학습 모드 검색(`llm/src/retrieval.ts`)은 section.md가 없으면 `backend/data/ironmaking-sources.json`(제선 공개 자료 메모)으로 대신하고, **제선이 아닌 섹션은 빈 배열**을 돌려준다.
- **영향**: 제강·연주·열연에서 학습 모드 튜터가 근거 없이 답하거나 "자료 없음"이 된다.
- **할 일**
  - [ ] `ironmaking`, `steelmaking`, `continuous_casting`, `rolling` 네 섹션의 `section.md` 작성(팀이 웹 자료를 정리, 교육 내용의 단일 기준)
  - [ ] 제목 규칙(`##`/`###` 하나 = 검색 조각 하나, `{#id}` 앵커)에 맞추기
  - [ ] `retrieval.ts`가 네 섹션 모두 section.md를 읽는지 확인(테스트 추가)

### 1-2. 루브릭 `content/rubrics/final/`
- **현재**: `01_제선.json` 하나뿐이고 `reviewed: false`(임시). 초안 `draft/sinter_purpose.v2.json`은 통기성 근거 문장이 없어 보류 중.
- **영향**: 제강·연주·열연은 체크포인트(이해도 확인)를 시작할 수 없다. 다음 섹션 해금 흐름이 제선에서 멈춘다.
- **할 일**
  - [ ] 각 섹션 section.md를 근거로 루브릭 초안 생성 → `draft/` → 팀 검수 → `final/`
  - [ ] 개념별 질문 은행(`questions`, `recheck_questions`), `answer_terms`, `fallback_question`, `glossary`
  - [ ] 유출 검사 테스트 통과, `concept_id` 전체 고유
  - [ ] `npm run eval:evaluator -- --set smoke|hard`에 새 섹션 케이스 추가
  - [ ] 제선 루브릭 검수 후 `reviewed: true`, `sinter_purpose.v2` 근거 확보 시 final 이동(smoke·hard 기대 판정도 갱신)

## 2순위: 기획에 있는데 아직 없는 기능

### 2-1. 튜토리얼(첫 로그인 코치마크 + 연습 질문)
- **현재**: CLAUDE.md '튜토리얼' 절에 있으나 서버에 저장 장치가 없다(마이그레이션 001~007에 없음). 화면 쪽 driver.js 연결도 없음.
- **할 일**
  - [ ] 마이그레이션 `008_tutorial.sql`(번호는 PR 전에 팀 공유): 사용자별 튜토리얼 완료 시각
  - [ ] `GET /api/me/tutorial`, `POST /api/me/tutorial/complete`
  - [ ] 연습 질문 1개: 점수 미포함 경로(체크포인트 엔진과 분리하거나 `practice` 플래그)

### 2-2. 개념 ↔ 설비 연결
- **현재**: `content/rubrics/schema.json`에 `equipment_ids` 없음.
- **할 일**
  - [ ] 스키마에 개념별 `equipment_ids`(선택, `data_v2.js` 설비 id 배열) 추가 — 공용 파일, 작은 PR
  - [ ] 루브릭 로드 시 id가 `data_v2.js` 24개 안에 있는지 검증(`docs/equipment-ids.md`)

### 2-3. 재학습 3D 하이라이트
- **할 일**
  - [ ] `GET /api/me/misconceptions`(또는 대시보드) 응답에 미해결 오개념 개념의 `equipment_ids` 포함
  - [ ] 프론트가 그 설비를 강조할 수 있게 응답 형식 문서화(학습 모드 `scene_actions`와 맞춤)

### 2-4. `JWT_SECRET`
- **현재**: `.env.example`의 `JWT_SECRET=`가 비어 있어 서버를 켤 때마다 임시 키 → **재시작하면 모두 로그아웃**.
- **할 일**
  - [ ] 시연·운영 환경에 고정 키 설정, 비어 있으면 운영 모드에서 시작 거부(또는 경고 강화)

## 3순위: 정리·결정

### 3-1. 임시 장치 제거(로그인이 생겼으므로)
CLAUDE.md '원격 팀원 테스트'에 "로그인이 생기면 지운다"로 적힌 것.
- [ ] `backend/src/request-user.ts`의 `X-User-Id` 헤더 경로(토큰 없을 때) 제거 — sleek 페이지는 이미 토큰으로 체크포인트를 쓴다
- [ ] `TEST_PASSCODE`(`test-access.ts`), `scripts/tunnel.mjs` 유지 여부 결정
- [ ] 헤더 이름으로 쌓인 기록은 지우지 않음(eval 원천). 필요 시 `eval:export-human` 백업 후

### 3-2. 메인 페이지 라우트
- **현재**: `backend/src/app.ts`의 `/`가 `Steel Academy v4.dc.html`(sleek 디자인)을 연다. v3는 `/Steel%20Academy%20v3.dc.html`로 남아 있다.
- [ ] 공용 파일 변경이라 팀에 공유. 관리자·신입사원 대시보드(`frontend/login_ui/`, viiin2)의 3D 화면 링크는 아직 v3

### 3-3. 학습 진도 저장
- CLAUDE.md '데이터 저장'에 "진도"가 사용자별 데이터로 적혀 있으나, 지금은 체크포인트 진입 상태만 있다.
- [ ] 필요하면 본 설비·완료한 시연(공정 재생) 기록 테이블 + API(마이그레이션 번호 공유)

## 4순위: 알려진 문제
- [ ] #14 `HTTP: 시작 201·재시작 200, 입력 오류 400, LLM 연결 실패 502` 테스트가 전체 실행에서 가끔 실패(단독 통과)

## 참고: 이미 되어 있는 것(중복 구현 주의)
- 인증: 회원가입·로그인·아이디/비밀번호 찾기·`/api/auth/me`·시연 계정
- 체크포인트: 시작·메시지·멈춤·이어 풀기·재채점·섹션 진입 상태
- 학습 모드: `POST /api/chat`, 대화 조회, 학습자 메모 → 체크포인트 튜터 연결
- 관리자: 신입사원 통계, 개념 통계, AI 요약
- 개인: 대시보드, 오개념 목록
