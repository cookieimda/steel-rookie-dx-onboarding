# 이해도 확인 오버레이 설계

이해도 확인(체크포인트)을 오른쪽 AI 튜터 패널에서 분리해 3D 화면 위 오버레이로 옮긴다. 서버 API는 바꾸지 않는다.
상태: PR 1(`checkpoint-chat.js`의 오버레이용 상태·값)이 이 문서와 함께 들어간다. 화면(v3)은 아직 바뀌지 않았다. 아래 '미정 사항'은 팀 확인 뒤 확정한다.

관련 문서: [checkpoint-api.md](checkpoint-api.md)(API·상태 머신), [checkpoint-integration.md](checkpoint-integration.md)(튜터 패널 통합, `vals()` 키 전체 표).

## 목표

- 오른쪽 AI 튜터 패널은 학습 전용이다. 모드 탭(학습 | 이해도 확인)을 없애고, 이어 풀기 배너는 공정 목록으로 옮긴다.
- 공정 목록 각 섹션 끝에 [담금질 시작하기] 버튼과 진행 상태·배지를 둔다.
- 버튼을 누르면 3D 화면 위에 오버레이가 뜬다: 3D 캐릭터 + 말풍선 + 답변 입력 + 나가기.
- 캐릭터 동작은 튜터 발화의 `type`으로 정한다(`question`, `feedback`, `explanation`, `recheck_question`, `result` 등).

## 근거: 발화 type만으로 동작을 정할 수 있다

진행 중에는 서버가 판정(`verdict`)을 보내지 않는다. 대신 엔진(`backend/src/checkpoint/engine.ts`)이 판정에 따라 내는 발화 조합이 정해져 있다.

| 상황 | 이번 응답의 발화 |
|---|---|
| 첫 판정 correct | `feedback`("맞아요.") → 다음 `question` |
| 첫 판정 partial·wrong·assisted | `explanation` → `recheck_question` |
| 재확인 correct | `feedback`("맞아요, 이번에는 정확해요.") → 다음 `question` |
| 재확인 correct 아님 | `key_points` → 다음 `question` |
| 마지막 개념 뒤 | (`feedback` 또는 `key_points`) → `result` |
| 평가자 형식 오류 | `error` |

- **`feedback`은 맞혔을 때만 나온다.** 이 약속은 지금 문서에 없으므로 백엔드 테스트로 고정한다. 엔진이 바뀌어 틀린 답에도 `feedback`을 내면 캐릭터가 틀린 답을 칭찬하게 된다.
- 한 응답에 발화가 여러 개 온다. 그래서 "마지막 메시지 type" 하나가 아니라, **이번 응답의 발화를 차례로 보여 주고 지금 보이는 발화로 동작을 정한다.**

## `checkpoint-chat.js` 변경 (수민)

### 새 상태

| 키 | 설명 |
|---|---|
| `cpOverlayOpen` | 오버레이 표시 여부. 로그인·새로고침으로 시도를 복원할 때는 열지 않는다(지금의 "이해도 확인 탭으로 자동 전환 안 함"과 같은 규칙). |
| `cpTurn` | 이번 응답의 튜터 발화 `[{ type, text }]`. `call()`·`enter()`에서 채운다. 복원 때는 history의 마지막 사용자 메시지 뒤 발화. |
| `cpBubbleIndex` | 말풍선이 보여 주는 `cpTurn` 번호 |

### 동작 이름표 (`motionFor`, 순수 함수)

체크포인트 로직은 아래 이름표만 낸다. 모델·클립·이미지는 모른다.

| 조건 | 이름표 |
|---|---|
| 채점 중(`cpPending`) | `thinking` |
| `intro` | `greet` |
| `question` | `ask` |
| `recheck_question` | `ask_again` |
| `feedback` | `praise` |
| `explanation` | `explain` |
| `key_points` | `encourage` |
| `result` + 통과(`result.unlocked`) | `celebrate` |
| `result` + 미통과 | `cheer_retry` |
| `error` | `sorry` |
| 멈춤·대기·그 밖 | `idle` |

틀렸을 때의 "실망" 동작은 두지 않는다. 틀린 경우는 `explain`(부가 설명)으로 보인다.

### `vals()`에 추가할 값

키별 형식·설명은 [checkpoint-integration.md](checkpoint-integration.md)의 '공정 목록 섹션 버튼'·'오버레이' 표.

- 공정 목록(섹션별, `sectionBadge(id)`를 넓힘): `cpSectionStatus`, `cpSectionPassed`, `cpSectionShowStart`(통과·로그인 전·잠김·준비 중이면 숨김), `cpSectionCanStart`·`cpSectionStartOpacity`, `cpSectionStartLabel`(담금질 시작하기 / 이어 풀기 / 재도전), `onCpSectionStart`(→ `openSection(id)`), `cpSectionHasResume`, `cpSectionResumeText`. 기존 진입 화면 키(`cpEntryStatus`, `cpCanStart` …)와 헷갈리지 않게 `cpSection`으로 시작한다.
- 오버레이: `cpShowOverlay`, `cpCharacterMotion`, `cpBubbleText`, `cpBubbleLabel`, `cpBubbleType`, `cpBubbleColor`, `cpBubbleHasNext`, `cpBubbleNextLabel`, `onCpBubbleNext`, `cpCanAnswer`(마지막 발화를 보고 있고 답하는 중일 때만 입력 가능)·`cpOverlayInputDisabled`, `cpShowHistory`·`cpHistoryLabel`·`onCpToggleHistory`(앞의 설명 다시 보기), `cpExitLabel`, `onCpExit`.
- 그대로 다시 쓰는 값: 입력(`cpInput`, `onCpSend` …), 준비·재채점 버튼, 멈춤 확인창(`cpConfirmPause` …), 결과(`cpResult`), 진행 점(`cpDots`).

### 동작 변경

| 함수 | 지금 | 바뀐 뒤 |
|---|---|---|
| `start()` | 현재 공정(`processId`)만 시작 | `start(section)`: 다른 공정이면 옮기고(`goProcess`) 오버레이를 연 뒤 시작. 실패하면 닫는다 |
| 섹션 버튼(새) | - | `openSection(section)`: 그 섹션의 풀던 시도가 열려 있으면 `resume()`, 결과가 열려 있으면 닫고 `start(section)`, 시작해서 멈춘 시도를 받으면 `resume()` |
| `resume()` | `tutorMode: 'checkpoint'` | `cpOverlayOpen: true` |
| 나가기(새) | - | 답하는 중이면 기존 확인창 → `pause()` → 닫기. 끝났으면 `close()`. 멈춤이면 닫기만 |
| `pauseForLearning()` | 학습 탭으로 전환 | 오버레이를 닫고 페이지 훅 `c.openTutor?.()` |
| `runLearning`·`lockLearning` | 잠금 규칙 | 그대로. `tutorMode` 관련 줄만 정리 |

- 탭 값(`cpTabs` 등)과 `tutorMode`는 PR 4에서 지웠다. v2 페이지는 이때 함께 지웠다(미정 사항 4).
- `tutor-text.js`(수민)에 `담금질 시작하기`, `나가기`, 말풍선 [다음] 문구를 추가한다.

## 캐릭터 모듈 (`frontend/3d-demo/cp-character.js`)

커스텀 엘리먼트 `<cp-character>`. `steel-scene`과 같은 방식으로 템플릿에 넣는다.

```html
<cp-character motion="{{ cpCharacterMotion }}" model="models/character/tutor.glb" fallback="images/character/idle.png"></cp-character>
```

- 입력은 속성뿐이다. `motion` 속성이 바뀌면 `attributeChangedCallback`이 동작을 바꾼다. v2의 `componentDidUpdate` 문제([#15](https://github.com/viiin2/ST-ROOKIE/issues/15))에 기대지 않는다.
- 렌더러 두 개가 같은 인터페이스를 따른다: `load()`, `play(motion)`, `dispose()`.

### `GltfRenderer` (1단계 기본)

- `scene_v3.js`와 별도의 캔버스·WebGL 렌더러를 쓴다(`scene_v3.js`는 고치지 않는다). 조명은 자체로 둔다(`RoomEnvironment` 또는 반구광).
- 불러온 모델을 정규화한다: 바운딩 박스로 목표 높이에 맞춰 크기를 조정하고, X·Z 중심을 0, 바닥(Y 최솟값)을 0에 놓는다. 동작은 모델을 감싼 그룹에 적용한다(기준점 = 발 중앙).
- **동작 선택 순서**
  1. 모델에 이름표와 같은 이름의 애니메이션 클립이 있으면 클립을 쓴다(`AnimationMixer`, 크로스페이드). 나중에 Mixamo 등으로 뼈대·동작을 넣으면 코드 변경 없이 이 경로를 탄다.
  2. 클립이 없으면 아래 **몸 전체 움직임**(그룹의 위치·회전·크기를 시간 함수로 바꿈)을 쓴다.
  3. 이름표에 정의된 몸 전체 움직임도 없으면 대체 이름표로, 그것도 없으면 `idle`.
- **몸 전체 움직임** (뼈대 없음)

  | 이름표 | 움직임 | 반복 |
  |---|---|---|
  | `idle` | 위아래 흔들림 | 반복 |
  | `praise` | 통통 튀기 | 한 번 → `idle` |
  | `ask_again` | 갸웃 기울기(옆으로) | 한 번 → 기운 채 유지 |
  | `explain` | 좌우 흔들기 | 반복 |
  | `celebrate` | 점프 + 회전 | 한 번 → `idle` |
  | `thinking` | 천천히 기울기 | 반복 |

  대체(제안, 팀 확인): `greet` → `praise`, `ask` → `idle`, `encourage` → `explain`, `cheer_retry` → `praise`, `sorry` → `thinking`.
- 동작이 바뀔 때는 이전 동작의 위치·회전에서 짧게(약 0.2초) 보간해 튀지 않게 한다.
- 오버레이가 닫히거나 화면에 안 보이면 렌더 루프를 멈추고, 엘리먼트가 빠지면 `dispose()`한다.
- `prefers-reduced-motion`이면 움직이지 않고 정지 자세로 둔다.

### `ImageRenderer` (대체)

- 모델 로드 실패·시간 초과·WebGL 없음일 때만 쓴다. 동작별 이미지는 만들지 않는다.
- `fallback` 이미지 한 장, 없으면 기본 실루엣 SVG.

### 모델 교체

- 모델 파일 규칙: `frontend/3d-demo/models/character/tutor.glb`, glTF 2.0 binary(Draco 압축 없음, 텍스처 포함). 발 중앙이 원점·바닥이 Y=0·얼굴이 +Z. 재질은 Metallic 0. 애니메이션 클립을 넣으면 클립 이름을 동작 이름표와 같게 한다.
- 뼈대·클립이 있는 모델로 바꿔도 `checkpoint-chat.js`와 이름표는 그대로다. 클립 이름만 이름표에 맞춘다.

## 캐릭터 모델 현황 (2026-10-08)

파일: `frontend/3d-demo/models/character/tutor.glb`(#84). Tripo에서 텍스처 포함으로 받은 원본(저장소에 넣지 않음)을 줄인 것이다. 뷰어로 모양과 텍스처를 확인했다. 처리: `@gltf-transform/cli` 4.5.1로 `weld` → `simplify --ratio 0.06 --error 0.001` → `quantize`.

모델 출처: Tripo AI로 생성(무료 플랜, 2026-10-08), 라이선스 CC BY 4.0

| 항목 | 원본 | `tutor.glb` |
|---|---|---|
| 형식 | glTF 2.0 binary(.glb), 생성 Tripo | 같음. `KHR_mesh_quantization` 확장 사용(three.js `GLTFLoader`가 추가 설정 없이 읽음). Draco 없음 |
| 용량 | 15.7 MB | 1.76 MB |
| 폴리곤 | 삼각형 501,242개, 꼭짓점 300,289개 | 삼각형 72,952개, 꼭짓점 61,554개 |
| 구성 | 노드 1, 메시 1, 재질 1. 뼈대(skin)·애니메이션 없음 | 같음 |
| 텍스처 | 3장(기본색, 노멀, 거칠기·금속성), 각 512×512 JPEG, 합계 88.8 KB | 원본과 같음(바이트 단위 동일, 크기 조정 안 함) |
| 크기·기준점 | 높이 1(Y 0 ~ 1), 폭 X ±0.377, 깊이 Z ±0.293. 발이 바닥(Y=0), 기준점이 발 중앙 | 같음. 단 배율·위치가 노드에 있다(아래) |
| 방향 | 얼굴이 +Z 쪽(glTF 기본 앞 방향) | 같음 |
| 모양 | 흰 곰 캐릭터(분홍·하늘색 무늬). 머리가 전체 높이의 약 60%, 짧은 팔이 몸통 옆에 붙어 내려와 있고 짧은 다리, 뒤에 꼬리 | 같음 |

- 거칠기·금속성 텍스처의 금속성은 거의 0이다. 재질이 비어 금속성 1로 어둡게 보이던 이전 후보(`Untitled.glb`, 텍스처 없음)의 문제는 없다.
- **크기는 노드 변환을 포함한 바운딩 박스로 맞춘다.** `quantize`가 메시 좌표를 정수로 바꾸면서 배율 0.5·위치 Y 0.5를 노드에 넣었다. 메시 좌표(accessor min/max)만 보면 크기·바닥 위치가 틀린다. three.js에서는 `new Box3().setFromObject(scene)`(월드 변환 포함)로 잰다.
- 비율 0.06(약 3만)까지 내려가지 않은 것은 UV 경계가 잠기기 때문으로 보인다. 텍스처를 쓰므로 UV는 남긴다.
- 모양·텍스처가 어긋나면 `--error`를 낮춰(예: 0.0005) 다시 만든다. 삼각형 수와 용량은 조금 늘어난다.

## Mixamo 자동 리깅 가능성

- 팔·다리가 있는 사람형이라 시도는 할 수 있지만 **결과가 좋을 가능성은 낮다**고 본다(실제로 올려 보지는 않았다).
  - 머리가 몸의 약 60%인 비율이라 턱·목 표시 위치가 애매하고, 머리 뼈 비중이 사람 기준과 크게 다르다.
  - 팔이 몸통에 붙어 내려와 있어(T·A 자세가 아님) 팔과 몸통의 가중치가 섞이기 쉽다.
  - 원본 50만 삼각형은 업로드·처리 부담이 크다. 줄인 `tutor.glb`로 시도한다.
- 대안: Blender에서 몸통·머리·팔·다리 정도의 단순 뼈대를 직접 만들거나, 머리만 따로 떼어 갸웃·끄덕을 머리 회전으로 한다. 어느 쪽이든 클립 이름을 이름표에 맞추면 `GltfRenderer`가 그대로 쓴다.

## v3 HTML 변경 범위 (viiin2)

1. 튜터 패널: 모드 탭 줄과 이해도 확인 블록을 지우고, 학습 블록을 감싼 `cpIsLearningTab` 조건을 푼다. 학습 잠금 문구와 [멈추고 질문하기]는 남긴다.
2. 공정 목록(넓은 화면): 펼친 섹션의 설비 목록 아래에 상태 문구와 [담금질 시작하기]/[이어 풀기]. 이어 풀기 배너를 이쪽으로 옮긴다. 좁은 화면(rail)은 배지 점만(미정 사항).
3. 오버레이: 3D 영역 div 안 `steel-scene` 위. 아래쪽 띠에 `<cp-character>` + 말풍선 + 입력 + 버튼(준비됐어요, 다시 채점하기, 나가기), 결과 차트. 바탕은 `pointer-events: none`, 실제 요소만 `auto`로 해서 3D 드래그가 통하게 한다.
4. 로직: `componentDidMount`에서 `cp-character.js` 불러오기, `openTutor()` 추가, `goProcess`·투어·작동 보기에 오버레이 잠금 검사.

## 잠금 규칙

| 항목 | 답하는 중(`awaiting_*`, `error`) | 멈춤·끝남 |
|---|---|---|
| 학습 패널 | **잠금(확정)**. [멈추고 질문하기] → 멈춤 → 오버레이 닫기 → 튜터 패널 열기 | 사용 가능 |
| 카메라 회전·확대·3D 클릭 | **막음(확정)**. 오버레이의 반투명 배경이 3D 영역 전체를 덮는다 | 허용 |
| 공정 메뉴(공정 이동·설비 선택·섹션 버튼)·하단 재생 바 | **막음(확정)**. 흐리게·흑백으로 보이고 누를 수 없다(`cpOverlayLock*`). 공정 메뉴 맨 위에 '담금질 중에는 공정 이동과 재생을 쓸 수 없어요' | 허용 |
| 상단 바(홈·전체 공정·경로 표시) | 열려 있음(미정 사항 1) | 허용 |
| 설비 클릭 | 하이라이트만, 설비 패널은 열지 않음(제안) | 허용 |
| 나가기 | 확인창 → 멈춤 | 닫기 |

새로고침 직후에는 답하는 중인데 오버레이가 닫힌 상태가 생길 수 있다. 이때는 지금처럼 학습 패널이 잠기고 공정 목록에 [이어 풀기]가 보인다.

## PR 순서

각 PR은 최신 `origin/dev`에서 브랜치를 만들고 base는 `dev`로 한다(스택 PR 금지).

| # | 담당 | 내용 | 기존 화면 영향 |
|---|---|---|---|
| 1 | 수민 | `checkpoint-chat.js`·`tutor-text.js`: `start(section)`, 섹션별 값, 오버레이 값, `motionFor`(탭 값은 유지). "`feedback` = 맞음" 백엔드 테스트 | 없음 |
| 모델 | 수민 | `models/character/tutor.glb`와 README(출처·라이선스, 수정 내역). 라이선스 칸을 채운 뒤 연다 | 없음 |
| 2 | 담당 확인 필요 | `cp-character.js`: `GltfRenderer`(클립 우선, 없으면 몸 전체 움직임) + `ImageRenderer`(대체 이미지·실루엣). `checkpoint-test.html`에 동작 미리보기 | 없음 |
| 3 | viiin2 | v3 HTML: 오버레이, 공정 목록 버튼, 탭 제거, 잠금 검사 | v3 개편 |
| 4 | 수민 | 탭 값·`tutorMode`와 튜터 패널 전용 값 제거, v3의 숨긴 이해도 확인 탭 블록 제거, v2 페이지·`scene_v2.js` 삭제, `checkpoint-integration.md` 갱신. CLAUDE.md는 별도 작은 PR | v2 페이지 삭제 |
| 5 | 나중에 | 뼈대·클립이 있는 모델로 교체. 클립 이름 = 이름표면 코드 변경 없음 | 없음 |

1·모델·2는 동시에 진행할 수 있고, 3은 1·2(와 모델)가 병합된 뒤 시작한다.
`cp-character.js`와 `models/character/`의 담당은 CLAUDE.md 파일 담당 표에 새로 정한다(`models/`는 viiin2 담당).

## 미정 사항

1. 오버레이 중 상단 바의 홈·전체 공정·경로 표시(지금은 눌러서 전체 공정으로 옮길 수 있다). 3D 화면 조작·공정 메뉴·하단 재생 바는 막기로 확정
2. 좁은 화면(rail)에서 [담금질 시작하기] 위치
3. 말풍선 넘김: [다음] 버튼 / 자동 넘김 + 클릭으로 건너뛰기
4. ~~v2 페이지의 이해도 확인 탭을 남길지 지울지~~ → v2 페이지 자체를 지우기로 결정(PR 4)
5. 오버레이가 열려 있을 때 튜터 패널을 함께 열 수 있게 할지
6. 이름표 대체 매핑(`greet`, `ask`, `encourage`, `cheer_retry`, `sorry`)
7. `cp-character.js`·`models/character/` 담당
