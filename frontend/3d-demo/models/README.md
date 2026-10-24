# 3D 모델(GLB) 넣는 곳

공정별로 파일 하나씩 넣으면 자동으로 기본 도형을 대체합니다. 파일이 없으면 기본 도형이 그대로 보입니다.

- `models/ironmaking.glb` — 제선
- `models/steelmaking.glb` — 제강
- `models/continuous_casting.glb` — 연주
- `models/rolling.glb` — 열간압연

## 규칙
- 설비 노드 이름: `EQ_<설비id>` (예: `EQ_blast_furnace`, `EQ_cc_mold`). 이름이 일치하는 노드만 클릭·하이라이트·라벨·소재 흐름에 연결됩니다. 없는 설비는 기본 도형이 남습니다.
- 배치: 설비들이 X축 −15 ~ +15 에 왼쪽→오른쓽 공정 순서로, 바닥 Y=0 위에 놓이게 해 주세요. 소재는 Z=+3.2 선을 따라 흐릅니다.
- 단위: 1 = 약 1 m 느낌(고로 높이 약 8). 크기가 다르면 3D 툴에서 스케일을 맞춰 내보내세요.
- 형식: glTF 2.0 binary(.glb), 텍스처 임베드.
- 용량 줄이기(지금 4개 파일에 적용): Blender에서 겹친 꼭짓점 합치기(Merge by Distance 0.0001)·같은 평면 면 합치기(Limited Dissolve 1°, 재질 경계 유지)·삼각형 쌍을 사각형으로(Tris to Quads)·각도 기준 매끈하게(35°) 정리한 뒤 GLB로 내보내고, `npx @gltf-transform/cli quantize`로 좌표·법선을 작은 숫자 형식(`KHR_mesh_quantization`)으로 저장합니다. three.js `GLTFLoader`가 추가 설정 없이 읽습니다(Draco와 달리 디코더 불필요).
- Draco 압축(2026-10-24, 4개 파일 6.5MB → 1.5MB): 위 정리 뒤 `npx @gltf-transform/cli draco 원본.glb models/<공정>.glb`로 형상을 압축합니다. 노드 이름(`EQ_<id>`)·위치는 그대로입니다. 읽는 쪽은 `GLTFLoader`를 직접 만들지 말고 `gltf-loader.js`의 `createGLTFLoader()`를 쓰세요(Draco 디코더가 연결된 로더). 새 GLB를 넣을 때도 같은 명령으로 압축합니다.

로딩 상태는 화면 우측 하단 `MODEL` 표시와 `{ }` 개발자 패널에서 확인할 수 있습니다.
