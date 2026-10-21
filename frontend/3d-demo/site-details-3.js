// 전체 공정 배경 디테일 3탄 (scene_v3.js 수정 없이 <steel-scene>에 붙인다)
//   import { attachSiteDetails3 } from './site-details-3.js'; attachSiteDetails3();
// 공통: 슬라브 야드 크레인, 깃발, 철도 건널목, 냉각탑 증기, 탱크 난간
// 낮: 갈매기 그림자, 작업자·자전거, 렌즈 플레어 / 밤: 출선 플래시, 부표 순차 점멸, 옥상 간판, 별똥별
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const dot = (() => { let t; return () => t ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(); })();
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });
const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.raycast = () => {}; return m; };
const points = (n, size, extra = {}) => { const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot(), size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra })); p.raycast = () => {}; p.frustumCulled = false; p.renderOrder = 6; return { p, pos, col, geo }; };
const sprite = (color, size, op = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.scale.setScalar(size); s.renderOrder = 8; return s; };
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const polyline = (pts) => { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); const len = L[L.length - 1];
  return { len, at(d, out) { d = ((d % len) + len) % len; let i = 1; while (i < L.length - 1 && L[i] < d) i++; const a = pts[i - 1], b = pts[i], t = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]); out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; out.ry = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); return out; } }; };
// 깃발: 평면 격자 정점을 매 프레임 sin으로 흔듦 (정점 수 작음)
const flagGeo = () => new THREE.PlaneGeometry(3.2, 2, 8, 4);

export async function attachSiteDetails3() {
  let el; while (!(el = document.querySelector('steel-scene'))) await new Promise(r => setTimeout(r, 100));
  while (!el.scene || !el.backdrop || !el.zones) await new Promise(r => setTimeout(r, 100));
  if (el.__siteDetails3) return; el.__siteDetails3 = true;
  const root = new THREE.Group(); root.name = 'SITE_DETAILS_3'; el.scene.add(root);
  const day = new THREE.Group(), night = new THREE.Group(); root.add(day, night);
  let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const zone = (id) => el.zones?.[id]; const Z = { iron: zone('ironmaking'), steel: zone('steelmaking'), cast: zone('continuous_casting'), roll: zone('rolling') };
  const zp = (z, dx, dz) => [z ? z.ox + dx : dx, z ? z.oz + dz : dz];

  // 2. 슬라브 야드 천장 크레인 — 연주와 압연 사이. 거더가 X로 왕복, 호이스트가 슬라브를 들었다 놓음
  const SY = [-42, 32]; /* 연주·압연 사이 빈터 (도로·건물과 5m 이상 간격) */ const yard = new THREE.Group(); yard.position.set(SY[0], 0, SY[1]); root.add(yard);
  { const rail = new THREE.InstancedMesh(new THREE.BoxGeometry(26, 0.5, 0.5), std(0x6a7078), 2), legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 9, 0.5), std(0x6a7078), 4), d = new THREE.Object3D();
    [-6, 6].forEach((z, i) => { d.position.set(0, 9, z); d.updateMatrix(); rail.setMatrixAt(i, d.matrix); }); [[-12.5, -6], [12.5, -6], [-12.5, 6], [12.5, 6]].forEach(([x, z], i) => { d.position.set(x, 4.5, z); d.updateMatrix(); legs.setMatrixAt(i, d.matrix); }); rail.raycast = legs.raycast = () => {}; yard.add(rail, legs);
    const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(5, 0.5, 1.6), std(0x4a4f56, { metalness: 0.4 }), 8); for (let i = 0; i < 8; i++) { d.position.set(-9 + (i % 4) * 6, 0.25 + Math.floor(i / 4) * 0.55, -3 + (i % 2) * 2.2); d.rotation.set(0, 0, 0); d.updateMatrix(); slabs.setMatrixAt(i, d.matrix); } slabs.raycast = () => {}; yard.add(slabs); }
  const girder = mesh(new THREE.BoxGeometry(1.2, 1, 13.4), std(0xd8a21e), 0, 9.6, 0), hoist = mesh(new THREE.BoxGeometry(1, 0.8, 1.2), std(0x3a4046), 0, 8.9, 0), hook = mesh(new THREE.BoxGeometry(5, 0.5, 1.6), std(0x6a6f76, { metalness: 0.4 }), 0, 3, 0), hcable = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4), std(0x222), 0, 6, 0);
  girder.add(hoist); yard.add(girder, hook, hcable);

  // 3. 깃대 3개 + 펄럭이는 깃발 — 사무동 앞 (바람은 +X, 연기와 같은 방향)
  const FL = /* 사무동 앞(북쪽) 보도 */ [[-18, 27.5], [-14.5, 27.5], [-11, 27.5]], flags = FL.map(([x, z], i) => { const pole = mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 5), std(0xe6e8ea), x, 4.5, z); root.add(pole);
    const g = flagGeo(), f = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: [0x05507d, 0xe9ecef, 0xc0482e][i], side: THREE.DoubleSide, roughness: 0.9 })); f.position.set(x + 1.6, 8.0, z); f.raycast = () => {}; root.add(f); return { f, base: g.attributes.position.array.slice(), ph: i * 1.7 }; });

  // 4. 철도 건널목 — 원료 열차 선로(R6 도로 교차 근처) 차단기 2개 + 빨간등 2개. 열차 접근은 el._traffic.train 거리로 판단
  const XG = [[-6, 24.4], [-6, 27.6]]; const gates = XG.map(([x, z], i) => { const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g); g.add(mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), std(0x3a3e44), 0, 0.7, 0)); const arm = new THREE.Group(); arm.position.set(0, 1.3, 0); const bar = mesh(new THREE.BoxGeometry(4, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.8 }), 2 * (i ? -1 : 1), 0, 0); arm.add(bar); g.add(arm); return { arm, open: 1 }; });
  const xl = points(2, 1.3); root.add(xl.p); XG.forEach(([x, z], i) => xl.pos.set([x, 2.1, z], i * 3)); xl.geo.attributes.position.needsUpdate = true;

  // 5. 냉각탑 수증기 — 압연 동쪽 냉각탑 2기 (탑 본체 + 굵은 증기 점)
  const CT = [zp(Z.roll, 48, -8), zp(Z.roll, 52.5, -8)]; /* 공장동 동쪽 바깥 */ CT.forEach(([x, z]) => root.add(mesh(new THREE.CylinderGeometry(1.6, 2.1, 5, 10), std(0x8a9098), x, 2.5, z)));
  const CN = 30, ctm = points(CN, 9, { blending: THREE.NormalBlending, opacity: 0.6 }); root.add(ctm.p); const ct = Array.from({ length: CN }, (_, i) => ({ s: CT[i % 2], t: rnd(), life: 4 + rnd() * 2, vx: 0.7 + rnd() * 0.5, vy: 1.8 + rnd() * 0.6, oz: (rnd() - 0.5) * 1.2 }));

  // 6. 저장탱크 난간·계단 — 제강 북쪽 탱크 2기 위 난간 링(토러스) + 나선 계단(InstancedMesh)
  const TK = [zp(Z.steel, 10, -18), zp(Z.steel, 16, -18)]; /* 제강 북동쪽 빈터 */ TK.forEach(([x, z], k) => { root.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 14), std(0xd6d9dc, { roughness: 0.5 }), x, 3, z)); const ring = mesh(new THREE.TorusGeometry(2.55, 0.06, 4, 24), std(0x3a3e44), x, 6.4, z); ring.rotation.x = Math.PI / 2; root.add(ring);
    const st = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.3), std(0x3a3e44), 14), d = new THREE.Object3D(); for (let i = 0; i < 14; i++) { const a = k * 1.3 + i * 0.32, r = 2.75; d.position.set(x + Math.cos(a) * r, 0.5 + i * 0.42, z + Math.sin(a) * r); d.rotation.set(0, -a, 0); d.updateMatrix(); st.setMatrixAt(i, d.matrix); } st.raycast = () => {}; root.add(st); });

  // 7. 갈매기 그림자 (낮) — site-details.js의 갈매기 위치(el._gulls)를 읽어 바닥에 작은 어두운 원
  const GS = 16, gsh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.9, 8), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }), GS); gsh.raycast = () => {}; gsh.renderOrder = 3; day.add(gsh); const gd = new THREE.Object3D();

  // 8. 작업자·자전거 (낮) — 공장 간 도로를 오가는 작은 사람(주황 조끼) 6명 + 자전거 2대
  const walkPath = polyline([[-24, 26], [20, 26], [20, 46], [-24, 46], [-24, 26]]); const WK = 8, walkers = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 0.7, 2, 6), new THREE.MeshStandardMaterial({ roughness: 0.9 }), WK); walkers.raycast = () => {}; day.add(walkers);
  const wd = new THREE.Object3D(); const wk = Array.from({ length: WK }, (_, i) => ({ d: rnd() * walkPath.len, v: i < 6 ? 1.1 + rnd() * 0.3 : 4.5 + rnd(), side: (rnd() - 0.5) * 1.6 })); for (let i = 0; i < WK; i++) walkers.setColorAt(i, new THREE.Color(i < 6 ? 0xff7a1e : 0x2f6aa8)); const wtmp = { x: 0, z: 0, ry: 0 };

  // 9. 렌즈 플레어 (낮) — 카메라가 태양 방향을 볼 때 스프라이트 3개가 화면 중심 대각선에 나타남
  const flares = [[0xfff2d0, 14, 0.35, 1], [0xffd9a0, 6, 0.25, 0.55], [0xa0c8ff, 4, 0.2, -0.4]].map(([c, s, o, k]) => { const sp = sprite(c, s, 0); sp.userData = { o, k }; day.add(sp); return sp; });

  // 10. 출선 플래시 (밤) — 고로 쪽 하늘이 가끔 순간 밝아짐 (큰 스프라이트 1개)
  const flash = sprite(0xffa050, 60, 0); { const [x, z] = zp(Z.iron, 4, 4); flash.position.set(x, 10, z); night.add(flash); } let flashT = 6 + rnd() * 10, flashA = 0;

  // 11. 부표 순차 점멸 (밤) — site-details.js의 부표 8개 좌표를 그대로 써서 유도등처럼 순서대로 켜짐
  const BUOY = [[96, -40], [110, -10], [124, 20], [138, 50], [104, -70], [118, -100], [150, 80], [132, -130]]; const seq = points(BUOY.length, 3.4); night.add(seq.p); BUOY.forEach(([x, z], i) => seq.pos.set([x, 2.4, z], i * 3)); seq.geo.attributes.position.needsUpdate = true;
  const order = [5, 4, 0, 1, 2, 3, 6, 7]; // 북 → 남

  // 12. 사무동 옥상 간판 (밤) — 작은 글자판이 은은히 빛남
  const sign = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#05507d'; x.fillRect(0, 0, 256, 64); x.font = 'bold 34px sans-serif'; x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STEEL ACADEMY', 128, 33); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), new THREE.MeshBasicMaterial({ map: tx, transparent: true, side: THREE.DoubleSide, fog: false })); m.position.set(-14, 9.5, 30.2); m.raycast = () => {}; night.add(m); const g = sprite(0x9ed0ff, 14, 0.22); g.position.set(-14, 9.5, 30.2); night.add(g); return m; })();

  // 13. 별똥별 (밤) — 1~2분에 한 번 하늘을 가로지르는 점 + 꼬리
  const SS = 12, star = points(SS, 2.2); night.add(star.p); let ssT = 20 + rnd() * 40, ss = null;

  const theme = () => (el.getAttribute('theme') || 'dark') === 'dark';
  let last = performance.now(), simT = 0, frame = 0; const tmp = { x: 0, z: 0, ry: 0 }, V = new THREE.Vector3(), V2 = new THREE.Vector3();
  const tick = (now) => { requestAnimationFrame(tick); if (document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now; simT += dt; frame++;
    const vis = el.backdrop?.visible !== false && !el._bpGrid?.visible && !el._2d; root.visible = vis; if (!vis) return;
    const dk = theme(); day.visible = !dk; night.visible = dk;
    // 2 야드 크레인: 거더 왕복 20초, 호이스트 들어올리기
    { const u = (simT % 20) / 20, f = u < 0.5 ? ease(u * 2) : 1 - ease((u - 0.5) * 2); girder.position.x = -9 + 18 * f; const lift = Math.sin(u * Math.PI * 2) * 0.5 + 0.5; hook.position.set(girder.position.x, 1 + 6 * lift, 0); hcable.position.set(girder.position.x, (hook.position.y + 8.9) / 2, 0); hcable.scale.y = Math.max(0.1, 8.9 - hook.position.y); }
    // 3 깃발 펄럭임 (정점 변형)
    flags.forEach(({ f, base, ph }) => { const a = f.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const x = base[i * 3], y = base[i * 3 + 1], k = (x + 1.6) / 3.2; a.setXYZ(i, x, y + Math.sin(simT * 6 + k * 5 + ph) * 0.12 * k, Math.sin(simT * 5 + k * 4 + ph) * 0.35 * k); } a.needsUpdate = true; });
    // 4 건널목: 열차가 선로 교차점(-6, 26) 근처 30m 안이면 차단기 내림 + 등 점멸
    { const T = el._traffic, tr = T?.train; let near = false; if (tr && T.rail && T.at) { for (let w = 0; w < tr.wagons.length; w += 3) { const dd = tr.d - w * tr.gap; if (dd <= 0 || dd >= T.rail.len) continue; T.at(T.rail, dd, tmp); if (Math.hypot(tmp.x + 6, tmp.z - 26) < 30) { near = true; break; } } }
      gates.forEach(g => { g.open += ((near ? 0 : 1) - g.open) * Math.min(1, dt * 1.5); g.arm.rotation.z = (g === gates[0] ? 1 : -1) * (Math.PI / 2) * g.open; });
      const bl = near ? (Math.sin(simT * 8) > 0 ? 1 : 0) : 0; xl.col.set([bl, bl * 0.1, bl * 0.05], 0); xl.col.set([1 - bl, (1 - bl) * 0.1, (1 - bl) * 0.05], 3); if (!near) { xl.col.fill(0); } xl.geo.attributes.color.needsUpdate = true; }
    // 5 냉각탑 증기
    ct.forEach((q, i) => { q.t += dt / q.life; if (q.t >= 1) q.t -= 1; const u = q.t; ctm.pos.set([q.s[0] + q.vx * u * q.life, 5 + q.vy * u * q.life, q.s[1] + q.oz + Math.sin(simT + i) * 0.3], i * 3); const a = Math.sin(u * Math.PI) * (dk ? 0.3 : 0.85); ctm.col.set([a, a, a], i * 3); }); ctm.geo.attributes.position.needsUpdate = ctm.geo.attributes.color.needsUpdate = true;
    if (!dk) {
      // 7 갈매기 그림자
      const gl = (el._skyAnim?.birds || []).filter(b => b.gull); if (gl.length && frame % 2 === 0) { let n = 0; for (const fl of gl) { for (const b of fl.g.children) { if (n >= GS) break; b.getWorldPosition(V); gd.position.set(V.x, 0.25, V.z); gd.rotation.set(-Math.PI / 2, 0, 0); gd.scale.setScalar(Math.max(0.5, 1.3 - V.y / 50)); gd.updateMatrix(); gsh.setMatrixAt(n++, gd.matrix); } } for (; n < GS; n++) { gd.position.set(0, -50, 0); gd.updateMatrix(); gsh.setMatrixAt(n, gd.matrix); } gsh.instanceMatrix.needsUpdate = true; gsh.visible = true; } else if (!gl.length) gsh.visible = false;
      // 8 작업자·자전거
      wk.forEach((q, i) => { q.d += q.v * dt; walkPath.at(q.d, wtmp); wd.position.set(wtmp.x - Math.sin(wtmp.ry) * q.side, i < 6 ? 0.6 + Math.abs(Math.sin(simT * 7 + i)) * 0.05 : 0.6, wtmp.z - Math.cos(wtmp.ry) * q.side); wd.rotation.set(0, wtmp.ry, 0); wd.updateMatrix(); walkers.setMatrixAt(i, wd.matrix); }); walkers.instanceMatrix.needsUpdate = true;
      // 9 렌즈 플레어: 태양 방향과 카메라 시선의 각도로 세기 결정
      if (el.camera && el.sunLight && frame % 2 === 0) { const cam = el.camera; cam.getWorldDirection(V); V2.copy(el.sunLight.position).normalize(); const dotp = V.dot(V2), k = Math.max(0, (dotp - 0.55) / 0.45); const sunW = V2.clone().multiplyScalar(400).add(cam.position); const ctr = cam.position.clone().add(V.multiplyScalar(400));
        flares.forEach(sp => { sp.material.opacity = sp.userData.o * k * k; sp.position.lerpVectors(ctr, sunW, sp.userData.k); }); }
    } else {
      // 10 출선 플래시
      flashT -= dt; if (flashT <= 0) { flashT = 14 + rnd() * 18; flashA = 1; } if (flashA > 0) { flashA = Math.max(0, flashA - dt * 1.6); flash.material.opacity = 0.35 * Math.sin(Math.min(1, 1 - flashA) * Math.PI) * (flashA > 0 ? 1 : 0); } else flash.material.opacity = 0;
      // 11 부표 순차 점멸 (2.4초 주기로 북→남)
      for (let i = 0; i < BUOY.length; i++) { const slot = order.indexOf(i), ph = ((simT * 1.8 - slot * 0.3) % 2.4 + 2.4) % 2.4, k = ph < 0.25 ? 1 - ph / 0.25 : 0; seq.col.set([1, 0.95 * k, 0.6 * k].map(v => v * k), i * 3); } seq.geo.attributes.color.needsUpdate = true;
      // 13 별똥별
      ssT -= dt; if (ssT <= 0 && !ss) { ssT = 60 + rnd() * 60; const a = rnd() * Math.PI * 2, r = 420; ss = { x: Math.cos(a) * r, y: 150 + rnd() * 60, z: Math.sin(a) * r, vx: -Math.cos(a + 1.2) * 140, vy: -55, vz: -Math.sin(a + 1.2) * 140, t: 0 }; }
      if (ss) { ss.t += dt; for (let i = 0; i < SS; i++) { const lag = i * 0.03, t = Math.max(0, ss.t - lag); star.pos.set([ss.x + ss.vx * t, ss.y + ss.vy * t, ss.z + ss.vz * t], i * 3); const a = (1 - i / SS) * Math.sin(Math.min(1, ss.t / 1.6) * Math.PI); star.col.set([a, a, a * 0.9], i * 3); } if (ss.t > 1.6) { ss = null; star.col.fill(0); } star.geo.attributes.position.needsUpdate = star.geo.attributes.color.needsUpdate = true; }
    }
    el._dirty = true; };
  requestAnimationFrame(tick);
  return root;
}
