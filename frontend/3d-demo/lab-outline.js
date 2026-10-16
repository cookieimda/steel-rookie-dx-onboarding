// 선택 설비 강조: 바닥에 퍼지는 물결 대신, 고른 설비를 카메라 기준 초록빛 외곽선으로 감싸고 표면에 옅은 초록 빛을 섞는다
// (레퍼런스: 주변은 흐리고 고른 것만 색이 살아 보이게). 다른 설비를 흐리게 하는 것은 steel-index.js가 하던 그대로다.
// three.js OutlinePass를 steel-index.js의 composer(블룸 뒤, OutputPass 앞)에 넣는다. 크기는 composer.setSize가 함께 맞춘다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { OutlinePass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js/+esm';

const TINT = new THREE.Color(0x3ddc84), TINT_INTENSITY = 0.32; // 표면에 섞는 초록 빛(자체 발광)

export function createOutline(scene, camera) {
  const pass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
  pass.edgeStrength = 7;     // 선 밝기
  pass.edgeThickness = 2;    // 선 두께
  pass.edgeGlow = 1;         // 선 바깥으로 번지는 빛
  pass.pulsePeriod = 0;      // 깜빡이지 않는다
  pass.visibleEdgeColor.set('#8dffbf'); // 보이는 외곽: 밝은 초록
  pass.hiddenEdgeColor.set('#2f6b4c');  // 다른 설비에 가린 외곽: 짙은 초록
  const saved = new Map(); // 재질 → 원래 발광색·세기

  function untint() {
    for (const [m, s] of saved) { m.emissive.copy(s.color); m.emissiveIntensity = s.intensity; }
    saved.clear();
  }
  function tint(obj) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!m?.emissive || saved.has(m)) continue;
        saved.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity });
        m.emissive.lerp(TINT, 0.85); m.emissiveIntensity = Math.max(m.emissiveIntensity, TINT_INTENSITY);
      }
    });
  }
  return {
    pass,
    // steel-index.js는 고른 직후 같은 흐름에서 재질 색을 되돌리므로, 그 뒤(마이크로태스크)에 초록 빛을 얹는다
    select(obj) { untint(); pass.selectedObjects = obj ? [obj] : []; if (obj) queueMicrotask(() => { if (pass.selectedObjects[0] === obj) tint(obj); }); },
    clear() { untint(); pass.selectedObjects = []; },
  };
}
