# feature/learning-lab 브랜치: 3D 인과 실습 (AI·개발자용 안내)

이 문서는 `feature/learning-lab` 브랜치에서 무엇을 만들었는지, 코드가 어디에 있는지, 고칠 때 무엇을 지켜야 하는지를 한곳에 모은 것이다. 사람이 읽는 시연 안내는 [DEMO-GUIDE.md](../DEMO-GUIDE.md), 회차별 작업·점검 기록은 [DEMO-LOG.md](../DEMO-LOG.md)다.

## 한 줄 요약

신입사원이 **한 공정의 조건이 다음 공정의 품질·안전으로 어떻게 이어지는지(인과)** 를 3D 공장 위에서 직접 바꿔 보고, 퀴즈·훈련·퍼즐로 확인하고, 그 기록이 학습 기록·사원증·관리자 통계로 이어지게 했다.

## 브랜치 기준

- 기준: `feature/learning-lab-sim`(커밋 `6bc9fec`, `dev`보다 1커밋 앞). 사원증·학습 랩·시험 그림·운영 도구·3D 인과 훈련 1차가 이 커밋에 있다.
- 이 브랜치는 그 위에 기능 커밋을 쌓았다. `git log 6bc9fec..feature/learning-lab`으로 전체를 본다. 커밋 scope는 `sim`(3D 실습 화면), `lab`(학습 랩·기록), `card`(사원증 XP·배지), `admin`(관리자 통계), `demo`(문서)다.
- 아직 `dev`에 PR을 열지 않았다. 합칠 때는 이 문서의 '기능별 정리'를 PR 설명으로 쓴다.

## 코드 지도

| 영역 | 파일 | 역할 |
|---|---|---|
| 인과 모델 | `backend/src/lab/causal.ts` | 변수 20개(`NODES`, 조정 가능 6개)·연결 17개(`EDGES`)의 교육용 선형 모델. `simulateCausal`, 퀴즈(`causalQuiz`·`checkHop`), 거꾸로 추론(`diagnoseQuiz`·`checkDiagnose`), 시간 질문(`lagQuiz`·`checkLag`), 되돌리기 퍼즐(`rebalancePuzzles`·`checkRebalance`), 개념→변수(`CONCEPT_VARS`), 한글 조사(`josa`·`eulReul`) |
| API | `backend/src/lab/routes.ts`, `backend/src/lab/extras-routes.ts` | 아래 'API' 표 |
| 실습 경로 | `backend/src/lab/practice-path.ts` | 내 기록으로 가장 약한 공정을 골라 지도 → 퀴즈 → 훈련 순서 추천 |
| 관리자 통계 | `backend/src/lab/practice-stats.ts` | 퀴즈·훈련·사고 사례·수업·거꾸로 추론·퍼즐 집계(사람별 내용 없음) |
| 수업 | `backend/src/lab/lessons.ts`, `content/lessons/lessons.json` | 수업 3개. 서버 시작 때 훈련·사례 참조를 검사하고 틀리면 시작하지 않는다 |
| 사고 사례·훈련 | `backend/src/lab/incidents.ts`·`content/scenarios/incidents.json`, `backend/src/lab/faults.ts`·`content/faults/faults.json` | 갈림길(다른 선택), 훈련 원인의 인과 지도 조건(`causal`) |
| 사원증·xAPI | `backend/src/me/employee-card.ts`, `backend/src/lab/xapi.ts` | 실습 XP·배지('인과 탐정'·'갈림길 탐험가'·'보상 판단'), xAPI 기록(서버에 남기고 API로 거름. 학습 랩의 xAPI 화면은 '보고서' 탭으로 바뀜) |
| 학습 보고서 | `frontend/login_ui/learner-report.html`·`learner-report.js`·`learner-report-model.js`, `backend/test/learner-report-model.test.ts` | 공정 하나의 내 학습 기록을 A4 보고서로 그리고 브라우저 인쇄로 PDF 저장. 학습 랩 '보고서' 탭이 iframe으로 띄운다. API 6개를 따로 불러 하나가 실패해도 나온다 |
| 3D 실습 화면 | `frontend/3d-demo/sim-lab.js` | 모든 실습 패널·3D 효과(링·흐름·빛·이름표)·카메라 따라가기. `attachSimLab(opts)`로 장면에 붙는다 |
| 인과 실습 공간 | `frontend/3d-demo/causal-lab.html`·`causal-lab.js` | 첫 화면 공장 부지를 밝은 낮 장면으로 옮기고 실습 4가지만 붙인 독립 페이지 |
| 학습 기록 | `frontend/login_ui/Trainee Dashboard.dc.html`, `learning-lab.js`, `lab-extras.js` | 오늘의 실습 경로·내 3D 실습 요약·오개념 → 인과 지도 링크·갈림길 |
| 운영 콘솔 | `frontend/login_ui/admin-ops.js` | [3D 실습] 탭 통계, 수업 모드 시작 |
| 테스트 | `backend/test/causal.test.ts`, `sim.test.ts`, `sim-lab-a11y.test.ts`, `lab.test.ts`, `employee-card.test.ts` | 모델·퍼즐 풀이 존재·주소 값 검사·접근성 속성 등 |

`sim-lab.js`는 v4(`Steel Academy v4.dc.html`)의 `<steel-scene>`에 붙는 것이 기본이다. 인과 실습 공간은 `<steel-scene>` 대신 `#stage`에 같은 이름의 속성(`scene`·`zones`·`camera`·`_frame`·`process`·`focus`·`reset`·`_overviewPose`·`_animateTo`)을 달고 `attachSimLab({ host, light: true, tutor: false, faultLabel: '이상 상황 알아보기' })`로 붙인다. 이 속성 이름을 바꾸면 두 화면이 함께 깨진다.

## 기능별 정리

### 1. 공정 인과 지도
- 조정 값을 바꾸면 하류 값이 위상 순서(`topoOrder`)로 반응하고, 3D 위에 흐름(오름 주황·내림 파랑), 범위 밖 붉은 링, 값 이름표로 보인다.
- 위험 점수 4개와 과열도는 0 아래로 내려가지 않는다(`floor`).
- 공정 사이 시간 지연 `LAG_HOURS`: 제선 → 제강 2~4시간, 제강 → 연주 1~2시간, 연주 → 압연 8~24시간(대략값).
- 인과 따라가기(카메라가 원인 → 결과 설비를 차례로 찾아감), 변수 설명 카드, 조건 링크, 두 조건 비교, 이 변수가 나오는 실습 바로 가기.
- 주소: `…?p=<공정>&lab=map[&var=<변수>][&set=<변수>:<값>][&tour=1]`. 화면이 값을 검사한다(id는 영문·숫자·_, 값은 숫자만).

### 2. 인과형 질문
- **인과 퀴즈**: 원인을 올리거나 내렸을 때 다음 값의 방향을 한 칸씩 고른다. 심화(`level=2`)는 세 칸. 틀린 칸만 다시 풀기, 틀린 칸을 튜터 입력창 질문으로 채우기(보내기는 학습자). 끝에 '언제 나타날까?' 시간 질문 한 문항.
- **거꾸로 추론**: 하류 증상 2개로 원인(변수·방향)을 고른다. 보기는 같은 증상을 만들지 않는 원인만 넣어 답이 하나다.
- **되돌리기 퍼즐**: 못 바꾸는 값이 흔들려 하류가 범위 밖일 때 다른 조정 값 하나로 되돌린다. 목표 도달·부작용·맞바꿈을 알려 준다. 모델로 풀이가 있는 퍼즐만 내고(테스트로 확인), 흔드는 크기 `DISTURB_LEVELS = [0.5, 0.8, 1]`, 부작용 없는 쉬운 퍼즐부터 낸다.
- 퀴즈·훈련 끝에 오늘의 실습 경로 다음 단계를 추천한다.

### 3. 이상 상황 훈련 ↔ 인과 지도
- 훈련 원인을 인과 지도 조건(`faults.json`의 `causal`)으로 적어, 끝나면 그 조건으로 지도를 열고 따라가기를 시작한다. 4개 훈련 모두 그 공정에 범위 밖 값이 생기는지 테스트로 확인한다.

### 4. 사고 사례 갈림길
- 사례 장면마다 실제 선택 1개 + 다른 선택. 학습 기록에서 고르면 결과 문장, [3D 공장에서 이 갈림길 보기]로 3D 재현(`lab=incident&scenario=…&at=…&pick=…`).

### 5. 공장 전체 보기
- 공정 4개가 한 화면에 들어오는 시점. 실습 패널이 닫혀 있으면 용선 → 용강 → 슬래브 → 코일 물류 흐름과 물질 이름표.

### 6. 학습 기록·운영
- 오늘의 실습 경로와 내 3D 실습 요약(학습 기록 › 학습 랩 맨 위).
- 오개념 → 인과 지도: 2026-10-16에 학습 기록의 '내 오개념' 탭을 빼면서 화면 링크도 없앴다. API `/api/lab/causal/concepts`와 인과 실습 공간 주소(`/3d-demo/causal-lab.html?p=…&lab=map&var=…`)는 그대로라 다른 화면에서 다시 연결할 수 있다. 복습(다시 볼 개념)은 사원증 탭 아래로 옮겼다.
- 수업 모드(운영 콘솔 › 3D 실습): 3D 화면 위쪽 막대로 단계 진행, 마지막 [🎓 수업 마치기]가 요약과 xAPI '마침'을 남긴다.
- 관리자 3D 실습 통계: 퀴즈 칸별 정답률·헷갈리는 연결, 훈련에서 오래 걸린 단계, 사례에서 많이 틀린 문항, 수업 진행, 거꾸로 추론 헷갈리는 원인, 퍼즐별 시도·풀이·부작용 없는 풀이. 시연 계정 빼기(`include_demo=false`) 지원.

### 7. 인과 실습 공간 (`/3d-demo/causal-lab.html`)
- 밝은 낮 장면에 실습 4가지(공정 인과 지도·조업 실험·이상 상황 알아보기·공장 전체 보기)만 둔 시연용 독립 페이지. 주소 값은 v4와 같다.
- `sim-lab.js`에 `opts.host`·`opts.light`(가산 합성 대신 보통 합성)·`opts.tutor`(false면 튜터 질문 버튼 숨김)·`opts.faultLabel`을 더했다. 옵션 없이 부르면 v4 동작은 그대로다.

### 8. 품질
- 접근성: 패널은 이름 있는 영역 + 상태 줄, Esc로 닫기·포커스 복귀, 범위 밖을 글로도 표시, 움직임 줄이기, 터치 높이 44px 이상.
- 휴대폰 폭 배치, 3D 이름표 겹침 정리, 이름표 크기 캐시, 3D 효과 메모리 점검, 모든 패널 [접기], 처음 한 번 안내 말풍선.

## API (이 브랜치에서 추가)

| 메서드·경로 | 용도 |
|---|---|
| `POST /api/lab/causal` | 조건으로 인과 모델 계산 |
| `GET /api/lab/causal/quiz?seed=&process=&level=` · `POST /api/lab/causal/quiz/check` | 인과 퀴즈 |
| `GET /api/lab/causal/diagnose` · `POST /api/lab/causal/diagnose/check` | 거꾸로 추론 |
| `GET /api/lab/causal/rebalance` · `POST /api/lab/causal/rebalance/check` | 되돌리기 퍼즐 |
| `GET /api/lab/causal/lag-quiz` · `POST /api/lab/causal/lag-quiz/check` | '언제 나타날까?' |
| `GET /api/lab/causal/concepts` | 개념 → 인과 지도 변수 |
| `GET /api/lab/practice-path` | 오늘의 실습 경로 |
| `GET /api/admin/practice-stats?include_demo=` | 관리자 3D 실습 통계 |
| `POST /api/lab/incidents/:id/branch` | 갈림길 탐험 기록 |
| `GET /api/lab/lessons` · `GET /api/lab/lessons/:id` | 수업 |
| `POST /api/me/lab/xapi`(`practice`) · `GET /api/me/lab/xapi?kind=` | xAPI 기록·거르기 |

## DB 마이그레이션

`backend/src/db/migrations/`에 014~018을 더했다(기준 브랜치에 011~013, `dev`는 010까지).

- `014_causal_quiz.sql` 인과 퀴즈 답 · `015_branch_explorations.sql` 갈림길 탐험 · `016_causal_quiz_deep.sql` 칸 3까지 · `017_diagnose_answers.sql` 거꾸로 추론 답 · `018_rebalance_attempts.sql` 되돌리기 퍼즐 시도
- 이미 합친 마이그레이션은 고치지 않고 새 번호로 더한다. `dev`에 합치기 전에 그사이 `dev`에 011 이상이 생겼는지 확인하고, 겹치면 번호를 다시 매긴다.

## 고칠 때 지킬 것

- 모델 계수·시간 지연·사고 사례는 모두 **교육용 대략값·가상 사례**다. 화면에 그렇게 밝히고 있다(`CAUSAL_NOTE`·`LAG_NOTE`). 실제 수치처럼 바꾸지 않는다. 현업 검수 전에는 '대략값' 표시를 지우지 않는다.
- 변수·연결을 바꾸면 `npm test`의 퍼즐 풀이 존재·훈련 재현·퀴즈 답 유일성 테스트가 함께 바뀌어야 한다. 테스트를 지워서 통과시키지 않는다.
- 설비 `id`(예: `blast_furnace`)는 화면·3D·콘텐츠를 잇는 키라 바꾸지 않는다([equipment-ids.md](equipment-ids.md)).
- 점수(체크포인트 이해도)에는 3D 실습 결과를 넣지 않는다. 실습 결과는 사원증 XP·배지·xAPI·통계에만 쓴다.
- 관리자 화면에는 사람별 답 내용을 보여 주지 않고 집계만 보인다.
- 커밋 메시지는 [agent.md](../agent.md) 형식을 따른다.

## 확인 방법

```bash
npm ci
npm run typecheck
npm test
npm run start
```

`npm run start` 뒤 `http://127.0.0.1:3000`에서 로그인한다. DB(`data/`)는 Git에 올리지 않으므로 처음에는 서버가 빈 DB와 시연 계정을 만들고, 체크포인트 시연 기록은 `npm run db:seed-demo`로 만든다. 3D 실습 기록은 화면에서 직접 풀어야 생긴다. 바로 가는 주소는 [DEMO-GUIDE.md](../DEMO-GUIDE.md)의 '한눈에 보기' 표.
