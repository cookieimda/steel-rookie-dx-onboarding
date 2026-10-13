# 다음 작업 (sleek 디자인)

기준: 2026-10-10 세션 종료 시점. 작업 기록은 `docs/sleek-worklog/index.html`, 백엔드는 `docs/backend-todo.md`.

## 0. 지금 상태
- 작업 위치: worktree `../ST-ROOKIE-dev`, 브랜치 `design/sleek-ui`(원격 `origin/design/sleek-ui` 기준). **커밋 전.**
- 바뀐 파일: `frontend/3d-demo/sleek-overview.js`, `frontend/3d-demo/Steel Academy v4.dc.html`, 문서 3개(`docs/`)
- 원래 폴더 `ST-ROOKIE`(`feature/ui-redesign`)는 건드리지 않음. 그쪽에 `.claude/launch.json`(미추적)만 추가됨(`st-rookie-dev` 설정이 이 worktree를 띄움).
- 서버: `npm run start --prefix ../ST-ROOKIE-dev` → `http://localhost:3000/Steel%20Academy%20v4.dc.html`, 홈 `http://localhost:3000/login_ui/home-sleek.html`
- worktree DB에는 확인용 기록이 있음(`trainee01`의 제선 이해도 확인 '멈춤' 1건).

## 1. 먼저 할 일(정리·공유)
- [ ] 변경 확인 후 `design/sleek-ui`에 커밋(agent.md 커밋 규칙), 푸시
- [ ] `Steel Academy v4.dc.html`, `scene_v3.js` 계열은 프론트 담당(viiin2) 영역 → 변경 내용 공유 후 PR
- [x] 메인 라우트(`/`)를 v4로 바꿈(`backend/src/app.ts`, 공용 → 팀 공유). 대시보드의 3D 링크(v3)는 담당자와 정리
- [ ] CLAUDE.md 프론트 구조 절에 sleek 페이지·`sleek-overview.js` 역할 추가

## 2. 3D 장면
- [ ] **고폴리 에셋 받기 → 로우폴리·UV·트림시트 반영**: 목록과 Tripo 프롬프트는 대화 기록 참고(원료 야적더미, 스태커, 컨베이어 갤러리, 슬래브·코일 더미, 배관 랙, 공장동 등). 받으면 미터 단위로 맞추고 공정 축척(1단위 ≈ 12m, 주변 물체는 `K_*` 비율)에 맞춰 배치
- [ ] 남은 실제 조명(방향광 1, 하늘빛 2)도 바닥·나무를 구우면 끌 수 있음(연산량 절감). 지금은 공정·건물만 구운 빛
- [ ] 3D 위 설비 이름표(`① 소결기`)가 아직 하늘색 → `sleek-overview.js`에서 덮어쓰기(`scene_v3.js`는 수정하지 않는 방식 유지)
- [ ] 제선 공정 굴뚝 연기 표현이 라이트 모드에서 회색 덩어리로 떠 보임 → 축척·색 조정
- [ ] 라이트 모드 하늘의 큰 해 원판·빛무리가 화면을 많이 차지함 → 크기·투명도 조정 검토
- [ ] 단면·흐름 기능 완전 제거 여부(지금은 탭만 숨김, 패널의 "단면 보기" 버튼과 시연 중 단면 카드는 남음)

## 3. UI
- [ ] 이해도 확인 오버레이(곰 캐릭터 대화창, `checkpoint-chat.js`)를 알약 스타일로 통일 — 체크포인트 담당(수민)과 협의
- [ ] 튜터 패널 경고 상자(노란 테두리) 외곽선 처리 결정
- [ ] 로그인 화면(`login-sleek.html`) 버튼이 파란색 `#2b50b8` → 홈·3D와 같은 규칙으로
- [ ] 좁은 화면(1200px 미만, 모바일)에서 알약·캡슐·패널 겹침 확인
- [ ] 2D 뷰(구역도·탑뷰·평면도)의 UI·색을 sleek 규칙으로

## 4. 확인·성능
- [ ] 실제 브라우저(창이 보이는 상태)에서 인트로 → 이어 풀기 토스트 3초 → 사라짐 흐름 확인(테스트 창은 가려지면 애니메이션이 멈춰 일부만 확인함)
- [ ] 저사양 PC에서 프레임 확인: 밤 굽기는 시작 시 1회(꼭짓점 계산 + 깊이 지도 2048²) — 로딩 시간 측정
- [ ] 테마 전환·공정 이동·시연을 반복해도 굽기·교체가 중복 실행되지 않는지(플래그: `__nightBaked`, `scaledY`, `treeProxy` 등)

## 5. 조절 값 위치(`sleek-overview.js`)
| 값 | 이름 |
|---|---|
| 배경 채도 | `GRADE` |
| 축척 | `K_BLD`, `K_TREE`, `K_LAMP` |
| 트림시트 세기 | `TRIM_AMT` |
| 밤 밝기 | `PROC_GAIN`, `BLD_GAIN` |
| 키라이트 | `KEY_DIR`, `KEY_COL`, `AMB_COL` |
| 빈터 옴니 | `NIGHT_OMNI`, `OMNI_COL` |
| 바다색 | `makeSea().setTheme` |
