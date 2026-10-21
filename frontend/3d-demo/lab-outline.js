// 선택 설비 강조: 주변 설비는 흑백, 고른 설비는 원래 재질 색을 조금 밝게 + 얇은 흰 외곽선.
// - 고른 설비: 색을 덧칠하지 않고 원래 색을 10% 밝게, 자체 발광(emissive)은 그대로 둔다(2026-10-19: 청록·구리빛 덧칠이 어색해 뺐다).
// - 같은 공정의 다른 설비: 흑백(밝기만 남김), 자체 발광은 끈다.
// - 외곽선: three.js OutlinePass로 카메라 기준 실루엣을 얇은 밝은 선으로(번짐 없음).
// 색은 steel-index.js가 고를 때·해제할 때 재질의 원래 색(userData.color·emissive)으로 되돌리므로, 같은 재질만 만지고 그 뒤에 덧칠한다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { OutlinePass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js/+esm';


const managed = (o) => o.isMesh && o.material?.userData?.color; // steel-index.js가 색을 되돌리는 재질만
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function paint(node, picked) {
  node.traverse((o) => {
    if (!managed(o)) return;
    const m = o.material, l = lum(m.userData.color);
    if (picked) { m.color.copy(m.userData.color).multiplyScalar(1.1); return; } // 원래 색 그대로 조금 밝게
    const g = l * 0.55; m.color.setRGB(g, g, g);                                // 흑백 + 살짝 어둡게
    if (m.userData.emissive) m.emissiveIntensity = 0;
  });
}

export function createOutline(scene, camera) {
  const pass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
  pass.edgeStrength = 3;     // 선 밝기
  pass.edgeThickness = 1;    // 얇게
  pass.edgeGlow = 0;         // 번짐 없음
  pass.pulsePeriod = 0;
  pass.visibleEdgeColor.set('#ffffff'); // 보이는 외곽: 흰색
  pass.hiddenEdgeColor.set('#3a3d44');  // 가린 외곽: 흐린 회색
  return {
    pass,
    /** @param obj 고른 설비 노드 @param all 같은 공정의 설비 노드들(고른 것 포함) */
    select(obj, all = []) {
      pass.selectedObjects = obj ? [obj] : [];
      // steel-index.js가 같은 흐름에서 색을 되돌린 뒤(마이크로태스크)에 덧칠한다
      if (obj) queueMicrotask(() => { if (pass.selectedObjects[0] !== obj) return; for (const n of all) if (n !== obj) paint(n, false); paint(obj, true); });
    },
    clear() { pass.selectedObjects = []; },
  };
}
