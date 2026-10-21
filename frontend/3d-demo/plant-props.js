// 제철소 주변 소품을 코드로 만든다. 단위는 미터, Y가 위, 원점은 바닥 가운데.
// 장면(1단위 ≈ 12m)에 넣을 때는 바깥에서 축척을 곱한다.
// 재질별로 지오메트리를 합쳐 메시 수를 줄인다(소품 하나당 재질 수만큼만 그린다).
// 벽·지붕은 트림시트(models/trim/plant-trim.jpg, 512²) 한 장을 같이 쓴다. 띠마다 가로로 반복되고, 면을 띠 높이 단위로 나눠 붙인다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';

const Y = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function rng(seed) { // 같은 seed면 같은 모양
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---- 트림시트 ----
// px: 시트(512×512)에서 띠의 위·아래 픽셀(make_trim.py 출력과 같아야 한다), m: 띠 높이가 나타내는 실제 높이(m)
// 가로는 텍셀이 정사각형이 되게 자동으로 정한다(시트 폭 512px = m × 512 / 띠 높이px).
const SHEET = 512;
export const TRIM = {
  cladding: { px: [0, 48], m: 3.5 },          // 밝은 외장 패널
  louver: { px: [48, 96], m: 3.0 },           // 청색 루버(공기 흡입구)
  concrete: { px: [96, 144], m: 4.0 },        // 밝은 콘크리트 벽
  concrete_dark: { px: [144, 192], m: 4.0 },  // 줄눈 있는 어두운 콘크리트 패널
  steel_panel: { px: [192, 224], m: 2.5 },    // 회청색 강판
  basin: { px: [224, 256], m: 1.5 },          // 바닥·수조 콘크리트
  slab_scale: { px: [256, 288], m: 1.6 },     // 슬래브 표면(산화 스케일)
  slab_cut: { px: [288, 304], m: 0.25 },      // 슬래브 절단면 + 흰 페인트 표시
  curb: { px: [304, 320], m: 0.4 },           // 연석·테두리
  wall_gray: { px: [320, 352], m: 3.0 },      // 회색 외벽 패널(냉각 플랜트)
  roof_gray: { px: [352, 368], m: 2.0 },      // 회색 지붕
  pipe: { px: [368, 400], m: 1.2 },           // 배관 표면(관 둘레 = 띠 높이 한 번, 길이 방향 반복)
  beam: { px: [400, 416], m: 0.5 },           // H형강·보
  coil_side: { px: [416, 448], m: 1.5 },      // 코일 옆면(띠 높이 = 코일 폭)
  coil_face: { px: [448, 480], m: 0.6 },      // 코일 끝면(극좌표: 띠 높이 = 안쪽→바깥 반지름)
  grating: { px: [480, 512], m: 1.0 },        // 통로 그레이팅
};
const GUTTER = 2.5; // 밉맵에서 옆 띠 색이 번지지 않게 띠 위아래를 조금 안쪽으로
function stripV(name) {
  const t = TRIM[name], [y0, y1] = t.px;
  return { v0: 1 - (y1 - GUTTER) / SHEET, v1: 1 - (y0 + GUTTER) / SHEET, uM: t.m * SHEET / (y1 - y0), hM: t.m };
}

let trimMat = null, trimLoaded = null;
export const trimReady = new Promise(res => { trimLoaded = res; }); // 텍스처를 받으면 풀린다(그때 장면을 다시 그리게)
export function trimMaterial() {
  if (trimMat) return trimMat;
  const tex = new THREE.TextureLoader().load(new URL('./models/trim/plant-trim.jpg', import.meta.url).href, () => trimLoaded());
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 8;
  trimMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.1 });
  return trimMat;
}
// 같은 트림 텍스처에 색만 곱한 재질(배관 도장색 등). 색마다 하나씩 만들어 재사용한다
const tintCache = new Map();
export function trimTint(color) {
  if (!color) return trimMaterial();
  if (!tintCache.has(color)) { const m = trimMaterial().clone(); m.color.set(color); tintCache.set(color, m); }
  return tintCache.get(color);
}
// 지오메트리의 기본 UV(0~1)를 트림 띠로 옮긴다. uLen: u 방향 실제 길이(m), swap: 원래 v를 길이 방향으로 쓸 때
function toStrip(geo, strip, uLen, swap = false) {
  const t = stripV(strip), uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const a = swap ? uv.getY(i) : uv.getX(i), b = swap ? uv.getX(i) : uv.getY(i);
    uv.setXY(i, a * uLen / t.uM, t.v0 + b * (t.v1 - t.v0));
  }
  return geo;
}

// 위치·법선·UV를 직접 채우는 삼각형 묶음
function rawGeo(pos, nor, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// 재질별로 지오메트리를 모았다가 한 번에 합친다
class Kit {
  constructor() { this.parts = new Map(); }
  add(mat, geo, m) {
    if (m) geo.applyMatrix4(m);
    if (geo.index) geo = geo.toNonIndexed();
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
    return geo;
  }
  box(mat, sx, sy, sz, x, y, z, rot) {
    const m = new THREE.Matrix4().compose(V(x, y, z), rot || new THREE.Quaternion(), V(1, 1, 1));
    return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), m);
  }
  // a에서 b까지 이어지는 각재(단면 t × t2)
  beam(mat, a, b, t, t2 = t) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    if (len < 1e-4) return;
    const q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1));
    return this.add(mat, new THREE.BoxGeometry(t, len, t2), m);
  }
  // a에서 b까지 원기둥(축 = a→b)
  rod(mat, a, b, r, seg = 8) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize());
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1));
    return this.add(mat, new THREE.CylinderGeometry(r, r, len, seg), m);
  }

  // ---- 트림시트 면 ----
  // o: 왼쪽 아래 모서리, U: 가로 방향, Vd: 세로 방향(둘 다 단위 벡터), w·h: 크기(m).
  // 세로는 띠 높이(hM)에 가장 가까운 정수 칸으로 나눠 띠를 통째로 쓴다(rows로 직접 정할 수 있음). u0는 가로 시작 위치(m), 모서리를 돌 때 이어 준다.
  quad(strip, o, U, Vd, w, h, { u0 = 0, rows } = {}) {
    const s = stripV(strip), n = rows || Math.max(1, Math.round(h / s.hM));
    const N = new THREE.Vector3().crossVectors(U, Vd).normalize();
    const pos = [], nor = [], uv = [];
    const ua = u0 / s.uM, ub = (u0 + w) / s.uM;
    for (let i = 0; i < n; i++) {
      const y0 = h * i / n, y1 = h * (i + 1) / n;
      const p = (u, v) => o.clone().addScaledVector(U, u).addScaledVector(Vd, v);
      const du = n > 1 ? i * 0.379 : 0; // 층마다 가로 시작점을 밀어 같은 무늬가 세로로 줄지어 보이지 않게
      const P = [p(0, y0), p(w, y0), p(w, y1), p(0, y1)], T = [[ua + du, s.v0], [ub + du, s.v0], [ub + du, s.v1], [ua + du, s.v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(P[k].x, P[k].y, P[k].z); nor.push(N.x, N.y, N.z); uv.push(...T[k]); }
    }
    return this.add(trimMaterial(), rawGeo(pos, nor, uv));
  }
  // 바닥에 놓인 직육면체(c: 아랫면 가운데). side: 옆면 띠(문자열 또는 [앞, 오른쪽, 뒤, 왼쪽]), top: 윗면 띠(없으면 생략)
  // vertical: 옆면 띠의 결을 세로(높이 방향)로 돌린다(기둥처럼 긴 부재는 결이 길이 방향을 따라야 한다)
  boxT(c, sx, sy, sz, side, top, { rows, rotY = 0, vertical = false } = {}) {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, rotY);
    const ax = V(1, 0, 0).applyQuaternion(q), az = V(0, 0, 1).applyQuaternion(q);
    const sides = Array.isArray(side) ? side : [side, side, side, side];
    const hx = sx / 2, hz = sz / 2;
    const corner = (a, b) => c.clone().addScaledVector(ax, a).addScaledVector(az, b);
    // 반시계로 돌며 바깥을 향하게: 앞(+z) → 오른쪽(+x) → 뒤(-z) → 왼쪽(-x)
    const faces = [[corner(-hx, hz), ax, sx], [corner(hx, hz), az.clone().negate(), sz], [corner(hx, -hz), ax.clone().negate(), sx], [corner(-hx, -hz), az, sz]];
    let u = 0;
    faces.forEach(([o, U, w], i) => {
      if (sides[i]) {
        if (vertical) this.quad(sides[i], o.clone().addScaledVector(U, w), Y, U.clone().negate(), sy, w, { rows: 1 });
        else this.quad(sides[i], o, U, Y, w, sy, { u0: u, rows });
      }
      u += w;
    });
    if (top) this.quad(top, corner(-hx, hz).add(V(0, sy, 0)), ax, az.clone().negate(), sx, sz, { rows: Math.max(1, Math.round(sz / stripV(top).hM)) });
  }
  // 원통 옆면(c: 아래 가운데, r0→r1로 벌어짐), 둘레를 따라 띠가 반복된다
  cylT(strip, c, r0, r1, h, seg = 24, { rows } = {}) {
    const s = stripV(strip), n = rows || Math.max(1, Math.round(h / s.hM));
    const pos = [], nor = [], uv = [];
    const circ = Math.PI * (r0 + r1);
    const slope = (r0 - r1) / h;
    for (let i = 0; i < seg; i++) for (let j = 0; j < n; j++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, y0 = h * j / n, y1 = h * (j + 1) / n;
      const r = y => r0 + (r1 - r0) * y / h;
      const P = (a, y) => [c.x + Math.cos(a) * r(y), c.y + y, c.z - Math.sin(a) * r(y)];
      const Nn = a => { const v = V(Math.cos(a), slope, -Math.sin(a)).normalize(); return [v.x, v.y, v.z]; };
      const u0 = (circ * i / seg) / s.uM, u1 = (circ * (i + 1) / seg) / s.uM;
      const Q = [[a0, y0, u0, s.v0], [a1, y0, u1, s.v0], [a1, y1, u1, s.v1], [a0, y1, u0, s.v1]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const [a, y, u, v] = Q[k]; pos.push(...P(a, y)); nor.push(...Nn(a)); uv.push(u, v); }
    }
    // 안쪽 면도 보이게(위가 열린 통): 같은 면을 뒤집어 한 번 더
    const g = rawGeo(pos, nor, uv), inner = g.clone();
    const ip = inner.attributes.position.array, inr = inner.attributes.normal.array;
    for (let i = 0; i < ip.length; i += 9) for (const k of [0, 1, 2]) { const t = ip[i + 3 + k]; ip[i + 3 + k] = ip[i + 6 + k]; ip[i + 6 + k] = t; }
    for (let i = 0; i < inr.length; i += 9) for (const k of [0, 1, 2]) { const t = inr[i + 3 + k]; inr[i + 3 + k] = inr[i + 6 + k]; inr[i + 6 + k] = t; }
    for (let i = 0; i < inr.length; i++) inr[i] = -inr[i];
    const iu = inner.attributes.uv.array;
    for (let i = 0; i < iu.length; i += 6) for (const k of [0, 1]) { const t = iu[i + 2 + k]; iu[i + 2 + k] = iu[i + 4 + k]; iu[i + 4 + k] = t; }
    this.add(trimMaterial(), g); this.add(trimMaterial(), inner);
  }
  // a→b 관(트림 'pipe' 띠: 길이 방향 반복, 둘레 = 띠 한 번)
  tubeT(a, b, r, { strip = 'pipe', tint, seg = 12 } = {}) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const geo = toStrip(new THREE.CylinderGeometry(r, r, len, seg, 1, true), strip, len, true);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()), V(1, 1, 1));
    return this.add(trimTint(tint), geo, m);
  }
  // 90° 엘보(트림 UV). basis: 로컬 호(XY 평면, (rb,0)→(0,rb))를 놓을 축 3개, c: 호의 중심
  elbowT(c, basis, rb, r, { strip = 'pipe', tint } = {}) {
    const geo = toStrip(new THREE.TorusGeometry(rb, r, 10, 8, Math.PI / 2), strip, rb * Math.PI / 2);
    const m = new THREE.Matrix4().makeBasis(...basis); m.setPosition(c);
    return this.add(trimTint(tint), geo, m);
  }
  build(name) {
    const g = new THREE.Group(); g.name = name;
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }
}

// 사각 트러스(격자 보). p0에서 dir 방향으로 len, 단면은 폭 w0→w1, 높이 h0→h1로 줄어든다.
// up은 대략의 위 방향. 아래 면의 가운데가 p0 → 끝점이 기준선이다.
function truss(kit, mat, p0, dir, up, len, { w0, w1 = w0, h0, h1 = h0, bay = 3, chord = 0.35, web = 0.16, deck = false }) {
  const u = dir.clone().normalize();
  const side = new THREE.Vector3().crossVectors(up, u).normalize();
  const v = new THREE.Vector3().crossVectors(u, side).normalize();
  const n = Math.max(1, Math.round(len / bay));
  const corner = (i, sx, sy) => { // i: 칸 번호, sx: -1/1(옆), sy: 0/1(아래/위)
    const t = i / n, w = w0 + (w1 - w0) * t, h = h0 + (h1 - h0) * t;
    return p0.clone().addScaledVector(u, len * t).addScaledVector(side, sx * w / 2).addScaledVector(v, sy * h);
  };
  const C = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k < 4; k++) { // 단면 테두리
      const [ax, ay] = C[k], [bx, by] = C[(k + 1) % 4];
      kit.beam(mat, corner(i, ax, ay), corner(i, bx, by), web);
    }
    if (i === n) break;
    for (const [sx, sy] of C) kit.beam(mat, corner(i, sx, sy), corner(i + 1, sx, sy), chord); // 현재(주재)
    const flip = i % 2 ? 1 : 0; // 사재 방향을 칸마다 바꿔 W 모양
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = C[k], [bx, by] = C[(k + 1) % 4];
      if (deck && k === 0) continue; // 아래 면은 바닥판이 있으면 사재 생략
      kit.beam(mat, corner(i + flip, ax, ay), corner(i + 1 - flip, bx, by), web);
    }
  }
  return { u, side, v, at: (t, sx = 0, sy = 0) => corner(t * n, sx, sy) };
}

function rail(kit, mat, axis, off, a0, a1) { // 레일 단면: 머리 + 몸 + 발. axis 'z'면 Z 방향으로 놓인다
  const L = a1 - a0, c = (a0 + a1) / 2;
  const put = (w, h, y) => axis === 'z' ? kit.box(mat, w, h, L, off, y, c) : kit.box(mat, L, h, w, c, y, off);
  put(0.15, 0.03, 0.015); put(0.02, 0.1, 0.08); put(0.08, 0.05, 0.155);
}

// 난간: a→b 사이 기둥 + 위·중간 가로대
function handrail(kit, mat, a, b, h = 1.1, step = 1.6) {
  const n = Math.max(1, Math.round(a.distanceTo(b) / step));
  for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); kit.beam(mat, p, p.clone().add(V(0, h, 0)), 0.07); }
  kit.beam(mat, a.clone().add(V(0, h, 0)), b.clone().add(V(0, h, 0)), 0.07);
  kit.beam(mat, a.clone().add(V(0, h / 2, 0)), b.clone().add(V(0, h / 2, 0)), 0.05);
}

// 철골 계단탑: 기둥 4개 + 층마다 참 + 지그재그 계단
function stairTower(kit, M, c, w, d, h, flight = 4) {
  const hx = w / 2, hz = d / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box(M.steel, 0.3, h, 0.3, c.x + sx * hx, c.y + h / 2, c.z + sz * hz);
  const n = Math.max(1, Math.round(h / flight));
  for (let i = 1; i <= n; i++) {
    const y = c.y + h * i / n, y0 = c.y + h * (i - 1) / n;
    kit.box(M.steel, w, 0.15, d, c.x, y, c.z);                                           // 참
    const s = i % 2 ? 1 : -1;
    kit.beam(M.steel, V(c.x - s * hx * 0.8, y0, c.z - hz * 0.45), V(c.x + s * hx * 0.8, y, c.z - hz * 0.45), 0.9, 0.15); // 계단 판
    handrail(kit, M.accent, V(c.x - hx, y, c.z + hz), V(c.x + hx, y, c.z + hz), 1.1, 3);
    for (const sx of [-1, 1]) kit.beam(M.steel, V(c.x + sx * hx, y0, c.z - hz), V(c.x + sx * hx, y, c.z + hz), 0.12); // 옆면 가새
  }
}

// 아주 가는 철골·난간이 멀리서 사라지지 않도록 너무 가늘게 만들지 않는다(최소 약 0.1m)
export const PROP_COLORS = {
  steel: '#c9c3b4',    // 구조물 도장(바랜 밝은 회색)
  accent: '#d2a12a',   // 버킷휠·안전 도장(노랑)
  dark: '#41464d',     // 기계·바퀴·선회륜
  belt: '#25282c',     // 컨베이어 벨트
  concrete: '#9a9890', // 평형추
  glass: '#2f4656',    // 운전실 창
  rail: '#5d5a55',
  cable: '#6c7076',    // 당김줄
  pipe: '#6f8597',     // 냉각수 배관(트림의 청회색과 맞춤)
  pipe_green: '#2f7a4e', // 냉각 플랜트 배관(녹색 도장)
  motor: '#a5352e',    // 펌프 모터(적색)
  tank: '#3f6f9e',     // 지붕 물탱크(청색)
};

const matCache = new Map();
function mats(c) {
  const key = JSON.stringify(c);
  if (matCache.has(key)) return matCache.get(key);
  const std = (color, rough = 0.85, metal = 0.15) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const M = {
    steel: std(c.steel), accent: std(c.accent, 0.7), dark: std(c.dark, 0.6, 0.4), belt: std(c.belt, 0.95, 0),
    cable: std(c.cable, 0.5, 0.6), concrete: std(c.concrete, 0.95, 0), glass: std(c.glass, 0.2, 0.6), rail: std(c.rail, 0.5, 0.6), pipe: std(c.pipe, 0.6, 0.3),
    pipe_green: std(c.pipe_green, 0.55, 0.3), motor: std(c.motor, 0.5, 0.3), tank: std(c.tank, 0.6, 0.3),
  };
  matCache.set(key, M);
  return M;
}

// ---------------------------------------------------------------------------------------------
// 버킷휠 스태커·리클레이머
// 레일은 Z 방향(궤간 10m), 붐은 +X 방향. 전체 길이 약 75m(평형추 끝 ~ 버킷휠), 높이 약 25m.
// opts.slew: 붐 선회각(라디안, 0이면 +X), opts.luff: 붐 기울기(라디안, 음수면 끝이 내려감)
// opts.tripper: 뒤에 트리퍼 카(야드 컨베이어에서 벨트를 끌어올리는 차)를 붙인다
export function makeReclaimer(opts = {}) {
  const { slew = 0, luff = -0.16, tripper = true, rails = 40, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const base = new Kit(), top = new Kit();
  const G = 10, half = G / 2;

  // ---- 하부: 주행 대차 · 문형 하부 프레임 (선회하지 않음) ----
  if (rails) { rail(base, M.rail, 'z', -half, -rails / 2, rails / 2); rail(base, M.rail, 'z', half, -rails / 2, rails / 2); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * half, z = sz * 4.6;
    base.box(M.dark, 0.9, 1.0, 4.2, x, 1.25, z);            // 균형보
    for (const dz of [-1.45, -0.48, 0.48, 1.45]) {           // 바퀴 4개
      base.rod(M.dark, V(x - 0.25, 0.62, z + dz), V(x + 0.25, 0.62, z + dz), 0.42, 14);
    }
    base.box(M.steel, 1.1, 0.5, 1.4, x, 1.95, z);           // 핀 받침
    base.beam(M.steel, V(x, 2.2, z), V(x * 0.62, 5.0, z * 0.62), 0.9); // 기울어진 다리
  }
  for (const sx of [-1, 1]) base.box(M.steel, 1.0, 1.4, 7.2, sx * half * 0.62, 5.2, 0); // 세로 거더
  for (const sz of [-1, 1]) base.box(M.steel, 7.2, 1.4, 1.0, 0, 5.2, sz * 2.85);       // 가로 거더
  base.add(M.steel, new THREE.CylinderGeometry(2.6, 3.0, 1.2, 24), new THREE.Matrix4().makeTranslation(0, 5.9, 0)); // 중앙 받침
  base.add(M.dark, new THREE.CylinderGeometry(3.3, 3.3, 0.5, 32), new THREE.Matrix4().makeTranslation(0, 6.75, 0)); // 선회륜
  base.box(M.steel, 9.2, 0.12, 1.0, 0, 4.4, 4.0);                                     // 하부 점검 발판
  handrail(base, M.accent, V(-4.2, 4.45, 4.45), V(4.2, 4.45, 4.45), 1.05, 2);

  // ---- 상부: 선회체 (붐·마스트·평형추) ----
  const deckY = 7.0;
  top.box(M.steel, 9.0, 1.2, 7.0, -0.5, deckY + 0.6, 0);                  // 선회 프레임
  top.boxT(V(-3.0, deckY + 1.2, 0), 6.0, 3.6, 5.6, 'cladding', null);     // 기계실(트림 외장)
  top.box(M.dark, 6.4, 0.25, 6.0, -3.0, deckY + 4.9, 0);                  // 기계실 지붕
  top.box(M.steel, 2.2, 2.2, 2.2, 0.8, deckY + 2.3, -2.6);               // 중앙 슈트 호퍼

  // 마스트(A자 기둥): 두 다리가 꼭대기에서 만난다
  const apex = V(-1.5, 25.5, 0);
  for (const sz of [-1, 1]) {
    const foot = V(0.8, deckY + 1.2, sz * 2.8), footB = V(-3.8, deckY + 1.2, sz * 2.8);
    top.beam(M.steel, foot, apex.clone().add(V(0, 0, sz * 0.5)), 0.8);
    top.beam(M.steel, footB, apex.clone().add(V(0, 0, sz * 0.5)), 0.7);
    for (let t = 0.25; t < 0.9; t += 0.22) top.beam(M.steel, foot.clone().lerp(apex, t), footB.clone().lerp(apex, t + 0.1), 0.22); // 다리 사이 가새
  }
  for (let t = 0.3; t < 1; t += 0.3) top.beam(M.steel, V(0.8, deckY + 1.2, -2.8).lerp(apex, t), V(0.8, deckY + 1.2, 2.8).lerp(apex, t), 0.25);
  top.box(M.dark, 1.4, 1.2, 2.0, apex.x, apex.y + 0.3, 0);                // 꼭대기 도르래 블록

  // 붐: 선회 프레임 앞쪽에서 기울어지게 뻗는다
  const pivot = V(2.6, deckY + 3.2, 0);
  const bdir = V(Math.cos(luff), Math.sin(luff), 0);
  const boom = truss(top, M.steel, pivot, bdir, Y, 44, { w0: 3.2, w1: 2.4, h0: 3.4, h1: 2.0, bay: 2.9, chord: 0.38, web: 0.17, deck: true });
  const bAt = (t, s = 0, h = 0) => boom.at(t, s, h);
  for (let i = 0; i < 30; i++) { // 붐 위 컨베이어 롤러
    const p = bAt((i + 0.5) / 30);
    top.beam(M.dark, p.clone().addScaledVector(boom.side, -0.75).addScaledVector(boom.v, 0.35), p.clone().addScaledVector(boom.side, 0.75).addScaledVector(boom.v, 0.35), 0.14);
  }
  {
    const a = bAt(0.02).addScaledVector(boom.v, 0.48), b = bAt(0.97).addScaledVector(boom.v, 0.48);
    const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), boom.u);
    top.add(M.belt, new THREE.BoxGeometry(a.distanceTo(b), 0.08, 1.4), new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, V(1, 1, 1)));          // 벨트
    top.add(M.steel, new THREE.BoxGeometry(a.distanceTo(b), 0.08, 2.4), new THREE.Matrix4().compose(bAt(0.5).addScaledVector(boom.v, 0.05), q, V(1, 1, 1))); // 바닥판
    const wa = bAt(0, 1).addScaledVector(boom.side, 0.6), wb = bAt(0.95, 1).addScaledVector(boom.side, 0.6); // 점검 통로(붐 바깥 +side 쪽)
    top.add(M.steel, new THREE.BoxGeometry(wa.distanceTo(wb), 0.08, 0.9), new THREE.Matrix4().compose(wa.clone().lerp(wb, 0.5), q, V(1, 1, 1)));
    handrail(top, M.accent, wa.clone().addScaledVector(boom.side, 0.4), wb.clone().addScaledVector(boom.side, 0.4), 1.1, 1.9);
  }

  // 버킷휠: 붐 끝 옆(+side)에 붙고, 축은 붐에 수직인 수평 방향
  const tip = bAt(1, 0, 0.5);
  const wheelR = 3.8, wheelC = tip.clone().addScaledVector(boom.u, 1.6).addScaledVector(boom.side, 2.3).add(V(0, -0.2, 0));
  const wheel = new Kit();
  { // 휠은 자기 좌표(축 = Z)로 만든 뒤 붐 방향에 맞춰 돌린다
    for (const z of [-0.6, 0.6]) wheel.add(M.accent, new THREE.TorusGeometry(wheelR - 0.6, 0.22, 8, 36), new THREE.Matrix4().makeTranslation(0, 0, z)); // 림 2줄
    wheel.add(M.dark, new THREE.CylinderGeometry(0.9, 0.9, 1.8, 16), new THREE.Matrix4().makeRotationX(Math.PI / 2)); // 허브
    const NB = 10;
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * Math.PI * 2, dir = V(Math.cos(a), Math.sin(a), 0);
      for (const z of [-0.6, 0.6]) wheel.beam(M.accent, V(0, 0, z * 0.6), dir.clone().multiplyScalar(wheelR - 0.6).setZ(z), 0.28); // 바퀴살
      // 버킷: 림 바깥에 붙은 통, 입구가 회전 방향(접선)을 향한다
      const tang = V(-Math.sin(a), Math.cos(a), 0);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tang, dir, V(0, 0, 1)));
      const c = dir.clone().multiplyScalar(wheelR - 0.1);
      wheel.add(M.accent, new THREE.BoxGeometry(1.1, 1.1, 1.6), new THREE.Matrix4().compose(c, q, V(1, 1, 1)));
      wheel.add(M.dark, new THREE.BoxGeometry(0.15, 1.15, 1.7), new THREE.Matrix4().compose(c.clone().addScaledVector(tang, 0.6), q, V(1, 1, 1))); // 입구 날
      for (const tz of [-0.55, 0, 0.55]) wheel.add(M.dark, new THREE.BoxGeometry(0.35, 0.18, 0.16), new THREE.Matrix4().compose(c.clone().addScaledVector(tang, 0.75).addScaledVector(dir, 0.55).setZ(tz), q, V(1, 1, 1))); // 이빨
    }
  }
  const wheelG = wheel.build('bucket_wheel');
  const up = V(0, 1, 0).sub(boom.u.clone().multiplyScalar(boom.u.y)).normalize();
  wheelG.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(boom.u, up, new THREE.Vector3().crossVectors(boom.u, up))); // 오른손 좌표계(축 Z = 붐 옆 방향)
  wheelG.position.copy(wheelC);
  // 휠 축·구동장치(감속기 + 모터)와 붐 끝 받침
  top.rod(M.dark, wheelC.clone().addScaledVector(boom.side, -2.6), wheelC.clone().addScaledVector(boom.side, 0.9), 0.35, 12);
  {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(boom.u, boom.v, new THREE.Vector3().crossVectors(boom.u, boom.v)));
    const gb = wheelC.clone().addScaledVector(boom.side, -2.4);
    top.add(M.dark, new THREE.BoxGeometry(2.2, 2.0, 1.2), new THREE.Matrix4().compose(gb, q, V(1, 1, 1)));
    top.add(M.dark, new THREE.CylinderGeometry(0.5, 0.5, 1.8, 12), new THREE.Matrix4().compose(gb.clone().addScaledVector(boom.u, -1.8).addScaledVector(boom.side, -0.2), new THREE.Quaternion().setFromUnitVectors(Y, boom.u), V(1, 1, 1)));
    top.beam(M.steel, bAt(0.94, 1, 0), wheelC.clone().addScaledVector(boom.side, -0.9), 0.5);
    top.beam(M.steel, bAt(0.94, 1, 1), wheelC.clone().addScaledVector(boom.side, -0.9), 0.4);
    top.add(M.steel, new THREE.BoxGeometry(1.6, 1.4, 1.6), new THREE.Matrix4().compose(bAt(0.985, 0, 1.3), q, V(1, 1, 1))); // 휠 → 벨트 슈트
  }

  // 운전실: 붐 바깥쪽, 끝에서 약 1/4 지점 아래에 매달림
  {
    const c = bAt(0.72, 1, 0).addScaledVector(boom.side, 1.9).add(V(0, -1.0, 0));
    const q = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(-boom.u.z, boom.u.x));
    top.add(M.steel, new THREE.BoxGeometry(2.6, 2.4, 2.4), new THREE.Matrix4().compose(c, q, V(1, 1, 1)));
    top.add(M.glass, new THREE.BoxGeometry(2.66, 1.0, 2.46), new THREE.Matrix4().compose(c.clone().add(V(0, 0.35, 0)), q, V(1, 1, 1)));
    top.add(M.dark, new THREE.BoxGeometry(2.9, 0.18, 2.7), new THREE.Matrix4().compose(c.clone().add(V(0, 1.3, 0)), q, V(1, 1, 1)));
    top.beam(M.steel, c.clone().add(V(0, 1.2, 0)), bAt(0.72, 1, 0), 0.25);
  }

  // 평형추 붐(뒤로 뻗는 짧은 트러스) + 콘크리트 평형추
  const cw = truss(top, M.steel, V(-4.0, deckY + 1.4, 0), V(-Math.cos(0.12), Math.sin(0.12), 0), Y, 17, { w0: 3.6, w1: 3.0, h0: 3.0, h1: 2.4, bay: 2.8, chord: 0.36, web: 0.17 });
  const cwEnd = cw.at(1, 0, 0.3);
  top.boxT(V(cwEnd.x - 1.2, cwEnd.y - 3.3, 0), 4.5, 4.2, 5.2, 'concrete_dark', 'basin');
  // 당김줄(마스트 꼭대기 → 붐 중간·끝, 평형추 끝): 좌우 2줄씩
  for (const sz of [-1, 1]) {
    const a = apex.clone().add(V(0, 0, sz * 0.5));
    top.rod(M.cable, a, bAt(0.55, sz, 1), 0.09, 6);
    top.rod(M.cable, a, bAt(0.88, sz, 1), 0.09, 6);
    top.rod(M.cable, a, cw.at(1, sz, 1), 0.11, 6);
  }

  const upper = top.build('slewing_upper');
  upper.add(wheelG);
  const pivotG = new THREE.Group(); pivotG.name = 'slew'; pivotG.rotation.y = slew; pivotG.add(upper);
  const g = new THREE.Group(); g.name = 'stacker_reclaimer';
  g.add(base.build('undercarriage'), pivotG);
  g.userData.wheel = wheelG; g.userData.slew = pivotG; // 애니메이션용(휠 회전·선회)

  // 트리퍼 카: 레일 옆(-X) 야드 컨베이어의 벨트를 비스듬히 끌어올려 선회 중심 슈트로 넘긴다
  if (tripper) {
    const t = new Kit(), yx = -half - 3.2, RL = rails || 40;
    t.box(M.belt, 1.2, 0.08, RL, yx, 1.1, 0);                                       // 야드 컨베이어 벨트
    for (let z = -RL / 2 + 1; z < RL / 2; z += 3) {                                  // 받침 다리
      t.box(M.steel, 2.0, 0.15, 0.15, yx, 0.95, z);
      for (const s of [-1, 1]) t.box(M.steel, 0.12, 0.95, 0.12, yx + s * 0.9, 0.47, z);
    }
    const tr = truss(t, M.steel, V(yx, 1.2, -22), V(0, 9.6, 15).normalize(), Y, Math.hypot(9.6, 15), { w0: 2.0, h0: 1.6, bay: 2.6, chord: 0.3, web: 0.14 });
    const head = tr.at(1, 0, 0.8);
    t.box(M.steel, 2.6, 2.2, 3.0, head.x, head.y, head.z + 0.6);                     // 머리 풀리 하우스
    t.beam(M.steel, V(head.x, head.y - 0.6, head.z + 1.8), V(-1.0, deckY + 3.6, -2.6), 1.0); // 중앙 호퍼로 넘기는 이송 슈트
    for (const [tz, h] of [[-19, 3.0], [-12, 7.0]]) {                                // 트리퍼 다리 + 바퀴
      for (const s of [-1, 1]) t.beam(M.steel, V(yx + s * 1.0, 0.8, tz), V(yx + s * 0.9, h, tz), 0.35);
      t.box(M.dark, 2.6, 0.6, 1.6, yx, 0.6, tz);
    }
    g.add(t.build('tripper_car'));
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// 기계통풍식 냉각탑(사각 셀형). 셀이 X 방향으로 줄지어 있다. 셀 하나 12m, 기본 4칸 → 약 50 × 15m, 높이 약 15m.
// 아래쪽 긴 면은 공기가 들어가는 루버, 위는 외장 패널, 지붕 위 셀마다 팬 원통. 한쪽 끝에 계단탑, 뒷면에 냉각수 배관.
export function makeCoolingTower(opts = {}) {
  const { cells = 4, cell = 12, depth = 13, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const k = new Kit();
  const L = cells * cell, hx = L / 2, hz = depth / 2;
  const basinH = 1.4, inletH = 4.5, bodyH = 10.5, deckY = basinH + bodyH;

  k.boxT(V(0, 0, 0), L + 2.4, basinH, depth + 2.4, 'basin', 'basin');                      // 콘크리트 수조
  // 몸체: 긴 면은 아래 루버 + 위 외장, 짧은 면은 외장 전체
  for (const [z, U] of [[hz, V(1, 0, 0)], [-hz, V(-1, 0, 0)]]) {
    const o = V(-U.x * hx, basinH, z);
    k.quad('louver', o, U, Y, L, inletH);
    k.quad('cladding', o.clone().add(V(0, inletH, 0)), U, Y, L, bodyH - inletH);
  }
  for (const [x, U] of [[hx, V(0, 0, -1)], [-hx, V(0, 0, 1)]]) k.quad('cladding', V(x, basinH, -U.z * hz), U, Y, depth, bodyH);
  // 셀 경계 기둥(바깥으로 조금 튀어나와 면을 나눔)
  for (let i = 0; i <= cells; i++) for (const z of [hz, -hz]) {
    const x = -hx + i * cell;
    k.boxT(V(x, basinH, z), 0.6, bodyH, 0.5, 'steel_panel', null);
  }
  // 팬 데크(지붕) + 테두리
  k.boxT(V(0, deckY, 0), L + 0.6, 0.45, depth + 0.6, 'curb', 'basin');
  // 셀마다 팬 원통(위로 살짝 벌어짐) + 안쪽 팬
  for (let i = 0; i < cells; i++) {
    const cx = -hx + cell * (i + 0.5), c = V(cx, deckY + 0.45, 0);
    k.cylT('cladding', c, 4.6, 5.0, 3.4, 28, { rows: 1 });
    k.add(M.dark, new THREE.CylinderGeometry(4.5, 4.5, 0.15, 28), new THREE.Matrix4().makeTranslation(cx, deckY + 1.6, 0)); // 팬 아래 어두운 바닥
    k.add(M.dark, new THREE.CylinderGeometry(0.5, 0.6, 0.8, 12), new THREE.Matrix4().makeTranslation(cx, deckY + 2.0, 0));   // 허브
    for (let b = 0; b < 6; b++) { // 날개
      const a = b / 6 * Math.PI * 2 + i;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -a, 0, 'YXZ'));
      k.add(M.dark, new THREE.BoxGeometry(4.0, 0.08, 0.7), new THREE.Matrix4().compose(V(cx + Math.cos(a) * 2.3, deckY + 2.1, -Math.sin(a) * 2.3), q, V(1, 1, 1)));
    }
    k.add(M.steel, new THREE.TorusGeometry(5.0, 0.08, 6, 28), new THREE.Matrix4().compose(V(cx, deckY + 3.85, 0), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2), V(1, 1, 1))); // 원통 테두리
  }
  // 지붕 둘레 난간
  const ry = deckY + 0.45;
  handrail(k, M.accent, V(-hx, ry, hz + 0.2), V(hx, ry, hz + 0.2), 1.1, 2.4);
  handrail(k, M.accent, V(-hx, ry, -hz - 0.2), V(hx, ry, -hz - 0.2), 1.1, 2.4);
  handrail(k, M.accent, V(-hx, ry, -hz), V(-hx, ry, hz), 1.1, 2.6);
  handrail(k, M.accent, V(hx, ry, -hz), V(hx, ry, hz), 1.1, 2.6);
  // 계단탑(+X 끝)
  stairTower(k, M, V(hx + 2.4, 0, hz - 3.0), 3.4, 4.0, deckY + 0.45, 3.2);
  // 냉각수 배관: 뒷면(-z)을 따라 가는 큰 헤더 + 셀마다 올라가는 입상관
  const pz = -hz - 2.2;
  k.rod(M.pipe, V(-hx - 4, 1.2, pz), V(hx + 1, 1.2, pz), 0.9, 14);
  for (let i = 0; i < cells; i++) {
    const x = -hx + cell * (i + 0.5);
    k.rod(M.pipe, V(x, 1.2, pz), V(x, deckY - 1.0, pz), 0.55, 12);
    k.rod(M.pipe, V(x, deckY - 1.0, pz), V(x, deckY - 1.0, -hz + 0.1), 0.55, 12);
    k.box(M.dark, 1.6, 0.4, 1.6, x, 0.2, pz);                                                  // 배관 받침
  }
  k.boxT(V(-hx - 7, 0, pz), 6, 4, 5, 'cladding', 'basin', { rows: 1 });                        // 펌프 하우스
  const g = k.build('cooling_tower');
  return g;
}

// ---------------------------------------------------------------------------------------------
// 코크스 소화탑. 아래는 소화차가 드나드는 콘크리트 문형(레일은 X 방향), 위는 사각 수증기 통로, 꼭대기에 루버(물방울 거르는 장치).
// 옆에 철골 계단탑과 급수관. 높이 약 48m, 바닥 약 14 × 10m.
export function makeQuenchTower(opts = {}) {
  const { car = true, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const k = new Kit();
  const bx = 14, bz = 10, portalH = 9;

  // 문형 아래부: 두 옆벽(레일 방향 X로 뚫림) + 위 슬래브
  for (const z of [bz / 2 - 0.7, -bz / 2 + 0.7]) k.boxT(V(0, 0, z), bx, portalH, 1.4, 'concrete_dark', null);
  k.boxT(V(0, portalH, 0), bx + 0.4, 1.6, bz + 0.4, 'concrete', 'basin', { rows: 1 });
  k.add(M.dark, new THREE.BoxGeometry(bx - 0.2, 0.2, bz - 2.8), new THREE.Matrix4().makeTranslation(0, portalH - 0.1, 0)); // 천장(어두운 안쪽)
  // 수증기 통로(콘크리트) → 위쪽 강판 실 → 꼭대기 루버
  const sx = 11, sz = 8, y0 = portalH + 1.6;
  k.boxT(V(0, y0, 0), sx, 20, sz, 'concrete', null);
  k.boxT(V(0, y0 + 20, 0), sx + 0.8, 0.6, sz + 0.8, 'curb', null, { rows: 1 });            // 띠
  k.boxT(V(0, y0 + 20.6, 0), sx + 0.6, 10, sz + 0.6, 'steel_panel', null);
  k.boxT(V(0, y0 + 30.6, 0), sx + 0.6, 4.5, sz + 0.6, 'louver', null);
  k.boxT(V(0, y0 + 35.1, 0), sx + 1.2, 0.6, sz + 1.2, 'curb', null, { rows: 1 });          // 꼭대기 테두리
  k.add(M.dark, new THREE.BoxGeometry(sx + 0.2, 0.2, sz + 0.2), new THREE.Matrix4().makeTranslation(0, y0 + 35.0, 0)); // 열린 꼭대기 안쪽
  for (let i = -2; i <= 2; i++) k.box(M.steel, 0.25, 0.8, sz, i * 2.0, y0 + 35.4, 0);     // 꼭대기 배플 보
  // 모서리 보강 기둥(통로 네 귀)
  for (const ax of [-1, 1]) for (const az of [-1, 1]) k.boxT(V(ax * (sx / 2), y0, az * (sz / 2)), 0.8, 30.6, 0.8, 'concrete', null);
  // 계단탑(+Z 옆, 열린 철골)
  stairTower(k, M, V(0, 0, bz / 2 + 2.6), 4.0, 3.6, y0 + 30, 3.6);
  // 급수관: 바닥에서 통로 위쪽 분사 노즐 높이까지
  k.rod(M.pipe, V(-bx / 2 + 1, 0.5, -bz / 2 - 1.2), V(-bx / 2 + 1, y0 + 24, -bz / 2 - 1.2), 0.45, 12);
  k.rod(M.pipe, V(-bx / 2 + 1, y0 + 24, -bz / 2 - 1.2), V(-bx / 2 + 1, y0 + 24, -sz / 2), 0.45, 12);
  k.boxT(V(-bx / 2 - 3, 0, -bz / 2 - 4), 7, 4.5, 5, 'cladding', 'basin', { rows: 1 });     // 펌프실
  // 레일(X 방향) + 소화차
  rail(k, M.rail, 'x', -0.75, -40, 25); rail(k, M.rail, 'x', 0.75, -40, 25);
  if (car) {
    const cx = -16;
    k.boxT(V(cx, 1.4, 0), 12, 3.2, 3.6, 'steel_panel', null, { rows: 1 });               // 차체(위가 열린 통)
    k.add(M.dark, new THREE.BoxGeometry(11.6, 0.2, 3.2), new THREE.Matrix4().makeTranslation(cx, 4.3, 0));   // 안쪽 코크스
    for (const dx of [-4.2, 4.2]) { k.box(M.dark, 2.6, 0.9, 2.2, cx + dx, 0.95, 0); for (const s of [-1, 1]) k.rod(M.dark, V(cx + dx + s * 0.8, 0.5, -1.0), V(cx + dx + s * 0.8, 0.5, 1.0), 0.45, 12); } // 대차·바퀴
    for (let i = -2; i <= 2; i++) k.box(M.dark, 0.18, 3.2, 3.7, cx + i * 2.4, 3.0, 0);    // 옆판 보강대
  }
  return k.build('coke_quench_tower');
}

// ---------------------------------------------------------------------------------------------
// 냉각수 펌프장(냉각 플랜트). 긴 상자형 건물(X 방향) + 옆면 녹색 입상관 + 한쪽 끝 펌프 3대 + 계단탑 + 지붕 환기팬·물탱크.
// 약 48 × 11m, 높이 약 9m(콘크리트 기초 포함).
export function makeCoolingPlant(opts = {}) {
  const { L = 48, D = 11, H = 8.4, risers = 7, pumps = 3, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const k = new Kit();
  const hx = L / 2, hz = D / 2, base = 0.6, top = base + H;

  k.boxT(V(0, 0, 0), L + 6, base, D + 5, 'basin', 'basin', { rows: 1 });        // 기초(펌프 쪽 +X로 길게)
  k.boxT(V(0, base, 0), L, H, D, ['wall_gray', 'louver', 'wall_gray', 'wall_gray'], 'roof_gray'); // 앞(+z)·끝(+x 청색 루버)·뒤·끝
  k.boxT(V(0, top, 0), L + 0.4, 0.5, D + 0.4, 'curb', null, { rows: 1 });       // 지붕 테두리(파라펫)
  k.box(M.dark, 5.0, 4.6, 0.1, -hx + 8, base + 2.3, hz + 0.05);                 // 앞면 셔터
  k.box(M.dark, 1.1, 2.2, 0.1, -hx + 14, base + 1.1, hz + 0.05);                // 출입문
  for (let i = 0; i < 6; i++) k.box(M.glass, 2.2, 0.8, 0.08, -hx + 20 + i * 4.2, base + 6.2, hz + 0.04); // 위쪽 창 띠

  // 지붕: 환기팬 4개 + 환기 후드 2개 + 물탱크
  for (let i = 0; i < 4; i++) {
    const x = -hx + 7 + i * 9;
    k.cylT('wall_gray', V(x, top + 0.5, -1.5), 1.3, 1.3, 1.4, 16, { rows: 1 });
    k.add(M.dark, new THREE.CylinderGeometry(1.35, 1.35, 0.15, 16), new THREE.Matrix4().makeTranslation(x, top + 1.95, -1.5));
  }
  for (const x of [-hx + 12, -hx + 30]) k.boxT(V(x, top + 0.5, 2.5), 2.6, 1.2, 1.8, 'steel_panel', 'roof_gray', { rows: 1 });
  k.add(M.tank, new THREE.CylinderGeometry(1.8, 1.8, 2.6, 20), new THREE.Matrix4().makeTranslation(hx - 5, top + 1.8, 2.2));
  handrail(k, M.accent, V(hx - 10, top + 0.5, hz), V(hx, top + 0.5, hz), 1.1, 2);

  // 옆면(-z) 녹색 배관: 바닥 헤더 + 입상관(벽 속으로 꺾여 들어감)
  const pz = -hz - 1.6;
  k.rod(M.pipe_green, V(-hx + 2, base + 0.9, pz), V(hx + 2, base + 0.9, pz), 0.6, 14);
  for (let i = 0; i < risers; i++) {
    const x = -hx + 5 + i * (L - 10) / (risers - 1), yTop = base + 5.0;
    k.rod(M.pipe_green, V(x, base + 0.9, pz), V(x, yTop, pz), 0.42, 12);
    elbow(k, M.pipe_green, V(x, yTop, pz), 0.42, 0.9, 'z');
    k.rod(M.pipe_green, V(x, yTop + 0.9, pz + 0.9), V(x, yTop + 0.9, -hz), 0.42, 12);
    k.box(M.dark, 1.2, 0.3, 0.3, x, base + 1.7, pz);                              // 배관 지지대
  }

  // +X 끝: 수직 펌프 3대(아래 케이싱 + 위 적색 모터). 녹색 흡입관이 바닥에서 올라와 엘보로 꺾여 케이싱에 들어가고, 토출관은 건물로 간다
  for (let i = 0; i < pumps; i++) {
    const z = (i - (pumps - 1) / 2) * 3.0, x = hx + 2.2, y = base + 0.8;
    k.box(M.dark, 2.0, 0.3, 1.8, x, base + 0.15, z);                               // 받침
    k.box(M.steel, 1.2, 1.1, 1.2, x, y, z);                                         // 펌프 케이싱
    k.rod(M.motor, V(x, y + 0.55, z), V(x, y + 2.3, z), 0.55, 14);                  // 모터
    k.add(M.dark, new THREE.CylinderGeometry(0.6, 0.6, 0.15, 14), new THREE.Matrix4().makeTranslation(x, y + 2.35, z)); // 모터 덮개
    k.rod(M.pipe_green, V(x - 0.6, y, z), V(hx + 0.05, y, z), 0.4, 12);             // 토출관(건물로)
    elbow(k, M.pipe_green, V(x + 1.5, y - 0.9, z), 0.42, 0.9, 'x');                 // 흡입 엘보(바닥에서 올라와 -X로)
  }
  stairTower(k, M, V(hx + 1.8, 0, -hz + 1.6), 3.0, 3.0, top + 0.5, 3.0);       // 지붕 오르는 계단

  return k.build('cooling_plant');
}

// 90° 배관 엘보: c에서 위로 올라가던 관이 반지름 rb로 꺾여 수평으로 나간다. dir 'x'면 -X 쪽, 'z'면 +Z 쪽으로 나간다
function elbow(kit, mat, c, r, rb, dir) {
  // 토러스 호(XY 평면, (rb,0)→(0,rb))를 -rb만큼 옮기면 원점에서 위로 출발해 (-rb, rb)에서 -X로 나간다
  const m = new THREE.Matrix4().makeTranslation(-rb, 0, 0);
  if (dir === 'z') m.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)); // -X → +Z
  m.premultiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
  kit.add(mat, new THREE.TorusGeometry(rb, r, 8, 10, Math.PI / 2), m);
}

// ---------------------------------------------------------------------------------------------
// 원료 야적더미: 길게 쌓은 더미(가운데 선분에서 멀어질수록 낮아지는 지붕꼴, 양 끝은 원뿔). X 방향으로 L, 폭 W, 높이 H(m).
// kind: 'ore'(철광석), 'coal'(석탄), 'lime'(석회석). 꼭짓점마다 높이·색을 조금씩 흔들어 자연스럽게 한다.
const PILE_COLORS = { ore: '#7b4e3a', coal: '#2e2f33', lime: '#b8b2a5' };
export function makeStockpile(opts = {}) {
  const { L = 200, W = 36, H = 14, kind = 'ore', seed = 11 } = opts;
  const r = rng(seed), half = W / 2, tot = L + W;
  const nx = Math.max(8, Math.round(tot / 5)), nz = 14;
  const g = new THREE.PlaneGeometry(tot, W, nx, nz); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = [], base = new THREE.Color(PILE_COLORS[kind] || kind), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dx = Math.max(0, Math.abs(x) - L / 2), d = Math.hypot(dx, z) / half; // 가운데 선분까지 거리(폭의 반 = 1)
    let h = Math.max(0, 1 - d) * H;
    if (h > H * 0.9) h = H * 0.9 + (h - H * 0.9) * 0.4;                         // 꼭대기를 조금 둥글게
    if (h > 0) h += (r() - 0.5) * H * 0.06;
    pos.setY(i, Math.max(0, h));
    const k = 0.88 + r() * 0.2 + (h / H) * 0.06;
    c.copy(base).multiplyScalar(k); col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'stockpile_' + kind;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// 배관 랙. 문형 프레임(H형강 기둥 2개 + 단마다 가로보)을 bay 간격으로 세우고, 단마다 굵기·색이 다른 배관을 X 방향으로 건다.
// 직선 모듈은 X 방향 길이 L(가운데 원점), 코너 모듈은 makePipeRackCorner. 둘은 같은 PIPE_LEVELS를 써서 배관 위치가 이어진다.
const PIPE_GRAY = '#c3c8ce', PIPE_BLUE = '#7aa4c8', PIPE_GREEN = '#7fb08a', PIPE_YELLOW = '#e2c25a', PIPE_RED = '#c97a6c', PIPE_DARK = '#8a8f96';
export const PIPE_LEVELS = [ // 단 높이(m)와 배관(반지름 m, 색) — 폭 W 안에 한쪽부터 차례로
  { y: 4.5, pipes: [[0.45, PIPE_GRAY], [0.35, PIPE_BLUE], [0.3, PIPE_GREEN], [0.25, PIPE_GRAY], [0.16, PIPE_YELLOW], [0.4, PIPE_DARK]] },
  { y: 7.5, pipes: [[0.6, PIPE_GRAY], [0.3, PIPE_RED], [0.25, PIPE_GRAY], [0.35, PIPE_BLUE]] },
];
function pipeSlots(W, pipes) { // 배관 중심 z(폭 방향) 계산
  let z = -W / 2 + 0.35; const out = [];
  for (const [r, tint] of pipes) { z += r; if (z + r > W / 2 - 0.2) break; out.push({ z, r, tint }); z += r + 0.28; }
  return out;
}
function rackColumn(k, x, z, colH) { // 기초 + H형강 기둥
  k.boxT(V(x, 0, z), 0.9, 0.45, 0.9, 'concrete', 'basin', { rows: 1 });
  k.boxT(V(x, 0.45, z), 0.36, colH - 0.45, 0.36, 'beam', null, { vertical: true });
}
function rackFrame(k, M, x, W, levels, colH) { // 한 줄 프레임: 기둥 2개 + 단마다 가로보 + 무릎 가새
  for (const z of [-W / 2, W / 2]) rackColumn(k, x, z, colH);
  for (const lv of levels) {
    k.boxT(V(x, lv.y - 0.42, 0), 0.36, 0.42, W + 0.5, 'beam', 'beam', { rows: 1 });
    for (const s of [-1, 1]) k.beam(M.dark, V(x, lv.y - 1.4, s * W / 2), V(x, lv.y - 0.42, s * (W / 2 - 1.0)), 0.14);
  }
}
function rackPipes(k, M, x0, x1, W, levels, frames) { // 단마다 배관 + 받침(슈) + 플랜지
  for (const lv of levels) for (const p of pipeSlots(W, lv.pipes)) {
    const y = lv.y + p.r + 0.08;
    k.tubeT(V(x0, y, p.z), V(x1, y, p.z), p.r, { tint: p.tint, seg: p.r > 0.3 ? 14 : 10 });
    for (const fx of frames) k.box(M.dark, 0.3, 0.08, p.r * 1.4, fx, lv.y + 0.04, p.z);
    for (let fx = x0 + 6; fx < x1 - 1; fx += 12) k.add(M.dark, new THREE.TorusGeometry(p.r + 0.04, 0.05, 6, 14), new THREE.Matrix4().compose(V(fx, y, p.z), new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2), V(1, 1, 1)));
  }
}
export function makePipeRack(opts = {}) {
  const { L = 36, bay = 6, W = 6, levels = PIPE_LEVELS, walkway = true, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const k = new Kit(), n = Math.max(1, Math.round(L / bay)), colH = levels[levels.length - 1].y + 0.2;
  const frames = []; for (let i = 0; i <= n; i++) frames.push(-L / 2 + i * L / n);
  frames.forEach(x => rackFrame(k, M, x, W, levels, colH));
  for (const lv of levels) for (const z of [-W / 2, W / 2]) k.boxT(V(0, lv.y - 0.3, z), L, 0.3, 0.24, 'beam', 'beam', { rows: 1 }); // 세로보(길이 방향)
  const mid = Math.floor(n / 2), xa = frames[mid], xb = frames[Math.min(n, mid + 1)]; // 가운데 칸 길이 방향 X자 가새
  for (const z of [-W / 2, W / 2]) { k.beam(M.dark, V(xa, 0.5, z), V(xb, levels[0].y - 0.4, z), 0.14); k.beam(M.dark, V(xb, 0.5, z), V(xa, levels[0].y - 0.4, z), 0.14); }
  rackPipes(k, M, -L / 2, L / 2, W, levels, frames);
  if (walkway) { // 위 단 바깥(+z)으로 점검 통로(그레이팅) + 난간
    const y = levels[levels.length - 1].y - 0.3;
    k.quad('grating', V(-L / 2, y, W / 2 + 1.0), V(1, 0, 0), V(0, 0, -1), L, 1.0, { rows: 1 });
    handrail(k, M.accent, V(-L / 2, y, W / 2 + 1.0), V(L / 2, y, W / 2 + 1.0), 1.1, 2);
    frames.forEach(x => k.beam(M.dark, V(x, y, W / 2), V(x, y, W / 2 + 1.0), 0.12));
  }
  return k.build('pipe_rack');
}
// 코너 모듈: -X에서 들어온 배관이 +Z로 90° 꺾인다(같은 중심을 도는 엘보). 들어오는 쪽 끝 x = 0, 나가는 쪽 끝 z = W/2 + 1 + W.
// 직선 모듈(길이 L) 잇기: 들어오는 모듈 중심 (-L/2, 0), 나가는 모듈 중심 (W/2 + 1, W/2 + 1 + W + L/2) + Y축 -90° 회전.
export function makePipeRackCorner(opts = {}) {
  const { W = 6, levels = PIPE_LEVELS, colors = {} } = opts;
  const M = mats({ ...PROP_COLORS, ...colors });
  const k = new Kit(), colH = levels[levels.length - 1].y + 0.2, Cz = W / 2 + 1, X1 = W + 1, Z1 = Cz + W;
  // 꺾이는 곳을 둘러싼 기둥(정사각 네 귀 + 나가는 쪽 끝 2개)
  for (const [x, z] of [[0, -W / 2], [X1, -W / 2], [0, Cz], [X1, Cz], [0.5, Z1], [X1 + 0.5, Z1]]) rackColumn(k, x, z, colH);
  for (const lv of levels) {
    const y = lv.y - 0.42;
    k.boxT(V(0, y, (Cz - W / 2) / 2), 0.36, 0.42, Cz + W / 2 + 0.4, 'beam', 'beam', { rows: 1 });       // 들어오는 쪽 가로보
    k.boxT(V(X1 / 2 + 0.25, y, Z1), X1 + 0.9, 0.42, 0.36, 'beam', 'beam', { rows: 1 });               // 나가는 쪽 가로보
    k.boxT(V(X1 / 2, y, -W / 2), X1 + 0.4, 0.42, 0.3, 'beam', 'beam', { rows: 1 });                   // 바깥 테두리 보
    k.boxT(V(X1, y, (Cz - W / 2) / 2), 0.3, 0.42, Cz + W / 2 + 0.4, 'beam', 'beam', { rows: 1 });
  }
  // 엘보: 로컬 호 (rb,0,0)→(0,rb,0)을 시작은 (0,0,-1) 쪽, 끝은 (1,0,0) 쪽으로 돌린다(진행 방향 +X → +Z)
  const basis = [V(0, 0, -1), V(1, 0, 0), V(0, -1, 0)];
  for (const lv of levels) for (const p of pipeSlots(W, lv.pipes)) {
    const y = lv.y + p.r + 0.08, rb = Cz - p.z;
    k.elbowT(V(0, y, Cz), basis, rb, p.r, { tint: p.tint });
    k.tubeT(V(rb, y, Cz), V(rb, y, Z1), p.r, { tint: p.tint, seg: p.r > 0.3 ? 14 : 10 });       // 나가는 쪽 짧은 관(다음 모듈까지)
    k.box(M.dark, p.r * 1.4, 0.08, 0.3, rb, lv.y + 0.04, Z1);
  }
  return k.build('pipe_rack_corner');
}

// ---------------------------------------------------------------------------------------------
// 코일 야드: 열연 코일(바깥지름 D, 안지름 Din, 폭 Wc)을 눈(구멍)이 수평이 되게 눕혀 줄지어 놓고, 2단은 아래 두 코일 사이 골에 얹는다.
// 코일 축은 Z, 한 줄은 X 방향. 옆면·끝면은 트림(끝면은 극좌표 UV로 동심원), 안쪽 구멍·결속 밴드는 어두운 재질. 모두 InstancedMesh.
let coilGeos = null, coilDark = null;
function coilGeometries(D, Din, Wc) {
  if (coilGeos) return coilGeos;
  const R = D / 2, Ri = Din / 2, seg = 28;
  const side = toStrip(new THREE.CylinderGeometry(R, R, Wc, seg, 1, true), 'coil_side', Math.PI * D); side.rotateX(Math.PI / 2);
  const face = new THREE.RingGeometry(Ri, R, seg, 1), t = stripV('coil_face'), uv = face.attributes.uv;
  for (let i = 0; i < uv.count; i++) { const a = i % (seg + 1), j = Math.floor(i / (seg + 1)); uv.setXY(i, (a / seg) * Math.PI * (R + Ri) / t.uM, t.v0 + j * (t.v1 - t.v0)); }
  const f1 = face.clone(); f1.translate(0, 0, Wc / 2);
  const f2 = face.clone(); f2.rotateY(Math.PI); f2.translate(0, 0, -Wc / 2);
  const trim = mergeGeometries([side, f1, f2].map(g => g.index ? g.toNonIndexed() : g));
  const bore = new THREE.CylinderGeometry(Ri, Ri, Wc, 16, 1, true); bore.rotateX(Math.PI / 2);
  const bands = [-Wc * 0.3, Wc * 0.3].map(z => { const b = new THREE.TorusGeometry(R + 0.012, 0.03, 4, seg); b.translate(0, 0, z); return b; });
  const dark = mergeGeometries([bore, ...bands].map(g => g.index ? g.toNonIndexed() : g));
  return (coilGeos = { trim, dark });
}
export function makeCoilYard(opts = {}) {
  const { rows = 4, perRow = 10, tiers = 2, D = 1.9, Din = 0.76, Wc = 1.5, rowGap = 0.6, aisleEvery = 2, aisle = 3, seed = 5 } = opts;
  const r = rng(seed), R = D / 2, s = D + 0.15, dy = Math.sqrt(D * D - (s / 2) * (s / 2));
  const { trim, dark } = coilGeometries(D, Din, Wc);
  coilDark ||= new THREE.MeshStandardMaterial({ color: '#3a3e44', roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  const zs = []; let z = 0;
  for (let i = 0; i < rows; i++) { zs.push(z); z += Wc + ((i + 1) % aisleEvery === 0 ? aisle : rowGap); }
  const z0 = zs[zs.length - 1] / 2, list = [];
  zs.forEach(zr => {
    const n1 = perRow - (r() < 0.3 ? 1 : 0);
    for (let j = 0; j < n1; j++) list.push([(j - (perRow - 1) / 2) * s, R + 0.12, zr - z0]);
    if (tiers > 1) for (let j = 0; j < n1 - 1; j++) if (r() < 0.75) list.push([(j + 0.5 - (perRow - 1) / 2) * s, R + 0.12 + dy, zr - z0]);
  });
  const mT = new THREE.InstancedMesh(trim, trimMaterial(), list.length), mD = new THREE.InstancedMesh(dark, coilDark, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  list.forEach(([x, y, zz], i) => {
    q.setFromAxisAngle(V(0, 0, 1), r() * Math.PI * 2); // 감긴 끝 위치가 제각각이게 축 둘레로 돌림
    m.compose(V(x, y, zz), q, V(1, 1, 1)); mT.setMatrixAt(i, m); mD.setMatrixAt(i, m);
    const k = 0.9 + r() * 0.18, warm = r() < 0.15 ? 0.06 : 0; mT.setColorAt(i, col.setRGB(k + warm, k, k - warm * 0.5));
  });
  const k = new Kit(); // 1단 코일 받침(콘크리트 새들): 줄마다 길게 두 줄
  zs.forEach(zr => { for (const dz of [-Wc * 0.3, Wc * 0.3]) k.boxT(V(0, 0, zr - z0 + dz), perRow * s, 0.14, 0.35, 'basin', 'basin', { rows: 1 }); });
  const g = k.build('coil_yard');
  for (const mm of [mT, mD]) { mm.castShadow = mm.receiveShadow = true; g.add(mm); }
  return g;
}

// ---------------------------------------------------------------------------------------------
// 슬래브 더미: 두께 0.25m · 폭 1.6m · 길이 10m 판을 층층이 쌓는다. 한 더미 = InstancedMesh 하나(트림시트 재질 하나).
let slabGeo = null;
function slabGeometry(L, W, T) {
  if (slabGeo) return slabGeo;
  const g = new THREE.BoxGeometry(L, T, W), uv = g.attributes.uv;
  const sc = stripV('slab_scale'), ct = stripV('slab_cut');
  // BoxGeometry 면 순서: +X, -X, +Y, -Y, +Z, -Z (면마다 꼭짓점 4개). 길이 = X
  const faces = [[ct, W, 1], [ct, W, 1], [sc, L, 1], [sc, L, 1], [sc, L, T / sc.hM], [sc, L, T / sc.hM]];
  faces.forEach(([s, ulen, vfrac], f) => {
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * ulen / s.uM, s.v0 + uv.getY(i) * (s.v1 - s.v0) * vfrac);
  });
  return (slabGeo = g);
}

export function makeSlabStack(opts = {}) {
  const { layers = 10, L = 10, W = 1.6, T = 0.25, seed = 1, jitter = 1 } = opts;
  const r = rng(seed);
  const mesh = new THREE.InstancedMesh(slabGeometry(L, W, T), trimMaterial(), layers);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  for (let i = 0; i < layers; i++) {
    const p = V((r() - 0.5) * 0.5 * jitter, T * (i + 0.5), (r() - 0.5) * 0.14 * jitter);
    q.setFromAxisAngle(Y, (r() - 0.5) * 0.02 * jitter);
    mesh.setMatrixAt(i, m.compose(p, q, V(1, 1, 1)));
    const k = 0.9 + r() * 0.2, warm = r() < 0.25 ? 0.04 : 0; // 판마다 조금씩 다른 산화 정도, 일부는 녹이 더 낀 판
    mesh.setColorAt(i, col.setRGB(k + warm, k, k - warm));
  }
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'slab_stack';
  return mesh;
}

// 슬래브 야드: 받침목(콘크리트 침목) 위에 더미를 줄지어 놓는다. rows × cols 더미, 높이는 들쭉날쭉.
export function makeSlabYard(opts = {}) {
  const { rows = 3, cols = 4, seed = 3, gapX = 1.6, gapZ = 1.2, minLayers = 5, maxLayers = 12 } = opts;
  const r = rng(seed), g = new THREE.Group(); g.name = 'slab_yard';
  const L = 10, W = 1.6;
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.25, W + 0.4), mats(PROP_COLORS).concrete, rows * cols * 3);
  let si = 0; const m = new THREE.Matrix4();
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const x = (i - (rows - 1) / 2) * (L + gapX), z = (j - (cols - 1) / 2) * (W + gapZ);
    for (const dx of [-3.5, 0, 3.5]) sleepers.setMatrixAt(si++, m.makeTranslation(x + dx, 0.125, z));
    const n = minLayers + Math.floor(r() * (maxLayers - minLayers + 1));
    if (r() < 0.12) continue; // 가끔 빈 자리
    const s = makeSlabStack({ layers: n, seed: (seed * 131 + i * 17 + j) | 0 });
    s.position.set(x, 0.25, z);
    g.add(s);
  }
  sleepers.castShadow = sleepers.receiveShadow = true;
  g.add(sleepers);
  return g;
}
