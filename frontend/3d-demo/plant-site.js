// [세련안] v4 장면에 제철소 주변 소품(plant-props.js)을 배치한다. scene_v3.js·sleek-overview.js는 고치지 않고 바깥에서 붙는다.
// 소품은 미터 단위로 만들어져 있어 공정 축척(1단위 ≈ 12m)에 맞춰 줄인다. 자리는 공정 위치(제선 z≈-69, 제강 -32, 연주 0, 열연 65)를
// 기준으로 빈 땅에 잡았다(열연은 z 34로 옮김)(위에서 내려다본 배치도로 도로·건물·해안선을 피함).
// 소품 자리에 겹치는 나무·가로등 인스턴스는 숨긴다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { makeReclaimer, makeStockpile, makeQuenchTower, makeSlabYard, makeCoolingTower, makeCoolingPlant, makePipeRack, makeCoilYard, trimReady } from './plant-props.js';

// 공정 GLB는 실제보다 크게 표현되어 있어(고로·열풍로가 실제 축척의 약 1.5배) 실축척(1/12)으로 두면 소품이 바닥 무늬처럼 납작해진다.
// 공정 모델과 나란히 봤을 때 어울리는 1/7로 둔다.
const M2U = 1 / 7; // 1m → 장면 단위
const NIGHT = 0.32;  // 밤 테마에서 소품 색에 곱하는 값(주변 건물 밝기에 맞춤)

// x, z: 장면 단위. ry: Y축 회전(라디안). 소품 자리(경계 상자)에 겹치는 나무·가로등은 숨긴다
const PLACES = [
  // 제선 북쪽 해안 띠: 철광석·석탄 야적더미 두 줄과 그 사이 레일 위 리클레이머(레일은 X 방향)
  { name: 'pile_ore', make: () => makeStockpile({ L: 130, W: 30, H: 14, kind: 'ore', seed: 3 }), x: 12, z: -93.3 },
  { name: 'pile_coal', make: () => makeStockpile({ L: 110, W: 28, H: 12, kind: 'coal', seed: 8 }), x: 12, z: -85.5 },
  { name: 'reclaimer', make: () => makeReclaimer({ rails: 130, slew: 0.5, tripper: false }), x: 12, z: -89.4, ry: Math.PI / 2 },
  // 코크스 오븐(12.6, -69.3) 남쪽: 소화탑(레일은 X 방향으로 오븐 줄과 나란히)
  { name: 'quench_tower', make: () => makeQuenchTower(), x: 12.5, z: -60 },
  // 연주(z 0) → 열연(z 65) 사이, 도로 서쪽: 슬래브 야드 두 곳
  { name: 'slab_yard_a', make: () => makeSlabYard({ rows: 4, cols: 9, seed: 3 }), x: -47, z: 17 },
  { name: 'slab_yard_b', make: () => makeSlabYard({ rows: 3, cols: 9, seed: 9 }), x: -41, z: 25 },
  // 연주(x -66 ~ -21, z 0) 남서쪽 바로 옆: 냉각탑과 냉각수 펌프장(연주 냉각수)
  { name: 'cooling_tower', make: () => makeCoolingTower(), x: -62, z: 19 },
  { name: 'cooling_plant', make: () => makeCoolingPlant(), x: -62, z: 26 },
  // 제강(z -44 ~ -20)과 연주(z -12.5 ~ 12.5) 사이 빈 띠: 두 공정을 잇는 배관 랙(길이 X 방향)
  { name: 'pipe_rack', make: () => makePipeRack({ L: 168 }), x: -38, z: -16 },
  // 열연 권취기(x≈11, z 34) 동쪽 끝: 감은 코일을 쌓는 코일 야드. 코일 하나가 삼각형 약 650개라 1단·70개 정도로 둔다(2단 8줄이면 12만 개)
  { name: 'coil_yard', make: () => makeCoilYard({ rows: 6, perRow: 12, tiers: 1, seed: 5 }), x: 18, z: 34 },
];

export function attachPlantSite() {
  const tryAttach = () => {
    const el = document.querySelector('steel-scene');
    const ready = el && el.scene && el.zones && el.scene.getObjectByName('SITE_BACKDROP_EXT');
    if (!ready) return setTimeout(tryAttach, 150);
    if (el.__plantSite) return; el.__plantSite = true;
    const root = new THREE.Group(); root.name = 'PLANT_PROPS';
    for (const p of PLACES) {
      const g = new THREE.Group(); g.name = 'PROP_' + p.name;
      const o = p.make(); g.add(o);
      g.scale.setScalar(M2U); g.position.set(p.x, 0, p.z); g.rotation.y = p.ry || 0;
      g.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } }); // 그림자는 장면 설정을 따른다(공정 밖은 그림자 지도 범위 밖)
      root.add(g);
      g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      p.rect = [(bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2, (bb.max.x - bb.min.x) / 2, (bb.max.z - bb.min.z) / 2];
    }
    el.scene.add(root);
    // 밤에는 주변 건물처럼 어둡게(소품은 밤 조명 굽기 대상이 아니라 그대로 두면 혼자 밝게 뜬다)
    const mats = new Set(); root.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => mats.add(m)); });
    mats.forEach(m => { m.userData.dayColor = m.color.clone(); });
    const tone = () => { const dark = (el.getAttribute('theme') || 'dark') === 'dark'; mats.forEach(m => m.color.copy(m.userData.dayColor).multiplyScalar(dark ? NIGHT : 1)); el.invalidate?.(); };
    tone(); new MutationObserver(tone).observe(el, { attributes: true, attributeFilter: ['theme'] });
    el.invalidate?.();
    trimReady.then(() => el.invalidate?.());
    // 나무·가로등은 sleek-overview.js가 늦게 바꿔 끼우므로 몇 번 더 비운다
    const clear = () => { clearInstances(el, PLACES); el.invalidate?.(); };
    clear(); [1500, 4000, 8000, 15000].forEach(t => setTimeout(clear, t));
    document.addEventListener('sleek-intro-done', clear);
  };
  tryAttach();
}

// 소품 자리 안에 있는 나무·가로등 인스턴스를 크기 0으로 만든다(InstancedMesh만 대상)
function clearInstances(el, places) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const rects = places.filter(pl => pl.rect).map(pl => pl.rect).map(([x, z, hx, hz]) => [x, z, hx + 0.8, hz + 0.8]);
  el.scene.traverse(o => {
    if (!o.isInstancedMesh || o.parent?.name?.startsWith?.('PROP_')) return;
    if (!(o.userData.tree || o.userData.sleekTree || o.userData.treeProxy || o.userData.lamp)) return;
    let hit = false;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, s);
      if (rects.some(([x, z, hx, hz]) => Math.abs(p.x - x) < hx && Math.abs(p.z - z) < hz)) { o.setMatrixAt(i, zero); hit = true; }
    }
    if (hit) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere?.(); }
  });
}
