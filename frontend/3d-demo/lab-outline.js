// 선택 설비 외곽선: 바닥에 퍼지는 물결 대신, 고른 설비의 실루엣을 카메라 기준으로 밝은 선으로 감싼다(레퍼런스의 건물 외곽선).
// three.js OutlinePass를 steel-index.js의 composer(블룸 뒤, OutputPass 앞)에 넣는다. 크기는 composer.setSize가 함께 맞춘다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { OutlinePass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutlinePass.js/+esm';

export function createOutline(scene, camera) {
  const pass = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
  pass.edgeStrength = 4.5;   // 선 밝기
  pass.edgeThickness = 1.2;  // 선 두께
  pass.edgeGlow = 0.35;      // 선 바깥 은은한 빛
  pass.pulsePeriod = 0;      // 깜빡이지 않는다
  pass.visibleEdgeColor.set('#eef4ff'); // 보이는 외곽: 거의 흰색
  pass.hiddenEdgeColor.set('#4d5868');  // 다른 설비에 가린 외곽: 흐린 회청색
  return {
    pass,
    select(obj) { pass.selectedObjects = obj ? [obj] : []; },
    clear() { pass.selectedObjects = []; },
  };
}
