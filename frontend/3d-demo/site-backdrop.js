// 전체 공정 배경(건물·나무·크레인·가로등·바닥 지도)과 밤 조명을 <steel-scene>에 붙인다.
// 공정 GLB 4개(제선·제강·연주·열연)는 건드리지 않는다. 장면 코드(scene_v3.js)를 고치지 않고 페이지에서 한 줄로 붙인다.
//   import { attachSiteBackdrop } from './site-backdrop.js';
//   attachSiteBackdrop();   // <steel-scene>이 생길 때까지 기다렸다가 붙는다
// - 낮/밤: <steel-scene theme="dark">이면 models/site/site-night.glb, 아니면 site-day.glb
// - 기존 배경 중 부지 안(반경 300) 정적 메시와 기존 바닥은 숨기고, 움직이는 것(차량·열차·상어·불꽃놀이·보케·새·구름)과 먼 산·지평선은 그대로 둔다
// - 밤에만 바닥 매립등 빛기둥을 그리고, 카메라를 따라가는 키라이트 1개와 구역 보조광(SpotLight) 4개를 더한다(값: models/site/site-lights.json)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';

// 페이지 틀(support.js)이 <helmet> 안 script를 두 번 실행할 수 있어서, 한 페이지에 한 번만 붙인다(두 번 붙으면 배경·조명이 2벌이 되어 느려짐)
export function attachSiteBackdrop(target = 'steel-scene', opts = {}) {
  return (window.__siteBackdrop ||= attach(target, opts));
}

async function attach(target, { base = 'models/site/' } = {}) {
  let el = typeof target === 'string' ? null : target;
  while (!el) { el = document.querySelector(target); if (!el) await new Promise(r => setTimeout(r, 100)); }
  while (!el.scene || !el.backdrop || !el.ground) await new Promise(r => setTimeout(r, 100));
  const url = (f) => new URL(base + f, document.baseURI).href;
  const cfg = await (await fetch(url('site-lights.json'))).json();
  const loader = new GLTFLoader(), glbs = {};
  const load = (dark) => glbs[dark ? 'n' : 'd'] ||= loader.loadAsync(url(dark ? 'site-night.glb' : 'site-day.glb')).then(g => { g.scene.traverse(o => { if (o.isMesh) o.raycast = () => {}; }); return g.scene; });
  const holder = new THREE.Group(); holder.name = 'SITE_BACKDROP_EXT'; el.scene.add(holder);

  // 밤 조명: 키라이트(카메라 추종) + 구역 보조광
  const key = new THREE.DirectionalLight(cfg.night.key?.color || '#dce8ff', 0); el.scene.add(key, key.target);
  const fills = (cfg.night.fills || []).map(f => { const l = new THREE.SpotLight(f.color, 0, f.distance, f.angle, f.penumbra, f.decay); l.position.fromArray(f.position); l.target.position.fromArray(f.target); l.userData.k = f.intensity; el.scene.add(l, l.target); return l; });

  // 바닥 매립등 빛기둥(밤): 렌즈에서 위로 넓어지며 사라지는 빛. 위치는 site-lights.json의 night.floorLights
  let beams = null; const FL = cfg.night.floorLights;
  if (FL?.points?.length) { const b = FL.beam, geo = new THREE.CylinderGeometry(b.r1, b.r0, b.height, 14, 1, true); geo.translate(0, b.height / 2 + 0.12, 0);
    const mat = new THREE.ShaderMaterial({ vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying float vY; void main(){ gl_FragColor = vec4(${b.color.map(v => v.toFixed(3)).join(', ')}, pow(1.0 - vY, 1.8) * ${b.alpha.toFixed(3)}); }`, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    beams = new THREE.InstancedMesh(geo, mat, FL.points.length); const m = new THREE.Matrix4(); FL.points.forEach(([x, z], i) => beams.setMatrixAt(i, m.makeTranslation(x, 0, z))); beams.name = 'SITE_FLOOR_BEAMS'; beams.renderOrder = 5; beams.raycast = () => {}; }

  // 기존 배경에서 숨길 것: 부지 안 정적 메시(내보낼 때와 같은 기준)
  const isNearStatic = (o) => {
    if (!o.isMesh || o.isPoints || o.userData.keep || !o.material || o.material.isShaderMaterial || o.material.blending === THREE.AdditiveBlending) return false;
    const s = o.isInstancedMesh ? (o.computeBoundingSphere(), o.boundingSphere.clone()) : (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld));
    return s.center.length() < 300 && s.radius < 300;
  };
  let applied = null;
  const apply = async () => {
    const dark = (el.getAttribute('theme') || 'dark') === 'dark', root = await load(dark);
    if (applied !== root) { holder.clear(); holder.add(root); if (beams) holder.add(beams); applied = root; }
    if (beams) beams.visible = dark;
    el.backdrop.updateMatrixWorld(true); el.backdrop.children.forEach(o => { if (isNearStatic(o)) o.visible = false; });
    key.intensity = dark ? (cfg.night.key?.intensity ?? 0) : 0; fills.forEach(l => { l.intensity = dark ? l.userData.k : 0; });
    el._dirty = true;
  };
  await apply();
  new MutationObserver(() => setTimeout(apply, 0)).observe(el, { attributes: true, attributeFilter: ['theme', 'time-of-day', 'timeofday'] });

  // 매 프레임: 바닥 교체 유지, 2D·도면 보기에서 기존 배경이 숨으면 같이 숨김, 키라이트 위치
  const tick = () => {
    const show = el.backdrop.visible && !el._2d; if (holder.visible !== show) { holder.visible = show; el._dirty = true; }
    if (el.ground.visible) { el.ground.visible = false; el._dirty = true; }
    if (key.intensity && el.camera && el.orbit) { const cp = el.camera.position, t = el.orbit.target; key.position.set(cp.x * 0.6 + t.x * 0.4 - (cp.z - t.z) * 0.35, cp.y + 40, cp.z * 0.6 + t.z * 0.4 + (cp.x - t.x) * 0.35); key.target.position.copy(t); key.target.updateMatrixWorld(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { holder, key, fills, apply };
}
