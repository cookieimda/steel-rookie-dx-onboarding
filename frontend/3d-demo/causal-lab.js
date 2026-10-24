// 인과 실습 공간(causal-lab.html): 첫 화면(steel-intro.js)의 공장 부지를 그대로 옮긴 밝은 낮 장면에 3D 실습 4가지만 붙인다.
// - 공정 인과 지도·조업 실험·이상 상황 알아보기(sim-lab의 이상 상황 훈련)·공장 전체 보기(sim-lab.js). 공정 아래 발광 테두리·물결과 공정 사이 연결선은 없다.
// - 부지·도로·소품·소나무·트럭·원료 열차는 steel-intro.js와 같은 값(포항제철소 위성 사진 기준)이고, 색만 낮 지도로 칠한다.
// - 구역은 처음부터 모두 서 있다(솟는 연출 없음). 칩·PROCESS FLOW·조작 안내 카드도 없다.
// - sim-lab.js는 <steel-scene> 대신 #stage에 같은 속성(scene·zones·camera·_frame·process·focus·reset·_overviewPose·_animateTo)을 달아 붙인다.
//   설비 위치는 GLB의 EQ_<설비 id> 노드 경계 상자로 잡는다(scene_v3.js와 같은 방식).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { createGLTFLoader } from './gltf-loader.js'; // Draco 압축 GLB
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { PROCESSES } from './data_v2.js';
import { makeStockpile, makeSlabYard, makeSlabStack, makeCoilYard } from './plant-props.js';
import { attachSimLab } from './sim-lab.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// ---- 부지 데이터(steel-intro.js·scene_v3.js와 같은 값) ----------------------------------------------------------------
const S = 0.18, PX = (x, y) => [(x - 640) * S, (y - 620) * S];
const SITE = { ironmaking: PX(760, 235), steelmaking: PX(470, 440), continuous_casting: PX(400, 620), rolling: PX(618, 809) };
const LAND = [[590, 40], [1180, 215], [1232, 300], [1196, 388], [746, 350], [700, 440], [614, 580], [538, 700], [500, 745], [760, 745], [760, 660], [1010, 630], [1040, 680], [1050, 800], [900, 870], [600, 1244], [62, 800], [235, 300], [340, 230]].map((p) => PX(p[0], p[1]));
const CITY = [[-320, -95], [-125, -95], [-86, -62], [-117, 36], [47, 47], [125, 92], [210, 160], [320, 230], [320, 320], [-320, 320]];
const ROADS = [[[-30, -80], [0, -90], [40, -84], [88, -70]], [[-30, -80], [-30, -72]], [[50, -53], [102, -47]], [[-2, -89], [-2, -24], [-12, -6], [-20, 10], [-27, 24], [-40, 48], [-46, 62], [-38, 80], [-22, 96], [-14, 102]], [[-86, -19], [0, -21]], [[-84, 46], [44, 46]], [[-24, 26], [20, 26]], [[-125, 10], [-106, 34], [-9, 114], [14, 125], [70, 126], [130, 98], [200, 120]]];
const TRUCK_PATH = [[88, -70], [40, -84], [-2, -89.5], [-2, -24], [-12, -6], [-20, 10], [-27, 24], [-40, 48], [-46, 62], [-38, 80], [-22, 96], [-14, 102], [-9, 114]];
const RAIL = [[104, -58], [62, -58], [50, -62], [41, -62]];

// ---- 렌더러·장면(낮) ----------------------------------------------------------------------------------------------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.localClippingEnabled = true;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
{ // 하늘: 위는 맑은 하늘색, 지평선은 거의 흰색
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#a9cdee'); g.addColorStop(0.6, '#d6e7f5'); g.addColorStop(1, '#f2f6fa'); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog(0xe6eef5, 320, 900);
const camera = new THREE.PerspectiveCamera(27, 1, 1, 2000);
scene.add(new THREE.HemisphereLight(0xf2f7ff, 0x9a9488, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e8, 2.1); sun.position.set(120, 230, 90); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 20, far: 560 }); scene.add(sun, sun.target);

const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x9cc3e2, roughness: 0.35, metalness: 0, envMapIntensity: 0.3 }));
sea.rotation.x = -Math.PI / 2; sea.position.y = -0.9; sea.receiveShadow = true; scene.add(sea);

// ---- 땅(낮 지도처럼 칠한 판) ----------------------------------------------------------------------------------------
function slab(points, depth, drawTop, sideColor, topY = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), W = x1 - x0, H = z1 - z0;
  const cw = 2048, ch = Math.round(2048 * H / W), c = document.createElement('canvas'); c.width = cw; c.height = ch; const ctx = c.getContext('2d');
  drawTop(ctx, (x, z) => [(x - x0) / W * cw, (z - z0) / H * ch], cw / W);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.repeat.set(1 / W, 1 / H); tex.offset.set(-x0 / W, z1 / H);
  const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, envMapIntensity: 0.25 }), new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.9, envMapIntensity: 0.2 })]);
  m.rotation.x = -Math.PI / 2; m.position.y = topY - depth; m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
}
const path2d = (ctx, toPx, pts) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = toPx(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
function roads(ctx, toPx, list, k, edge, fill, wEdge, wFill) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  list.forEach((r) => { path2d(ctx, toPx, r); ctx.lineWidth = wEdge * k; ctx.strokeStyle = edge; ctx.stroke(); });
  list.forEach((r) => { path2d(ctx, toPx, r); ctx.lineWidth = wFill * k; ctx.strokeStyle = fill; ctx.stroke(); });
}
slab(LAND, 1.4, (ctx, toPx, k) => {
  ctx.fillStyle = '#e4e1da'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#d8d4cb'; for (let i = 0; i < 70; i++) { const x = -100 + Math.random() * 200, z = -100 + Math.random() * 210, w = 4 + Math.random() * 12, d = 3 + Math.random() * 8; const [px, py] = toPx(x, z); ctx.fillRect(px, py, w * k, d * k); }
  roads(ctx, toPx, ROADS, k, '#c6c1b7', '#f7f5f1', 2.8, 2.0);
}, 0xb9b4aa);
slab(CITY, 1.2, (ctx, toPx, k) => {
  ctx.fillStyle = '#ebe8e2'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const streets = []; for (let x = -320; x < 320; x += 7 + Math.random() * 5) streets.push([[x, -95], [x + (Math.random() - 0.5) * 6, 320]]); for (let z = -95; z < 320; z += 7 + Math.random() * 5) streets.push([[-320, z], [320, z + (Math.random() - 0.5) * 6]]);
  roads(ctx, toPx, streets, k, '#d9d5cd', '#f6f4f0', 1.3, 0.8);
  ctx.fillStyle = '#cfe0c6'; for (let i = 0; i < 26; i++) { const [px, py] = toPx(-300 + Math.random() * 600, -80 + Math.random() * 380); ctx.beginPath(); ctx.arc(px, py, (3 + Math.random() * 6) * k, 0, Math.PI * 2); ctx.fill(); } // 공원
}, 0xc4bfb5, -0.15);
function inside(poly, x, z) { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) r = !r; } return r; }
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ---- 공정 구역(처음부터 서 있음) + 설비 위치(EQ_ 노드) ------------------------------------------------------------------
const loader = createGLTFLoader();
const above = (y) => [new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)];
function tune(m) {
  m = m.clone(); const nm = m.name || ''; m.envMapIntensity = 0.9;
  if (/^(Steel|Steel_Dark|Struct_Gray|Roll_Steel|Coil_Cooled|Chrome_Rod)$/.test(nm)) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 1.1; }
  if (nm === 'Concrete') m.color.setRGB(0.62, 0.63, 0.64);
  if (nm === 'Cladding') m.color.setRGB(0.62, 0.65, 0.68);
  if (/^(Molten_Steel|Hot_Slab|Slag_Hot)$/.test(nm)) { m.emissiveIntensity = 1.6; m.toneMapped = false; }
  m.clippingPlanes = above(0.0); return m;
}
const procs = PROCESSES.map((p, i) => ({ id: p.id, data: p, i, c: SITE[p.id], root: null, foot: null, modelTop: 10 }));
const zones = {};
let loaded = 0;
const loadAll = () => Promise.all(procs.map((p) => new Promise((resolve) => {
  loader.load(`models/${p.id}.glb`, (gltf) => {
    const root = gltf.scene; root.position.set(p.c[0], 0, p.c[1]);
    root.traverse((o) => { if (!o.isMesh) return; o.material = Array.isArray(o.material) ? o.material.map(tune) : tune(o.material); o.castShadow = true; o.receiveShadow = true; });
    root.updateMatrixWorld(true);
    const fb = new THREE.Box3();
    root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (/^Floor_/.test(q.name)) { o.visible = false; o.castShadow = false; fb.expandByObject(o); break; } });
    const all = new THREE.Box3().setFromObject(root); if (fb.isEmpty()) fb.copy(all);
    p.foot = { w: fb.max.x - fb.min.x + 5, d: fb.max.z - fb.min.z + 5, cx: (fb.min.x + fb.max.x) / 2, cz: (fb.min.z + fb.max.z) / 2 }; p.modelTop = all.max.y;
    scene.add(root); p.root = root;
    // 설비: EQ_<id> 노드의 경계 상자 가운데가 초점, 크기로 카메라 거리
    const eqs = [];
    for (const e of p.data.equipment) {
      const node = root.getObjectByName(`EQ_${e.id}`); if (!node) continue;
      const box = new THREE.Box3().setFromObject(node), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
      eqs.push({ id: e.id, zone: p.id, data: e, focus: c, anchor: new THREE.Vector3(c.x, box.max.y + 0.6, c.z), dist: Math.max(10, sz * 1.6) });
    }
    zones[p.id] = { id: p.id, ox: p.c[0], oz: p.c[1], eqs, root };
    loaded++; $('loadbar').style.width = `${Math.round(loaded / procs.length * 100)}%`; resolve(true);
  }, undefined, () => { loaded++; resolve(false); });
})));

// ---- 주변 모델(소품 + 소나무), 낮이라 색을 어둡게 하지 않는다 ----------------------------------------------------------------
const M2U = 1 / 7, MAX_TRIS = 1000;
const SURROUND = {
  ironmaking: [
    { make: () => makeStockpile({ L: 80, W: 26, H: 12, kind: 'ore', seed: 5 }), x: 6, z: -93.3 },
    { make: () => makeStockpile({ L: 80, W: 26, H: 12, kind: 'coal', seed: 6 }), x: 6, z: -86.5 },
    { make: () => makeStockpile({ L: 40, W: 22, H: 9, kind: 'lime', seed: 7 }), x: 26, z: -90 },
  ],
  steelmaking: [{ make: () => makeStockpile({ L: 40, W: 24, H: 10, kind: '#45484d', seed: 12 }), x: -54, z: -33, ry: Math.PI / 2 }],
  continuous_casting: [
    { make: () => makeSlabYard({ rows: 2, cols: 3, seed: 4 }), x: -47, z: 17, sc: 2.2 },
    { make: () => makeSlabStack({ layers: 8, seed: 2 }), x: -36, z: 17, sc: 2.2 },
  ],
  rolling: [
    { make: () => makeSlabStack({ layers: 9, seed: 6 }), x: -25, z: 33, ry: Math.PI / 2, sc: 2.2 },
    { make: () => makeCoilYard({ rows: 1, perRow: 2, tiers: 1, seed: 5 }), x: 19, z: 34, sc: 4.5 },
  ],
};
const triCount = (o) => { let n = 0; o.traverse((m) => { if (!m.isMesh) return; const g = m.geometry, c = g.index ? g.index.count / 3 : g.attributes.position.count / 3; n += m.isInstancedMesh ? c * m.count : c; }); return Math.round(n); };
function pineGeometry() {
  const paint = (g, f) => { g = g.toNonIndexed(); const P = g.attributes.position, c = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) c.set(f(P.getY(i)), i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const green = new THREE.Color(0x3d7f4f), trunk = new THREE.Color(0x6a5040);
  const parts = [[0.45, 1.4, 0.62], [0.9, 1.78, 0.47], [1.35, 2.2, 0.32]].map(([y0, y1, r]) => paint(new THREE.ConeGeometry(r, y1 - y0, 6, 1, true).translate(0, (y0 + y1) / 2, 0), (y) => { const k = 0.7 + 0.45 * (y - y0) / (y1 - y0); return [green.r * k, green.g * k, green.b * k]; }));
  parts.push(paint(new THREE.CylinderGeometry(0.07, 0.1, 0.6, 4, 1, true).translate(0, 0.3, 0), () => [trunk.r, trunk.g, trunk.b]));
  return mergeGeometries(parts);
}
const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); return Math.hypot(x - a[0] - u * dx, z - a[1] - u * dz); };
const nearLines = (x, z, lines, r) => lines.some((l) => l.some((p, i) => i > 0 && segDist(x, z, l[i - 1], p) < r));
function buildSurroundings() {
  const boxes = [], lines = [...ROADS, RAIL], feet = procs.filter((q) => q.foot).map((q) => q.foot);
  const inFoot = (x, z, m) => feet.some((f) => Math.abs(x - f.cx) < f.w / 2 + m && Math.abs(z - f.cz) < f.d / 2 + m);
  const inBox = (x, z) => boxes.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const fits = (x, z, hx, hz) => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const px = x + hx * i / 2, pz = z + hz * j / 2; if (!inside(LAND, px, pz) || nearLines(px, pz, lines, 1.4) || inFoot(px, pz, 1.5) || inBox(px, pz)) return false; } return true; };
  const findSpot = (x, z, hx, hz) => { if (fits(x, z, hx, hz)) return [x, z]; for (let r = 1; r <= 24; r += 1) for (let k = 0, n = Math.ceil(r * 6); k < n; k++) { const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (fits(px, pz, hx, hz)) return [px, pz]; } return null; };
  procs.forEach((p) => {
    if (!p.foot) return;
    (SURROUND[p.id] || []).forEach((s) => {
      const o = s.make(); if (triCount(o) > MAX_TRIS) return;
      o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      const g = new THREE.Group(); g.add(o); g.rotation.y = s.ry || 0; g.scale.setScalar(M2U * (s.sc || 1)); g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g), hx = (bb.max.x - bb.min.x) / 2, hz = (bb.max.z - bb.min.z) / 2, ox = (bb.max.x + bb.min.x) / 2, oz = (bb.max.z + bb.min.z) / 2;
      const spot = findSpot(s.x, s.z, hx, hz); if (!spot) return;
      g.position.set(spot[0] - ox, 0, spot[1] - oz); scene.add(g);
      boxes.push([spot[0] - hx - 1, spot[0] + hx + 1, spot[1] - hz - 1, spot[1] + hz + 1]);
    });
  });
  const PINE_GEO = pineGeometry(), PINE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, envMapIntensity: 0.3 });
  const blocked = (x, z) => !inside(LAND, x, z) || nearLines(x, z, lines, 2.2) || inFoot(x, z, 3.5) || inBox(x, z);
  procs.forEach((p) => {
    if (!p.foot) return; const { cx, cz, w, d } = p.foot, list = [];
    for (let tries = 0; tries < 900 && list.length < 34; tries++) {
      const side = Math.random(), a = Math.random() * Math.PI * 2, rx = w / 2 + 4 + Math.random() * 12, rz = d / 2 + 4 + Math.random() * 12;
      const x = cx + Math.cos(a) * rx * (0.7 + 0.3 * side), z = cz + Math.sin(a) * rz * (0.7 + 0.3 * side);
      if (blocked(x, z) || list.some((q) => Math.hypot(q.x - x, q.z - z) < 1.3)) continue;
      list.push({ x, z, s: 0.75 + Math.random() * 0.6, ry: Math.random() * Math.PI * 2 });
      for (let c = 0, nc = Math.random() < 0.5 ? 2 : 0; c < nc && list.length < 34; c++) { const xx = x + gauss() * 1.4, zz = z + gauss() * 1.4; if (!blocked(xx, zz)) list.push({ x: xx, z: zz, s: 0.6 + Math.random() * 0.5, ry: Math.random() * Math.PI * 2 }); }
    }
    const inst = new THREE.InstancedMesh(PINE_GEO, PINE_MAT, list.length); inst.castShadow = true; inst.receiveShadow = true; inst.raycast = () => {};
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => inst.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(Y, t.ry), new THREE.Vector3().setScalar(t.s))));
    scene.add(inst);
  });
}

// ---- 트럭과 원료 열차(낮이라 전조등·불빛 웅덩이는 없다) -------------------------------------------------------------------
const TRUCK_COLORS = [0xe8e4da, 0x2f62a8, 0xd0782e, 0xb83a32, 0x3d8a5a, 0x8a9099];
const TRUCK_MAX = 10, TRUCK_EVERY = 10000, TRUCK_SPEED = 10, TRAIN_SPEED = 6;
const traffic = { trucks: [], body: null, last: 0, next: 0, train: null };
const mkPath = (pts) => { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { P: pts, L, len: L[L.length - 1] }; };
const pathAt = ({ P, L, len }, s) => { s = Math.max(0, Math.min(len, s)); let k = 1; while (k < L.length - 1 && L[k] < s) k++; const u = (s - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]); return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * u, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * u]; };
function pose(path, s, dir, lane = 0) {
  const at = (q) => pathAt(path, dir > 0 ? q : path.len - q), [x, z] = at(s), f = at(s + 0.9), r = at(s - 0.9);
  let tx = f[0] - r[0], tz = f[1] - r[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: x - tz * lane, z: z + tx * lane, tx, tz, ry: Math.atan2(-tz, tx) };
}
const paintGeo = (g, c) => { g = g.toNonIndexed(); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
function truckGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.55, 0.6, 0.72).translate(0.8, 0.4, 0), [1, 1, 1]),
    paintGeo(new THREE.BoxGeometry(0.05, 0.22, 0.62).translate(1.08, 0.52, 0), [0.08, 0.09, 0.1]),
    paintGeo(new THREE.BoxGeometry(1.5, 0.66, 0.78).translate(-0.28, 0.45, 0), [0.62, 0.62, 0.64]),
    paintGeo(new THREE.BoxGeometry(2.15, 0.13, 0.6).translate(0.02, 0.12, 0), [0.1, 0.1, 0.11]),
  ]);
}
// 선로 띠: uv.x = 길이 비율. 땅 위 납작한 띠(폭 W)
function ribbon(pts, W = 1.0, y = 0.07) {
  const D = pts.map((p) => new THREE.Vector2(...p)), pos = [], uv = [], idx = [], len = [0];
  for (let i = 1; i < D.length; i++) len.push(len[i - 1] + D[i].distanceTo(D[i - 1]));
  D.forEach((p, i) => { const a = D[Math.max(0, i - 1)], b = D[Math.min(D.length - 1, i + 1)], t = b.clone().sub(a).normalize(), n = new THREE.Vector2(-t.y, t.x).multiplyScalar(W / 2);
    pos.push(p.x + n.x, y, p.y + n.y, p.x - n.x, y, p.y - n.y); uv.push(len[i], 0, len[i], 1); if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); return g;
}
function buildTraffic() {
  const N = TRUCK_MAX, path = mkPath(TRUCK_PATH);
  for (let i = 0; i < N; i++) traffic.trucks.push({ path, dir: 1, s: 0, on: false, vis: 0, wait: 0 });
  const body = new THREE.InstancedMesh(truckGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.6 }), N);
  body.castShadow = true; body.frustumCulled = false; body.raycast = () => {}; const col = new THREE.Color();
  for (let i = 0; i < N; i++) { body.setColorAt(i, col.set(TRUCK_COLORS[i % TRUCK_COLORS.length])); body.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); } body.instanceColor.needsUpdate = true; scene.add(body);
  const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#9a9a96'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#7a6250'; x.fillRect(9, 3, 14, 26); x.fillStyle = '#5c6066'; x.fillRect(0, 8, 32, 3); x.fillRect(0, 21, 32, 3);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.set(1 / 0.55, 1);
  const bed = new THREE.Mesh(ribbon(RAIL), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, envMapIntensity: 0.2, side: THREE.DoubleSide })); bed.receiveShadow = true; bed.raycast = () => {}; scene.add(bed);
  const M = (cl, r = 0.6) => new THREE.MeshStandardMaterial({ color: cl, roughness: r, metalness: 0.3, envMapIntensity: 0.6 });
  const locoM = M(0x2f5a8a), cabM = M(0x1f3d5e), hopM = M(0x5a4c42, 0.8), oreM = M(0x6a3f2e, 0.95), cars = [], ores = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    if (!i) { g.add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 0.66).translate(0, 0.45, 0), locoM)); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.6).translate(0.55, 0.92, 0), cabM)); }
    else { g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.7).translate(0, 0.45, 0), hopM)); const ore = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.2, 0.56).translate(0, 0.8, 0), oreM); g.add(ore); ores.push(ore); }
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; }); g.visible = false; scene.add(g); cars.push({ g, len: i ? 1.5 : 2.0 });
  }
  let off = 0; cars.forEach((cc, i) => { if (i) off += cars[i - 1].len / 2 + 0.22 + cc.len / 2; cc.off = off; });
  traffic.train = { rail: mkPath(RAIL), cars, ores, total: off + 2, s: 0, dir: 1, run: false, next: 0, loaded: true };
  traffic.body = body;
}
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
function trafficTick(now) {
  const T = traffic; if (!T.body) return; const dt = Math.min(0.1, (now - (T.last || now)) / 1000); T.last = now;
  if (!T.next) T.next = now + 800;
  if (now >= T.next) {
    T.next = now + TRUCK_EVERY * (0.85 + Math.random() * 0.3);
    const spawn = (dir, delay) => { const k = T.trucks.find((q) => !q.on && !q.wait); if (k) Object.assign(k, { dir, s: 0, vis: 0, wait: now + delay }); };
    const first = Math.random() < 0.5 ? 1 : -1; spawn(first, 0); if (Math.random() < 0.7) spawn(-first, 2500 + Math.random() * 3500);
  }
  T.trucks.forEach((c, i) => {
    if (c.wait && now >= c.wait) { c.wait = 0; c.on = true; }
    if (c.on) { c.s += (REDUCED ? 3 : TRUCK_SPEED) * dt; if (c.s >= c.path.len) c.on = false; }
    if (!c.on) { T.body.setMatrixAt(i, _cm.makeScale(0, 0, 0)); return; }
    const p = pose(c.path, c.s, c.dir, 0.5);
    c.vis += ((inside(LAND, p.x, p.z) ? 1 : 0) - c.vis) * Math.min(1, dt * 6);
    const sc = c.vis * Math.min(1, c.s / 2, (c.path.len - c.s) / 2); _cq.setFromAxisAngle(_Y, p.ry);
    T.body.setMatrixAt(i, _cm.compose(_cp.set(p.x, 0, p.z), _cq, _cs.setScalar(Math.max(0, sc))));
  });
  const R = T.train;
  if (!R.run && now >= R.next) { R.run = true; R.s = 0; R.ores.forEach((o) => (o.visible = R.loaded)); }
  if (R.run) {
    R.s += (REDUCED ? 3 : TRAIN_SPEED) * dt;
    R.cars.forEach((c) => {
      const s = R.s - c.off, inRail = s > 0 && s < R.rail.len; c.g.visible = inRail; if (!inRail) return;
      const p = pose(R.rail, s, R.dir), sc = Math.min(1, s / 1.2, (R.rail.len - s) / 1.2);
      c.g.position.set(p.x, 0, p.z); c.g.rotation.y = p.ry; c.g.scale.set(Math.max(0.001, sc), 1, 1);
    });
    if (R.s > R.rail.len + R.total) { R.run = false; R.cars.forEach((c) => (c.g.visible = false)); R.dir = -R.dir; R.loaded = !R.loaded; R.next = now + 6000 + Math.random() * 5000; }
  }
  T.body.instanceMatrix.needsUpdate = true;
}

// ---- 카메라 --------------------------------------------------------------------------------------------------
const orbit = { yaw: -0.58, pitch: 0.52, dist: 300, target: new THREE.Vector3(-8, 0, 0) };
let viewBox = null, anim = null;
function overviewPose(pitch = 1.32) {
  if (!viewBox) { const f = procs.filter((p) => p.foot).map((p) => p.foot); if (!f.length) return { yaw: 0, pitch, dist: 420, target: new THREE.Vector3(-10, 0, 0) };
    viewBox = { x0: Math.min(...f.map((q) => q.cx - q.w / 2)) - 8, x1: Math.max(...f.map((q) => q.cx + q.w / 2)) + 8, z0: Math.min(...f.map((q) => q.cz - q.d / 2)) - 6, z1: Math.max(...f.map((q) => q.cz + q.d / 2)) + 6 }; }
  const { x0, x1, z0, z1 } = viewBox, half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), USE = 0.8;
  return { yaw: 0, pitch, dist: Math.max(z1 - z0, (x1 - x0) / Math.max(0.6, camera.aspect)) / (2 * half * USE), target: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2 + 4) };
}
// 3D 대각선 전체 보기(steel-intro.js의 pose3D와 같은 기울기·방향)
const pose3D = () => { const p = overviewPose(0.52); p.target.z -= 12; return { ...p, yaw: -0.58, dist: p.dist * 0.7 }; }; // 위 제목 카드에 제선이 가리지 않게 목표를 북쪽으로 조금 민다
const maxDist = () => overviewPose().dist * 1.06;
const zonePose = (p) => ({ yaw: -0.42 + (p.i - 1.5) * 0.06, pitch: 0.48, dist: Math.min(130, Math.max(85, (p.foot?.w || 40) * 2.3)), target: new THREE.Vector3(p.foot ? p.foot.cx : p.c[0], 3, p.foot ? p.foot.cz : p.c[1]) });
function animateTo(to, dur = 1400) { anim = { t0: performance.now(), dur: REDUCED ? 1 : dur, from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, target: orbit.target.clone() }, to: { ...to, target: to.target.clone() } }; }

// ---- 입력(드래그 회전·휠 확대) -------------------------------------------------------------------------------------------
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; stage.classList.add('dragging'); renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; orbit.yaw -= dx * 0.004; orbit.pitch = Math.min(1.52, Math.max(0.25, orbit.pitch + dy * 0.003)); drag.x = e.clientX; drag.y = e.clientY; anim = null; });
renderer.domElement.addEventListener('pointerup', () => { drag = null; stage.classList.remove('dragging'); });
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(maxDist(), Math.max(14, orbit.dist * (1 + e.deltaY * 0.0012))); anim = null; }, { passive: false });
function resize() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();

// ---- sim-lab이 붙는 장면 속성(<steel-scene>과 같은 이름) ------------------------------------------------------------------
const host = stage;
const procOf = (id) => PROCESSES.find((p) => p.id === id) || PROCESSES[0];
const qsP = new URLSearchParams(location.search).get('p');
Object.assign(host, {
  scene, camera, zones, _2d: false, _dirty: true,
  process: procOf(qsP),
  _frame() {},
  _overviewPose: pose3D,
  _animateTo: (p) => animateTo(p, 1400),
  overview() { animateTo(pose3D(), 1400); },
  reset() { const p = procs.find((q) => q.id === host.process.id); if (p) animateTo(zonePose(p), 1400); },
  focus(id) {
    const e = Object.values(zones).flatMap((z) => z.eqs).find((q) => q.id === id); if (!e) return;
    host.process = procOf(e.zone);
    animateTo({ yaw: orbit.yaw, pitch: 0.5, dist: Math.min(95, Math.max(32, e.dist * 1.5)), target: e.focus.clone() }, 1300);
  },
});
// sim-lab이 공정을 옮길 때(v4에서는 공정 화면 전환) 보내는 이벤트: 여기서는 카메라만 그 구역으로 옮긴다
document.addEventListener('steel-goto', (e) => { const id = e.detail?.process; if (!id) return; host.process = procOf(id); host.reset(); });

// ---- 루프 ----------------------------------------------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  trafficTick(now);
  if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), s = easeInOut(k); orbit.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * s; orbit.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * s; orbit.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * s; orbit.target.lerpVectors(anim.from.target, anim.to.target, s); if (k >= 1) anim = null; }
  const o = orbit; camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch)); camera.lookAt(o.target);
  try { host._frame(now); } catch (e) { console.warn('실습 효과 실패', e); }
  renderer.render(scene, camera);
}
loadAll().then(() => {
  buildTraffic(); buildSurroundings();
  const start = pose3D(); Object.assign(orbit, { yaw: start.yaw, pitch: start.pitch, dist: start.dist }); orbit.target.copy(start.target);
  $('load').classList.add('off');
  requestAnimationFrame(frame);
  if (!$('needLogin').hidden) return;
  attachSimLab({ host, light: true, tutor: false, faultLabel: '이상 상황 알아보기' });
});
