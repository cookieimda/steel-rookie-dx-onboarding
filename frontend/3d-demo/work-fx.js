// 설비 작동 연출(공정 인덱스 페이지용). v4 3D 화면(scene_v3.js의 _startWork·_spawn·_workTick·_heat·_stopWork)을 그대로 떼어 온 것이다.
// 설비마다 정해진 레시피(불씨·불꽃·수증기·물 분사·쇳물 붓기·기포·소용돌이 입자 + 주황 점광)를 설비 상자 위에 띄운다.
// 프런트 개편(steel-index) 뒤 설비를 봐도 이 연출이 안 나와 다시 붙였다(2026-10-14). 레시피·수치는 v4와 같다.
// 쓰는 쪽: const work = createWorkFx({ scene, isDark }); work.start({ id, box }) · work.tick(now) · work.stop() · work.setVisible(bool)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const RECIPE = {
  sinter_plant: [['embers', 0.35], ['glow', 0.3, 0xff6a20], ['glow', 0.9, 0xff7a28]], coke_oven: [['steam', 0.9], ['embers', 0.4], ['glow', 0.4, 0xff5a1a]], hot_stove: [['glow', 0.5, 0xff8030], ['glow', 1.0, 0xff7020]],
  blast_furnace: [['steam', 1.0], ['tap', 0.5], ['glow', 0.3, 0xff6a10], ['glow', 0.7, 0xff7a20]], hot_metal_pretreatment: [['swirl', 0.5], ['glow', 0.5, 0xff8a30], ['glow', 0.2, 0xff7a28]], bof_converter: [['sparks', 0.85], ['glow', 0.8, 0xffa040], ['glow', 0.3, 0xff7a28]],
  secondary_refining: [['bubbles', 0.45], ['glow', 0.5, 0xff9a40]], tundish: [['pour', 0.55], ['glow', 0.3, 0xff9030], ['glow', 0.7, 0xff8030]], cc_mold: [['steam', 0.6], ['glow', 0.5, 0xff8a30], ['glow', 0.15, 0xff6a20]],
  secondary_cooling: [['spray', 0.85], ['steam', 0.4], ['glow', 0.2, 0xff6a20]], torch_cutter: [['sparksDown', 0.6], ['glow', 0.35, 0xffb050], ['glow', 0.2, 0xff8030]], reheating_furnace: [['embers', 0.6], ['glow', 0.4, 0xff6a20], ['glow', 0.9, 0xff7020]],
  roughing_mill: [['spray', 0.7], ['glow', 0.25, 0xff7a30], ['glow', 0.6, 0xff8030]], finishing_mill: [['spray', 0.6], ['glow', 0.25, 0xff7a30], ['glow', 0.6, 0xff8a38]], runout_table: [['spray', 0.6], ['steam', 0.25], ['glow', 0.25, 0xff8a38]], coiler: [['swirl', 0.4], ['glow', 0.4, 0xff7a30], ['glow', 0.15, 0xff7a28]],
};
export function workRecipe(id) {
  if (RECIPE[id]) return RECIPE[id];
  if (/cool|spray|runout|water/.test(id)) return [['spray', 0.8], ['steam', 0.4]]; if (/cut|torch/.test(id)) return [['sparksDown', 0.5], ['glow', 0.35, 0xffb050]];
  if (/mill|roll|stand/.test(id)) return [['spray', 0.6], ['glow', 0.3, 0xff7a30]]; if (/convert|bof|lance/.test(id)) return [['sparks', 0.8], ['glow', 0.8, 0xffa040]];
  if (/coil/.test(id)) return [['swirl', 0.4]]; if (/ladle|refin|rh|lf/.test(id)) return [['bubbles', 0.45], ['glow', 0.5, 0xff9a40]];
  return [['embers', 0.5], ['glow', 0.4, 0xff7a30]];
}
// 입자 종류: [색, 개수, 수명(초), 크기]
const P = { embers: [0xff8a3a, 140, 1.8, 0.45], sparks: [0xffc070, 70, 0.9, 0.12], sparksDown: [0xffd090, 60, 0.8, 0.11], steam: [0x8a96a4, 90, 3.2, 2.2], spray: [0x9fd4ff, 200, 0.8, 0.22],
  pour: [0xffa040, 120, 0.5, 0.5], bubbles: [0xffc080, 110, 1.4, 0.35], swirl: [0xffa050, 120, 2.0, 0.35], flow: [0xff7040, 160, 1.4, 0.4], tap: [0xffb050, 90, 0.9, 0.13] };
const STREAK = { sparks: 1, sparksDown: 1, tap: 1 }, G = { sparks: 9, sparksDown: 9, tap: 6, spray: 3, pour: 14 };
// 불꽃 색: 백열(흰색) → 노랑 → 주황 → 어두운 빨강으로 식으며 사라짐
const heat = (k) => { const f = Math.pow(Math.max(0, 1 - k), 1.4); if (k < 0.12) return [f, f * 0.96, f * 0.82]; if (k < 0.4) return [f, f * 0.78, f * 0.32]; if (k < 0.7) return [f, f * 0.45, f * 0.08]; return [f * 0.8, f * 0.18, 0]; };

export function createWorkFx({ scene, isDark = () => true }) {
  let dotTex = null, W = null;
  function dot() { if (dotTex) return dotTex; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (dotTex = new THREE.CanvasTexture(c)); }
  function spawn(m, q) {
    const r = (a) => (Math.random() * 2 - 1) * a, s = m.sc; q.age = 0; q.L = m.ln ? m.life * (0.35 + Math.random() * 0.9) : m.life; q.p.copy(m.o); q.a = Math.random() * Math.PI * 2;
    switch (m.kind) {
      case 'embers': q.p.x += r(1.4 * s); q.p.z += r(1.2 * s); q.v.set(r(0.4), 1.2 + Math.random() * 1.8, r(0.4)).multiplyScalar(s); break;
      case 'sparks': { const th = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4.5; q.v.set(Math.cos(th) * sp * 0.7, 3 + Math.random() * 5, Math.sin(th) * sp * 0.7).multiplyScalar(s); break; }
      case 'sparksDown': q.v.set(r(2.2), 0.5 + Math.random() * 2, r(2.2)).multiplyScalar(s); break;
      case 'tap': q.p.x += 1.2 * s; q.v.set(1.5 + Math.random() * 2.5, 1 + Math.random() * 2.5, r(1.2)).multiplyScalar(s); break;
      case 'steam': q.p.x += r(0.8 * s); q.p.z += r(0.8 * s); q.v.set(r(0.25) + 0.25, 1 + Math.random(), r(0.25)).multiplyScalar(s); break;
      case 'spray': q.p.x += r(2.4 * s); q.p.z += r(0.5 * s); q.v.set(r(0.4), -(1 + Math.random() * 2.5), r(1.2)).multiplyScalar(s); break;
      case 'pour': q.p.x += r(0.12 * s); q.p.z += r(0.12 * s); q.v.set(0, -0.5, 0); break;
      case 'bubbles': q.p.x += r(0.7 * s); q.p.z += r(0.7 * s); q.v.set(r(0.15), 0.6 + Math.random() * 0.9, r(0.15)).multiplyScalar(s); break;
      case 'flow': q.p.x -= 1.5 * s; q.p.y += r(0.6 * s); q.p.z += r(0.5 * s); q.v.set(3 + Math.random() * 2, r(0.2), r(0.2)).multiplyScalar(s); break;
      case 'swirl': q.v.set(0, 0.2 + Math.random() * 0.3, 0); break;
    }
  }
  /** e: { id, box(THREE.Box3, 월드) }. v4의 anchor.y(설비 윗면)·focus(설비 가운데)·dist(크기)를 상자에서 만든다 */
  function start(e) {
    stop(); if (!e?.box) return;
    const c = e.box.getCenter(new THREE.Vector3()), sz = e.box.getSize(new THREE.Vector3()), top = Math.max(1, e.box.max.y - 0.6), dist = Math.max(sz.x, sz.z, 6), sc = Math.max(0.6, dist / 16), g = new THREE.Group(), em = [];
    workRecipe(e.id).forEach(([kind, h, col]) => {
      const o = new THREE.Vector3(c.x, top * h, c.z);
      if (kind === 'glow') { const L = new THREE.PointLight(col, 0, 14 * sc, 1.6); L.position.copy(o); g.add(L); em.push({ kind, L, o }); return; }
      const [col2, n, life, size] = P[kind], pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      const mat = new THREE.PointsMaterial({ size: size * sc, map: dot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: kind === 'steam' ? 0.5 : 1 });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 20; pts.raycast = () => {}; g.add(pts);
      let ln = null; if (STREAK[kind]) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); ln = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); ln.frustumCulled = false; ln.renderOrder = 20; ln.raycast = () => {}; g.add(ln); }
      const ps = Array.from({ length: n }, () => ({ age: Math.random() * life, L: life, p: new THREE.Vector3(), v: new THREE.Vector3(), a: 0 }));
      em.push({ kind, pts, ln, ps, life, o, sc, c: new THREE.Color(col2) });
    });
    scene.add(g); W = { g, em, last: performance.now(), e };
  }
  function tick(now) {
    if (!W) return; const dt = Math.min(0.05, (now - W.last) / 1000); W.last = now; const dark = isDark();
    W.em.forEach((m) => {
      if (m.kind === 'glow') { m.L.intensity = (3.4 + Math.sin(now / 160) * 1.0 + Math.sin(now / 47) * 0.5) * (dark ? 1.8 : 1.1); return; }
      const pa = m.pts.geometry.attributes.position.array, ca = m.pts.geometry.attributes.color.array, g = G[m.kind] || 0;
      m.ps.forEach((q, i) => {
        q.age += dt; if (q.age > q.L) spawn(m, q);
        if (m.kind === 'swirl') { q.a += dt * 2.4; const rad = (0.9 + q.age * 0.25) * m.sc; q.p.set(m.o.x + Math.cos(q.a) * rad, m.o.y + q.age * 0.4 * m.sc, m.o.z + Math.sin(q.a) * rad); }
        else { q.v.y -= g * m.sc * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.05) { q.p.y = 0.05; q.v.y *= -0.25; q.v.x *= 0.6; q.v.z *= 0.6; } }
        const k = q.age / q.L, f = m.kind === 'steam' ? Math.sin(Math.min(1, k) * Math.PI) : Math.max(0, 1 - k);
        pa[i * 3] = q.p.x; pa[i * 3 + 1] = q.p.y; pa[i * 3 + 2] = q.p.z;
        if (m.ln) { const h = heat(k), la = m.ln.geometry.attributes.position.array, lc = m.ln.geometry.attributes.color.array, j = i * 6, t = 0.035 + 0.02 * (1 - k); ca[i * 3] = h[0]; ca[i * 3 + 1] = h[1]; ca[i * 3 + 2] = h[2];
          la[j] = q.p.x; la[j + 1] = q.p.y; la[j + 2] = q.p.z; la[j + 3] = q.p.x - q.v.x * t; la[j + 4] = q.p.y - q.v.y * t; la[j + 5] = q.p.z - q.v.z * t;
          lc[j] = h[0]; lc[j + 1] = h[1]; lc[j + 2] = h[2]; lc[j + 3] = h[0] * 0.25; lc[j + 4] = h[1] * 0.12; lc[j + 5] = 0; }
        else { ca[i * 3] = m.c.r * f; ca[i * 3 + 1] = m.c.g * f; ca[i * 3 + 2] = m.c.b * f; }
      });
      m.pts.geometry.attributes.position.needsUpdate = true; m.pts.geometry.attributes.color.needsUpdate = true;
      if (m.ln) { m.ln.geometry.attributes.position.needsUpdate = true; m.ln.geometry.attributes.color.needsUpdate = true; }
    });
  }
  function stop() { if (!W) return; scene.remove(W.g); W.em.forEach((m) => { if (m.pts) { m.pts.geometry.dispose(); m.pts.material.dispose(); } if (m.ln) { m.ln.geometry.dispose(); m.ln.material.dispose(); } }); W = null; }
  function setVisible(v) { if (W) W.g.visible = !!v; }
  return { start, tick, stop, setVisible, get active() { return !!W; } };
}
