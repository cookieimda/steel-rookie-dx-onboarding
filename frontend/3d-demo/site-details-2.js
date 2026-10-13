// 전체 공정 배경 디테일 2탄 (scene_v3.js 수정 없이 <steel-scene>에 붙인다)
//   import { attachSiteDetails2 } from './site-details-2.js'; attachSiteDetails2();
// 공통: 굴뚝 수증기, 원료 컨베이어, 크레인 작업, 예인선 2척, 리클레이머 2대, 교차로 신호등
// 낮: 고로·전로 열기 아지랑이 / 밤: 창문 불빛, 출선구 붉은빛, 정박선 등화, 차량 꼬리등
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const dot = (() => { let t; return () => t ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(); })();
const cloudTex = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); let k = 3; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) { const g = x.createRadialGradient(60 + r() * 136, 90 + r() * 76, 0, 60 + r() * 136, 90 + r() * 76, 40 + r() * 50); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
  return new THREE.CanvasTexture(c); };
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });
const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.raycast = () => {}; return m; };
const points = (n, size, color, extra = {}) => { const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot(), size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra })); p.raycast = () => {}; p.frustumCulled = false; p.renderOrder = 6; return { p, pos, col, geo }; };
const sprite = (color, size, op = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.scale.setScalar(size); s.renderOrder = 8; return s; };
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export async function attachSiteDetails2() {
  let el; while (!(el = document.querySelector('steel-scene'))) await new Promise(r => setTimeout(r, 100));
  while (!el.scene || !el.backdrop || !el.zones) await new Promise(r => setTimeout(r, 100));
  if (el.__siteDetails2) return; el.__siteDetails2 = true;
  const root = new THREE.Group(); root.name = 'SITE_DETAILS_2'; el.scene.add(root);
  const day = new THREE.Group(), night = new THREE.Group(); root.add(day, night);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const zone = (id) => el.zones?.[id]; const Z = { iron: zone('ironmaking'), steel: zone('steelmaking'), roll: zone('rolling') };
  const zp = (z, dx, dz) => [z ? z.ox + dx : dx, z ? z.oz + dz : dz];

  // 1. 굴뚝 수증기 — 제선·제강 굴뚝 3곳, 점 풀. 생성 시 seed로 속도·수명 고정, 위로 오르며 커지고 사라짐
  const STACKS = [zp(Z.iron, 12, -6), zp(Z.iron, -8, -8), zp(Z.steel, 10, -6)].map(([x, z]) => [x, 22, z]);
  const SN = 42, smoke = points(SN, 7, 0xffffff, { blending: THREE.NormalBlending, opacity: 0.55 }); root.add(smoke.p);
  const sm = Array.from({ length: SN }, (_, i) => ({ s: STACKS[i % 3], t: rnd(), life: 5 + rnd() * 3, vx: (rnd() - 0.5) * 0.9 + 0.9, vz: (rnd() - 0.5) * 0.5, vy: 1.4 + rnd() * 0.8 }));

  // 2. 원료 컨베이어 — 야적장(동쪽) → 제선 소결기. 벨트 1개 + 덩어리 InstancedMesh
  const CV0 = zp(Z.iron, 26, -4), CV1 = zp(Z.iron, 60, -8), cvLen = Math.hypot(CV1[0] - CV0[0], CV1[1] - CV0[1]), cvAng = Math.atan2(-(CV1[1] - CV0[1]), CV1[0] - CV0[0]);
  { const belt = mesh(new THREE.BoxGeometry(cvLen, 0.3, 1.6), std(0x3a4046), (CV0[0] + CV1[0]) / 2, 3.2, (CV0[1] + CV1[1]) / 2); belt.rotation.y = cvAng; root.add(belt);
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), std(0x7a8088), 6), d = new THREE.Object3D(); for (let i = 0; i < 6; i++) { const t = (i + 0.5) / 6; d.position.set(CV0[0] + (CV1[0] - CV0[0]) * t, 1.6, CV0[1] + (CV1[1] - CV0[1]) * t); d.updateMatrix(); legs.setMatrixAt(i, d.matrix); } legs.raycast = () => {}; root.add(legs); }
  const LUMP = 16, lumps = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ roughness: 0.95 }), LUMP), ld = new THREE.Object3D(); lumps.raycast = () => {}; root.add(lumps);
  for (let i = 0; i < LUMP; i++) lumps.setColorAt(i, new THREE.Color(i % 3 ? 0x6e4a3a : 0x2a2a2e)); const lumpPh = Array.from({ length: LUMP }, (_, i) => i / LUMP);

  // 3. 안벽 크레인 작업 — 붐 끝에서 그랩(운반통)이 내려갔다 올라오고, 트롤리가 안벽 쪽으로 이동. 크레인 위치는 scene_v3.js와 동일
  const quayZ = (x) => -48.6 + (x - 19.1) * 0.084; const CR = [[30, quayZ(30) - 2.6, 1], [44, quayZ(44) - 2.6, 1], [58, quayZ(58) - 2.6, 1]];
  const grabs = CR.map(([cx, cz, dir], i) => { const g = new THREE.Group(); g.position.set(cx, 0, cz); root.add(g); const cable = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4), std(0x222), 0, 0, 0), grab = mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), std(0xc98a2a), 0, 0, 0); g.add(cable, grab); return { g, cable, grab, dir, ph: i * 2.1, top: 16.6 }; });

  // 4. 예인선 2척 — 부두 앞을 타원으로 돌며 하얀 물결(점 꼬리)
  const tugs = /* 항만 수역 안에서만 */ [[42, -28, 14, 6, 0], [78, -18, 10, 12, 2.2]].map(([cx, cz, rx, rz, ph]) => { const g = new THREE.Group(); root.add(g);
    g.add(mesh(new THREE.BoxGeometry(6, 1.4, 2.6), std(0x1f2a36), 0, 0.6, 0), mesh(new THREE.BoxGeometry(2.2, 1.6, 2), std(0xe8e4dc), -0.6, 2.1, 0), mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.4, 6), std(0xc8463a), -1.4, 3.5, 0));
    const nav = sprite(0xfff0c8, 1.1); nav.position.set(-0.6, 3.2, 0); g.add(nav); return { g, cx, cz, rx, rz, ph, nav }; });
  const WK = 60, wake = points(WK, 2.2, 0xffffff, { blending: THREE.NormalBlending, opacity: 0.7 }); root.add(wake.p); const wk = Array.from({ length: WK }, (_, i) => ({ tug: i % 2, t: rnd() }));

  // 5. 리클레이머 2대 — 야적장 원료 더미 위를 왕복 (붐 + 버킷휠 회전)
  const recl = [[62, -58, 92, 0], [66, -50.5, 96, 1.6]].map(([x0, z, x1, ph]) => { const g = new THREE.Group(); root.add(g);
    g.add(mesh(new THREE.BoxGeometry(3, 1.6, 3.2), std(0xd8a21e), 0, 3.2, 0), mesh(new THREE.BoxGeometry(0.8, 4, 0.8), std(0x7a8088), 0, 5.8, 0)); const boom = mesh(new THREE.BoxGeometry(9, 0.6, 0.6), std(0x7a8088), 4.5, 7.4, 0); /* 원료 더미(≤2.1) 위로 */ boom.rotation.z = -0.22; g.add(boom);
    const wheel = mesh(new THREE.TorusGeometry(1.3, 0.25, 6, 12), std(0x5a6068), 9, 5.6, 0); wheel.rotation.y = Math.PI / 2; g.add(wheel); return { g, x0, x1, z, ph, wheel }; });

  // 6. 교차로 신호등 4곳 — 기둥 InstancedMesh + 등은 점(색이 바뀜)
  const TL = [[-2, -24], [-27, 24], [-40, 48], [0, -21]]; { const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 5, 5), std(0x3a3e44), TL.length), heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), std(0x1a1d22), TL.length), d = new THREE.Object3D();
    TL.forEach(([x, z], i) => { d.position.set(x + 2.3, 2.5, z + 2.3); d.updateMatrix(); poles.setMatrixAt(i, d.matrix); d.position.set(x + 2.3, 5.2, z + 2.3); d.updateMatrix(); heads.setMatrixAt(i, d.matrix); }); poles.raycast = heads.raycast = () => {}; root.add(poles, heads); }
  const sig = points(TL.length, 1.4, 0xffffff); root.add(sig.p); TL.forEach(([x, z], i) => sig.pos.set([x + 2.3, 5.4, z + 2.3], i * 3)); sig.geo.attributes.position.needsUpdate = true;


  // 8. 열기 아지랑이 (낮) — 고로·전로 위 점이 흔들리며 오름 (셰이더 없이 가볍게)
  const HZ = 36, haze = points(HZ, 4, 0xffffff, { blending: THREE.NormalBlending, opacity: 0.12 }); day.add(haze.p);
  const hzSrc = [zp(Z.iron, 0, 0), zp(Z.steel, 0, 0)]; const hz = Array.from({ length: HZ }, (_, i) => ({ s: hzSrc[i % 2], t: rnd(), ox: (rnd() - 0.5) * 8, oz: (rnd() - 0.5) * 8 }));

  // 9. 창문 불빛 (밤) — 부지 안 건물 벽에 격자 점, 일부 켜짐. 가끔 한두 칸 토글
  const WN = 180, win = points(WN, 1.3, 0xffffff, { opacity: 0.9 }); night.add(win.p);
  const BLD = [[-70, 50, 10, 4, 0.7], [-30, 74, 5, 2.5, 0.7], [-85, -5, 2.5, 12, 0.15], [-14, 30, 10, 6, 0], [30, 38, 8, 5, 0.12], [-50, 70, 9, 6, 0.7]];
  const winOn = new Uint8Array(WN); for (let i = 0; i < WN; i++) { const b = BLD[i % BLD.length], f = Math.floor(i / BLD.length), c = f % 6, r = Math.floor(f / 6); const a = b[4], lx = -b[2] + 1 + c * (b[2] * 2 - 2) / 5, ly = 1.4 + r * 1.3; win.pos.set([b[0] + Math.cos(a) * lx - Math.sin(a) * (b[3] + 0.15), ly, b[1] + Math.sin(a) * lx + Math.cos(a) * (b[3] + 0.15)], i * 3); winOn[i] = rnd() < 0.55 ? 1 : 0; }
  win.geo.attributes.position.needsUpdate = true; let winT = 0;

  // 10. 출선구 붉은빛 (밤) — 고로 아래 주황 스프라이트 맥동 + 바닥 번짐
  const tap = sprite(0xff7a28, 9, 0.6), tapFloor = mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshBasicMaterial({ color: 0xff6a1e, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 0, 0.15, 0);
  { const [x, z] = zp(Z.iron, 4, 4); tap.position.set(x, 2.2, z); tapFloor.position.set(x, 0.15, z); tapFloor.rotation.x = -Math.PI / 2; tapFloor.renderOrder = 4; night.add(tap, tapFloor); }

  // 11. 정박선 등화 (밤) — scene_v3.js 벌크선 2척 위치. 갑판등(노랑) + 항해등(좌 빨강·우 초록) + 마스트 흰등
  const SHIPS = [[37, quayZ(37) + 4.6, -0.08], [46, -0.6, 0.12]]; const SL = SHIPS.length * 6, shipL = points(SL, 1.5, 0xffffff); night.add(shipL.p);
  SHIPS.forEach(([cx, cz, ry], si) => { const ax = [Math.cos(ry), -Math.sin(ry)], nx = [-ax[1], ax[0]]; const at = (t, s, y) => [cx + t * ax[0] + s * nx[0], y, cz + t * ax[1] + s * nx[1]];
    const pts = [[at(-9, 0, 4.2), [1, 0.85, 0.5]], [at(-3, 0, 4.2), [1, 0.85, 0.5]], [at(5, 0, 4.2), [1, 0.85, 0.5]], [at(0, -3.2, 3.3), [1, 0.1, 0.1]], [at(0, 3.2, 3.3), [0.1, 1, 0.3]], [at(-10, 0, 8.5), [1, 1, 1]]];
    pts.forEach(([p, c], i) => { shipL.pos.set(p, (si * 6 + i) * 3); shipL.col.set(c, (si * 6 + i) * 3); }); });
  shipL.geo.attributes.position.needsUpdate = shipL.geo.attributes.color.needsUpdate = true;

  // 12. 차량 꼬리등 (밤) — scene_v3.js 교통 데이터(el._traffic.cars)를 읽어 뒤쪽에 빨간 점. 헤드라이트는 기존 것
  const TN = 8, tail = points(TN, 1.3, 0xffffff); night.add(tail.p); for (let i = 0; i < TN; i++) tail.col.set([1, 0.12, 0.08], i * 3); tail.geo.attributes.color.needsUpdate = true;

  const theme = () => (el.getAttribute('theme') || 'dark') === 'dark';
  let last = performance.now(), simT = 0, frame = 0; const V = new THREE.Vector3();
  const tick = (now) => { requestAnimationFrame(tick); if (document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now; simT += dt; frame++;
    const vis = el.backdrop?.visible !== false && !el._bpGrid?.visible && !el._2d; root.visible = vis; if (!vis) return;
    const dk = theme(); day.visible = !dk; night.visible = dk;
    // 1 수증기
    sm.forEach((q, i) => { q.t += dt / q.life; if (q.t >= 1) q.t -= 1; const u = q.t, s = q.s; smoke.pos.set([s[0] + q.vx * u * q.life + Math.sin(simT + i) * 0.4, s[1] + q.vy * u * q.life, s[2] + q.vz * u * q.life], i * 3); const a = Math.sin(u * Math.PI) * (dk ? 0.35 : 0.8); smoke.col.set([a, a, a], i * 3); });
    smoke.geo.attributes.position.needsUpdate = smoke.geo.attributes.color.needsUpdate = true;
    // 2 컨베이어 덩어리 (야적장 → 소결기, 등속)
    for (let i = 0; i < LUMP; i++) { const u = (lumpPh[i] + simT * 0.06) % 1, t = 1 - u; ld.position.set(CV0[0] + (CV1[0] - CV0[0]) * t, 3.65, CV0[1] + (CV1[1] - CV0[1]) * t); ld.rotation.set(0, i, 0); ld.updateMatrix(); lumps.setMatrixAt(i, ld.matrix); } lumps.instanceMatrix.needsUpdate = true;
    // 3 크레인 그랩: 12초 주기 — 안벽 쪽 하강(0~.25) → 상승(.25~.5) → 배 쪽 하강(.5~.75) → 상승
    grabs.forEach(({ g, cable, grab, dir, ph, top }) => { const u = ((simT + ph) % 12) / 12, seg = Math.floor(u * 4), f = ease((u * 4) % 1), down = seg % 2 === 0 ? f : 1 - f, side = seg < 2 ? -1 : 1; const y = top - down * 13, zz = side * dir * 5.5 + (seg < 2 ? 0 : 0); grab.position.set(0, y, zz); cable.position.set(0, (y + top) / 2 + 0.6, zz); cable.scale.y = Math.max(0.1, top - y + 1.2); });
    // 4 예인선 + 물결
    tugs.forEach(({ g, cx, cz, rx, rz, ph, nav }, i) => { const a = simT * 0.18 + ph, x = cx + rx * Math.cos(a), z = cz + rz * Math.sin(a), vx = -rx * Math.sin(a), vz = rz * Math.cos(a); g.position.set(x, 0.1 + Math.sin(simT * 1.3 + i) * 0.08, z); g.rotation.y = Math.atan2(-vz, vx); nav.material.opacity = dk ? 1 : 0.25; });
    wk.forEach((q, i) => { q.t += dt / 3; if (q.t >= 1) { q.t -= 1; const tg = tugs[q.tug]; q.x = tg.g.position.x - Math.cos(tg.g.rotation.y) * 3; q.z = tg.g.position.z + Math.sin(tg.g.rotation.y) * 3; } wake.pos.set([q.x || 0, 0.12, q.z || 0], i * 3); const a = (1 - q.t) * (dk ? 0.35 : 0.9); wake.col.set([a, a, a], i * 3); });
    wake.geo.attributes.position.needsUpdate = wake.geo.attributes.color.needsUpdate = true;
    // 5 리클레이머 왕복 (가속→등속→감속 ease)
    recl.forEach(({ g, x0, x1, z, ph, wheel }) => { const u = ((simT * 0.04 + ph) % 2), f = u < 1 ? ease(u) : 1 - ease(u - 1); g.position.set(x0 + (x1 - x0) * f, 0, z); g.rotation.y = u < 1 ? 0 : Math.PI; wheel.rotation.x += dt * 1.6; });
    // 6 신호등 (8초 주기: 초록 4 → 노랑 1 → 빨강 3), 교차로마다 위상 다름
    TL.forEach((_, i) => { const u = ((simT + i * 2) % 8); const c = u < 4 ? [0.1, 1, 0.3] : u < 5 ? [1, 0.8, 0.1] : [1, 0.12, 0.08]; sig.col.set(c, i * 3); }); sig.geo.attributes.color.needsUpdate = true;
    if (!dk) {
      hz.forEach((q, i) => { q.t += dt / 2.2; if (q.t >= 1) q.t -= 1; haze.pos.set([q.s[0] + q.ox + Math.sin(simT * 3 + i) * 0.6, 14 + q.t * 12, q.s[1] + q.oz], i * 3); const a = Math.sin(q.t * Math.PI) * 0.6; haze.col.set([a, a, a], i * 3); });
      haze.geo.attributes.position.needsUpdate = haze.geo.attributes.color.needsUpdate = true;
    } else {
      if ((winT += dt) > 1.6) { winT = 0; const i = Math.floor(rnd() * WN); winOn[i] ^= 1; }
      if (frame % 10 === 0) { for (let i = 0; i < WN; i++) { const k = winOn[i] ? 0.85 : 0.04; win.col.set([k, k * 0.86, k * 0.62], i * 3); } win.geo.attributes.color.needsUpdate = true; }
      const p = 0.75 + 0.25 * Math.sin(simT * 1.1) + 0.08 * Math.sin(simT * 7.3); tap.material.opacity = 0.45 * p; tap.scale.setScalar(8 + 2.5 * p); tapFloor.material.opacity = 0.14 * p;
      const cars = el._traffic?.cars; if (cars && frame % 2 === 0) { for (let i = 0; i < TN; i++) { const c = cars[i]; if (!c || !c.path) { tail.pos.set([0, -50, 0], i * 3); continue; } const tmp = el._traffic.tmp; el._traffic.at(c.path, c.d, tmp); const back = c.v > 0 ? -1 : 1; tail.pos.set([tmp.x + Math.cos(tmp.ry) * 1.2 * back, 0.75, tmp.z - Math.sin(tmp.ry) * 1.2 * back], i * 3); } tail.geo.attributes.position.needsUpdate = true; }
    }
    el._dirty = true; };
  requestAnimationFrame(tick);
  return root;
}
