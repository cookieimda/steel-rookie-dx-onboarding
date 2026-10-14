// <steel-scene> — Three.js 공정 뷰. 설비 그룹 이름 = EQ_<id> (GLB 노드 규약과 동일).
// GLB 교체: buildProcess() 안의 primitive 생성 부분을 GLTFLoader.load(`models/${processId}.glb`)로 바꾸고,
// scene.getObjectByName(`EQ_${id}`)로 노드를 찾으면 나머지(라벨·클릭·하이라이트·흐름)는 그대로 동작.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
import { PROCESSES, findProcess } from './data_v2.js';
import { StepFx } from './step-fx.js';
// 포항제철소 위성 사진 기준 배치. 사진 px → 월드 (X = (px-640)·S, Z = (py-620)·S). 북쪽이 -Z(화면 안쪽), 동쪽이 +X
const MAP_S = 0.18, MAP_W = 640, PX = (x, y) => [(x - 640) * MAP_S, (y - 620) * MAP_S];
// 공정 위치(c), 구역 이름표 오프셋(lab), 바닥판(ap: dx, dz, w, d). 제선=고로가 있는 북쪽 매립지(원료 야적장 옆), 제강·연주=그 옆 서쪽 라인, 열간압연=남쪽 긴 공장 라인
const SITE = { ironmaking: { c: PX(760, 235), lab: [0, 13], ap: [0, -1.4, 38, 18] }, steelmaking: { c: PX(470, 440), lab: [-33, 4], ap: [0.8, 0.4, 35, 14] }, continuous_casting: { c: PX(400, 620), lab: [-34, 4], ap: [0, 0, 36, 15] }, rolling: { c: PX(618, 809), lab: [-32, -4], ap: [0, 0, 33, 9] } }; // 열간압연: 연주 남쪽 공장동 자리(x≈-4, z≈34). 이름표는 모델 왼쪽 옆에
const zonePos = (p, i) => SITE[p.id]?.c || [(i - (PROCESSES.length - 1) / 2) * 44, 0];
// 부지 윤곽(월드 XZ, 시계 방향): 매립지(제철소)·도시(강 건너 서쪽과 남쪽)
const SITE_LAND = [[590, 40], [1180, 215], [1232, 300], [1196, 388], [746, 350], [700, 440], [614, 580], [538, 700], [500, 745], [760, 745], [760, 660], [1010, 630], [1040, 680], [1050, 800], [900, 870], [600, 1244], [62, 800], [235, 300], [340, 230]].map(p => PX(p[0], p[1]));
const SITE_CITY = [[-320, -95], [-125, -95], [-86, -62], [-117, 36], [47, 47], [125, 92], [210, 160], [320, 230], [320, 320], [-320, 320]];
// 주요 도로 (월드 XZ 폴리라인). R31 = 부지 남서쪽 경계 국도
const SITE_ROADS = { R7: [[-30, -80], [0, -90], [40, -84], [88, -70]], RJ: [[-30, -80], [-30, -72]], R1: [[50, -53], [102, -47]],
  R2: [[-2, -89], [-2, -24], [-12, -6], [-20, 10], [-27, 24], [-40, 48], [-46, 62], [-38, 80], [-22, 96], [-14, 102]],
  R4: [[-86, -19], [0, -21]], R5: [[-84, 46], [44, 46]], R6: [[-24, 26], [20, 26]], R31: [[-125, 10], [-106, 34], [-9, 114], [14, 125], [70, 126], [130, 98], [200, 120]] };
// 공정 사이 레일 경유점 (null = 앞쪽은 출구 Z, 뒤쪽은 입구 Z를 그대로 씀)
const SITE_LINKS = { 'ironmaking>steelmaking': [[43, null], [43, -58], [-55, -58], [-55, null]], 'steelmaking>continuous_casting': [[-6.7, null], [-6.7, -16], [-66, -16], [-66, null]], 'continuous_casting>rolling': [[-24, null], [-24, 34]] };

const STEEL = 0x7d8794, DARK = 0x4a525c, ACCENT = 0x22c7f0, UI = '#ff9e64', UI_INK = '#1a1200'; // UI: 이름표 번호·선택 테두리(우리 UI 주황), UI_INK: 그 위 글자
const HAZE = 0xdfe3e8; // [UI 시안] 낮 배경을 옅게 만들 때 섞는 스튜디오 회색
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.35, ...o });
const mesh = (g, m, y = 0) => { const o = new THREE.Mesh(g, m); o.position.y = y; return o; };

function equipmentPrimitive(shape) {
  const g = new THREE.Group();
  const add = (m) => (g.add(m), m);
  switch (shape) {
    case 'tower': add(mesh(new THREE.CylinderGeometry(1.3, 1.9, 6.5, 20), mat(STEEL), 3.25)); add(mesh(new THREE.CylinderGeometry(0.6, 1.3, 1.6, 20), mat(DARK), 7.3)); add(mesh(new THREE.CylinderGeometry(0.9, 1.9, 1.2, 20), mat(DARK), 0.6)); break;
    case 'battery': for (let i = 0; i < 5; i++) add(mesh(new THREE.BoxGeometry(0.7, 3, 2.4), mat(i % 2 ? DARK : STEEL), 1.5)).position.x = (i - 2) * 0.85; break;
    case 'cyl': for (let i = 0; i < 3; i++) add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.5, 16), mat(STEEL), 2.25)).position.x = (i - 1) * 1.7; break;
    case 'ladle': add(mesh(new THREE.CylinderGeometry(1.3, 1.0, 2.6, 20), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.6 }), 2.65)); break;
    case 'converter': add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 20), mat(STEEL), 1.9)); add(mesh(new THREE.CylinderGeometry(0.7, 1.5, 1.4, 20), mat(DARK), 4.1)); add(mesh(new THREE.CylinderGeometry(1.5, 1.0, 0.9, 20), mat(DARK), 0.45)); add(mesh(new THREE.BoxGeometry(4, 0.3, 0.3), mat(DARK), 1.9)); break;
    case 'twin': add(mesh(new THREE.CylinderGeometry(1.1, 0.9, 2.4, 20), mat(STEEL), 1.2)).position.x = -1.3; add(mesh(new THREE.BoxGeometry(1.8, 3.6, 1.8), mat(DARK), 1.8)).position.x = 1.3; break;
    case 'tray': add(mesh(new THREE.BoxGeometry(4, 1.2, 1.8), mat(STEEL), 3.2)); add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = -1.7; add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = 1.7; break;
    case 'mold': add(mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), mat(0xb87333, { metalness: 0.6 }), 2.6)); add(mesh(new THREE.BoxGeometry(3.2, 0.4, 2.8), mat(DARK), 1.3)); break;
    case 'rollers': for (let i = 0; i < 6; i++) { const r = add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 12), mat(DARK), 0.9)); r.rotation.x = Math.PI / 2; r.position.x = (i - 2.5) * 0.8; } add(mesh(new THREE.BoxGeometry(5, 0.2, 0.2), mat(STEEL), 2.6)); break;
    case 'gate': add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = -1.4; add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = 1.4; add(mesh(new THREE.BoxGeometry(0.5, 0.5, 3.2), mat(DARK), 3.2)); add(mesh(new THREE.ConeGeometry(0.25, 0.7, 12), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.8 }), 2.6)).rotation.x = Math.PI; break;
    case 'stand': add(mesh(new THREE.BoxGeometry(2.2, 4, 3), mat(STEEL), 2)); add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 1.0)).rotation.x = Math.PI / 2; add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 2.4)).rotation.x = Math.PI / 2; break;
    case 'stands': for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(1.0, 3.4, 2.8), mat(i % 2 ? DARK : STEEL), 1.7)).position.x = (i - 1.5) * 1.3; break;
    case 'table': add(mesh(new THREE.BoxGeometry(6, 0.3, 2.2), mat(DARK), 0.9)); for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(0.2, 1.6, 2.4), mat(STEEL), 1.9)).position.x = (i - 1.5) * 1.6; break;
    case 'coiler': add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.8, 24), mat(STEEL), 1.6)).rotation.x = Math.PI / 2; add(mesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), mat(DARK), 0.8)); break;
    default: add(mesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 12), mat(DARK), 3.5)).position.x = 1;
  }
  return g;
}

function materialVFX(state, tex) {
  // 소재를 메시 대신 파티클 구름으로 표현: 상태별 분포 형태(core) + 뒤로 흘리는 꼬리(trail)
  const c = new THREE.Color(state.color), hot = state.shape === 'liquid' || c.r > 0.85;
  const SH = { chunks: [1.6, 0.9, 1.0, 0.16], liquid: [1.4, 0.8, 1.2, 0.22], slab: [3.2, 0.45, 1.5, 0.15], bar: [4.4, 0.25, 1.4, 0.13], strip: [6, 0.12, 1.4, 0.11], coil: [1.6, 1.6, 0.9, 0.14] };
  const [sx, sy, sz, size] = SH[state.shape] || SH.chunks, nCore = hot ? 420 : 300, nTrail = hot ? 220 : 90;
  const mk = (n, sz, op) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ size: sz, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: hot ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: op, sizeAttenuation: true });
    const p = new THREE.Points(geo, mat); p.frustumCulled = false; p.renderOrder = 21; return p; };
  const core = mk(nCore, size, hot ? 0.95 : 0.9), trail = mk(nTrail, size * 0.8, hot ? 0.8 : 0.5);
  const seeds = new Float32Array(nCore * 4); for (let i = 0; i < nCore; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = Math.random(); }
  const tr = new Float32Array(nTrail * 4); for (let i = 0; i < nTrail; i++) tr[i * 4 + 3] = Math.random();
  const g = new THREE.Group(); g.add(core, trail);
  const c2 = hot ? c.clone().lerp(new THREE.Color(0xfff0c0), 0.55) : c.clone().multiplyScalar(1.25), c3 = hot ? c.clone().multiplyScalar(0.55) : c.clone().multiplyScalar(0.7);
  g.userData.vfx = { core, trail, seeds, tr, sx, sy, sz, hot, shape: state.shape, c, c2, c3, prev: new THREE.Vector3(), t0: performance.now() };
  g.userData.tick = (now) => {
    const V = g.userData.vfx, P = core.geometry.attributes.position.array, C = core.geometry.attributes.color.array, t = (now - V.t0) / 1000;
    for (let i = 0; i < nCore; i++) { const u = V.seeds[i * 4], v = V.seeds[i * 4 + 1], w = V.seeds[i * 4 + 2], r = V.seeds[i * 4 + 3]; let x, y, z;
      if (V.shape === 'coil') { const a = u * Math.PI * 2 + t * 0.6, rr = 0.55 + v * 0.3, th = w * Math.PI * 2; x = Math.cos(a) * (rr + 0.3 * Math.cos(th)) * 0.9; y = 1.0 + Math.sin(a) * (rr + 0.3 * Math.cos(th)) * 0.9; z = Math.sin(th) * 0.35; }
      else if (V.shape === 'liquid') { const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), rr = Math.cbrt(w) * 0.75; x = rr * Math.sin(ph) * Math.cos(th); z = rr * Math.sin(ph) * Math.sin(th); y = 0.5 + rr * Math.cos(ph) * 0.6 + Math.sin(t * 3 + u * 9) * 0.05; if (r > 0.9) y += ((t * 0.7 + r) % 1) * 0.9; }
      else if (V.shape === 'chunks') { const k = Math.floor(u * 6), cx = (k % 3 - 1) * 0.55, cy = 0.3 + Math.floor(k / 3) * 0.45, cz = (k % 2 - 0.5) * 0.5; x = cx + (v - 0.5) * 0.5; y = cy + (w - 0.5) * 0.5; z = cz + (r - 0.5) * 0.5; }
      else { x = (u - 0.5) * V.sx; z = (w - 0.5) * V.sz; y = 0.45 + (v - 0.5) * V.sy; if (V.hot && r > 0.85) y += ((t * 0.9 + r) % 1) * 0.7; }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      const fl = V.hot ? 0.75 + 0.25 * Math.sin(t * 7 + u * 30) : 1, col = (r > 0.6 ? V.c2 : r > 0.25 ? V.c : V.c3); C[i * 3] = col.r * fl; C[i * 3 + 1] = col.g * fl; C[i * 3 + 2] = col.b * fl; }
    core.geometry.attributes.position.needsUpdate = true; core.geometry.attributes.color.needsUpdate = true;
    // 꼬리: 월드 이동량 반대 방향으로 퍼지며 식어 간다
    const wp = g.getWorldPosition(new THREE.Vector3()); const mv = new THREE.Vector3().subVectors(wp, V.prev); const speed = mv.length(); V.prev.copy(wp);
    const TP = trail.geometry.attributes.position.array, TC = trail.geometry.attributes.color.array, inv = g.matrixWorld.clone().invert(), back = speed > 1e-4 ? mv.clone().normalize().negate() : new THREE.Vector3(-1, 0, 0);
    for (let i = 0; i < nTrail; i++) { let life = (V.tr[i * 4 + 3] + t * (V.hot ? 0.9 : 0.6)) % 1; const sp = 1 + Math.sin(i * 12.9) * 0.5; const q = wp.clone().addScaledVector(back, life * (V.hot ? 3.2 : 2.0) * sp).add(new THREE.Vector3(Math.sin(i * 3.1 + t) * 0.3, 0.45 + life * (V.hot ? 1.4 : 0.5), Math.cos(i * 1.7 + t * 1.3) * 0.3)).applyMatrix4(inv);
      TP[i * 3] = q.x; TP[i * 3 + 1] = q.y; TP[i * 3 + 2] = q.z; const f = (1 - life) * (speed > 0.002 || V.hot ? 1 : 0.35); TC[i * 3] = V.c2.r * f; TC[i * 3 + 1] = V.c2.g * f * (V.hot ? 0.8 : 1); TC[i * 3 + 2] = V.c2.b * f * (V.hot ? 0.5 : 1); }
    trail.geometry.attributes.position.needsUpdate = true; trail.geometry.attributes.color.needsUpdate = true;
  };
  g.userData.tick(performance.now());
  return g;
}
function materialMesh(state) {
  const c = new THREE.Color(state.color);
  const glow = ['liquid'].includes(state.shape) || c.r > 0.9;
  const m = glow ? new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color(0xfff2c8), 0.35), roughness: 0.25, metalness: 0.0, emissive: c, emissiveIntensity: 2.2 })
    : new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.65, emissive: c.clone().multiplyScalar(0.08), emissiveIntensity: 1 });
  const g = new THREE.Group();
  switch (state.shape) {
    case 'chunks': for (let i = 0; i < 14; i++) { const d = new THREE.Mesh(new THREE.DodecahedronGeometry(0.18 + ((i * 7) % 5) * 0.06, 1), m); const a = i * 2.4, rr = 0.25 + (i % 4) * 0.22; d.position.set(Math.cos(a) * rr, 0.22 + Math.floor(i / 5) * 0.3 - rr * 0.15, Math.sin(a) * rr * 0.8); d.rotation.set(i, i * 1.7, i * 0.6); g.add(d); } break;
    case 'liquid': { const s = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 24), m); s.scale.y = 0.55; s.position.y = 0.45; g.add(s); const skin = new THREE.Mesh(new THREE.SphereGeometry(0.78, 32, 24), new THREE.MeshStandardMaterial({ color: 0x5a2a10, roughness: 0.9, transparent: true, opacity: 0.35, emissive: 0xff5a10, emissiveIntensity: 0.4 })); skin.scale.y = 0.55; skin.position.y = 0.45; g.add(skin); g.userData.tick = (now) => { const t = now / 1000; s.scale.set(1 + Math.sin(t * 2.3) * 0.04, 0.55 + Math.sin(t * 3.1) * 0.03, 1 + Math.cos(t * 1.9) * 0.04); skin.rotation.y = t * 0.35; m.emissiveIntensity = 2.0 + Math.sin(t * 6) * 0.35; }; break; }
    case 'slab': g.add(mesh(new THREE.BoxGeometry(3.2, 0.5, 1.5), m, 0.45)); break;
    case 'bar': g.add(mesh(new THREE.BoxGeometry(4.5, 0.22, 1.4), m, 0.4)); break;
    case 'strip': g.add(mesh(new THREE.BoxGeometry(6, 0.08, 1.4), m, 0.4)); break;
    case 'coil': { const t = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.42, 14, 32), m); t.position.y = 1.15; g.add(t); break; }
  }
  return g;
}

class SteelScene extends HTMLElement {
  static get observedAttributes() { return ['process', 'selected', 'theme', 'time-of-day', 'timeofday', 'view']; }
  connectedCallback() {
    if (this._init) { this._startLoop(); return; } this._init = true;
    Object.assign(this.style, { display: 'block', position: 'relative', overflow: 'hidden', width: '100%', height: '100%', touchAction: 'none', isolation: 'isolate', zIndex: '0' }); // [UI 시안] 라벨이 화면 위 패널·구역도보다 위로 올라오지 않게
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth * devicePixelRatio > 2600 ? 1 : 1.25)); // 최적화: 해상도 배율 상한 1.25
    // [UI 시안] 실사 톤: ACES 톤매핑 + 그림자(활성 공정 주변만) + 스튜디오 반사 환경맵
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap; // 최적화: Soft → 기본 PCF
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', cursor: 'grab' });
    this.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.appendChild(this.labels);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000); this._persp = this.camera;
    this.orbit = { yaw: -0.5, pitch: 0.36, dist: 48, target: new THREE.Vector3(0, 1.5, 0) };
    this.home0 = { yaw: -0.5, pitch: 0.36, dist: 48, target: [0, 1.5, 0] }; this.home = { ...this.home0 };
    this.hemiLight = new THREE.HemisphereLight(0xdfe6ee, 0x3a4048, 0.9); this.scene.add(this.hemiLight);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(10, 20, 12); this.scene.add(sun, sun.target); this.sunLight = sun;
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 220 });
    this._envTex = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, MAP_W), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0.12 }));
    this.ground.receiveShadow = true;
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.02; this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(700, 350, 0x556070, 0x3c4550); this.grid.visible = false; this.scene.add(this.grid);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.75, 64), new THREE.MeshBasicMaterial({ color: 0x22c7f0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    /* 배경 장식 제거 (성능) */ if (false) { const sg = new THREE.BufferGeometry(), sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { const r = 90 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9); sp.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) - 10, r * Math.sin(ph) * Math.sin(th)], i * 3); }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb0c4, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8 })); this.scene.add(this.stars);
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.set(0, 0.03, 0); this.scene.add(this.glow);
    this.skyline = new THREE.Group();
    for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 40, h = 4 + Math.random() * 22, w = 3 + Math.random() * 10; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ color: 0x0b1119 })); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); this.skyline.add(b); if (Math.random() < 0.3) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, h * 1.6, 8), b.material); s.position.set(b.position.x + w / 2, h * 0.8, b.position.z); this.skyline.add(s); } }
    this.scene.add(this.skyline);
    }
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.02; this.ring.visible = false; this.scene.add(this.ring);
    this.ray = new THREE.Raycaster(); this.eqs = []; this._tourId = 0; this._tourWaits = [];
    this._bindPointer();
    new ResizeObserver(() => this._resize()).observe(this);
    this._resize();
    this._applyTheme();
    this._buildAll();
    this._applySelection();
    this._startLoop();
  }
  _startLoop() {
    if (this._raf) return;
    const tick = (now) => { this._frame(now); const o = this.orbit, key = `${o.yaw.toFixed(4)}|${o.pitch.toFixed(4)}|${o.dist.toFixed(3)}|${o.target.x.toFixed(2)},${o.target.y.toFixed(2)},${o.target.z.toFixed(2)}`; const busy = this.anim || this.move || this.playing || this.touring || this.ring.visible || this._dirty || key !== this._camKey; this._camKey = key; if (busy) { this.renderer.render(this.scene, this.camera); this._dirty = false; } this._raf = requestAnimationFrame(tick); };
    this._raf = requestAnimationFrame(tick);
  }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; }
  attributeChangedCallback(n) { if (n === 'process') queueMicrotask(() => this._init && this._resize());
    if (!this._init) return;
    if (n === 'process') this._activate(this.getAttribute('process'), true); if (n === 'selected') this._applySelection(); if (n === 'theme' || n === 'time-of-day' || n === 'timeofday') this._applyTheme(); if (n === 'view') { this._applySelection(); this._applyView(); this._apply2d(); const sid = this.getAttribute('selected'); if (sid && !this.touring && !this._2d) this.focus(sid); }
  }
  invalidate() { this._dirty = true; }
  _resize() { this._dirty = true; const w = this.clientWidth || 1, h = this.clientHeight || 1; this.renderer.setSize(w, h, false); const pc = this._persp || this.camera; pc.aspect = w / h; const sh = Math.min(170, Math.round(w * 0.1)); const site = !this.getAttribute('process') || this.getAttribute('process') === 'site'; if (w > 900 && !site) pc.setViewOffset(w, h, -sh, 0, w, h); else pc.clearViewOffset(); pc.updateProjectionMatrix(); if (this._2d) this._fit2d(true); }
  // 라이트 모드: 실제 시각으로 오전(5~11시) / 오후(11~17시) / 저녁(17~5시) 하늘을 고른다. time-of-day 속성으로 고정 가능
  _period() { const f = this.getAttribute('time-of-day') || this.getAttribute('timeofday'); if (f === 'morning' || f === 'afternoon' || f === 'evening') return f; const h = new Date().getHours(); return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : 'evening'; }
  _tod() { return ({
    morning: { sky: ['#4f80b0', '#80a9d0', '#b7cde2', '#e2d9cf', '#efdcc6'], fog: 0xe3ddd4, sunCol: 0xfff3d6, sunPos: [330, 70, -560], halo: [[70, 0.24, 0xfff0c0], [150, 0.11, 0xffd8a0], [260, 0.05, 0xffc890]], sil: 0x9aa5b3, far: 0xbdc7d3, steam: 0xffffff, steamOp: 0.26, win: false, ridges: [[0xa0bcd6, 0xcbdcea], [0x7fa0a0, 0xaac4be], [0x5c8a68, 0x86ad88]], ground: 0x8e978e, sl: [0xfff2e0, 1.7, [16, 16, -22]], hemi: [0xf0f5ff, 0x5c6470, 1.0] },
    afternoon: { sky: ['#3d78b4', '#6a9fd0', '#a3c6e4', '#cfe0ee', '#dfe9f1'], fog: 0xd6e3ee, sunCol: 0xffffff, sunPos: [-80, 230, -560], halo: [[70, 0.2, 0xffffff], [150, 0.08, 0xeaf4ff], [260, 0.04, 0xdcecff]], sil: 0xa2acb8, far: 0xc5cdd7, steam: 0xffffff, steamOp: 0.3, win: false, ridges: [[0x8fb0d4, 0xbdd6ea], [0x6f9a86, 0x9dbfae], [0x4f8058, 0x78a070]], ground: 0x8c968a, sl: [0xffffff, 1.9, [6, 30, 8]], hemi: [0xf4f8ff, 0x5e646e, 1.05] },
    evening: { sky: ['#2f3d6e', '#6a5b94', '#b8769a', '#ea9d78', '#ffcf8f'], fog: 0xd0c6d2, sunCol: 0xffe2a8, sunPos: [-330, 46, -560], halo: [[70, 0.28, 0xffb070], [150, 0.14, 0xff8a60], [260, 0.07, 0xff7a70]], sil: 0x8d8aa0, far: 0xb0abbd, steam: 0xffe0c8, steamOp: 0.18, win: true, ridges: [[0xc2b3c8, 0xe2c6c2], [0xa597b2, 0xc8b2b8], [0x8a8299, 0xaea2ac]], ground: 0x8f939a, sl: [0xfff0e2, 1.6, [-16, 18, -22]], hemi: [0xeef0f6, 0x585e68, 0.95] },
  })[this._period()]; }
  _applyTheme() { this._dirty = true; this._todNow = this._period();
    if (!this._todTimer) this._todTimer = setInterval(() => { if ((this.getAttribute('theme') || 'dark') !== 'dark' && this._period() !== this._todNow) this._applyTheme(); }, 60000);
    const T = this._tod(); if (this.siteMode && this._init && this.root) setTimeout(() => this._buildSite(), 0);
    const dark = (this.getAttribute('theme') || 'dark') === 'dark';
    // [UI 시안] 낮 하늘은 스튜디오 회색 쪽으로 옅게 섞어 설비가 먼저 보이게 한다 (팀원 배경은 유지)
    const hz = (c, k) => '#' + new THREE.Color(c).lerp(new THREE.Color(HAZE), k).getHexString();
    this.scene.background = this._gradientTex(dark ? ['#02040a', '#0a1324', '#1b2740'] : T.sky.map((c, i) => hz(c, 0.03 + i * 0.03)));
    this._fog0 = null; this.scene.fog = null; // 안개 없음(요청) // 카메라 거리에 따라 _frame 에서 밀어 줌
    this.scene.environment = dark ? null : this._envTex;
    this.renderer.toneMappingExposure = dark ? 0.95 : 1.0;
    if (this.sunLight) { if (dark) { this.sunLight.color.set(0xffffff); this.sunLight.intensity = 1.4; this._sunDir = new THREE.Vector3(10, 20, 12).normalize(); } else { this.sunLight.color.set(T.sl[0]); this.sunLight.intensity = T.sl[1] * 0.95; this._sunDir = new THREE.Vector3(...T.sl[2]).normalize(); } this._placeSun(); }
    if (this.hemiLight) { if (dark) { this.hemiLight.color.set(0xdfe6ee); this.hemiLight.groundColor.set(0x3a4048); this.hemiLight.intensity = 0.9; } else { this.hemiLight.color.set(T.hemi[0]); this.hemiLight.groundColor.set(T.hemi[1]); this.hemiLight.intensity = T.hemi[2] * 0.55; } }
    { const mp = this._siteMap(dark), gm = this.ground.material; gm.map = mp.map; gm.roughnessMap = mp.rough; gm.roughness = 1; gm.color.set(0xffffff); gm.emissiveMap = mp.emis || null; gm.emissive.set(mp.emis ? 0xffffff : 0x000000); gm.emissiveIntensity = mp.emis ? 1.6 : 0; gm.needsUpdate = true; } // 위성 지도 기반 일러스트 바닥
    this._buildWaves(dark); this._buildBackdrop(dark); this._lampFade();
    this._gridOn = false; this.grid.visible = false; // 바닥이 지도이므로 격자는 쓰지 않음
    if (this.glow) this.glow.visible = false;
    if (this.skyline) this.skyline.visible = false;
    if (!this.nightSky) this._buildStars();
    this.nightSky.visible = dark;
    this.dark = dark; this._styleLabels(); this._paintSite(); Object.values(this.zones || {}).forEach(z => { if (z.neon) z.neon.visible = dark; });
    this._zoneLight(); if (this._2d) this._2dStyle();
  }
  // [UI 시안] 공정 안에서는 그 공정만 보이게(다른 공정은 숨김), 전체 보기에서는 모두
  _zoneVis() { Object.values(this.zones || {}).forEach(z => { const loaded = !!z.modelStatus && z.modelStatus !== 'loading'; z.root.visible = loaded && (this._isOverview !== false || z === this.zone); }); this._dirty = true; }
  // [UI 시안] 팀원이 넣은 가로등은 그대로 두고, 공정 안(가까이)에서는 반투명하게 흐려 설비를 가리지 않게 한다
  _lampFade() { const k = this._isOverview ? 1 : 0.18; if (!this.backdrop) return;
    this.backdrop.children.forEach(o => { if (!o.userData.lamp) return; const m = o.material; if (m.uniforms) { if (m.userData.op == null) m.userData.op = m.uniforms.opacity.value; m.uniforms.opacity.value = m.userData.op * k; return; }
      if (m.userData.op == null) { m.userData.op = m.opacity; m.userData.tr = m.transparent; } m.transparent = k < 1 || m.userData.tr; m.opacity = m.userData.op * k; m.depthWrite = k >= 1; m.needsUpdate = true; }); this._dirty = true; }
  _neonAll() { const zs = Object.values(this.zones || {}).filter(z => z.floorBox); if (!zs.length) return;
    this._neons = [];
    zs.forEach(z => { if (z.neon) z.root.remove(z.neon); z.neon = this._neonRect(z.floorBox.clone()); z.neon.visible = !!this.dark; z.root.add(z.neon); }); this._dirty = true; }
  // 네온 테두리: 둥근 사각형까지의 거리로 가는 심선 + 화면 픽셀 기준으로 퍼지는 빛(어느 거리에서 봐도 두께가 같다)
  _neonRect(box) { const pad = 6, w = box.max.x - box.min.x, d = box.max.z - box.min.z;
    const mat = new THREE.ShaderMaterial({ uniforms: { hs: { value: new THREE.Vector2(w / 2, d / 2) }, rad: { value: Math.min(w, d) * 0.06 }, col: { value: new THREE.Color(0x7884e0) }, t: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec2 hs; uniform float rad; uniform vec3 col; uniform float t; varying vec2 vP; float sdb(vec2 p){ vec2 q = abs(p) - hs + rad; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad; } void main(){ float d = abs(sdb(vP)); float px = max(fwidth(d), 1e-4); float core = 1.0 - smoothstep(px * 0.8, px * 2.2, d); float glow = exp(-d / (px * 11.0)) * (0.28 + 0.06 * sin(t * 1.6)); float a = clamp(core * 0.75 + glow, 0.0, 1.0); vec3 c = mix(col, vec3(1.0), core * 0.4); gl_FragColor = vec4(c * a * 0.8, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w + pad * 2, d + pad * 2), mat); m.rotation.x = -Math.PI / 2; m.position.set((box.min.x + box.max.x) / 2, 0.08, (box.min.z + box.max.z) / 2);
    m.renderOrder = 8; m.raycast = () => {}; m.userData.neon = true; (this._neons = this._neons || []).push(mat); return m; }
  // [UI 시안] 그림자: 해를 현재 공정 구역 위에 두어 그림자 카메라가 그 구역만 덮게 한다
  _placeSun() { const s = this.sunLight; if (!s) return; const c = this.zone && !this._isOverview ? new THREE.Vector3(this.zone.ox, 0, this.zone.oz || 0) : new THREE.Vector3(0, 0, 0), d = this._sunDir || new THREE.Vector3(0.4, 0.8, 0.45);
    s.target.position.copy(c); s.position.copy(c).addScaledVector(d, 90); s.castShadow = !!this.zone && !this._isOverview; s.target.updateMatrixWorld(); this._dirty = true; }
  // 다크모드 밤하늘: 큰 구 위쪽 반구에 별 점들 (안개 영향 없음)
  // 공장 바닥판: 아스팔트 도로 톤 (밝은 민트 → 짙은 회색), 테두리는 연석 느낌
  // [UI 시안] 낮: 짙은 아스팔트 → 밝은 콘크리트 바닥판(참고 이미지처럼 설비가 바닥과 분리돼 보이게)
  _paintSite() { const d = this.dark; (this._siteMeshes || []).forEach(o => { const m = o.material; if (o.userData.site === 'Base_Mint') { m.color.set(d ? 0x24282e : 0xa4a9af); m.roughness = 0.95; m.metalness = 0; } else { m.color.set(d ? 0x5a6068 : 0x8f959c); } m.needsUpdate = true; }); this._dirty = true; }
  _buildStars() {
    const g = new THREE.Group(); g.name = 'STARS';
    const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    [[1400, 2.2, 0.55], [260, 4, 0.85], [40, 6.5, 1]].forEach(([n, size, op]) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = Math.random() * Math.PI * 2, y = 0.06 + Math.pow(Math.random(), 0.8) * 0.94, r = Math.sqrt(1 - y * y), R = 780;
        pos.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R], i * 3);
        const t = Math.random(); col.set(t < 0.15 ? [1, 0.88, 0.75] : t < 0.35 ? [0.78, 0.86, 1] : [1, 1, 1], i * 3);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity: op, depthWrite: false, fog: false, sizeAttenuation: false })));
    });
    g.renderOrder = -1; this.nightSky = g; this.scene.add(g);
  }
  _styleLabels() {
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => { const on = e.id === id, act = on || e.id === this.hoverId, dot = e.label.querySelector('i'), nm = e.label.querySelector('.nm');
      Object.assign(e.label.style, { color: '#ffffff', opacity: act || !id ? '1' : '0.8', fontWeight: '600', alignItems: 'center', gap: '6px', padding: '0', background: 'transparent', border: 'none', boxShadow: 'none', zIndex: on ? '3' : act ? '2' : '1' });
      Object.assign(nm.style, { padding: '5px 10px', borderRadius: '7px', background: on ? 'rgba(9,14,21,.94)' : 'rgba(18,24,32,.8)', border: '1px solid ' + (on ? UI : 'rgba(255,255,255,.16)'), boxShadow: on ? '0 0 0 3px rgba(255,158,100,.22), 0 6px 18px rgba(0,0,0,.28)' : '0 4px 12px rgba(0,0,0,.2)', backdropFilter: 'blur(6px)', webkitBackdropFilter: 'blur(6px)' });
      const sz = on ? 24 : 20; Object.assign(dot.style, { width: sz + 'px', height: sz + 'px', borderRadius: '50%', background: UI, color: UI_INK, border: '2px solid #ffffff', boxSizing: 'border-box', boxShadow: on ? '0 0 0 4px rgba(255,158,100,.35), 0 0 12px ' + UI : '0 2px 6px rgba(0,0,0,.35)' }); });
  }

  // 멀리 보이는 제철소 실루엣 + 불티
  _buildBackdrop(dark) {
    // 테마/시간대별로 한 번 만든 배경은 캐시해서 다시 켤 때 즉시 교체
    const key = dark ? 'dark' : this._period(); this._bdCache = this._bdCache || {};
    if (this.backdrop) this.scene.remove(this.backdrop);
    const hit = this._bdCache[key]; if (hit) { this._occ = hit.occ; this.backdrop = hit.g; this.embers = hit.embers; this._skyAnim = hit.sky; this._sharks = hit.sharks; this._traffic = hit.traffic; this._fw = hit.fw; this.scene.add(hit.g); return; }
    this._occ = []; this._sharks = []; this._traffic = null; this._fw = null; this._buildBackdropNew(dark); this._mergeStatic(this.backdrop);
    this._bdCache[key] = { g: this.backdrop, embers: this.embers, sky: this._skyAnim, occ: this._occ, sharks: this._sharks, traffic: this._traffic, fw: this._fw };
  }
  // 같은 재질의 정적 메시를 하나로 합쳐 드로우콜을 줄인다 (애니메이션 대상·포인트·인스턴스는 제외)
  _mergeStatic(root) {
    root.updateMatrixWorld(true); const groups = new Map(), drop = [];
    root.children.forEach(o => { if (!o.isMesh || o.isInstancedMesh || o.children.length || o.userData.keep || o.material.isShaderMaterial) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const gb = o.geometry.boundingBox; if (o.userData.occ || ((gb.max.y - gb.min.y) * o.scale.y > 1.5 && o.position.y + gb.max.y * o.scale.y > 2)) { if (this._occ && !this._occ.includes(o)) this._occ.push(o); return; } const a = o.geometry.attributes; const sig = o.material.uuid + '|' + Object.keys(a).sort().join(',') + '|' + o.renderOrder; if (!groups.has(sig)) groups.set(sig, []); groups.get(sig).push(o); });
    groups.forEach(list => { if (list.length < 2) return; const names = Object.keys(list[0].geometry.attributes), buf = {}; names.forEach(n => buf[n] = []);
      list.forEach(o => { const gg = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); gg.applyMatrix4(o.matrixWorld); names.forEach(n => { const arr = gg.attributes[n].array; for (let i = 0; i < arr.length; i++) buf[n].push(arr[i]); }); drop.push(o); });
      const geo = new THREE.BufferGeometry(); names.forEach(n => geo.setAttribute(n, new THREE.Float32BufferAttribute(buf[n], list[0].geometry.attributes[n].itemSize)));
      const m = new THREE.Mesh(geo, list[0].material); m.renderOrder = list[0].renderOrder; root.add(m); });
    drop.forEach(o => root.remove(o));
  }
  _buildHorizonGlow(g, T) {
    const p = this._period(), col = { morning: '255,214,176', afternoon: '236,224,212', evening: '255,170,120' }[p];
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(' + col + ',0)'); gr.addColorStop(0.55, 'rgba(' + col + ',.22)'); gr.addColorStop(0.82, 'rgba(' + col + ',.6)'); gr.addColorStop(0.9, 'rgba(' + col + ',.85)'); gr.addColorStop(1, 'rgba(' + col + ',.85)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 256); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2300, 2300, 260, 128, 1, true), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false }));
    m.position.y = 92; m.renderOrder = -2; m.userData.keep = 1; g.add(m); // 띠 아래 끝(y≈-38)이 수평선을 덮어 바다·하늘 경계가 한 면으로 이어진다
  }
  _buildBackdropNew(dark) {
    const g = new THREE.Group(); this.backdrop = g;
    const T = this._tod(), bk = [], N = dark;
    const hz = (c, k) => dark ? c : new THREE.Color(c).lerp(new THREE.Color(HAZE), k).getHex();
    const B = (c) => new THREE.MeshBasicMaterial({ color: c, fog: true });
    const silM = new THREE.MeshBasicMaterial({ color: dark ? 0x0d131a : hz(T.sil, 0.1), fog: true });
    const rnd = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    // 지평선의 먼 공장 실루엣 + 굴뚝
    for (let i = 0; i < (N ? 48 : 0); i++) { // 라이트 모드: 먼 건물 실루엣 없음
      const a = rnd() * Math.PI * 2, r = 400 + rnd() * 50, w = 14 + rnd() * 30, h = 10 + rnd() * 30;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + rnd() * 10), silM); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); g.add(b);
      if (rnd() < 0.45) { const ch = 18 + rnd() * 26, c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, ch, 8), silM); c.position.set(b.position.x + (rnd() - 0.5) * w, ch / 2, b.position.z); g.add(c); if (dark) bk.push([c.position.x, ch + 0.4, c.position.z, 0xff5a2a, 1]); }
    }
    // 제철소 위를 떠다니는 불티 (밤)
    if (dark) { const n = 200, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) pos.set([(rnd() - 0.5) * 170 + 10, 2 + rnd() * 40, (rnd() - 0.5) * 180 - 5], i * 3);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); this.embers = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffa050, size: 0.35, transparent: true, opacity: 0.7, depthWrite: false })); g.add(this.embers); }
    else this.embers = null;
    // 더 먼 실루엣 층 + 굴뚝 증기
    const farM = new THREE.MeshBasicMaterial({ color: N ? 0x16202e : hz(T.far, 0.2), fog: true });
    for (let i = 0; i < (N ? 36 : 0); i++) { const a = rnd() * Math.PI * 2, r = 470 + rnd() * 40, w = 20 + rnd() * 40, h = 14 + rnd() * 46; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10), farM); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); g.add(b); }
    const steamM = new THREE.MeshBasicMaterial({ color: N ? 0x4a5568 : T.steam, transparent: true, opacity: N ? 0.3 : T.steamOp, depthWrite: false, fog: true });
    g.children.filter(o => o.geometry.type === 'CylinderGeometry').slice(0, 10).forEach(c => { for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(2.2 + k * 1.3, 10, 8), steamM); p.position.set(c.position.x + k * 2.5, c.position.y * 2 + 2 + k * 2.4, c.position.z + k * 1.2); g.add(p); } });
    if (N) {
      const moon = new THREE.Mesh(new THREE.CircleGeometry(11, 40), new THREE.MeshBasicMaterial({ color: 0xeef2f8, depthWrite: false, fog: false })); moon.position.set(-200, 140, -320); moon.lookAt(0, 20, 0); moon.material.depthTest = true; moon.material.depthWrite = true; moon.renderOrder = -5; moon.userData.keep = 1; g.add(moon); // 달: 땅 아래로 비치지 않게 깊이 기록
      const halo = new THREE.Mesh(new THREE.CircleGeometry(34, 40), new THREE.MeshBasicMaterial({ color: 0x8fa6c8, transparent: true, opacity: 0.12, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); halo.position.copy(moon.position).multiplyScalar(1.01); halo.lookAt(0, 20, 0); halo.userData.keep = 1; g.add(halo);
      g.children.filter(o => o.geometry.type === 'BoxGeometry' && o.material === silM).forEach(b => { const p = b.geometry.parameters; const k = Math.floor(rnd() * 5); const sz = b.position.z > 0 ? -1 : 1; for (let q = 0; q < k; q++) bk.push([b.position.x + (rnd() - 0.5) * p.width * 0.8, b.position.y + (rnd() - 0.3) * p.height * 0.6, b.position.z + sz * (p.depth / 2 + 0.5), rnd() < 0.8 ? 0xffc56a : 0xfff0d8, 0]); });
    } else {
      const sun = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshBasicMaterial({ color: T.sunCol, depthWrite: false, fog: false })); sun.position.set(...T.sunPos); sun.lookAt(0, 20, 0); sun.renderOrder = -2; g.add(sun);
      T.halo.forEach(([r, op, c]) => { const h = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); h.position.copy(sun.position).multiplyScalar(0.995); h.lookAt(0, 20, 0); h.renderOrder = -2; g.add(h); });
      if (T.win) g.children.filter(o => o.geometry.type === 'BoxGeometry' && o.material === silM).forEach(b => { if (rnd() < 0.5) return; const p = b.geometry.parameters; const k = 1 + Math.floor(rnd() * 3); const sz = b.position.z > 0 ? -1 : 1; for (let q = 0; q < k; q++) bk.push([b.position.x + (rnd() - 0.5) * p.width * 0.8, b.position.y + (rnd() - 0.3) * p.height * 0.6, b.position.z + sz * (p.depth / 2 + 0.5), 0xffc46a, 0]); });
    }
    // 지도 바깥 지평선 바닥 + 먼 산 능선 3겹
    { let far;
      if (N) far = new THREE.Mesh(new THREE.RingGeometry(300, 1400, 96, 1), new THREE.MeshBasicMaterial({ color: 0x0c1015, fog: true }));
      else { const geo = new THREE.RingGeometry(300, 2400, 128, 8), col = [], a = new THREE.Color(0x4f8aa6), b = new THREE.Color(0x7fa7bd), v = new THREE.Vector3(); const pa = geo.attributes.position;
        for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const t = Math.min(1, (v.length() - 300) / 2100); const c = a.clone().lerp(b, Math.pow(t, 0.6)); col.push(c.r, c.g, c.b); }
        const hzCol = new THREE.Color(T.sky[T.sky.length - 1]).lerp(new THREE.Color(HAZE), 0.15), seaC = new THREE.Color(0x5d93ad); col.length = 0;
        for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); const t = Math.min(1, Math.max(0, (v.length() - 300) / 2100)); const c = seaC.clone().lerp(hzCol, Math.pow(t, 1.6) * 0.92); col.push(c.r, c.g, c.b); } // 수평선 쪽은 하늘 아랫색으로 녹아들게
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); far = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: false })); far.userData.keep = true; }
      far.rotation.x = -Math.PI / 2; far.position.y = -0.4; g.add(far); }
    {
      const hash = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
      const vn = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
      const fbm = (x, o) => { let v = 0, amp = 0.5, fr = 1; for (let k = 0; k < o; k++) { v += amp * vn(x * fr + k * 17.3); amp *= 0.5; fr *= 2.1; } return v; };
      const ridge = (R, base, amp, seed, cTop, cBot) => {
        const seg = 720, pos = [], col = [], idx = [], ct = new THREE.Color(cTop), cb = new THREE.Color(cBot);
        for (let k = 0; k <= seg; k++) { const t = k / seg, ang = t * Math.PI * 2, u = t * 18 + seed; const h = base + amp * Math.pow(fbm(u, 5), 1.35) * 1.7 + amp * 0.08 * vn(u * 9.1); const x = Math.cos(ang) * R, z = Math.sin(ang) * R;
          pos.push(x, h, z, x, -2, z); col.push(ct.r, ct.g, ct.b, cb.r, cb.g, cb.b); if (k < seg) { const q = k * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
        g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false, depthWrite: true })));
      };
      if (N) { ridge(620, 20, 80, 3.1, 0x1b2944, 0x0d1524); ridge(560, 12, 58, 9.7, 0x131e34, 0x0b1220); ridge(500, 6, 34, 21.4, 0x0d1524, 0x090e18); }
      else this._buildHorizonGlow(g, T); if (false) { const rc = T.ridges; ridge(620, 20, 80, 3.1, hz(rc[0][0], 0.15), hz(rc[0][1], 0.15)); ridge(560, 12, 58, 9.7, hz(rc[1][0], 0.1), hz(rc[1][1], 0.1)); ridge(500, 6, 34, 21.4, hz(rc[2][0], 0.05), hz(rc[2][1], 0.05)); }
    }
    this._buildSiteProps(g, N, T, B, bk);
    // 먼 불빛 보케 (도시 불빛 + 창문 + 항공장애등)
    if (dark || T.win) { for (let i = 0; i < 160; i++) { const a = rnd() * Math.PI * 2, r = 430 + rnd() * 90; bk.push([Math.cos(a) * r, 2 + rnd() * 16, Math.sin(a) * r, [0xffc56a, 0xffe2b0, 0xff9a5a, 0xfff4e0][Math.floor(rnd() * 4)], rnd() < 0.15 ? 1 : 0]); } }
    [0, 1].forEach(big => { const pts = bk.filter(b => b[4] === big); if (!pts.length) return; const pos = new Float32Array(pts.length * 3), col = new Float32Array(pts.length * 3), cc = new THREE.Color();
      pts.forEach((b, i) => { pos.set([b[0], b[1], b[2]], i * 3); cc.set(b[3]).multiplyScalar(0.7 + rnd() * 0.3); col.set([cc.r, cc.g, cc.b], i * 3); });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pm = new THREE.Points(geo, new THREE.PointsMaterial({ map: this._bokehTex(), size: big ? 9 : 5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: dark ? 0.85 : 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); pm.renderOrder = 3; pm.userData.bokeh = big ? 9 : 5; (this._bokehPts || (this._bokehPts = [])).push(pm); g.add(pm); });
    this._skyAnim = dark ? null : this._buildSkyDetail(g, T); // 밤에는 갈매기 없음
    this.scene.add(g);
  }
  // 부지 위 소품: 원료 하역 크레인(언로더)·벌크선·원료 더미·공장동·도시 블록·가로등. 위치는 SITE/SITE_ROADS 좌표계(위성 지도 기준)
  _buildSiteProps(g, N, T, B, bk) {
    const inst = (geo, mat, list) => { const m = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(); list.forEach((t, k) => { d.position.set(t[0], t[1], t[2]); d.rotation.set(t[3] || 0, t[4] || 0, t[5] || 0); d.updateMatrix(); m.setMatrixAt(k, d.matrix); }); g.add(m); return m; };
    const box = (w, h, d, m, x, y, z, ry = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.y = ry; g.add(b); if (h > 2) (this._occ || (this._occ = [])).push(b); return b; }; // 높은 건물은 시야 가림 페이드 대상
    // 언로더: dir=+1 붐이 +Z(남쪽 바다), -1 북쪽
    const cM = B(N ? 0x141a22 : 0x4b555f), cM2 = B(N ? 0x1b222b : 0x5b6570);
    const crane = (cx, cz, dir, s = 1) => { const L = 14 * s;
      [[-3.2, -2.2], [3.2, -2.2], [-3.2, 2.2], [3.2, 2.2]].forEach(([dx, dz]) => box(0.7 * s, L, 0.7 * s, cM, cx + dx * s, L / 2, cz + dz * s));
      [-2.2, 2.2].forEach(dz => box(8 * s, 1.1 * s, 0.9 * s, cM, cx, L + 0.55 * s, cz + dz * s)); [-3.2, 3.2].forEach(dx => box(0.9 * s, 0.9 * s, 5.3 * s, cM, cx + dx * s, L + 0.55 * s, cz));
      box(4.2 * s, 3 * s, 4.6 * s, cM2, cx, L + 2.6 * s, cz - 1.4 * s * dir);
      const boom = box(1.1 * s, 1 * s, 21 * s, cM, cx, L + 2.6 * s, cz + 6.8 * s * dir); boom.rotation.x = dir * 0.2;
      box(0.9 * s, 0.9 * s, 7 * s, cM, cx, L + 2.6 * s, cz - 5.2 * s * dir); box(0.8 * s, 6.5 * s, 0.8 * s, cM, cx, L + 5.5 * s, cz - 1.4 * s * dir);
      const tie = box(0.25 * s, 0.25 * s, 15 * s, cM, cx, L + 6 * s, cz + 4.5 * s * dir); tie.rotation.x = dir * 0.42;
      if (N) { bk.push([cx, L + 9 * s, cz - 1.4 * s * dir, 0xff3b30, 1]); bk.push([cx, L + 2.2 * s, cz + 16.5 * s * dir, 0xff3b30, 0]); } };
    // 벌크선
    const hullM = B(N ? 0x11151b : 0x6a3d33), deckM = B(N ? 0x1f252d : 0xcbc7bf), hatchM = B(N ? 0x262d36 : 0xb9b5ad), houseM = B(N ? 0x2b323c : 0xe8e5de);
    const ship = (cx, cz, ry, len = 26) => { const ax = [Math.cos(ry), -Math.sin(ry)], at = (t, y) => [cx + t * ax[0], y, cz + t * ax[1]];
      let p = at(0, 1.2); box(len, 2.4, 6.2, hullM, p[0], p[1], p[2], ry); p = at(0, 2.5); box(len - 1.2, 0.5, 5.6, deckM, p[0], p[1], p[2], ry);
      for (let k = 0; k < 4; k++) { p = at((k - 1.2) * 5.2, 3.05); box(4.2, 0.6, 4.4, hatchM, p[0], p[1], p[2], ry); }
      p = at(-len / 2 + 3.6, 4.6); box(4, 4, 5, houseM, p[0], p[1], p[2], ry); p = at(-len / 2 + 2.4, 7.4); box(1.3, 1.8, 1.6, hullM, p[0], p[1], p[2], ry);
      if (N) { p = at(-len / 2 + 3.6, 6.9); bk.push([p[0], p[1], p[2], 0xfff0d8, 0]); p = at(len / 2 - 1.5, 4.2); bk.push([p[0], p[1], p[2], 0xffffff, 0]); } };
    // 원료 더미 (철광석 · 석탄)
    const oreM = B(N ? 0x231914 : 0x5c4236), coalM = B(N ? 0x0f1115 : 0x2e2c30);
    const pile = (cx, cz, m, l) => { const p = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), m); p.scale.set(l / 2, 2.1, 3); p.position.set(cx, 0, cz); p.rotation.y = -0.1; g.add(p); };
    [60, 72, 84].forEach(x => pile(x, -57.5 + 0.1 * (x - 76), oreM, 11)); [64, 76, 88, 97].forEach(x => pile(x, -52.5 + 0.1 * (x - 76), coalM, 10));
    // 공장동·창고 + 도시 블록
    const shedM = B(N ? 0x1a2028 : 0xb1b4b9), roofM = B(N ? 0x232b34 : 0xc8cbcf), cityM = B(N ? 0x1a1f27 : 0xd2cec6);
    const winM = B(0x5f7a90), doorM = B(0x7b8690), ventM = B(0x9aa1a8), stripeM = B(0x3a6ea8), pipeM = B(0x8c949c);
    const shed = (cx, cz, w, d, h, ry, m = shedM) => { box(w, h, d, m, cx, h / 2, cz, ry).userData.occ = 1; box(w * 0.98, 0.3, d * 0.98, roofM, cx, h + 0.15, cz, ry).userData.occ = 1;
      if (!N) { const cs = Math.cos(ry), sn = Math.sin(ry), at = (lx, lz) => [cx + lx * cs + lz * sn, cz - lx * sn + lz * cs]; // 로컬(lx,lz) → 월드
        let p = at(0, d / 2 + 0.03); box(w * 0.82, 0.55, 0.05, winM, p[0], h * 0.66, p[1], ry).userData.occ = 1; p = at(0, -d / 2 - 0.03); box(w * 0.82, 0.55, 0.05, winM, p[0], h * 0.66, p[1], ry).userData.occ = 1; // 긴 띠창
        p = at(0, d / 2 + 0.03); box(w * 0.9, 0.35, 0.05, stripeM, p[0], h * 0.86, p[1], ry).userData.occ = 1; // 상단 파란 띠
        p = at(w * 0.3, d / 2 + 0.03); box(Math.min(3.5, w * 0.22), h * 0.42, 0.05, doorM, p[0], h * 0.21, p[1], ry).userData.occ = 1; // 셔터문
        const nv = Math.max(1, Math.floor(w / 7)); for (let k = 0; k < nv; k++) { p = at((k - (nv - 1) / 2) * 7, 0); box(1.1, 0.8, 1.1, ventM, p[0], h + 0.7, p[1], ry).userData.occ = 1; } // 지붕 환기구
        if (w > 12) { p = at(0, -d * 0.3); box(w * 0.7, 0.3, 0.3, pipeM, p[0], h + 0.45, p[1], ry).userData.occ = 1; } }
      if (N && w > 10) for (let k = -1; k <= 1; k += 2) bk.push([cx + k * w * 0.3 * Math.cos(ry), h + 0.5, cz - k * w * 0.3 * Math.sin(ry), 0xffd9a0, 0]); };
    [[-26, -72, 24, 6, 7, -0.28], [50, -71, 6, 5, 9, -0.3], [-74, -40, 14, 5, 6, 1.45], [-72, 0, 18, 6, 7, 1.5], [46, 25.5, 26, 4, 5, 0.12], [10, 62, 30, 7, 8, -0.88], [-14, 86, 30, 7, 9, -0.75]].forEach(q => shed(...q));
    [[-150, -20, 8, 8, 6], [-160, 8, 6, 10, 9], [-142, -48, 10, 7, 5], [-136, 66, 7, 7, 12], [-124, 104, 9, 6, 5], [-70, 150, 8, 8, 7], [-10, 150, 10, 7, 6], [60, 136, 7, 7, 5], [96, 104, 6, 6, 8], [-108, -82, 8, 6, 5], [-98, -70, 6, 6, 7], [-176, 40, 7, 9, 10]].forEach(([x, z, w, d, h], i) => shed(x, z, w, d, h, (i % 3 - 1) * 0.15, cityM));
    if (!N) { // 낮: 가로수(도로 반대편)·녹지 나무 군락·야적장 컨테이너·트럭
      const rnd2 = (() => { let x = 97; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
      const trees = [];
      const alongT = (pts, step, off) => { let acc = step * 0.5; for (let i = 0; i < pts.length - 1; i++) { const a = new THREE.Vector2(pts[i][0], pts[i][1]), b = new THREE.Vector2(pts[i + 1][0], pts[i + 1][1]), dd = b.clone().sub(a), L = dd.length(); dd.normalize(); const n = new THREE.Vector2(-dd.y, dd.x); while (acc < L) { const p = a.clone().addScaledVector(dd, acc).addScaledVector(n, off); trees.push([p.x, p.y, 0.8 + rnd2() * 0.5]); acc += step; } acc -= L; } };
      alongT(SITE_ROADS.R2, 9, -3.2); alongT(SITE_ROADS.R7, 10, -3.2); alongT(SITE_ROADS.R1, 9, 3.2); alongT(SITE_ROADS.R5, 10, -3.0); alongT(SITE_ROADS.R31, 7, 3.4); alongT(SITE_ROADS.R31, 7, -3.4);
      [[-70, 50, 10, 4], [-30, 74, 5, 2.5], [-150, 30, 10, 7], [-172, -30, 12, 6], [90, 112, 9, 5], [-124, 96, 8, 5], [-60, 150, 10, 5]].forEach(([u, v, rw, rd]) => { const n = Math.round(rw * rd * 0.5); for (let k = 0; k < n; k++) { const a = rnd2() * Math.PI * 2, r = Math.sqrt(rnd2()); trees.push([u + Math.cos(a) * r * rw * 0.9, v + Math.sin(a) * r * rd * 0.9, 0.9 + rnd2() * 0.7]); } });
      const keepT = trees.filter(t => !Object.values(SITE).some(q => { const cx = q.c[0] + q.ap[0], cz = q.c[1] + q.ap[1], hw = q.ap[2] / 2 + 14, hd = q.ap[3] / 2 + 14; return Math.abs(t[0] - cx) < hw && Math.abs(t[1] - cz) < hd; })); trees.length = 0; trees.push(...keepT); // 공정 구역 안·근처 나무 제거(설비 가림 방지)
      const trunkM = B(0x6b5443), leafM = B(0x5f8a4e), leafM2 = B(0x7aa15e);
      inst(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 5), trunkM, trees.map(t => [t[0], 0.8 * t[2], t[1]]));
      const sph = new THREE.SphereGeometry(1, 8, 6); const T1 = trees.filter((_, i) => i % 2 === 0), T2 = trees.filter((_, i) => i % 2 === 1);
      const mkLeaf = (list, mat) => { const m = new THREE.InstancedMesh(sph, mat, list.length), dmy = new THREE.Object3D(); list.forEach((t, k) => { dmy.position.set(t[0], 1.6 * t[2] + 0.9 * t[2], t[1]); dmy.scale.set(1.3 * t[2], 1.5 * t[2], 1.3 * t[2]); dmy.updateMatrix(); m.setMatrixAt(k, dmy.matrix); }); m.userData.tree = 1; g.add(m); };
      mkLeaf(T1, leafM); mkLeaf(T2, leafM2);
      // 컨테이너 (야적장 가장자리) + 트럭 (도로변 주차)
      const cont = [], cCols = [0x3a6ea8, 0xb8503c, 0x7f8a94, 0xd9a441]; const cGeo = new THREE.BoxGeometry(6, 2.4, 2.4);
      for (let k = 0; k < 14; k++) cont.push([58 + (k % 7) * 6.4, 1.2, -46.5 + Math.floor(k / 7) * 2.7, 0, 0.08, 0, k]);
      for (let k = 0; k < 6; k++) cont.push([-62 + k * 6.6, 1.2, 38, 0, -0.02, 0, k + 2]);
      cCols.forEach((col, ci) => { const L = cont.filter(c => c[6] % 4 === ci); if (L.length) inst(cGeo, B(col), L); });
      const trucks = [[-20, 25.5, 0.02], [-36, 25.5, 0.02], [24, 44, -0.9], [-66, 60, 1.5], [12, 95, -0.75], [-98, 20, 1.5]];
      inst(new THREE.BoxGeometry(5.2, 1.6, 2.1), B(0xe8eaec), trucks.map(t => [t[0], 1.3, t[1], 0, t[2], 0])); // 적재함
      inst(new THREE.BoxGeometry(1.6, 1.4, 2.0), B(0x3a6ea8), trucks.map(t => [t[0] + 3.3 * Math.cos(t[2]), 1.0, t[1] - 3.3 * Math.sin(t[2]), 0, t[2], 0])); // 캡
    }
    { // 위성 사진에 보이는 큰 설비 실루엣: 가스홀더·저장 탱크·컨베이어 갤러리·대형 굴뚝·송전탑
      const tankM = B(N ? 0x20262e : 0xb8bcc1), tankTop = B(N ? 0x2a313a : 0xd7d9dc), galM = B(N ? 0x1e252d : 0x9aa3ad), stackM = B(N ? 0x2a2f36 : 0x9b9ea3), bandM = B(N ? 0x5a1e1e : 0xc8463a), pylM = B(N ? 0x3a424c : 0x8d949c);
      const cyl = (r, h, m, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), m); c.position.set(x, y, z); g.add(c); if (h > 2) (this._occ || (this._occ = [])).push(c); return c; };
      [[-78, -62, 9, 14], [-66, -58, 6, 10]].forEach(([tx, tz, r, h]) => { cyl(r, h, tankM, tx, h / 2, tz).userData.occ = 1; cyl(r * 0.96, 0.6, tankTop, tx, h + 0.3, tz).userData.occ = 1; }); // 가스홀더
      [[-96, 30, 3.2, 4], [-90, 34, 3.2, 4], [-84, 38, 3.2, 4], [78, 70, 4, 5], [86, 74, 4, 5], [94, 78, 4, 5]].forEach(([tx, tz, r, h]) => { cyl(r, h, tankM, tx, h / 2, tz).userData.occ = 1; }); // 저장 탱크 군
      const gal = (a, b, h) => { const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx); box(L, 1.4, 1.6, galM, (a[0] + b[0]) / 2, h, (a[1] + b[1]) / 2, ry).userData.occ = 1; const n = Math.max(2, Math.floor(L / 12)); for (let i = 0; i <= n; i++) { const t = i / n; box(0.5, h, 0.5, galM, a[0] + dx * t, h / 2, a[1] + dz * t, ry).userData.occ = 1; } };
      gal([76, -52], [50, -40], 6); gal([50, -40], [30, -28], 7); gal([-56, -70], [-30, -64], 5); // 원료 야적장 → 제선, 슬래그 야적장 컨베이어 갤러리
      [[-40, -62, 1.3, 26], [-10, -60, 1.1, 22], [60, 30, 1.2, 24]].forEach(([tx, tz, r, h]) => { cyl(r, h, stackM, tx, h / 2, tz).userData.occ = 1; cyl(r * 1.02, 1.2, bandM, tx, h - 2, tz).userData.occ = 1; cyl(r * 1.02, 1.2, bandM, tx, h - 5, tz).userData.occ = 1; }); // 대형 굴뚝(적백 띠)
      const pylon = (px, pz) => { box(0.35, 16, 0.35, pylM, px - 1.2, 8, pz).userData.occ = 1; box(0.35, 16, 0.35, pylM, px + 1.2, 8, pz).userData.occ = 1; box(5.5, 0.3, 0.3, pylM, px, 13.5, pz).userData.occ = 1; box(4, 0.3, 0.3, pylM, px, 10.5, pz).userData.occ = 1; box(2.4, 0.3, 0.3, pylM, px, 16, pz).userData.occ = 1; };
      [[-118, -40], [-118, -10], [-118, 20], [-118, 50], [-118, 80]].forEach(([px, pz]) => pylon(px, pz)); // 송전탑 열(부지 서쪽 경계)
    }
    { // 상어 3마리: 등지느러미(삼각) + 꼬리지느러미 + 수면 아래 몸통 그림자. 먼바다 타원 경로를 천천히 유영
      const finM = new THREE.MeshStandardMaterial({ color: N ? 0x1a2430 : 0x3a4652, roughness: 0.6 }), bodyM = new THREE.MeshBasicMaterial({ color: N ? 0x060a10 : 0x1f3a4a, transparent: true, opacity: N ? 0.5 : 0.35, depthWrite: false });
      // 상어: 수면 위로는 등지느러미(뒤로 휜 얇은 삼각)와 꼬리 끝만, 몸은 수면 아래 납작한 어두운 그림자 + 뒤로 퍼지는 물결
      const finShape = new THREE.Shape(); finShape.moveTo(-0.9, 0); finShape.lineTo(0.9, 0); finShape.lineTo(-0.25, 1.9); finShape.lineTo(-0.75, 1.1); finShape.closePath();
      const finGeo = new THREE.ShapeGeometry(finShape), tailShape = new THREE.Shape(); tailShape.moveTo(-0.35, 0); tailShape.lineTo(0.35, 0); tailShape.lineTo(-0.15, 1.1); tailShape.closePath(); const tailGeo = new THREE.ShapeGeometry(tailShape);
      const finM2 = new THREE.MeshStandardMaterial({ color: N ? 0x1a2430 : 0x3a4652, roughness: 0.6, side: THREE.DoubleSide }), shadowM = new THREE.MeshBasicMaterial({ color: N ? 0x04070c : 0x163040, transparent: true, opacity: N ? 0.55 : 0.4, depthWrite: false }), wakeM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: N ? 0.08 : 0.22, depthWrite: false });
      const mk = (cx, cz, rx, rz, ph, sp) => { const grp = new THREE.Group();
        const fin = new THREE.Mesh(finGeo, finM2); fin.position.set(0.3, 0.02, 0); grp.add(fin); // 등지느러미(진행 방향 +x)
        const tail = new THREE.Mesh(tailGeo, finM2); tail.position.set(-3.4, 0.02, 0); grp.add(tail);
        const body = new THREE.Mesh(new THREE.CircleGeometry(1, 20), shadowM); body.rotation.x = -Math.PI / 2; body.scale.set(3.2, 1.0, 1); body.position.set(-0.8, 0.04, 0); body.renderOrder = 2; grp.add(body); // 물속 몸통 그림자(타원)
        const wake = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.2), wakeM); wake.rotation.x = -Math.PI / 2; wake.position.set(-4.5, 0.05, 0); wake.renderOrder = 2; grp.add(wake); // 물결 꼬리
        grp.userData = { cx, cz, rx, rz, ph, sp, tail, keep: 1 }; grp.traverse(o => { o.userData.keep = 1; }); g.add(grp); (this._sharks || (this._sharks = [])).push(grp); };
      mk(-60, -175, 70, 24, 0, 0.055); mk(175, -60, 28, 55, 2.1, -0.045); mk(80, -160, 50, 20, 4.0, 0.05);
    }
    { // 교통: 도로를 달리는 차량 + 원료 열차. 각 경로는 폴리라인 → 누적 길이로 파라미터화
      const mkPath = (pts) => { const P = pts.map(p => new THREE.Vector2(p[0], p[1])), L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1])); return { P, L, len: L[L.length - 1] }; };
      const at = (path, d, out) => { const { P, L } = path; let i = 1; while (i < L.length - 1 && L[i] < d) i++; const t = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]); out.x = P[i - 1].x + (P[i].x - P[i - 1].x) * t; out.z = P[i - 1].y + (P[i].y - P[i - 1].y) * t; out.ry = Math.atan2(-(P[i].y - P[i - 1].y), P[i].x - P[i - 1].x); return out; };
      const roads = ['R31', 'R2'].map(k => mkPath(SITE_ROADS[k])); // 국도 1대 + 부지 간선 1대
      const carBody = new THREE.BoxGeometry(2.2, 0.7, 1.1), carTop = new THREE.BoxGeometry(1.2, 0.5, 1.0), cols = [0xe8eaec, 0x3a6ea8, 0xc8463a, 0x2b2f36, 0xd9d2c2];
      const cars = []; roads.forEach((rp, ri) => { const n = 1; for (let i = 0; i < n; i++) { const dir = i % 2 ? -1 : 1; cars.push({ path: rp, d: (i / n) * rp.len, v: dir * (6 + (i % 3) * 1.5), off: dir * 1.1, col: cols[(ri + i) % cols.length] }); } });
      const grpC = new THREE.Group(); grpC.userData.keep = true; const byCol = {}; cars.forEach(c => (byCol[c.col] = byCol[c.col] || []).push(c));
      const inst2 = {}; Object.entries(byCol).forEach(([col, list]) => { const b = new THREE.InstancedMesh(carBody, B(+col), list.length), t = new THREE.InstancedMesh(carTop, B(N ? 0x1a2028 : 0x9fb3c4), list.length); b.userData.keep = t.userData.keep = true; grpC.add(b, t); inst2[col] = { b, t, list }; });
      let lamps = null; if (N) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cars.length * 2 * 3), 3)); lamps = new THREE.Points(lg, new THREE.PointsMaterial({ color: 0xfff2d0, size: 1.6, sizeAttenuation: true, map: this._bokehTex(), transparent: true, opacity: 0.9, depthWrite: false, fog: false })); lamps.userData.keep = true; lamps.renderOrder = 3; grpC.add(lamps); }
      g.add(grpC);
      // 열차: 기관차 + 호퍼차 6량, 철도 인입선(제선 북쪽 → 야적장)
      const rail = mkPath([[-2, -89], [-2, -50], [20, -52], [52, -64], [100, -64]]); /* 야적장 원료 더미 북쪽으로 우회 */ const grpT = new THREE.Group(); grpT.userData.keep = true; const locoM = B(N ? 0x3a4652 : 0x2f5a8a), hopM = B(N ? 0x262a30 : 0x6e5a4e);
      const wagons = []; for (let i = 0; i < 7; i++) { const m = new THREE.Mesh(i ? new THREE.BoxGeometry(3.6, 1.3, 1.5) : new THREE.BoxGeometry(4, 1.7, 1.6), i ? hopM : locoM); m.userData.keep = true; grpT.add(m); wagons.push(m); if (i) { const ore = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 1.2), B(N ? 0x3a2418 : 0x8a5a3c)); ore.userData.keep = true; m.add(ore); ore.position.y = 0.8; } }
      g.add(grpT);
      this._traffic = { cars, inst2, lamps, rail, train: { wagons, d: 0, v: 5.5, gap: 4.2 }, at, dmy: new THREE.Object3D(), tmp: { x: 0, z: 0, ry: 0 } };
    }
    if (N) { // 밤 불꽃놀이 (포항 불빛축제처럼 바다 위에서) — 고정 개수 파티클 풀, 상태(쏘아올림→폭발→낙하) 결정적 갱신
      const MAXB = 6, PER = 140, n = MAXB * PER, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 1, map: this._bokehTex(), depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); pts.userData.keep = true; pts.renderOrder = 4; pts.frustumCulled = false; g.add(pts);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); glow.visible = false; // 수면 반사 원판은 어색해서 끔
      let k = 29; const rnd3 = () => (k = (k * 16807) % 2147483647) / 2147483647;
      const palette = [0xff5a3c, 0xffb347, 0xfff1a8, 0x7fd0ff, 0xff7fd4, 0x9dff8a, 0xffffff];
      const bursts = []; for (let b = 0; b < MAXB; b++) bursts.push({ t: -(b * 1.1 + rnd3() * 1.5), x: 0, z: 0, hy: 0, col: new THREE.Color(), dirs: new Float32Array(PER * 3), spd: new Float32Array(PER), life: 0 });
      this._fw = { pts, glow, bursts, pos, col, rnd: rnd3, palette, PER, sites: [[-30, -118], [30, -125], [90, -120], [140, -40], [150, 10]] };
      for (let i = 0; i < n * 3; i++) pos[i] = 0, col[i] = 0; pos.fill(0); for (let i = 1; i < n * 3; i += 3) pos[i] = -50;
    }
    // 크레인·선박: 제선 구역 남쪽 원료 하역 안벽(E→D) + 피어 북쪽 면
    const quayZ = (x) => -48.6 + (x - 19.1) * 0.084;
    [30, 44, 58].forEach(x => crane(x, quayZ(x) - 2.6, 1)); crane(39, 7.7, -1, 0.85);
    ship(37, quayZ(37) + 4.6, -0.08); ship(46, -0.6, 0.12);
    // 가로등: 주요 도로를 따라 (밤에는 불빛 + 바닥 빛 웅덩이)
    const along = (pts, step, off) => { const out = []; let acc = step * 0.5; for (let i = 0; i < pts.length - 1; i++) { const a = new THREE.Vector2(pts[i][0], pts[i][1]), b = new THREE.Vector2(pts[i + 1][0], pts[i + 1][1]), d = b.clone().sub(a), L = d.length(); d.normalize(); const n = new THREE.Vector2(-d.y, d.x); while (acc < L) { const p = a.clone().addScaledVector(d, acc).addScaledVector(n, off); out.push([p.x, 0, p.y]); acc += step; } acc -= L; } return out; };
    const lamps = [...along(SITE_ROADS.R2, 22, 1.9), ...along(SITE_ROADS.R7, 26, 1.9), ...along(SITE_ROADS.R1, 24, -1.9), ...along(SITE_ROADS.R5, 26, 1.8), ...along(SITE_ROADS.R31, 26, -2.2)];
    inst(new THREE.CylinderGeometry(0.1, 0.13, 7, 6), B(N ? 0x4a525c : 0xaab0b7), lamps.map(l => [l[0], 3.5, l[2]])).userData.lamp = 1;
    inst(new THREE.BoxGeometry(1.0, 0.2, 0.38), N ? new THREE.MeshBasicMaterial({ color: 0xf0d2a0 }) : B(0xe6e1d6), lamps.map(l => [l[0], 7, l[2]])).userData.lamp = 1;
    { const pool = inst(new THREE.CircleGeometry(N ? 5 : 4.5, 24), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: N ? 0.07 : 0.025, depthWrite: false, blending: THREE.AdditiveBlending }), lamps.map(l => [l[0], 0.09, l[2], -Math.PI / 2])); pool.renderOrder = 4; pool.userData.lamp = 1; }
    if (N || T.win) { const gm = new THREE.Mesh(this._crossGeo(lamps.map(l => [l[0], 7, l[2]]), N ? 6 : 7), this._glowMat(0xffc27a, N ? 0.45 : 0.2)); gm.renderOrder = 6; gm.userData.lamp = 1; gm.userData.keep = true; g.add(gm); }
  }
  // 전체 공정 바닥: 포항제철소 위성 사진의 해안선·부두·방파제·도로·야적장 윤곽을 단순화한 일러스트 지도. 사진은 쓰지 않고 색만 낮/밤 팔레트로
  // 파도: 해안 거품 띠 3겹(위상 다르게 맥동) + 먼바다 물결 능선(UV 흐름). 캔버스는 테마별 1회 생성, 프레임에선 오프셋·투명도만 갱신
  _buildWaves(dark) {
    if (this._waves) { this.scene.remove(this._waves.g); this._waves = null; }
    this._waveCache = this._waveCache || {}; const key = dark ? 'd' : 'l';
    const Wd = MAP_W, N = 2048, S = N / Wd;
    const pathLand = (x) => { const P = (pts) => { x.beginPath(); pts.forEach((p, i) => { const u = (p[0] + Wd / 2) * S, v = (p[1] + Wd / 2) * S; i ? x.lineTo(u, v) : x.moveTo(u, v); }); x.closePath(); }; P(SITE_LAND.map(p => PX(p[0], p[1]))); P(SITE_CITY); };
    if (!this._waveCache[key]) {
      const foamTex = (w, alpha, dash) => { const c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = 'rgba(255,255,255,' + alpha + ')'; x.lineWidth = w * S; if (dash) x.setLineDash(dash.map(d => d * S)); pathLand(x); x.stroke(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = '#000'; pathLand(x); x.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
      const wc = document.createElement('canvas'); wc.width = wc.height = 512; const wx = wc.getContext('2d'); wx.strokeStyle = dark ? 'rgba(130,170,210,.26)' : 'rgba(255,255,255,.3)'; wx.lineWidth = 1.6; wx.lineCap = 'round'; let kk = 5; const r2 = () => (kk = (kk * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 90; i++) { const u = r2() * 512, v = r2() * 512, L = 26 + r2() * 40; wx.beginPath(); wx.moveTo(u, v); wx.bezierCurveTo(u + L * 0.3, v - 3, u + L * 0.6, v + 3, u + L, v); wx.stroke(); }
      const wt = new THREE.CanvasTexture(wc); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(14, 14); wt.colorSpace = THREE.SRGBColorSpace;
      const mask = document.createElement('canvas'); mask.width = mask.height = N; const mx = mask.getContext('2d'); mx.fillStyle = '#fff'; mx.fillRect(0, 0, N, N); mx.globalCompositeOperation = 'destination-out'; pathLand(mx); mx.fill(); const maskT = new THREE.CanvasTexture(mask); maskT.channel = 1;
      this._waveCache[key] = { foams: [foamTex(2.2, dark ? 0.35 : 0.8, null), foamTex(4.0, dark ? 0.18 : 0.45, [14, 9]), foamTex(6.5, dark ? 0.1 : 0.25, [22, 16])], wt, maskT };
    }
    const T = this._waveCache[key], g = new THREE.Group(); g.name = 'WAVES';
    T.foams.forEach((t, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Wd, Wd), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0, fog: true })); m.rotation.x = -Math.PI / 2; m.position.y = 0.06 + i * 0.01; m.renderOrder = 1; m.raycast = () => {}; m.userData.ph = i * 2.1; g.add(m); });
    const sg = new THREE.PlaneGeometry(Wd, Wd); sg.setAttribute('uv1', sg.attributes.uv.clone());
    const sea = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: T.wt, alphaMap: T.maskT, transparent: true, depthWrite: false, fog: true })); sea.rotation.x = -Math.PI / 2; sea.position.y = 0.05; sea.renderOrder = 1; sea.raycast = () => {}; g.add(sea);
    this.scene.add(g); this._waves = { g, foams: g.children.slice(0, 3), wt: T.wt };
  }
  _wavesTick(now) { const W = this._waves; if (!W || !this.ground?.visible || document.hidden) return; const t = now * 0.001;
    W.foams.forEach(m => { m.material.opacity = 0.5 + 0.5 * Math.sin(t * 0.9 + m.userData.ph); }); W.wt.offset.set(t * 0.004, t * 0.0025); this._dirty = true; }
  _siteMap(dark) {
    this._mapCache = this._mapCache || {}; const key = dark ? 'd' : 'l'; if (this._mapCache[key]) return this._mapCache[key];
    const Wd = MAP_W, Nn = 3072, c = document.createElement('canvas'); c.width = c.height = Nn; const x = c.getContext('2d');
    const rc = document.createElement('canvas'); rc.width = rc.height = 1024; const rx = rc.getContext('2d');
    const C = dark
      ? { sea: '#0a1422', wave: 'rgba(40,70,100,.35)', rim: 'rgba(32,58,88,.55)', rim2: 'rgba(40,70,104,.7)', land: '#1a2029', city: '#161b23', road: '#2b3442', edge: '#10151c', r31: '#4a4530', r31e: '#2a2718', yard: '#17130f', pier: '#20262f', green: '#132019', pond: '#15485c', beach: '#2a2923', apron: '#222a35', coast: '#0e1a2a' }
      : { sea: '#4f8aa6', wave: 'rgba(255,255,255,.22)', rim: 'rgba(160,205,220,.6)', rim2: 'rgba(190,224,234,.8)', land: '#8f9499', city: '#c9c4ba', road: '#dfe1e3', edge: '#6d7378', r31: '#f0d78a', r31e: '#c9ac4e', yard: '#6b584a', pier: '#d1ccc3', green: '#a6bd90', pond: '#78cfe5', beach: '#e9dec3', apron: '#a4a9ae', coast: '#55606a' };
    const S = Nn / Wd, Sr = 1024 / Wd, RS = '#767676', RL = '#f2f2f2'; // 거칠기: 바다 매끈(반사) / 땅 거침
    const P = (ctx, s, pts) => { ctx.beginPath(); pts.forEach((p, i) => { const u = (p[0] + Wd / 2) * s, v = (p[1] + Wd / 2) * s; i ? ctx.lineTo(u, v) : ctx.moveTo(u, v); }); };
    const fillP = (ctx, s, pts, col) => { P(ctx, s, pts); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
    const strokeP = (ctx, s, pts, col, w, close = false) => { P(ctx, s, pts); if (close) ctx.closePath(); ctx.strokeStyle = col; ctx.lineWidth = w * s; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); };
    const rect = (ctx, s, cx, cz, w, d, ang, col) => { ctx.save(); ctx.translate((cx + Wd / 2) * s, (cz + Wd / 2) * s); ctx.rotate(ang); ctx.fillStyle = col; ctx.fillRect(-w / 2 * s, -d / 2 * s, w * s, d * s); ctx.restore(); };
    const ell = (ctx, s, cx, cz, rw, rd, ang, col) => { ctx.beginPath(); ctx.ellipse((cx + Wd / 2) * s, (cz + Wd / 2) * s, rw * s, rd * s, ang, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); };
    const both = (fn) => { fn(x, S, true); fn(rx, Sr, false); };
    // 바다 + 잔물결
    x.fillStyle = C.sea; x.fillRect(0, 0, Nn, Nn); rx.fillStyle = RS; rx.fillRect(0, 0, 1024, 1024);
    if (!dark) { // 낮 바다 디테일: 연안은 밝고 먼바다는 짙게, 잔물결 띠, 햇빛 반짝임
      const gr = x.createRadialGradient(Nn * 0.55, Nn * 0.45, Nn * 0.08, Nn * 0.55, Nn * 0.45, Nn * 0.7); gr.addColorStop(0, 'rgba(90,150,175,0)'); gr.addColorStop(1, 'rgba(25,70,105,.6)');
      x.fillStyle = gr; x.fillRect(0, 0, Nn, Nn);
      let kk = 3; const r2 = () => (kk = (kk * 16807) % 2147483647) / 2147483647;
      x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 1.2 * S; for (let i = 0; i < 160; i++) { const u = r2() * Nn, v = r2() * Nn, L = (6 + r2() * 14) * S; x.beginPath(); x.moveTo(u, v); x.bezierCurveTo(u + L * 0.3, v - 1.5 * S, u + L * 0.6, v + 1.5 * S, u + L, v); x.stroke(); }
      x.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 260; i++) { const u = r2() * Nn, v = r2() * Nn, rr = (0.25 + r2() * 0.5) * S; x.beginPath(); x.arc(u, v, rr, 0, Math.PI * 2); x.fill(); }
    }
    { let k = 3; const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647; x.strokeStyle = C.wave; x.lineCap = 'round'; x.lineWidth = 0.35 * S; for (let i = 0; i < 320; i++) { const px = (rnd() - 0.5) * Wd, pz = (rnd() - 0.5) * Wd, L = 4 + rnd() * 8; x.beginPath(); x.moveTo((px + Wd / 2) * S, (pz + Wd / 2) * S); x.lineTo((px + L + Wd / 2) * S, (pz + Wd / 2 + (rnd() - 0.5) * 0.6) * S); x.stroke(); } }
    // 육지: 해안 안쪽 얕은 물 테두리 → 도시 → 제철소 매립지
    [SITE_CITY, SITE_LAND].forEach(poly => { strokeP(x, S, poly, C.rim, 7, true); strokeP(x, S, poly, C.rim2, 3, true); });
    both((ctx, s, col) => { fillP(ctx, s, SITE_CITY, col ? C.city : RL); fillP(ctx, s, SITE_LAND, col ? C.land : RL); });
    // 형산강 상류(남서쪽으로)
    both((ctx, s, col) => strokeP(ctx, s, [[-110, 34], [-140, 66], [-200, 110], [-320, 150]], col ? C.sea : RS, 11));
    // 피어 블록(콘크리트) · 긴 부두 · 방파제 · 선석(물길)
    both((ctx, s, col) => { const pc = col ? C.pier : RL, sc = col ? C.sea : RS;
      fillP(ctx, s, [[21.6, 7.2], [66.6, 1.8], [72, 10.8], [73.8, 32.4], [21.6, 22.5]], pc);
      strokeP(ctx, s, [[72, 12], [76, -24]], pc, 3.2); strokeP(ctx, s, [[7.2, -9], [21.6, -6.3]], pc, 1.4); strokeP(ctx, s, [[41.4, -16.2], [55.8, -10.8]], pc, 1.4);
      [[34.1, 14.7], [48.1, 13.1], [62.1, 11.4]].forEach(([u, v]) => rect(ctx, s, u, v, 4, 18, -0.12, sc)); });
    strokeP(x, S, SITE_LAND, C.coast, 0.5, true); strokeP(x, S, SITE_CITY, C.coast, 0.5, true);
    if (!dark) { strokeP(x, S, SITE_LAND, 'rgba(40,52,64,.55)', 1.6, true); strokeP(x, S, SITE_LAND, 'rgba(255,255,255,.5)', 0.5, true); } // 제철소 부지 외곽 담장
    // 해변(송도·청림), 원료 야적장, 침전지, 녹지, 공정 바닥판
    strokeP(x, S, [[-124, -93], [-87, -61]], C.beach, 3); strokeP(x, S, [[47, 47], [125, 92], [210, 160]], C.beach, 3.5);
    fillP(x, S, [[54, -62], [102, -58], [102, -49.5], [54, -55]], C.yard); ell(x, S, 90, -63, 7, 3.2, 0.3, C.pond); ell(rx, Sr, 90, -63, 7, 3.2, 0.3, RS);
    [[-70, 50, 10, 4, 0.7], [-30, 74, 5, 2.5, 0.7], [-85, -5, 2.5, 12, 0.15], [-150, 30, 10, 7, 0], [-172, -30, 12, 6, 0.3], [90, 112, 9, 5, 0.5], [-124, 96, 8, 5, 0], [-60, 150, 10, 5, 0.2]].forEach(([u, v, rw, rd, an]) => ell(x, S, u, v, rw, rd, an, C.green));
    // 위성 사진 디테일: 원료 야적장 줄무늬 더미(철광석 적갈 / 석탄 검정), 슬래그 야적장, 침전지, 매립지 구획선, 철도 인입선, 방파제 테트라포드, 주차장
    { const oreC = dark ? '#2a1c15' : '#7d5a47', coalC = dark ? '#0c0e12' : '#2f2d31', slagC = dark ? '#1c1e22' : '#8f8a84', lotC = dark ? '#1f2630' : '#cfccc6', railC = dark ? '#3a4250' : '#8a8f96', blkC = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)', tetC = dark ? '#242b35' : '#b9b5ad';
      for (let i = 0; i < 6; i++) rect(x, S, 60 + i * 7.5, -58.5 + 0.1 * (60 + i * 7.5 - 76), 5.5, 5, 0.1, i < 3 ? oreC : coalC); // 야적 더미 줄
      fillP(x, S, [[-62, -74], [-30, -82], [-26, -76], [-58, -68]], slagC); for (let i = 0; i < 5; i++) rect(x, S, -56 + i * 7, -75 + i * 0.6 - 1.5, 5, 4, -0.25, i % 2 ? slagC : (dark ? '#262a30' : '#a19c95')); // 슬래그 야적장
      [[-60, 20, 9, 5, 0.1], [38, 60, 7, 4, -0.3]].forEach(([u, v, rw, rd, an]) => { ell(x, S, u, v, rw, rd, an, C.pond); ell(rx, Sr, u, v, rw, rd, an, RS); }); // 침전지 (매끈·반사)
      x.strokeStyle = blkC; x.lineWidth = 0.5 * S; for (let i = -4; i <= 4; i++) { P(x, S, [[-100 + i * 18, -60], [-70 + i * 18, 100]]); x.stroke(); } for (let i = -3; i <= 3; i++) { P(x, S, [[-110, 10 + i * 24], [100, -8 + i * 24]]); x.stroke(); } // 매립지 구획 격자
      x.strokeStyle = railC; x.lineWidth = 0.5 * S; [[[-2, -89], [-2, -24], [-30, 24], [-66, 60]], [[-2, -50], [20, -52], [52, -64], [100, -64]]].forEach(pl => { P(x, S, pl); x.stroke(); }); x.lineWidth = 0.2 * S; [[[-2, -89], [-2, -24], [-30, 24], [-66, 60]], [[-2, -50], [20, -52], [52, -64], [100, -64]]].forEach(pl => { P(x, S, pl.map(p => [p[0] + 0.9, p[1] + 0.9])); x.stroke(); }); // 철도 인입선(복선)
      let tk = 17; const tr = () => (tk = (tk * 16807) % 2147483647) / 2147483647; x.fillStyle = tetC; const bw = [[72, 12], [76, -24]]; for (let i = 0; i < 40; i++) { const t = tr(), u = bw[0][0] + (bw[1][0] - bw[0][0]) * t + 1.8 + tr() * 0.6, v = bw[0][1] + (bw[1][1] - bw[0][1]) * t; x.beginPath(); x.arc((u + Wd / 2) * S, (v + Wd / 2) * S, (0.45 + tr() * 0.35) * S, 0, Math.PI * 2); x.fill(); } // 방파제 바깥 테트라포드
      [[-14, 30, 10, 6, 0], [30, 38, 8, 5, 0.12], [-50, 70, 9, 6, 0.7]].forEach(([u, v, w, d, an]) => { rect(x, S, u, v, w, d, an, lotC); x.save(); x.translate((u + Wd / 2) * S, (v + Wd / 2) * S); x.rotate(an); x.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.7)'; x.lineWidth = 0.12 * S; for (let i = -Math.floor(w / 2) + 1; i < Math.floor(w / 2); i++) { x.beginPath(); x.moveTo(i * S, -d / 2 * S); x.lineTo(i * S, d / 2 * S); x.stroke(); } x.restore(); }); // 주차장 줄선
    }
    Object.values(SITE).forEach(q => rect(x, S, q.c[0] + q.ap[0], q.c[1] + q.ap[1], q.ap[2], q.ap[3], 0, C.apron));
    // 도로(테두리 + 노면). 31번 국도는 노란색
    const road = (pts, w, f, e) => { strokeP(x, S, pts, e, w + 0.9); strokeP(x, S, pts, f, w); };
    ['R7', 'RJ', 'R1', 'R2', 'R4', 'R5', 'R6'].forEach(k => road(SITE_ROADS[k], k === 'R2' ? 2.6 : 2.2, C.road, C.edge)); road(SITE_ROADS.R31, 3.2, C.r31, C.r31e);
    // 밤: 도로 양쪽 가장자리를 따라 점선 LED 라인 (emissiveMap으로 스스로 빛남). 부지 도로 = 차가운 흰빛, 31번 국도 = 호박색
    let emis = null;
    if (dark) { const ec = document.createElement('canvas'); ec.width = ec.height = Nn; const ex = ec.getContext('2d'); ex.fillStyle = '#000'; ex.fillRect(0, 0, Nn, Nn);
      const led = (pts, w, col) => { const off = w / 2 + 0.35, side = (sg) => { const out = []; for (let i = 0; i < pts.length; i++) { const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)]; const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; out.push([pts[i][0] - dz / L * off * sg, pts[i][1] + dx / L * off * sg]); } return out; };
        [1, -1].forEach(sg => { const pl = side(sg); ex.save(); ex.setLineDash([0.9 * S, 1.6 * S]); ex.shadowColor = col; ex.shadowBlur = 1.6 * S; strokeP(ex, S, pl, col, 0.28); ex.restore(); ex.save(); ex.globalAlpha = 0.35; strokeP(ex, S, pl, col, 0.9); ex.restore(); }); };
      ['R7', 'RJ', 'R1', 'R2', 'R4', 'R5', 'R6'].forEach(k => led(SITE_ROADS[k], k === 'R2' ? 2.6 : 2.2, '#cfe6ff')); led(SITE_ROADS.R31, 3.2, '#ffb452');
      emis = new THREE.CanvasTexture(ec); emis.colorSpace = THREE.SRGBColorSpace; emis.wrapS = emis.wrapT = THREE.ClampToEdgeWrapping; emis.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const rough = new THREE.CanvasTexture(rc); rough.wrapS = rough.wrapT = THREE.ClampToEdgeWrapping;
    return (this._mapCache[key] = { map: tex, rough, emis });
  }
  // 공정 사이 소재 이동 레일: 위성 지도의 동선처럼 꺾어서 잇는다 (각 공정 모델의 흐름 끝점 → 다음 공정 시작점). 공정 화살표도 레일 중간으로
  _buildSiteLinks() {
    if (this._links) { this.scene.remove(this._links.g); this._links.g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this._links = null; }
    const zs = PROCESSES.map(p => this.zones?.[p.id]).filter(z => z && z.path && z.path.length); if (zs.length < 2) return;
    const g = new THREE.Group(); g.name = 'SITE_LINKS'; const mids = [];
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85, fog: true }), base = new THREE.MeshBasicMaterial({ color: 0x0b1420, transparent: true, opacity: 0.35, fog: true, depthWrite: false });
    for (let i = 0; i < zs.length - 1; i++) {
      const a = zs[i], b = zs[i + 1], pa = a.path[a.path.length - 1], pb = b.path[0], way = SITE_LINKS[a.id + '>' + b.id] || [];
      const pts = [new THREE.Vector3(pa.x, 0, pa.z)]; way.forEach((w, k) => pts.push(new THREE.Vector3(w[0], 0, w[1] == null ? (k < way.length / 2 ? pa.z : pb.z) : w[1]))); pts.push(new THREE.Vector3(pb.x, 0, pb.z));
      const sm = this._fillet(pts, 4), cp = new THREE.CurvePath(); for (let k = 0; k < sm.length - 1; k++) cp.add(new THREE.LineCurve3(sm[k], sm[k + 1]));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(cp, sm.length * 2, 0.45, 7, false), mat); tube.position.y = 0.3; tube.raycast = () => {}; g.add(tube);
      const sh = new THREE.Mesh(new THREE.TubeGeometry(cp, sm.length * 2, 1.0, 6, false), base); sh.position.y = -0.05; sh.scale.y = 0.12; sh.raycast = () => {}; sh.renderOrder = 1; g.add(sh);
      let L = 0; for (let k = 0; k < sm.length - 1; k++) L += sm[k].distanceTo(sm[k + 1]); let acc = 0, mid = sm[0].clone(), dir = new THREE.Vector3(1, 0, 0);
      for (let k = 0; k < sm.length - 1; k++) { const d = sm[k].distanceTo(sm[k + 1]); if (acc + d >= L / 2) { const t = (L / 2 - acc) / d; mid = sm[k].clone().lerp(sm[k + 1], t); dir = sm[k + 1].clone().sub(sm[k]).normalize(); break; } acc += d; }
      mids.push({ mid, dir }); const ar = this.zoneArrows?.[i]; if (ar) { ar.pos.copy(mid).setY(1.5); ar.p0.copy(mid).addScaledVector(dir, -4).setY(1.5); ar.p1.copy(mid).addScaledVector(dir, 4).setY(1.5); ar._lx = null; }
    }
    if (this._2d) g.visible = false; this.scene.add(g); this._links = { g, mids }; this._dirty = true;
  }
  _fillet(pts, r) { const out = [pts[0].clone()]; for (let i = 1; i < pts.length - 1; i++) { const Pp = pts[i], dA = pts[i - 1].clone().sub(Pp), dB = pts[i + 1].clone().sub(Pp), rr = Math.min(r, dA.length() / 2, dB.length() / 2); if (rr < 0.05) { out.push(Pp.clone()); continue; } const a1 = Pp.clone().addScaledVector(dA.normalize(), rr), b1 = Pp.clone().addScaledVector(dB.normalize(), rr); for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push(new THREE.Vector3().addScaledVector(a1, u * u).addScaledVector(Pp, 2 * u * t).addScaledVector(b1, t * t)); } } out.push(pts[pts.length - 1].clone()); return out; }
  // 라이트 모드 하늘 디테일: 구름(시간대별 모양), 지평선 안개, 새 떼. _frame 에서 천천히 움직인다
  _buildSkyDetail(g, T) {
    const p = this._period(), rnd = (() => { let x = 11; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    const puff = (seed, flat) => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); let k = seed; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < (flat ? 22 : 16); i++) { const cx = 40 + r() * 176, cy = flat ? 64 + (r() - 0.5) * 22 : 78 - Math.sin((cx - 40) / 176 * Math.PI) * (18 + r() * 26), rr = flat ? 14 + r() * 18 : 20 + r() * 26; const gr = x.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill(); }
      if (!flat) { const sh = x.createLinearGradient(0, 40, 0, 128); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(120,135,160,.35)'); x.globalCompositeOperation = 'source-atop'; x.fillStyle = sh; x.fillRect(0, 0, 256, 128); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const cfg = { morning: { n: 8, flat: true, col: 0xfff0e4, op: 0.5, w: [160, 260], h: [22, 36], y: [170, 260], mist: [0xf6f1ea, 0.6], birds: 2 },
      afternoon: { n: 10, flat: false, col: 0xffffff, op: 0.7, w: [110, 190], h: [50, 80], y: [200, 300], mist: [0xe2ecf5, 0.35], birds: 2 },
      evening: { n: 7, flat: true, col: 0xffb89c, op: 0.45, w: [180, 300], h: [20, 32], y: [160, 240], mist: [0xffcfb0, 0.3], birds: 1 } }[p];
    const texs = [1, 2, 3].map(i => puff(i * 7919, cfg.flat)), clouds = [];
    for (let i = 0; i < cfg.n; i++) { const m = new THREE.SpriteMaterial({ map: texs[i % 3], color: cfg.col, transparent: true, opacity: cfg.op * (0.7 + rnd() * 0.3), depthWrite: false, fog: false });
      const sp = new THREE.Sprite(m), w = cfg.w[0] + rnd() * (cfg.w[1] - cfg.w[0]); sp.scale.set(w, cfg.h[0] + rnd() * (cfg.h[1] - cfg.h[0]), 1); sp.renderOrder = -1;
      const c = { s: sp, a: rnd() * Math.PI * 2, r: 640 + rnd() * 260, y: cfg.y[0] + rnd() * (cfg.y[1] - cfg.y[0]), v: (0.004 + rnd() * 0.006) * (p === 'afternoon' ? 1.4 : 1) }; clouds.push(c); g.add(sp); }
    // 지평선 안개: 산 아래를 감싸는 원통, 아래는 진하고 위로 갈수록 투명
    { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); x.fillStyle = gr; x.fillRect(0, 0, 4, 128);
      const mist = new THREE.Mesh(new THREE.CylinderGeometry(470, 470, 46, 96, 1, true), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: cfg.mist[0], transparent: true, opacity: cfg.mist[1], side: THREE.BackSide, depthWrite: false, fog: false }));
      mist.position.y = 16; mist.renderOrder = 2; mist.userData.keep = true; /* 흰 번짐 → 사용 안 함 */ }
    // 새 떼: V자 선분, 날갯짓은 y 스케일로
    const birds = [], bm = new THREE.LineBasicMaterial({ color: p === 'evening' ? 0x3a3040 : 0x3b4655, fog: false });
    const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.Float32BufferAttribute([-1.6, 0.6, 0, 0, 0, 0, 0, 0, 0, 1.6, 0.6, 0], 3));
    for (let f = 0; f < cfg.birds; f++) { const flock = new THREE.Group(); const n = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) { const b = new THREE.LineSegments(bgeo, bm); const side = i % 2 ? 1 : -1, row = Math.ceil(i / 2); b.position.set(side * row * 4.5 + (rnd() - 0.5) * 2, -row * 1.2 + (rnd() - 0.5), -row * 3); b.userData.ph = rnd() * 6.28; b.scale.setScalar(1.3); flock.add(b); }
      g.add(flock); birds.push({ g: flock, a: rnd() * Math.PI * 2, r: 220 + f * 90 + rnd() * 40, y: 55 + rnd() * 35, v: 0.035 + rnd() * 0.02 }); }
    this._addGulls(g, birds, bgeo, rnd, p === 'evening' ? 0x4a4050 : 0xf4f6f8, 0x5a6672);
    const st = { clouds, birds, t: 0, last: 0 }; this._skyStep(st, 0); return st;
  }
  // 갈매기: 안벽·바다 가까이 낮게 선회하는 작은 무리 (낮·밤 공용)
  _addGulls(g, birds, bgeo, rnd, c1, c2) {
    const gm = new THREE.LineBasicMaterial({ color: c1, fog: false }), gm2 = new THREE.LineBasicMaterial({ color: c2, fog: false });
    [[55, -70, 26, 14], [-10, -100, 30, 12], [120, 20, 22, 18], [-40, -50, 18, 10]].forEach(([cx, cz, rx, rz], f) => { const flock = new THREE.Group(); const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) { const b = new THREE.LineSegments(bgeo, i % 3 ? gm : gm2); b.position.set((rnd() - 0.5) * 9, (rnd() - 0.5) * 2.5, (rnd() - 0.5) * 7); b.scale.setScalar(0.65); b.userData.ph = rnd() * Math.PI * 2; flock.add(b); }
      flock.userData.keep = true; g.add(flock); birds.push({ g: flock, a: rnd() * Math.PI * 2, r: rx, rz, cx, cz, y: 9 + rnd() * 7, v: (f % 2 ? -1 : 1) * (0.12 + rnd() * 0.06), gull: true }); });
  }
  _buildGullsOnly(g) { let k = 11; const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647; const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.Float32BufferAttribute([-1.6, 0.6, 0, 0, 0, 0, 0, 0, 0, 1.6, 0.6, 0], 3)); const birds = []; this._addGulls(g, birds, bgeo, rnd, 0xdfe6ee, 0x9aa6b4); const st = { clouds: [], birds, t: 0, last: 0 }; this._skyStep(st, 0); return st; }
  _skyStep(st, dt) {
    st.t += dt;
    st.clouds.forEach(c => { c.a += c.v * dt; c.s.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r); });
    st.birds.forEach(b => { b.a += b.v * dt; const x = (b.cx || 0) + Math.cos(b.a) * b.r, z = (b.cz || 0) + Math.sin(b.a) * (b.rz || b.r); b.g.position.set(x, b.y + Math.sin(st.t * 0.6 + b.r) * 3, z); b.g.lookAt(x - Math.sin(b.a) * 10, b.g.position.y, z + Math.cos(b.a) * 10); b.g.rotateY(Math.PI);
      b.g.children.forEach(m => { m.scale.y = 1.3 * (0.35 + 0.65 * Math.abs(Math.sin(st.t * 7 + m.userData.ph))); }); });
  }
  // 렌즈형 글로우 텍스처: 밝은 코어 + 길게 퍼지는 감쇠 (공용 캐시)
  _glowTex() { if (this.__glow) return this.__glow; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    [[0, 1], [0.12, 0.8], [0.3, 0.38], [0.55, 0.13], [0.8, 0.03], [1, 0]].forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`)); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return (this.__glow = new THREE.CanvasTexture(c)); }
  // 보케 텍스처: 부드러운 원판 + 살짝 밝은 테두리
  _bokehTex() { if (this.__bokeh) return this.__bokeh; const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 60);
    [[0, 0.5], [0.7, 0.55], [0.88, 0.85], [0.95, 0.5], [1, 0]].forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`)); x.fillStyle = gr; x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill(); return (this.__bokeh = new THREE.CanvasTexture(c)); }
  // 교차 쿼드(그래스 기법): 세로 판 3장(60° 간격) + 가로 판 1장을 점마다 배치해 하나의 지오메트리로 합친다
  _crossGeo(points, size) { const P = [], N = [], U = [], base = [];
    [0, Math.PI / 3, Math.PI * 2 / 3].forEach(r => base.push(new THREE.PlaneGeometry(size, size).rotateY(r).toNonIndexed()));
    base.push(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).toNonIndexed());
    points.forEach(([px, py, pz]) => base.forEach(b => { const p = b.attributes.position.array, n = b.attributes.normal.array, u = b.attributes.uv.array; for (let i = 0; i < p.length; i += 3) P.push(p[i] + px, p[i + 1] + py, p[i + 2] + pz); N.push(...n); U.push(...u); }));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); return g; }
  // 글로우 셰이더: 판이 카메라와 나란해질수록(옆에서 볼수록) 투명하게 → 교차 판의 선이 보이지 않음
  _glowMat(color, opacity) { return new THREE.ShaderMaterial({ uniforms: { map: { value: this._glowTex() }, color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: 'varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); vF = abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv; varying float vF; void main(){ float a = texture2D(map, vUv).a * opacity * smoothstep(0.08, 0.7, vF); gl_FragColor = vec4(color, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }); }
  // 풀 덤불 텍스처: 가늘고 휜 잎 여러 장, 아래 진하고 끝이 밝음 (배경 투명)
  _grassTex() { if (this.__grass) return this.__grass; const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d'); let k = 5; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) { const bx = 10 + r() * 236, h = 46 + r() * 80, lean = (r() - 0.5) * 70, w = 2 + r() * 4, gr = x.createLinearGradient(0, 128, 0, 128 - h);
      const t = r(); gr.addColorStop(0, `rgb(${48 + t * 20},${70 + t * 20},${28})`); gr.addColorStop(1, `rgb(${150 + t * 50},${175 + t * 40},${70 + t * 30})`); x.fillStyle = gr;
      x.beginPath(); x.moveTo(bx - w, 128); x.quadraticCurveTo(bx - w * 0.3 + lean * 0.3, 128 - h * 0.55, bx + lean, 128 - h); x.quadraticCurveTo(bx + w * 0.3 + lean * 0.3, 128 - h * 0.55, bx + w, 128); x.closePath(); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (this.__grass = t); }
  _grassGeo() { const parts = [0, Math.PI / 3, Math.PI * 2 / 3].map(r => new THREE.PlaneGeometry(3, 1.6).translate(0, 0.8, 0).rotateY(r).toNonIndexed()); const P = [], U = [];
    parts.forEach(b => { P.push(...b.attributes.position.array); U.push(...b.attributes.uv.array); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); return g; }
  _gradientTex(stops) { const c = document.createElement('canvas'); c.width = 4; c.height = 512; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 4, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _radialTex(stops) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), gr = g.createRadialGradient(256, 256, 20, 256, 256, 256); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _buildAll() {
    this.zones = {}; this.labels.innerHTML = '';
    this.zoneLabels = [];
    PROCESSES.forEach((p, i) => this._buildZone(p, zonePos(p, i), i));
    this.zoneArrows = PROCESSES.slice(1).map((_, i) => { const el = document.createElement('div'); el.innerHTML = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', color: 'rgba(110,122,138,.85)', pointerEvents: 'none', transition: 'opacity .25s', willChange: 'transform', visibility: 'hidden' /* 공정 사이 화살표 숨김 */ }); this.labels.appendChild(el); const za = this.zones[PROCESSES[i].id], zb = this.zones[PROCESSES[i + 1].id]; return { el, pos: new THREE.Vector3((za.ox + zb.ox) / 2, 3, (za.oz + zb.oz) / 2), p0: new THREE.Vector3(za.ox, 3, za.oz), p1: new THREE.Vector3(zb.ox, 3, zb.oz) }; });
    this._buildSiteLinks();
    this._activate(this.getAttribute('process') || PROCESSES[0].id, false);
    // 처음엔 4개 공정 전체 보기
    const pose = this._overviewPose(); this.orbit.yaw = pose.yaw; this.orbit.pitch = pose.pitch; this.orbit.dist = pose.dist; this.orbit.target.copy(pose.target);
    const cur0 = this.getAttribute('process'); if (cur0 && cur0 !== 'site' && findProcess(cur0)) setTimeout(() => this.reset(), 0); // [UI 시안] 처음부터 공정이 정해져 있으면 그 공정으로 이동
  }
  // 설정 메뉴: 4개 공정 3D 모델(+이름표) 숨기기/표시 (기본 표시). 배경·지도는 그대로
  setZoneLabelsVisible(v) { this._zoneLabelsHidden = !v; (this.zoneLabels || []).forEach(z => { if (z.label) z.label.style.display = v && z.root?.visible ? '' : 'none'; }); this._dirty = true; }
  setModelsVisible(v) { this._modelsHidden = !v; Object.values(this.zones || {}).forEach(z => { if (z.root) z.root.visible = v; if (z.label) z.label.style.display = v ? '' : 'none'; }); if (this._links) this._links.g.visible = v; this._dirty = true; }
  _buildZone(p, pos, zi) {
    const [ox, oz] = pos;
    const z = { id: p.id, ox, oz, root: new THREE.Group(), eqs: [], anchorMode: false, home: { yaw: -0.5, pitch: 0.36, dist: 48, target: [ox, 1.5, oz] }, ringScale: 1 };
    z.root.name = `PROCESS_${p.id}`;
    const n = p.equipment.length;
    p.equipment.forEach((e, i) => {
      const lx = n === 1 ? 0 : -15 + 30 * i / (n - 1), x = ox + lx;
      const g = equipmentPrimitive(e.shape); g.name = `EQ_${e.id}`; g.position.set(x, 0, oz); g.userData.id = e.id;
      g.traverse(o => { if (o.isMesh) { o.userData.eq = e.id; o.userData.base = o.material.emissive.getHex(); } });
      z.root.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const lab = document.createElement('div');
      lab.innerHTML = `<i>${i + 1}</i><span class="nm" style="display:flex;flex-direction:column;gap:2px"><b>${e.name}</b><u></u></span>`;
      const tip = lab.querySelector('u'); tip.textContent = e.role; tip.style.cssText = 'text-decoration:none;display:none;font-size:11px;font-weight:400;opacity:0;max-height:0;overflow:hidden;white-space:normal;max-width:220px;line-height:1.4;color:inherit;transition:max-height .22s ease, opacity .22s ease';
      Object.assign(lab.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform', display: 'none', alignItems: 'flex-start', gap: '8px', padding: '4px 6px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', fontWeight: '500', letterSpacing: '0.02em', lineHeight: '1', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer', textShadow: 'none', transition: 'opacity .2s' });
      lab.querySelector('i').style.cssText = 'flex:none;display:flex;align-items:center;justify-content:center;font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:700;color:' + UI_INK;
      lab.onmouseenter = () => { this._hover(e.id); }; lab.onmouseleave = () => { this._hover(null); this._styleLabels(); if (this.dimmed) this.eqs.forEach(q => { if (q.id !== this.getAttribute('selected')) q.label.style.opacity = '0.2'; }); };
      lab.onclick = () => this._select(e.id, true);
      this.labels.appendChild(lab);
      const sz = box.getSize(new THREE.Vector3());
      z.eqs.push({ id: e.id, x, zone: p.id, data: e, anchor: new THREE.Vector3(x, box.max.y + 0.6, oz), focus: new THREE.Vector3(x, 2.5, oz), dist: 16, group: g, label: lab, interior: e.interior ? { cx: x, cz: oz, y0: box.min.y + 0.3, y1: box.max.y - 0.4, r: sz.x * 0.34 } : null });
    });
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ox - 18, 0.05, oz + 3.2), new THREE.Vector3(ox + 18, 0.05, oz + 3.2)]);
    const line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0x22c7f0, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.5 })); line.computeLineDistances(); z.root.add(line);
    z.path = [new THREE.Vector3(ox - 18, 0, oz + 3.2), ...z.eqs.map(e => new THREE.Vector3(e.x, 0, oz + 3.2)), new THREE.Vector3(ox + 18, 0, oz + 3.2)];
    z.states = [p.materialIn, ...p.equipment.map(e => e.materialOut)];
    z.root.visible = false; // GLB 확인 전까지 기본 도형 숨김
    this.scene.add(z.root);
    // 구역 타이틀 라벨 (클릭 → 그 공정으로 이동)
    const zl = document.createElement('button');
    zl.innerHTML = `<code>${p.num}</code><span style="display:flex;flex-direction:column;align-items:flex-start;gap:2px"><b>${p.name}</b><small>${p.sub || ''}</small></span>`;
    Object.assign(zl.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform', display: 'flex', alignItems: 'baseline', gap: '8px', padding: '8px 14px', border: '1px solid rgba(255,255,255,.25)', borderRadius: '2px', background: 'rgba(8,12,18,.6)', color: '#fff', fontFamily: '"IBM Plex Sans KR", sans-serif', cursor: 'pointer', pointerEvents: 'auto', whiteSpace: 'nowrap', transition: 'opacity .25s, background .2s, border-color .2s' });
    zl.querySelector('code').style.cssText = 'font-family:"Noto Sans KR",sans-serif;font-size:26px;font-weight:900;line-height:1;opacity:.55'; zl.querySelector('b').style.cssText = 'font-size:17px;font-weight:700;letter-spacing:.02em'; zl.querySelector('small').style.cssText = 'font-size:11px;font-weight:500;opacity:.75;white-space:nowrap';
    zl.onmouseenter = () => { zl.style.borderColor = UI; zl.style.background = UI; zl.style.color = UI_INK; }; zl.onmouseleave = () => this._styleZoneLabels();
    const go = (ev) => { ev.stopPropagation(); ev.preventDefault(); this.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: p.id }, bubbles: true, composed: true })); };
    zl.onpointerdown = go; zl.onpointerup = (ev) => ev.stopPropagation();
    zl.onclick = (ev) => ev.stopPropagation();
    this.labels.appendChild(zl); z.label = zl; const lb = SITE[p.id]?.lab || [0, 13]; z.labelPos = new THREE.Vector3(ox + lb[0], 0, oz + lb[1]);
    this.zones[p.id] = z; this.zoneLabels.push(z); if (this._modelsHidden) { z.root.visible = false; zl.style.display = 'none'; } if (this._zoneLabelsHidden) zl.style.display = 'none';
    // 지금 보는 공정 먼저, 나머지는 순서대로 조금씩 늦게 불러온다
    const cur = this.getAttribute('process'), first = !cur || cur === 'site' ? zi === 0 : cur === p.id;
    if (first) this._loadGLB(p, z); else setTimeout(() => this._loadGLB(p, z), 0);
  }
  _styleZoneLabels() { const ov = this.orbit.dist > 120; (this.zoneLabels || []).forEach(z => { Object.assign(z.label.style, { borderColor: 'rgba(255,255,255,.1)', background: 'rgba(38,46,58,.94)', color: '#ffffff', borderRadius: '8px', padding: '9px 16px 9px 14px', alignItems: 'center', gap: '12px', boxShadow: '0 8px 20px rgba(15,20,30,.25)', opacity: ov ? '1' : '0', pointerEvents: ov ? 'auto' : 'none' }); }); (this.zoneArrows || []).forEach(a => { a.el.style.opacity = ov ? '1' : '0'; }); }
  // 공정 활성화: 해당 구역을 현재 작업 대상으로 바꾸고 카메라를 그 구역으로 이동
  _activate(id, fly) {
    const p = findProcess(id), z = this.zones?.[id]; if (!p || !z) return;
    if (this.touring) { this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; }
    this._showInterior(null); this._dimOthers(null); this._secShown = null;
    if (this.eqs) this.eqs.forEach(e => { e.label.style.display = 'none'; });
    this.process = p; this.zone = z; this.root = z.root; this.eqs = z.eqs; this.path = z.path; this.states = z.states; this.stops = z.stops; this.rail = z.rail; this.matScale = z.matScale; this.anchorMode = z.anchorMode; this.home = z.home; this.ring.scale.setScalar(z.ringScale);
    this.eqs.forEach(e => { e.label.style.display = z.root.visible ? 'flex' : 'none'; e._lx = null; });
    this.stop(); this._setMaterial(0, this.path[0]); this._emitProgress();
    this._applySelection(); this._styleZoneLabels(); this._zoneLight(); this._placeSun(); this._zoneVis(); if (this._navG) this._navG.clear(); this._applyView(); if (this._2d) { this._2d = false; this._2dZone = null; this.camera = this._persp; this._2dStyle(); this._applyTheme(); } this._apply2d();
    if (fly && !this._pendingTour) this.reset(); // 시연 예약 시 전체 시점으로 날아가지 않고 바로 첫 설비로
    this._emitModel(z.modelStatus || 'loading', z.modelUrl || '', z.mapped || 0);
  }
  // 공정 안에서 이웃 공정으로 넘어가는 3D 화살표 (바닥 위 이중 화살표 + 떠 있는 이름표). 클릭하면 그 공정으로 이동
  _navArrows() {
    if (!this._navG) { this._navG = new THREE.Group(); this._navG.name = 'NAV_ARROWS'; this.scene.add(this._navG); }
    const G = this._navG; G.clear(); const i = PROCESSES.findIndex(p => p.id === this.process?.id); if (i < 0) return;
    const shape = new THREE.Shape([[-0.9, 0.55], [0.1, 0.55], [0.1, 1.2], [1.3, 0], [0.1, -1.2], [0.1, -0.55], [-0.9, -0.55]].map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x22c7f0 }), mat2 = new THREE.MeshBasicMaterial({ color: 0x22c7f0, transparent: true, opacity: 0.45 });
    const tag = (top, name, dir) => { const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
      x.fillStyle = 'rgba(10,16,24,.62)'; x.beginPath(); x.roundRect(6, 6, 500, 148, 40); x.fill(); x.strokeStyle = 'rgba(34,199,240,.9)'; x.lineWidth = 4; x.stroke();
      x.fillStyle = '#9fd4f0'; x.font = '600 34px "IBM Plex Sans KR", sans-serif'; x.textAlign = 'center'; x.fillText(dir < 0 ? '‹ ' + top : top + ' ›', 256, 62);
      x.fillStyle = '#ffffff'; x.font = '700 52px "IBM Plex Sans KR", sans-serif'; x.fillText(name, 256, 124);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); sp.scale.set(6.3, 1.96, 1); sp.renderOrder = 20; return sp; };
    const ox = this.zone.ox, oz = this.zone.oz || 0;
    [[-1, PROCESSES[i - 1], '이전 공정'], [1, PROCESSES[i + 1], '다음 공정']].forEach(([dir, np, top]) => { if (!np) return;
      const a = new THREE.Group(); a.position.set(ox + dir * 30, 0.15, oz + 3.2); a.userData.go = np.id; a.userData.dir = dir;
      const m1 = new THREE.Mesh(geo, mat), m2 = new THREE.Mesh(geo, mat2); m1.scale.setScalar(1.12); m2.scale.setScalar(1.12); if (dir < 0) { m1.rotation.y = Math.PI; m2.rotation.y = Math.PI; }
      m1.userData.go = m2.userData.go = np.id; m2.position.x = -dir * 1.8; a.add(m1, m2); a.userData.m = [m1, m2];
      const gl = new THREE.Mesh(this._crossGeo([[0, 0.6, 0]], 6), this._glowMat(0x22c7f0, 0.55)); a.add(gl);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 4), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 1.5; hit.userData.go = np.id; a.add(hit);
      G.add(a); });
    this._dirty = true;
  }
  // 화살표 위치: 화면 기준 좌하단(왼쪽 메뉴 피해서)·우하단 지점을 바닥에 투영해 3D 위치를 정한다 → 어떤 카메라 각도에서도 보임
  _placeNav() {
    const cam = this.camera, right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; right.normalize();
    const c = new THREE.Vector3(this.zone.ox, 0, this.zone.oz || 0), narrow = this.clientWidth < 700;
    this._navG.children.forEach(a => { const d = a.userData.dir;
      const p = new THREE.Vector3(d < 0 ? (narrow ? -0.7 : -0.12) : 0.74, -0.5, 0.5).unproject(cam), dir = p.sub(cam.position); if (Math.abs(dir.y) < 1e-4) return;
      const t = (0.15 - cam.position.y) / dir.y; if (t <= 0) return; const w = cam.position.clone().addScaledVector(dir, t);
      const off = w.sub(c); if (off.length() > 40) off.setLength(40); a.position.set(c.x + off.x, 0.15, c.z + off.z);
      a.rotation.y = Math.atan2(-right.z, right.x); });
  }
  // models/<processId>.glb 가 있으면 기본 도형을 GLB 노드(EQ_<id>)로 교체
  async _loadGLB(p, z) {
    const url = new URL(`models/${p.id}.glb`, document.baseURI).href; z.modelUrl = url; z.modelStatus = 'loading';
    if (this.zone === z) this._emitModel('loading', url);
    let cfg = null;
    try { const all = await (await fetch(new URL('models/anchors-v2b.json', document.baseURI))).json(); cfg = all[p.id] || null; } catch (e) {}
    const done = (status, mapped) => { z.modelStatus = status; z.mapped = mapped; z.root.visible = true; this._zoneVis(); if (this.zone === z) { this.eqs.forEach(e => { e.label.style.display = 'flex'; }); if (this.material) this.material.visible = true; this._emitModel(status, url, mapped); this._zoneLight(); } this._dirty = true; };
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene; model.name = `GLB_${p.id}`;
      const sc = cfg?.scale ?? 1, off = new THREE.Vector3().fromArray(cfg?.offset || [0, 0, 0]).add(new THREE.Vector3(z.ox, 0, z.oz || 0));
      model.scale.setScalar(sc); model.position.copy(off);
      // [UI 시안] 재질 보정: 금속 재질은 환경맵 반사로 밝히고, 쇳물·고온 슬라브는 더 뜨겁게 빛나게, 그림자 주고받기
      model.traverse(o => { if (o.isMesh) { const m = o.material = o.material.clone(), nm = m.name || '';
        o.castShadow = true; o.receiveShadow = true; m.envMapIntensity = 0.9;
        if (/^(Steel|Steel_Dark|Struct_Gray|Roll_Steel|Coil_Cooled|Chrome_Rod)$/.test(nm)) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 1.15; }
        if (nm === 'Concrete') { m.color.setRGB(0.6, 0.61, 0.62); o.castShadow = false; }
        if (nm === 'Cladding') m.color.setRGB(0.6, 0.63, 0.66);
        if (nm === 'Grating') m.color.setRGB(0.36, 0.38, 0.4);
        if (/^(Molten_Steel|Hot_Slab|Slag_Hot)$/.test(nm)) { m.emissiveIntensity = 2.2; m.toneMapped = false; o.castShadow = false; }
        if (nm === 'Slab_Cooling') m.emissiveIntensity = 1.6;
        if (/Water/.test(nm)) o.castShadow = false;
        if (nm === 'Glass') { m.envMapIntensity = 0.3; m.roughness = 0.35; }
        if (nm === 'Blue_Steel') { m.envMapIntensity = 0.5; m.roughness = Math.max(0.55, m.roughness); }
        o.userData.base = m.emissive ? m.emissive.getHex() : 0; o.userData.baseI = m.emissiveIntensity; } }); this._paintSite();
      const M = (a) => new THREE.Vector3().fromArray(a).multiplyScalar(sc).add(off);
      let mapped = 0;
      z.eqs.forEach(e => {
        const node = model.getObjectByName(`EQ_${e.id}`), a = cfg?.anchors?.[e.id];
        if (node) {
          node.traverse(o => { if (o.isMesh) o.userData.eq = e.id; });
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(node), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
          e.group.visible = false; e.group = node; e.x = c.x; e.anchor.set(c.x, box.max.y + 0.6, c.z); e.focus.set(c.x, c.y, c.z); e.dist = Math.max(10, sz * 1.6); mapped++;
          // 내부 단면: anchors의 interiors(또는 anchors.interior) 좌표를 쓰고, 없으면 노드 경계 상자로 잡는다
          if (e.data.interior) { const iv = cfg?.interiors?.[e.id] || a?.interior; if (iv) { const ic = M([iv.center[0], 0, iv.center[1]]); e.interior = { cx: ic.x, cz: ic.z, y0: iv.y0 * sc + off.y, y1: iv.y1 * sc + off.y, r: iv.r * sc, box: iv.box ? [iv.box[0] * sc, iv.box[1] * sc] : null, w: iv.w ? iv.w * sc : null }; } else { const bs = box.getSize(new THREE.Vector3()); e.interior = { cx: c.x, cz: c.z, y0: box.min.y + bs.y * 0.08, y1: box.max.y - bs.y * 0.08, r: Math.min(bs.x, bs.z) * 0.3 }; } }
        } else if (a) {
          e.group.visible = false; e.group = new THREE.Group(); e.anchor.copy(M(a.label)); e.focus.copy(M(a.focus || a.label)); e.x = e.focus.x; e.dist = (a.dist ?? 40) * sc; mapped++;
          if (a.interior && e.data.interior) { const c = M([a.interior.center[0], 0, a.interior.center[1]]); e.interior = { cx: c.x, cz: c.z, y0: a.interior.y0 * sc + off.y, y1: a.interior.y1 * sc + off.y, r: a.interior.r * sc }; }
          else if (e.data.interior) { // anchors에 단면 좌표가 없으면 포커스 주변 GLB 메시의 경계 상자에 맞춰 단면 모형을 배치한다
            model.updateMatrixWorld(true); const f = e.focus, R0 = Math.max(3, e.dist * 0.28), ub = new THREE.Box3(), bb = new THREE.Box3(), bc = new THREE.Vector3(); let hit = 0;
            model.traverse(o => { if (!o.isMesh || o.userData.floor) return; bb.setFromObject(o); if (bb.isEmpty()) return; bb.getCenter(bc); const bs = bb.getSize(new THREE.Vector3()); if (Math.max(bs.x, bs.z) > R0 * 3) return; if (bs.y > 1.6 * Math.max(bs.x, bs.z)) return; /* 굴뚝처럼 가늘고 긴 메시는 제외 */ if (Math.hypot(bc.x - f.x, bc.z - f.z) < R0 && bb.max.y > 0.3) { ub.union(bb); hit++; } });
            if (hit) { const c = ub.getCenter(new THREE.Vector3()), bs = ub.getSize(new THREE.Vector3()), r = Math.max(0.8, Math.min(bs.x, bs.z) * 0.3); e.interior = { cx: c.x, cz: c.z, y0: Math.max(0.1, ub.min.y + bs.y * 0.06), y1: ub.max.y - bs.y * 0.06, r }; e.focus.set(c.x, c.y, c.z); e.anchor.set(c.x, ub.max.y + 0.6, c.z); }
            else { const r = Math.max(0.8, e.dist * 0.08); e.interior = { cx: f.x, cz: f.z, y0: Math.max(0.1, f.y - r * 1.5), y1: f.y + r * 1.5, r }; } }
        }
      });
      if (!mapped) { done('glb-no-nodes', 0); return; }
      z.root.children.filter(c => c.isLine).forEach(l => z.root.remove(l));
      model.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); }); model.matrixAutoUpdate = false; model.updateMatrix();
      // [UI 시안] 공정 바닥판은 낮·밤 모두 투명(숨김). 밤에는 바닥판 외곽만 빛나는 네온 테두리로 표시
      model.updateMatrixWorld(true); const fb = new THREE.Box3();
      model.traverse(o => { if (!o.isMesh) return; for (let q = o; q && q !== model; q = q.parent) if (/^Floor_/.test(q.name)) { o.visible = false; o.castShadow = false; o.userData.floor = true; fb.expandByObject(o); break; } });
      if (!fb.isEmpty()) { z.floorBox = fb; this._neonAll(); }
      z.root.add(model); z.glb = model; z.anchorMode = !!cfg?.anchors; this._addSmoke(z, model);
      z.path = cfg?.flow ? cfg.flow.map(M) : [z.eqs[0].focus.clone().add(new THREE.Vector3(-6, 0, 0)), ...z.eqs.map(e => e.focus.clone()), z.eqs[z.eqs.length - 1].focus.clone().add(new THREE.Vector3(6, 0, 0))];
      if (cfg?.home) { const t = cfg.home.target || [0, 1.5, 0]; z.home = { ...z.home, ...cfg.home, target: [t[0] + z.ox, t[1], t[2] + (z.oz || 0)] }; }
      z.ringScale = cfg?.ringScale ?? 1; z.stops = cfg?.stops || null; z.rail = !!cfg?.rail; z.matScale = cfg?.materialScale ?? 1;
      if (this.zone === z) { this.path = z.path; this.stops = z.stops; this.rail = z.rail; this.matScale = z.matScale; this.anchorMode = z.anchorMode; this.home = z.home; this.ring.scale.setScalar(z.ringScale); this.stop(); this._setMaterial(0, this.path[0]); this._applySelection(); }
      this._buildSiteLinks(); done('glb', mapped); this.dispatchEvent(new CustomEvent('steel-layout', { detail: { process: p.id }, bubbles: true, composed: true })); if (this._2d && this.zone === z) { this._fit2d(false); this._2dStyle(); }
    }, undefined, () => done('primitive', 0));
  }
  _emitModel(status, url, mapped = 0) { this.dispatchEvent(new CustomEvent('steel-model', { detail: { status, url, mapped, process: this.process?.id }, bubbles: true, composed: true })); }
  _setMaterial(stateIdx, x) {
    const key = this._torpedoMat ? 'torp' : stateIdx; // 제강 첫 구간: 쇳물 덩어리 대신 토페도카가 직접 들어옴
    if (this.matIdx !== key) {
      if (this.material) this.scene.remove(this.material);
      if (!this._dotTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this._dotTex = new THREE.CanvasTexture(c); }
      this.material = this._torpedoMat ? this._buildTorpedo() : materialMesh(this.states[stateIdx]); this.material.name = 'MATERIAL'; this.material.scale.setScalar(this.matScale || 1); this.material._fresh = true; this.matBase = new THREE.Box3().setFromObject(this.material).min.y; this.material.visible = !!(this.zone && this.zone.root.visible); this.scene.add(this.material);
      const hot = this.states[stateIdx], hc = new THREE.Color(hot.color); if (hc.r > 0.85 || hot.shape === 'liquid') { const L = new THREE.PointLight(hc, 2.6, 9 * (this.matScale || 1), 2); L.position.y = 0.8; this.material.add(L); }
      this.material.traverse(o => { if (o.isMesh || o.isPoints) { o.castShadow = false; o.visible = !!(this.zone && this.zone.root.visible) && (this.touring || this.playing || !!this.move); } });
      this.matIdx = key;
    }
    this.material.position.copy(x); if (this.rail) this.material.position.y -= this.matBase || 0; this.material.visible = !this._hideMat;
  }
  _buildTorpedo() {
    const g = new THREE.Group(), tank = new THREE.Group(), steel = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.7, roughness: 0.42 }), dark = new THREE.MeshStandardMaterial({ color: 0x23272d, metalness: 0.5, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.0, 28), steel); body.rotation.z = Math.PI / 2; tank.add(body);
    [-1, 1].forEach(d => { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 14), steel); cap.scale.set(1.1, 0.82, 0.82); cap.position.x = d * 1.0; tank.add(cap);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 28), dark); ring.rotation.y = Math.PI / 2; ring.position.x = d * 0.7; tank.add(ring);
      const bog = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 1.0), dark); bog.position.set(d * 1.05, 0.2, 0); g.add(bog);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 1.1), new THREE.MeshStandardMaterial({ color: 0xd8b21e, roughness: 0.6 })); pad.position.set(d * 1.05, 0.04, 0); g.add(pad); });
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.16, 18), dark); hatch.position.y = 0.6; tank.add(hatch);
    const hot = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18), new THREE.MeshBasicMaterial({ color: 0xffa040 })); hot.rotation.x = -Math.PI / 2; hot.position.y = 0.685; tank.add(hot);
    tank.position.y = 0.95; g.add(tank);
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 1, 10), new THREE.MeshBasicMaterial({ color: 0xffe0a0 })); stream.add(core); stream.visible = false; g.add(stream);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
    g.userData.torp = { tank, hatch, stream, pool }; return g;
  }
  // 제강 GLB 속 토페도카(S1_Torpedo_Car)와 붓는 쇳물(S1_Ladle_Car_5)을 직접 움직인다
  _torpSetup() {
    if (this._torp) return true; const glb = this.zone?.glb; if (!glb) return false; let car = null, stream = null;
    glb.traverse(o => { if (o.name === 'S1_Torpedo_Car') car = o; if (o.name === 'S1_Ladle_Car_5') stream = o; }); if (!car || !car.parent) return false;
    car.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(car), c = bb.getCenter(new THREE.Vector3()), par = car.parent;
    const pivot = new THREE.Object3D(); par.add(pivot); pivot.position.copy(par.worldToLocal(c.clone())); pivot.updateMatrixWorld(true);
    const save = { pos: car.position.clone(), quat: car.quaternion.clone() }; pivot.attach(car);
    let sMat = null; if (stream) { sMat = stream.material; stream.material = sMat.clone(); stream.material.transparent = true; stream.material.opacity = 0; if (stream.material.emissive) stream.material.emissive.set(0xff6b35); }
    this._torp = { car, par, pivot, save, p0: pivot.position.clone(), stream, sMat, ph: null }; return true;
  }
  _torpTick(now) {
    const T = this._torp; if (!T || !T.ph) return; const P = T.ph, k = Math.min(1, Math.max(0, (now - P.t0) / P.dur)), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    if (P.kind === 'drive') { T.pivot.position.set(T.p0.x - 8 * (1 - e), T.p0.y, T.p0.z); T.pivot.rotation.x = 0; if (T.stream) T.stream.material.opacity = 0; }
    else { T.pivot.position.copy(T.p0); T.pivot.rotation.x = 0.32 * e; if (T.stream) { const f = Math.max(0, (k - 0.5) / 0.5); T.stream.material.opacity = f * (0.85 + 0.15 * Math.sin(now / 70)); if (T.stream.material.emissiveIntensity != null) T.stream.material.emissiveIntensity = 1.2 + 0.5 * Math.sin(now / 90); } }
    T.pivot.updateMatrixWorld(true); this._dirty = true;
  }
  _torpReset() {
    const T = this._torp; if (!T) return; this._torp = null; T.par.attach(T.car); T.car.position.copy(T.save.pos); T.car.quaternion.copy(T.save.quat); T.car.updateMatrixWorld(true); T.par.remove(T.pivot);
    if (T.stream) { T.stream.material.dispose(); T.stream.material = T.sMat; } this._hideMat = false; this._dirty = true;
  }
  // (미사용) 절차적 토페도카 — 토페도카가 옆으로 기울어 쇳물을 쏟아붓는다 (k: 0→1 기울기, 이후 계속 흘림)
  _pourTick(now) {
    const P = this._pour, T = this.material?.userData?.torp; if (!T) return; if (!P) { if (T.stream.visible) { T.stream.visible = false; T.pool.material.opacity = 0; } return; }
    const k = Math.min(1, Math.max(0, (now - P.t0) / P.dur)), e = k * k * (3 - 2 * k), ang = -1.75 * e; T.tank.rotation.x = ang;
    const flow = Math.max(0, (k - 0.55) / 0.45); T.tank.updateMatrix();
    const p = new THREE.Vector3(0, 0.66, 0).applyMatrix4(T.tank.matrix);
    T.stream.visible = flow > 0; if (flow > 0) { const len = Math.max(0.05, p.y), w = 0.85 + 0.25 * Math.sin(now / 55) + 0.1 * Math.sin(now / 23); T.stream.position.set(p.x, p.y - len / 2, p.z + 0.05); T.stream.scale.set(w * flow, len, w * flow); }
    T.pool.position.set(p.x, 0.02, p.z); T.pool.material.opacity = 0.7 * flow; T.pool.scale.setScalar(0.6 + 0.6 * flow + 0.06 * Math.sin(now / 90)); this._dirty = true;
  }
  _stopPos(i) { return this.path[this._stopIdx(i)]; }
  _stopList() { return this.stops || this.path.map((_, i) => i); }
  _nStops() { return this.stops ? this.stops.length : this.path.length; }
  _stopIdx(i) { const S = this._stopList(); return S[Math.max(0, Math.min(i, S.length - 1))]; }
  // 경로 인덱스 a..b 구간을 실제 거리 기준으로 보간(레일 위 등속 이동)
  _along(a, b, u) {
    const P = this.path; if (a === b) return { pos: P[a].clone(), dir: new THREE.Vector3(1, 0, 0), seg: a, f: 0 };
    const L = []; let tot = 0; for (let i = a; i < b; i++) { const l = P[i].distanceTo(P[i + 1]); L.push(l); tot += l; }
    let d = Math.max(0, Math.min(1, u)) * tot, j = 0; while (j < L.length - 1 && d > L[j]) { d -= L[j]; j++; }
    const i = a + j, f = L[j] ? Math.min(1, d / L[j]) : 0;
    return { pos: new THREE.Vector3().lerpVectors(P[i], P[i + 1], f), dir: new THREE.Vector3().subVectors(P[i + 1], P[i]).normalize(), seg: i, f };
  }
  _orient(dir) {
    const m = this.material; m.rotation.order = 'YZX';
    const yaw = Math.atan2(-dir.z, dir.x), pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    if (m._fresh) { m.rotation.y = yaw; m.rotation.z = pitch; m._fresh = false; return; }
    let dy = yaw - m.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * 0.12; m.rotation.z += (pitch - m.rotation.z) * 0.12;
  }
  _applySelection() { this._dirty = true;
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => {
      const on = e.id === id;
      e.group.traverse(o => { if (o.isMesh && o.material.emissive) { const tint = on && !this._noTint(); o.material.emissive.setHex(tint ? ACCENT : o.userData.base); o.material.emissiveIntensity = tint ? 0.35 : (o.userData.base ? (o.userData.baseI ?? 0.6) : 0); } });
    });
    this._styleLabels();
    const sel = this.eqs.find(e => e.id === id);
    const sec = sel && sel.interior && (this.getAttribute('view') === 'section' || this.touring) ? sel : null;
    if (sec !== this._secShown) { this._secShown = sec; this._showInterior(sec); this._dimOthers(sec); }
    this.ring.material.color.set(this.dark ? 0x5cc8ff : 0x22c7f0); this.ring.material.opacity = 0.75; this.ring.visible = !!sel && !sec && !this._isVehicle(sel); if (sel) this.ring.position.set(sel.focus.x, 0.02 + (this.anchorMode ? 0.4 : 0), sel.focus.z); if (this._2d && this._drawMode !== 'top') this.ring.visible = false;

  }
  // 선택된 설비 내부 단면(X-ray): data.js의 equipment.interior 레이어를 색깔 층으로 표시
  _typewrite(el, text, delay, speed, showEl) {
    const target = showEl || el; const t0 = setTimeout(() => { target.style.opacity = '1'; let i = 0; const tick = () => { if (!el.isConnected) return; el.textContent = text.slice(0, ++i) + (i < text.length ? '▍' : ''); if (i < text.length) this._timers.push(setTimeout(tick, speed)); }; tick(); }, delay);
    this._timers.push(t0);
  }
  _showInterior(e) { this._dirty = true; this._secShown = e || null; this._layerHL(null); this._fx().play(null);
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    if (this.interior) { this.scene.remove(this.interior); this.interior = null; }
    (this.interiorLabels || []).forEach(l => l.remove()); this.interiorLabels = []; this.layerItems = []; this.pinnedLayer = null; if (this.activeLayer !== null && this.activeLayer !== undefined) this.dispatchEvent(new CustomEvent('steel-layer', { detail: { layer: null }, bubbles: true, composed: true })); this.activeLayer = null;
    if (!e) return;
    const { cx, cz, y0, y1, r } = e.interior, layers = e.data.interior, H = y1 - y0, layout = e.data.interiorLayout || 'stack';
    const g = new THREE.Group(); let y = y1, x = cx - r * 1.6;
    const W = e.interior.w || r * 3.2, mat = (c, op = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false });
    this.interiorSpan = layout === 'stack' || layout === 'stove' ? H : W;
    if (layout === 'strand') { this.interiorSpan = W; x = cx - W / 2; }
    const x0 = cx - W / 2;
    layers.forEach((L, idx) => {
      let m, mid, h = L.h * H, cardX;
      if (layout === 'strand') {         // 연주 주편: 노란 호(주형 출구→수평)를 따라 판을 이어 붙임
        // 호: 중심 (x0+R, y1), 반지름 R=H → 위쪽(주형 아래)에서 시작해 90° 돌며 바닥 y0에서 수평
        const Rr = H, qLen = Math.PI / 2 * Rr, total = qLen + Math.max(0, W - Rr), th = 0.32, dp = r * 1.3;
        const t0 = x - x0, t1 = t0 + L.h * total, segs = [];
        const P = t => Rr > 0.01 && t < qLen ? { x: x0 + Rr - Rr * Math.cos(t / Rr), y: y1 - Rr * Math.sin(t / Rr), a: -(t / Rr) } : { x: x0 + Rr + (t - qLen), y: y0, a: -Math.PI / 2 };
        const n = Math.max(2, Math.ceil((t1 - t0) / 0.28)); m = new THREE.Group();
        for (let q = 0; q < n; q++) { const ta = t0 + (t1 - t0) * q / n, tb = t0 + (t1 - t0) * (q + 1) / n, pa = P(ta), pb = P(tb), len = Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1.08;
          const seg = new THREE.Mesh(new THREE.BoxGeometry(len, th, dp), mat(L.color)); seg.position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 + th / 2, cz); seg.rotation.z = Math.atan2(pb.y - pa.y, pb.x - pa.x); m.add(seg); }
        const pm = P((t0 + t1) / 2); mid = new THREE.Vector3(pm.x, pm.y + th, cz); x += L.h * total; h = th; cardX = mid.x;
      } else if (layout === 'bed') {            // 소결: 수평 이동 베드 — 왼쬭→오른쬭 구간
        const w = L.h * W, bh = H * 0.45; m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh, r * 1.2), mat(L.color));
        m.position.set(x + w / 2, y0 + bh / 2, cz); mid = m.position.clone(); x += w;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh * 0.12, r * 1.3), mat(0x2a2f36, 0.95)); rail.position.set(mid.x, y0 - bh * 0.06, cz); rail.renderOrder = 10; g.add(rail);
        h = bh; cardX = mid.x;
      } else if (layout === 'chambers') { // 코크스: 좁은 탄화실이 나란히 — 연소실 벽은 사이사이 얇은 벽
        if (L.wall) {
          m = new THREE.Group(); const n = layers.filter(q => !q.wall).length, cw = W / n;
          for (let i = 0; i <= n; i++) { const wall = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.18, H, r * 1.5), mat(L.color)); wall.position.set(cx - W / 2 + i * cw, y0 + H / 2, cz); wall.renderOrder = 10; m.add(wall); }
          mid = new THREE.Vector3(cx, y1 + H * 0.08, cz);
        } else {
          const n = layers.filter(q => !q.wall).length, cw = W / n, i = layers.filter((q, k) => k < idx && !q.wall).length;
          m = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.74, H * 0.92, r * 1.4), mat(L.color)); m.position.set(cx - W / 2 + cw * (i + 0.5), y0 + H * 0.46, cz); mid = m.position.clone();
        }
        h = H; cardX = mid.x;
      } else if (layout === 'stove' && idx === 0) {   // 열풍로: 돔
        m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.color)); m.position.set(cx, y - h, cz); mid = new THREE.Vector3(cx, y - h * 0.4, cz); y -= h;
      } else if (layout === 'stove' && idx === layers.length - 1) {   // 열풍로: 열풍 출구 관 (오른쬭으로)
        m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 2.4, 16), mat(L.color)); m.rotation.z = Math.PI / 2; m.position.set(cx + r + r * 1.2, y0 + H * 0.12, cz); mid = m.position.clone();
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 0.6, 16), mat(L.color)); arrow.rotation.z = -Math.PI / 2; arrow.position.set(cx + r + r * 2.6, y0 + H * 0.12, cz); arrow.renderOrder = 10; g.add(arrow);
      } else {                            // 기본: 수직 층 (고로 등)
        const prof = e.id === 'blast_furnace' ? (t) => { const P = [[0, 0.56], [0.1, 0.6], [0.52, 0.9], [0.66, 0.94], [0.8, 0.76], [1, 0.8]]; let i = 1; while (i < P.length - 1 && t > P[i][0]) i++; const [a, ra] = P[i - 1], [b, rb] = P[i]; return ra + (rb - ra) * (t - a) / (b - a); } : () => 0.86;
        const tTop = (y1 - y) / H, tBot = (y1 - y + h) / H;
        // anchors interiors.<id>.box = [가로, 세로] 가 있으면 원통 대신 직육면체(턴디시 같은 각진 통)
        m = new THREE.Mesh(e.interior.box ? new THREE.BoxGeometry(e.interior.box[0], h, e.interior.box[1]) : new THREE.CylinderGeometry(r * prof(tTop), r * prof(tBot), h, 40), mat(L.color)); m.position.set(cx, y - h / 2, cz); mid = m.position.clone(); y -= h; m.userData.vert = true;
      }
      m.renderOrder = 10; m.traverse(o => { o.renderOrder = 10; o.userData.layerIdx = idx; }); g.add(m);
      // 온도 칩: 층 안쪽 중앙, 클릭 → 그 층으로 포커스 + 설명 등장
      const tl = document.createElement('button');
      tl.textContent = L.temp || '·';
      Object.assign(tl.style, { position: 'absolute', transform: 'translate(-50%,-50%)', fontFamily: '"IBM Plex Mono", monospace', fontSize: '13px', fontWeight: '700', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', color: '#fff', background: 'rgba(8,12,18,.45)', border: '1px solid rgba(255,255,255,.35)', borderRadius: '2px', padding: '4px 10px', textShadow: '0 0 6px rgba(0,0,0,.9)', opacity: '0', transition: 'opacity .3s, transform .2s, background .2s, border-color .2s', pointerEvents: 'auto' });
      const horizL = layout === 'bed' || layout === 'chambers' || layout === 'strand';
      tl._pos = horizL ? new THREE.Vector3(mid.x, mid.y + (idx % 2 ? -1 : 1) * h * 0.95, mid.z) : mid; tl._lead = horizL ? mid : null;
      // 수직 층: 온도 칩을 몸체 왼쪽 바깥으로 빼고 지시선으로 연결 (칩끼리 겹치지 않게)
      if (this._ext()) { tl._hide = true; tl.style.display = 'none'; } else if (m.userData.vert) { const side = new THREE.Vector3(cx - r * 2.6, mid.y, cz); tl._pos = side; const ll = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx - r * 1.02, mid.y, cz), new THREE.Vector3(cx - r * 1.9, mid.y, cz)]), new THREE.LineBasicMaterial({ color: L.color, transparent: true, opacity: 0.9, depthTest: false })); ll.renderOrder = 12; g.add(ll); } this.labels.appendChild(tl); this.interiorLabels.push(tl);
      this._timers.push(setTimeout(() => { tl.style.opacity = '1'; }, 120 * idx + 200));
      // 마우스 올리면 바로 그 층 열기(설명 자동 표시), 클릭하면 고정
      tl.onmouseenter = () => { if (this.touring) return; clearTimeout(this._hoverT); if (this.activeLayer !== idx && this.pinnedLayer === null) this._hoverT = setTimeout(() => { this._focusLayer(idx, { hover: true }); }, 120); };
      tl.onmouseleave = () => { clearTimeout(this._hoverT); };
      // 설명 카드: 처음엔 숨김
      const card = document.createElement('div');
      card.innerHTML = `<i>×</i><em></em><b></b><span></span>${L.formula ? '<code></code>' : ''}`;
      Object.assign(card.style, { position: 'absolute', transform: 'translate(0,-50%)', display: 'none', flexDirection: 'column', gap: '5px', padding: '12px 14px 12px 16px', borderRadius: '2px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', lineHeight: '1.35', whiteSpace: 'nowrap', pointerEvents: 'none', color: '#f3f5f8', background: this.dark ? `linear-gradient(115deg, ${L.color}40 0%, ${L.color}00 55%), rgba(20,26,34,.82)` : `linear-gradient(115deg, ${L.color}30 0%, ${L.color}00 55%), rgba(255,255,255,.85)`, backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)', color: this.dark ? '#f3f5f8' : '#14202c', border: `1px solid ${L.color}66`, boxShadow: '0 10px 30px rgba(0,0,0,.18)', opacity: '0', transition: 'opacity .35s' });
      card.querySelector('em').style.cssText = `font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.16em;color:${L.color}`;
      const xb = card.querySelector('i'); xb.style.cssText = 'position:absolute;top:8px;right:10px;font-style:normal;font-size:18px;line-height:1;color:currentColor;opacity:.55;cursor:pointer;pointer-events:auto'; xb.onclick = (ev) => { ev.stopPropagation(); this.pinnedLayer = null; this._focusLayer(idx); };
      card.querySelector('b').style.cssText = 'font-size:18px;font-weight:700;letter-spacing:-0.01em;white-space:normal;line-height:1.3';
      card.querySelector('span').style.cssText = 'font-size:13px;color:inherit;opacity:.85;white-space:normal;line-height:1.6';
      const code = card.querySelector('code'); if (code) code.style.cssText = `font-family:"IBM Plex Mono",monospace;font-size:12px;color:${L.color};margin-top:2px`;
      const horiz = layout === 'bed' || layout === 'chambers';
      card._pos = horiz ? new THREE.Vector3(mid.x, y1 + H * 0.35, cz) : new THREE.Vector3(mid.x + r * 1.25, mid.y, cz);
      card._card = true; card._dock = true; Object.assign(card.style, { right: '22px', left: 'auto', top: '50%', transform: 'translateY(-50%)', width: 'min(340px, 38vw)', whiteSpace: 'normal', padding: '16px 18px 16px 20px', pointerEvents: 'auto' }); this.labels.appendChild(card); this.interiorLabels.push(card);
      this.layerItems.push({ L, m, tl, card, mid, h, idx });
      tl.onclick = (ev) => { ev.stopPropagation(); if (this.activeLayer === idx && this.pinnedLayer === idx) { this.pinnedLayer = null; this._focusLayer(idx); } else { this.pinnedLayer = idx; if (this.activeLayer !== idx) { this.activeLayer = null; this._focusLayer(idx); } } };
    });
    if (false) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, H, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthTest: false })); sh.position.set(cx, (y0 + y1) / 2, cz); sh.renderOrder = 11; g.add(sh); }
    this.interior = g; this.scene.add(g);
  }
  _focusLayer(idx, opt = {}) { this._dirty = true; if (this.pinnedLayer === undefined) this.pinnedLayer = null;
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    this._fx().play(null); // 이전 층의 시각화(그라데이션 덮개 등)를 먼저 지운다
    const same = this.activeLayer === idx; this.activeLayer = same ? null : idx; this._layerHL(this.activeLayer);
    this.dispatchEvent(new CustomEvent('steel-layer', { detail: { layer: this.activeLayer }, bubbles: true, composed: true }));
    const e = this.eqs.find(q => q.id === this.getAttribute('selected'));
    // 단계별 시각화: 고른 층의 설명에 맞는 화살표·그라데이션·수치를 그리고, 그동안 설비 공통 파티클은 숨긴다
    const fx = this._fx().play(this.activeLayer === null ? null : e, this.activeLayer); if (this._work) this._work.g.visible = !fx;
    this.layerItems.forEach(it => {
      const on = it.idx === this.activeLayer, none = this.activeLayer === null;
      const op = none || on ? 0.9 : 0.22; it.m.traverse(o => { if (o.isMesh) o.material.opacity = op; });
      it.tl.style.opacity = none || on ? '1' : '0.35';
      it.tl.style.transform = on ? 'translate(-50%,-50%) scale(1.35)' : 'translate(-50%,-50%)'; it.tl.style.zIndex = on ? '3' : '';
      it.tl.style.background = on ? it.L.color : 'rgba(8,12,18,.45)';
      it.tl.style.borderColor = on ? it.L.color : 'rgba(255,255,255,.35)';
      it.tl.style.color = on ? '#0b0f14' : '#fff';
      it.card.style.display = on && !(this.hasAttribute('external-cards') || this.hasAttribute('externalcards')) ? 'flex' : 'none'; it.card.style.opacity = '0';
      if (on) {
        const em = it.card.querySelector('em'), b = it.card.querySelector('b'), sp = it.card.querySelector('span'), code = it.card.querySelector('code');
        em.textContent = ''; b.textContent = ''; sp.textContent = ''; if (code) code.textContent = '';
        this._timers.push(setTimeout(() => { it.card.style.opacity = '1'; }, 350));
        this._typewrite(em, `LAYER ${String(it.idx + 1).padStart(2, '0')} · ${it.L.temp || '온도 유지'}`, 400, 14);
        this._typewrite(b, it.L.label, 650, 20);
        this._typewrite(sp, e?.data.steps?.[it.idx]?.text || '', 650 + it.L.label.length * 20 + 160, 9);
        if (code) this._typewrite(code, it.L.formula, 650 + it.L.label.length * 20 + 160 + (e?.data.steps?.[it.idx]?.text || '').length * 9 + 160, 17);
      }
    });
    if (this.activeLayer !== null && e) {
      const it = this.layerItems[idx], r = e.interior.r;
      const H = e.interior.y1 - e.interior.y0, center = (e.interior.y0 + e.interior.y1) / 2, yaw = -0.2, S = this.interiorSpan || H;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), horiz = S !== H;
      const dist = Math.max(S * (horiz ? 1.5 : 2.1), r * 7, 9);
      const tx = horiz ? e.interior.cx : it.mid.x;
      this._animateTo({ yaw, pitch: horiz ? 0.25 : 0.05, dist, target: new THREE.Vector3(tx, center + (horiz ? H * 0.4 : H * 0.06), it.mid.z).add(right.multiplyScalar(dist * 0.08)) });
      this.ring.visible = false;
    } else if (e) { this.focus(e.id); this.ring.visible = true; }
  }
  // 내부 단면 표시 중에는 나머지 장면을 흐리게(포커스 모드)
  // 다크모드: 선택한 설비에 조명을 비춰 밝게 강조 (스포트라이트 + 바닥 빛 웅덩이)
  _spotlight(sel) {
    if (!this.selLight) {
      const g = new THREE.Group(); g.name = 'SEL_LIGHT';
      const spot = new THREE.SpotLight(0xfff2e0, 0, 0, Math.PI / 7, 0.6, 1.4); const tgt = new THREE.Object3D(); spot.target = tgt; g.add(spot, tgt);
      const pt = new THREE.PointLight(0xbfe4ff, 0, 0, 1.4); g.add(pt);
      const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(140,210,255,.9)'); gr.addColorStop(0.5, 'rgba(34,199,240,.35)'); gr.addColorStop(1, 'rgba(34,199,240,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); pool.rotation.x = -Math.PI / 2; g.add(pool);
      this.selLight = { g, spot, tgt, pt, pool }; this.scene.add(g);
    }
    const L = this.selLight, on = !!sel && this.dark;
    L.g.visible = on; this._dirty = true; if (!on) { L.spot.intensity = 0; L.pt.intensity = 0; return; }
    const f = sel.focus, r = Math.max(3, (sel.dist || 20) * 0.22), h = r * 2.6;
    L.tgt.position.copy(f); L.spot.position.set(f.x, f.y + h, f.z + r * 0.4); L.spot.distance = h * 3; L.spot.intensity = 14 * h;
    L.pt.position.set(f.x, f.y + r * 0.6, f.z + r * 0.8); L.pt.distance = r * 5; L.pt.intensity = 8 * r;
    L.pool.position.set(f.x, 0.06 + (this.anchorMode ? 0.4 : 0), f.z); L.pool.scale.setScalar(r * 3.2);
  }
  // 선택한 설비 주변 메시를 직접 밝게 (GLB에 설비 노드가 없어서 거리로 찾음)
  _isVehicle(e) { return !!e && /torpedo|_car$/.test(e.id); }
  _glowNear(sel) {
    const zr = this.zone?.root; if (!zr) return;
    (this._glowed || []).forEach(o => { const m = o.material; if (m.emissive) { m.emissive.setHex(o.userData.base || 0); m.emissiveIntensity = o.userData.base ? (o.userData.baseI ?? 0.6) : 0; } }); this._glowed = [];
    if (!sel || !this.dark) return;
    const f = sel.focus, R = Math.max(3, (sel.dist || 20) * 0.28), c = new THREE.Vector3(), box = new THREE.Box3();
    if (this._isVehicle(sel)) { // 토페도카: 차체는 쇳물 열기(주황)로, 쇳물이 흘러드는 라인(탕도·러너)은 녹은 쇠 색으로
      const k = this.eqs.indexOf(sel), prev = this.eqs[Math.max(0, k - 1)]; let a = this._stopPos(Math.max(0, k - 1)).clone(), b = this._stopPos(k).clone(); if (a.distanceTo(b) < 3 && prev && prev !== sel) { a = prev.focus.clone(); b = sel.focus.clone(); } // 정거장이 겹치면 이전 설비(출선구) 중심 → 토페도카 중심 구간
      const ab = new THREE.Vector3().subVectors(b, a), L2 = Math.max(1e-6, ab.lengthSq()), corr = Math.max(0.9, ab.length() * 0.18);
      zr.traverse(o => { if (!o.isMesh || !o.material.emissive) return; const nm = (o.name + ' ' + (o.parent?.name || '')).toLowerCase(); if (/rail|track|ground|floor/.test(nm)) return;
        if (!o.userData._c) { box.setFromObject(o); o.userData._c = box.getCenter(new THREE.Vector3()); o.userData._s = box.getSize(new THREE.Vector3()).length(); } if (!o.userData._bs) { box.setFromObject(o); o.userData._bs = box.getSize(new THREE.Vector3()); }
        const cc = o.userData._c, bs = o.userData._bs, elong = Math.max(bs.x, bs.z) > 2.5 * Math.max(0.05, Math.min(bs.x, bs.z)) && bs.y < Math.max(bs.x, bs.z) * 0.5; let hot = 0;
        if (/torpedo|ladle_car|hot_metal_car|_car\b/.test(nm)) hot = 1;
        else if (/runner|trough|launder|spout|tapping|tap_hole|channel/.test(nm)) hot = 2;
        else if (/casthouse|cast_house|taphole/.test(nm) && elong && o.userData._s >= 1 && o.userData._s <= 5.5 && cc.y > 0.5 && cc.y < 1.6) hot = 2; // 주상 바닥의 길쭉하고 낮은 조각 = 탕도(쇳물 홈통)
        else { const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(cc, a).dot(ab) / L2)); const p = a.clone().addScaledVector(ab, t); if (t > 0.02 && t < 0.98 && Math.hypot(cc.x - p.x, cc.z - p.z) < corr && o.userData._s < 3 && cc.y > 0.5 && cc.y < Math.max(a.y, b.y) + 1.5) hot = 2; }
        if (hot === 1) { o.material.emissive.setHex(0xff6a1a); o.material.emissiveIntensity = 0.85; this._glowed.push(o); }
        else if (hot === 2) { o.material.emissive.setHex(0xffa03a); o.material.emissiveIntensity = 1.1; this._glowed.push(o); } });
      this._dirty = true; return; }
    zr.traverse(o => { if (!o.isMesh || !o.material.emissive) return; if (!o.userData._c) { box.setFromObject(o); o.userData._c = box.getCenter(new THREE.Vector3()); o.userData._s = box.getSize(new THREE.Vector3()).length(); } if (o.userData._s > R * 4) return; const d = Math.hypot(o.userData._c.x - f.x, o.userData._c.z - f.z); if (d < R && Math.abs(o.userData._c.y - f.y) < R * 2.5) { o.material.emissive.setHex(0x9fd8ff); o.material.emissiveIntensity = 0.55; this._glowed.push(o); } });
    this._dirty = true;
  }
  // 다크모드: 현재 공정 구역에 투광등을 켠 것처럼 조명 (배경보다 밝게)
  _zoneLight() {
    const z = this.zone, on = !!z && this.dark && !this._isOverview;
    if (!this.zl) {
      const g = new THREE.Group(); g.name = 'ZONE_LIGHT';
      const spot = new THREE.SpotLight(0xeef4ff, 0, 0, Math.PI / 4.2, 0.7, 1.1), tgt = new THREE.Object3D(); spot.target = tgt; g.add(spot, tgt);
      const fill = new THREE.PointLight(0xdce8f5, 0, 0, 1.2); g.add(fill);
      const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(170,190,215,.12)'); gr.addColorStop(0.55, 'rgba(140,165,195,.05)'); gr.addColorStop(1, 'rgba(120,145,180,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); pool.rotation.x = -Math.PI / 2; pool.renderOrder = 5; g.add(pool);
      const poles = new THREE.Group(); g.add(poles);
      this.zl = { g, spot, tgt, fill, pool, poles }; this.scene.add(g);
    }
    const L = this.zl; L.g.visible = on; this._dirty = true;
    if (!on) { L.spot.intensity = 0; L.fill.intensity = 0; return; }
    const box = new THREE.Box3().setFromObject(z.root), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), r = Math.max(sz.x, sz.z) * 0.6, h = Math.max(sz.y * 2.2, r * 1.3);
    L.tgt.position.set(c.x, 0, c.z); L.spot.position.set(c.x, h, c.z + r * 0.25); L.spot.angle = Math.min(1.1, Math.atan(r / h) * 1.15); L.spot.distance = h * 3; L.spot.intensity = 1.3 * h * h / 10;
    L.fill.position.set(c.x, sz.y * 0.8, c.z + r * 0.6); L.fill.distance = r * 3; L.fill.intensity = 0.4 * r;
    L.pool.position.set(c.x, 0.08, c.z); L.pool.scale.set(r * 2.6, r * 1.9, 1);
    // 네 모서리 투광등 기둥 (불 켜진 머리)
    // [UI 시안] 투광등은 유지하되 카메라 쪽(앞) 두 기둥은 반투명·작은 빛으로 약하게 → 설비를 가리지 않음
    L.poles.clear(); const ph = Math.max(6, sz.y * 0.9);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz2]) => { const front = sz2 > 0, pm = new THREE.MeshBasicMaterial({ color: 0x2a3038, transparent: front, opacity: front ? 0.18 : 1, depthWrite: !front }), hm = new THREE.MeshBasicMaterial({ color: 0xfff0d0, fog: false, transparent: front, opacity: front ? 0.3 : 1 });
      const x = c.x + sx * sz.x * 0.56, zz = c.z + sz2 * sz.z * 0.62; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, ph, 6), pm); p.position.set(x, ph / 2, zz); L.poles.add(p); const hd = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.45), hm); hd.position.set(x - sx * 0.4, ph, zz - sz2 * 0.4); hd.lookAt(c.x, 0, c.z); L.poles.add(hd); if (!front) L.poles.add(new THREE.Mesh(this._crossGeo([[hd.position.x, hd.position.y, hd.position.z]], 6), this._glowMat(0xe6efff, 0.45))); }); // 앞쪽 기둥은 빛 번짐 없음 (화면 가림 방지)
  }
  _noTint() { return this.touring || this.getAttribute('view') === 'section'; } // 작동/단면 보기: 하늘색 칠 없이 투명도로만 구분
  _dimOthers(sel) { this._dirty = true;
    const dim = !!sel;
    const mine = new Set(); if (sel && sel.group) sel.group.traverse(o => { if (o.isMesh) mine.add(o); }); // 지금 설명하는 설비는 덜 투명, 나머지는 더 투명
    const set = (o) => { if (!o.isMesh || Array.isArray(o.material)) return; if (!o.userData._m) { o.material = o.material.clone(); o.userData._m = { t: o.material.transparent, op: o.material.opacity, dw: o.material.depthWrite }; } const on = mine.has(o); o.material.transparent = dim ? true : o.userData._m.t; o.material.opacity = dim ? (on ? 0.88 : 0.1) : o.userData._m.op; o.material.depthWrite = dim ? on : o.userData._m.dw; /* 흐린 설비가 층 강조선을 가리지 않게 */ o.material.needsUpdate = true; };
    if (this.root) this.root.traverse(set);
    if (this.material) this.material.traverse(set);
    if (this.skyline) this.skyline.traverse(set);
    if (this.glow) this.glow.visible = !dim;
    if (this.stars) this.stars.material.opacity = dim ? 0.3 : 0.8;
    this.eqs.forEach(e => { if (dim && e !== sel) e.label.style.opacity = '0.2'; if (dim && e === sel) e.label.style.opacity = '0'; });
    if (this.interiorLabels) this.interiorLabels.forEach(l => l.style.zIndex = '2');
    this.dimmed = dim;
  }
  _yawRange() { if (this.orbit.dist > 120) return [-0.75, 0.65]; const c = this.home?.yaw ?? -0.6; return [c - 1.15, c + 1.15]; }
  _declutter(now) {
    const sel = this.getAttribute('selected'), moving = now - (this._lastOrbitMove || 0) < 260, list = this.eqs.filter(e => e._vis);
    const order = list.slice().sort((a, b) => (b.id === sel) - (a.id === sel) || (b.id === this.hoverId) - (a.id === this.hoverId) || this.eqs.indexOf(a) - this.eqs.indexOf(b));
    const taken = [], hit = (r) => taken.some(t => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
    order.forEach(e => { const x = e._lx - 7, y = e._ly, keep = e.id === sel || e.id === this.hoverId;
      const full = [x - 2, y - 15, x + (e._w || 140) + 4, y + 15], dot = [x - 2, y - 12, x + 24, y + 12];
      const compact = !keep && (moving || hit(full)); taken.push(compact ? dot : full);
      if (compact !== e._compact) { e._compact = compact; const nm = e.label.querySelector('.nm'); nm.style.display = compact ? 'none' : 'flex'; if (!compact) e._w = nm.offsetWidth + 30; e.label.style.zIndex = e.id === sel ? '4' : compact ? '1' : '2'; } }); // 번호만 남은 핀은 이름표 아래로
    if (moving) this._dirty = true;
  }
  _hover(id) {
    if (this.hoverId === id) return; this.hoverId = id; this._dirty = true;
    const sel = this.getAttribute('selected'), accent = UI;
    this.eqs.forEach(e => {
      const on = e.id === id && e.id !== sel;
      // 3D: 살짝 밝아지는 emissive + 바닥 점선 사각
      e.group.traverse(o => { if (o.isMesh && o.material.emissive && o.userData.eq) { const selOn = e.id === sel && !this._noTint(); o.material.emissive.setHex(selOn ? ACCENT : on ? 0x22c7f0 : o.userData.base); o.material.emissiveIntensity = selOn ? 0.35 : on ? 0.22 : (o.userData.base ? (o.userData.baseI ?? 0.6) : 0); } });
      // 라벨: 밑줄·역할 툴팁
      const tip = e.label.querySelector('u');
      e.label.style.fontWeight = on ? '700' : '500';
      e.label.style.color = on ? accent : '';
      if (tip) { tip.style.display = on ? 'block' : 'none'; tip.style.maxHeight = on ? '40px' : '0'; tip.style.opacity = on ? '1' : '0'; }
      if (!this.dimmed) e.label.style.opacity = on || !sel || e.id === sel ? '1' : '0.55';
      if (on && !this.dimmed) this._styleLabels(); // keep selected styling
      if (on) { e.label.style.color = accent; e.label.querySelector('i').style.background = accent; }
    });
    if (this.hoverRing) this.hoverRing.visible = false;
    const e = this.eqs.find(q => q.id === id);
    if (e && e.id !== sel && !this._2d) { if (!this.hoverRing) { this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.75, 4), new THREE.MeshBasicMaterial({ color: 0x22c7f0, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })); this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.rotation.z = Math.PI / 4; this.scene.add(this.hoverRing); } this.hoverRing.visible = true; this.hoverRing.position.set(e.focus.x, 0.03 + (this.anchorMode ? 0.4 : 0), e.focus.z); this.hoverRing.scale.setScalar(this.anchorMode ? (e.dist / 16) * 0.5 : 1); }
  }
  _select(id, user = false) { this.dispatchEvent(new CustomEvent('steel-select', { detail: { id, user }, bubbles: true, composed: true })); }
  _bindPointer() {
    const el = this.renderer.domElement; let down = null, moved = false;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, pan: e.button === 1 }; moved = false; el.setPointerCapture(e.pointerId); el.style.cursor = e.button === 1 ? 'move' : 'grabbing'; if (e.button === 1) e.preventDefault(); });
    el.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('pointermove', e => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (this._2d) { this._pan2d(dx, dy); down = { x: e.clientX, y: e.clientY, pan: down.pan }; return; }
      if (down.pan) { // 휠(가운데) 버튼 드래그: 화면 평면을 따라 보는 위치(target) 이동
        this.anim = null; const o = this.orbit, k = o.dist * 0.0012, right = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw)), up = new THREE.Vector3(0, 1, 0);
        o.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); o.target.y = Math.max(0, o.target.y); this._lastOrbitMove = performance.now(); this._dirty = true; down = { x: e.clientX, y: e.clientY, pan: true }; return; }
      const [y0, y1] = this._yawRange(); this.orbit.yaw = Math.min(y1, Math.max(y0, this.orbit.yaw - dx * 0.005)); this.orbit.pitch = Math.min(1.25, Math.max(0.12, this.orbit.pitch + dy * 0.005)); this._lastOrbitMove = performance.now(); down = { x: e.clientX, y: e.clientY, pan: false };
    });
    el.addEventListener('pointermove', e => { if (down || !this.zoneLabels || this.orbit.dist <= 120) return; const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); const zid = this._zoneAt(v); (this.zoneLabels || []).forEach(z => { if (z.id === zid) { z.label.style.borderColor = '#22c7f0'; z.label.style.background = 'rgba(34,199,240,.35)'; } }); if (zid !== this._hoverZone) { this._hoverZone = zid; if (!zid) this._styleZoneLabels(); } el.style.cursor = zid ? 'pointer' : 'grab'; });
    el.addEventListener('pointermove', e => { if (down || !this.root || this.anchorMode || this.orbit.dist > 120) return; const nowT = performance.now(); if (nowT - (this._lastHover || 0) < 90) return; this._lastHover = nowT; const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(v, this.camera); const hit = this.ray.intersectObjects(this.root.children, true)[0]; let id = hit ? hit.object.userData.eq : null; if (hit && !id && this.anchorMode) { let best = null, bd = Infinity; this.eqs.forEach(q => { const d = q.focus.distanceTo(hit.point); if (d < bd) { bd = d; best = q; } }); if (best && bd < best.dist * 0.9) id = best.id; } this._hover(id); el.style.cursor = id ? 'pointer' : 'grab'; });
    el.addEventListener('pointerleave', () => this._hover(null));
    el.addEventListener('pointerup', e => {
      el.style.cursor = 'grab';
      if (down && !moved) {
        const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(v, this.camera);
        if (this._navG && this._navG.visible) { const nh = this.ray.intersectObjects(this._navG.children, true).find(h => h.object.userData.go); if (nh) { down = null; this.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: nh.object.userData.go }, bubbles: true, composed: true })); return; } }
        if (this.interior && this.layerItems?.length) { const lh = this.ray.intersectObject(this.interior, true).find(h => h.object.userData.layerIdx != null); if (lh) { down = null; this.layer(lh.object.userData.layerIdx); return; } }
        const zid = this._zoneAt(v); if (zid) { down = null; this.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: zid }, bubbles: true, composed: true })); return; }
        const hit = this.ray.intersectObjects(this.root.children, true)[0];
        let id = hit ? hit.object.userData.eq : null;
        if (hit && !id && this.anchorMode) { let best = null, bd = Infinity; this.eqs.forEach(q => { const d = q.focus.distanceTo(hit.point); if (d < bd) { bd = d; best = q; } }); if (best && bd < best.dist * 0.9) id = best.id; }
        if (id || !this.touring) this._select(id, true);
      }
      down = null;
    });
    el.addEventListener('wheel', e => { e.preventDefault(); if (this._2d) { const c = this.camera; c.zoom = Math.min(10, Math.max(0.5, c.zoom * (1 - e.deltaY * 0.0012))); c.updateProjectionMatrix(); this._dirty = true; return; } const ov = this.orbit.dist > 120; this.orbit.dist = ov ? Math.min(300, Math.max(125, this.orbit.dist * (1 + e.deltaY * 0.001))) : Math.min(90, Math.max(8, this.orbit.dist * (1 + e.deltaY * 0.001))); this._lastOrbitMove = performance.now(); }, { passive: false });
  }
  _zoneAt(v) {
    if (this.orbit.dist <= 120 || !this.zoneLabels) return null;
    this.ray.setFromCamera(v, this.camera);
    const zs = this.zoneLabels.filter(z => z.root && z.root.visible);
    const hit = this.ray.intersectObjects(zs.map(z => z.root), true)[0];
    if (!hit) return null;
    let o = hit.object; while (o) { const z = zs.find(q => q.root === o); if (z) return z.id; o = o.parent; }
    return null;
  }
  // 설비 확대 시: 물체 뒤에 반투명 판을 깔아 배경을 가림
  _focusVeil() {
    if (this._2d) { if (this.veil) this.veil.visible = false; return; }
    if (!this.veil) {
      const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 20, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.85)'); gr.addColorStop(0.75, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); x.globalCompositeOperation = 'destination-in'; const vg = x.createLinearGradient(0, 0, 0, 256); vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.4, 'rgba(0,0,0,1)'); vg.addColorStop(0.72, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = vg; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
      this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0x0b1018, transparent: true, opacity: 0, depthWrite: false, fog: false }));
      this.veil.name = 'FOCUS_VEIL'; this.veil.renderOrder = 0; this.scene.add(this.veil); this._veilOp = 0;
    }
    const sel = !this._isOverview && this.eqs?.find(e => e.id === this.getAttribute('selected'));
    const target = sel ? (this.dark ? 0.7 : 0.7) : 0;
    this._veilOp += (target - this._veilOp) * 0.12; if (Math.abs(target - this._veilOp) > 0.002) this._dirty = true; else this._veilOp = target;
    const v = this.veil; v.visible = this._veilOp > 0.01; if (!v.visible) return;
    if (sel) this._veilEq = sel; const e = this._veilEq; if (!e) return;
    v.material.color.set(this.scene.fog ? this.scene.fog.color.getHex() : (this.dark ? 0x141a22 : 0xc9c3d2)); v.material.opacity = this._veilOp;
    const cam = this.camera.position, dir = new THREE.Vector3().subVectors(e.focus, cam).normalize(), back = Math.max(4, (e.dist || 20) * 0.55);
    v.position.copy(e.focus).addScaledVector(dir, back); v.quaternion.copy(this.camera.quaternion);
    const d = cam.distanceTo(v.position), hgt = 2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 2.2; v.scale.set(hgt * this.camera.aspect, hgt, 1);
  }
  // 작동 보기 중 설비별 작업 연출(입자·불빛). GLB 교체와 무관하게 설비 위치(e.focus/anchor) 기준으로 붙음
  _workRecipe(id) {
    const R = { sinter_plant: [['embers', 0.35], ['glow', 0.3, 0xff6a20], ['glow', 0.9, 0xff7a28]], coke_oven: [['steam', 0.9], ['embers', 0.4], ['glow', 0.4, 0xff5a1a]], hot_stove: [['glow', 0.5, 0xff8030], ['glow', 1.0, 0xff7020]],
      blast_furnace: [['steam', 1.0], ['tap', 0.5], ['glow', 0.3, 0xff6a10], ['glow', 0.7, 0xff7a20]], hot_metal_pretreatment: [['swirl', 0.5], ['glow', 0.5, 0xff8a30], ['glow', 0.2, 0xff7a28]], bof_converter: [['sparks', 0.85], ['glow', 0.8, 0xffa040], ['glow', 0.3, 0xff7a28]],
      secondary_refining: [['bubbles', 0.45], ['glow', 0.5, 0xff9a40]], tundish: [['pour', 0.55], ['glow', 0.3, 0xff9030], ['glow', 0.7, 0xff8030]], cc_mold: [['steam', 0.6], ['glow', 0.5, 0xff8a30], ['glow', 0.15, 0xff6a20]],
      secondary_cooling: [['spray', 0.85], ['steam', 0.4], ['glow', 0.2, 0xff6a20]], torch_cutter: [['sparksDown', 0.6], ['glow', 0.35, 0xffb050], ['glow', 0.2, 0xff8030]], reheating_furnace: [['embers', 0.6], ['glow', 0.4, 0xff6a20], ['glow', 0.9, 0xff7020]],
      roughing_mill: [['spray', 0.7], ['glow', 0.25, 0xff7a30], ['glow', 0.6, 0xff8030]], finishing_mill: [['spray', 0.6], ['glow', 0.25, 0xff7a30], ['glow', 0.6, 0xff8a38]], runout_table: [['spray', 0.6], ['steam', 0.25], ['glow', 0.25, 0xff8a38]], coiler: [['swirl', 0.4], ['glow', 0.4, 0xff7a30], ['glow', 0.15, 0xff7a28]] };
    if (R[id]) return R[id];
    if (/cool|spray|runout|water/.test(id)) return [['spray', 0.8], ['steam', 0.4]]; if (/cut|torch/.test(id)) return [['sparksDown', 0.5], ['glow', 0.35, 0xffb050]];
    if (/mill|roll|stand/.test(id)) return [['spray', 0.6], ['glow', 0.3, 0xff7a30]]; if (/convert|bof|lance/.test(id)) return [['sparks', 0.8], ['glow', 0.8, 0xffa040]];
    if (/coil/.test(id)) return [['swirl', 0.4]]; if (/ladle|refin|rh|lf/.test(id)) return [['bubbles', 0.45], ['glow', 0.5, 0xff9a40]];
    return [['embers', 0.5], ['glow', 0.4, 0xff7a30]];
  }
  _startWork(e) {
    this._stopWork(); if (!e) return;
    if (!this._dotTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this._dotTex = new THREE.CanvasTexture(c); }
    const P = { embers: [0xff8a3a, 140, 1.8, 0.45], sparks: [0xffc070, 70, 0.9, 0.12], sparksDown: [0xffd090, 60, 0.8, 0.11], steam: [0x8a96a4, 90, 3.2, 2.2], spray: [0x9fd4ff, 200, 0.8, 0.22],
      pour: [0xffa040, 120, 0.5, 0.5], bubbles: [0xffc080, 110, 1.4, 0.35], swirl: [0xffa050, 120, 2.0, 0.35], flow: [0xff7040, 160, 1.4, 0.4], tap: [0xffb050, 90, 0.9, 0.13] };
    const STREAK = { sparks: 1, sparksDown: 1, tap: 1 };
    const top = Math.max(1, e.anchor.y - 0.6), sc = Math.max(0.6, (e.dist || 16) / 16), g = new THREE.Group(), em = [];
    this._workRecipe(e.id).forEach(([kind, h, col]) => {
      const o = new THREE.Vector3(e.focus.x, top * h, e.focus.z);
      if (kind === 'glow') { const L = new THREE.PointLight(col, 0, 14 * sc, 1.6); L.position.copy(o); g.add(L); em.push({ kind, L, o }); return; }
      const [c, n, life, size] = P[kind], pos = new Float32Array(n * 3), colr = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
      const mat = new THREE.PointsMaterial({ size: size * sc, map: this._dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: kind === 'steam' ? 0.5 : 1 });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 20; g.add(pts);
      let ln = null; if (STREAK[kind]) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); ln = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); ln.frustumCulled = false; ln.renderOrder = 21; g.add(ln); }
      const ps = Array.from({ length: n }, () => ({ age: Math.random() * life, L: life, p: new THREE.Vector3(), v: new THREE.Vector3(), a: 0 }));
      em.push({ kind, pts, ln, ps, life, o, sc, c: new THREE.Color(c) });
    });
    this.scene.add(g); this._work = { g, em, last: performance.now(), e };
  }
  _spawn(m, q) {
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
  _workTick(now) {
    const W = this._work; if (!W) return; if (!this.touring) { this._stopWork(); return; }
    const dt = Math.min(0.05, (now - W.last) / 1000); W.last = now; this._dirty = true;
    const G = { sparks: 9, sparksDown: 9, tap: 6, spray: 3, pour: 14 };
    W.em.forEach(m => {
      if (m.kind === 'glow') { m.L.intensity = (3.4 + Math.sin(now / 160) * 1.0 + Math.sin(now / 47) * 0.5) * (this.dark ? 1.8 : 1.1); return; }
      const pa = m.pts.geometry.attributes.position.array, ca = m.pts.geometry.attributes.color.array, g = G[m.kind] || 0;
      m.ps.forEach((q, i) => {
        q.age += dt; if (q.age > q.L) this._spawn(m, q);
        if (m.kind === 'swirl') { q.a += dt * 2.4; const rad = (0.9 + q.age * 0.25) * m.sc; q.p.set(m.o.x + Math.cos(q.a) * rad, m.o.y + q.age * 0.4 * m.sc, m.o.z + Math.sin(q.a) * rad); }
        else { q.v.y -= g * m.sc * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.05) { q.p.y = 0.05; q.v.y *= -0.25; q.v.x *= 0.6; q.v.z *= 0.6; } }
        const k = q.age / q.L, f = m.kind === 'steam' ? Math.sin(Math.min(1, k) * Math.PI) : Math.max(0, 1 - k);
        pa[i * 3] = q.p.x; pa[i * 3 + 1] = q.p.y; pa[i * 3 + 2] = q.p.z;
        if (m.ln) { const h = this._heat(k), la = m.ln.geometry.attributes.position.array, lc = m.ln.geometry.attributes.color.array, j = i * 6, t = 0.035 + 0.02 * (1 - k); ca[i * 3] = h[0]; ca[i * 3 + 1] = h[1]; ca[i * 3 + 2] = h[2];
          la[j] = q.p.x; la[j + 1] = q.p.y; la[j + 2] = q.p.z; la[j + 3] = q.p.x - q.v.x * t; la[j + 4] = q.p.y - q.v.y * t; la[j + 5] = q.p.z - q.v.z * t;
          lc[j] = h[0]; lc[j + 1] = h[1]; lc[j + 2] = h[2]; lc[j + 3] = h[0] * 0.25; lc[j + 4] = h[1] * 0.12; lc[j + 5] = 0; }
        else { ca[i * 3] = m.c.r * f; ca[i * 3 + 1] = m.c.g * f; ca[i * 3 + 2] = m.c.b * f; }
      });
      m.pts.geometry.attributes.position.needsUpdate = true; m.pts.geometry.attributes.color.needsUpdate = true;
      if (m.ln) { m.ln.geometry.attributes.position.needsUpdate = true; m.ln.geometry.attributes.color.needsUpdate = true; }
    });
  }
  // 불꽃 색: 백열(흰색) → 노랑 → 주황 → 어두운 빨강으로 식으며 사라짐
  _heat(k) { const f = Math.pow(Math.max(0, 1 - k), 1.4); if (k < 0.12) return [f, f * 0.96, f * 0.82]; if (k < 0.4) return [f, f * 0.78, f * 0.32]; if (k < 0.7) return [f, f * 0.45, f * 0.08]; return [f * 0.8, f * 0.18, 0]; }
  // 차량형 설비(토페도카)의 GLB 메시를 찾아 소재와 함께 레일 방향으로 이동시킨다
  _driveVehicle(e, k, dur) {
    this._resetVehicle(); const model = this.zone?.glb; if (!model) return Promise.resolve();
    model.updateMatrixWorld(true); const f = e.focus, R0 = Math.max(2.5, e.dist * 0.22), bb = new THREE.Box3(), bc = new THREE.Vector3(), parts = [];
    const add = (o) => parts.push({ o, p0: o.position.clone(), inv: new THREE.Matrix4().copy(o.parent.matrixWorld).invert() });
    // 1순위: 이름으로 찾기(GLB에 Torpedo_Car 같은 이름이 있으면 그 메시만), 2순위: 포커스 주변 반경 탐색
    model.traverse(o => { if (!o.isMesh || o.userData.floor) return; const nm = (o.name + ' ' + (o.parent?.name || '')).toLowerCase(); if (/torpedo|ladle_car|hot_metal_car|_car\b/.test(nm) && !/rail|track/.test(nm)) add(o); });
    if (!parts.length) model.traverse(o => { if (!o.isMesh || o.userData.floor) return; const nm = (o.name + ' ' + (o.parent?.name || '')).toLowerCase(); if (/rail|track|ground|floor|road|fence|house|building/.test(nm)) return; bb.setFromObject(o); if (bb.isEmpty()) return; bb.getCenter(bc); const bs = bb.getSize(new THREE.Vector3()); if (Math.max(bs.x, bs.z) > R0 * 2.2) return; if (Math.hypot(bc.x - f.x, bc.z - f.z) < R0) add(o); });
    if (!parts.length) return Promise.resolve();
    parts.forEach(P => { P.o.matrixAutoUpdate = true; }); // GLB 메시는 행렬 자동 갱신이 꺼져 있어 켜 줘야 이동이 보인다
    // 이동 방향: 직전 정거장 → 이 정거장 방향(들어온 레일을 그대로 따라감), 없으면 +x
    const a = this._stopPos(Math.max(0, k - 1)), b = this._stopPos(k); const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z); if (dir.lengthSq() < 0.01) dir.set(1, 0, 0); dir.normalize(); dir.set(-dir.z, 0, dir.x); // 진행 방향에서 오른쪽으로 90° 꺾어 레일을 따라감
    const L = Math.max(6, e.dist * 0.9), m0 = this.material ? this.material.position.clone() : null;
    return new Promise(resolve => { this._vehicle = { parts, dir, L, t0: performance.now(), dur, m0, resolve }; });
  }
  _vehicleTick(now) {
    const V = this._vehicle; if (!V) return; const k = Math.min(1, (now - V.t0) / V.dur), s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; const off = V.dir.clone().multiplyScalar(V.L * s);
    V.parts.forEach(P => { P.o.position.copy(P.p0).add(this._localOffset(P, off)); P.o.updateMatrix(); P.o.updateMatrixWorld(true); });
    if (this.material && V.m0) this.material.position.copy(V.m0).add(off);
    if (this._work?.g) this._work.g.position.copy(off); // 열기 불빛·입자도 토페도카와 함께 이동
    this._dirty = true; if (k >= 1) { const r = V.resolve; this._vehicle = { ...V, done: true }; r(); }
  }
  _localOffset(P, off) { const m = new THREE.Matrix3().setFromMatrix4(P.inv); return off.clone().applyMatrix3(m); } // 부모 월드 행렬의 회전·스케일만 역적용(이동 제외)
  _resetVehicle() { const V = this._vehicle; if (!V) return; V.parts.forEach(P => { P.o.position.copy(P.p0); P.o.updateMatrix(); P.o.updateMatrixWorld(true); }); if (!V.done) V.resolve(); this._vehicle = null; this._dirty = true; }
  _matSinkTick(now) { const S = this._matSink, m = this.material; if (!S || !m) return; const k = Math.min(1, Math.max(0, (now - S.t0) / (S.dur || 600))); m.scale.setScalar((this.matScale || 1) * (S.y1 != null ? 0.45 * (1 - k * 0.8) : 1 - k * k));
    if (S.y1 != null) { const e2 = k * k * (3 - 2 * k); m.position.y = S.y0 + (S.y1 - S.y0) * e2; if (S.x1 != null) { const e1 = Math.min(1, k * 2.2), q = e1 * e1 * (3 - 2 * e1); m.position.x = S.x0 + (S.x1 - S.x0) * q; m.position.z = S.z0 + (S.z1 - S.z0) * q; } } /* 토페도카: 쇳물이 위 구멍으로 쏙 들어감 */ this._dirty = true; if (k >= 1) { this._matSink = null; this._hideMat = true; m.visible = false; } }
  _stopWork() { (this._sinkSaved || []).forEach(([o, v, d, r]) => { o.visible = v; o.material.depthTest = d; o.renderOrder = r; o.material.needsUpdate = true; }); this._sinkSaved = null; this._matSink = null; if (this.material) this.material.scale.setScalar(this.matScale || 1); this._resetVehicle(); this._hideMat = false; if (this.material) this.material.visible = true; const W = this._work; if (!W) return; this._work = null; this.scene.remove(W.g); W.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this._dirty = true; }
  // 굴뚝 찾기: 가늘고 긴 수직 원기둥(높이가 지름의 4배 이상, 높이 6 이상) 꼭대기에서 연기 입자가 올라간다
  _addSmoke(z, model) {
    if (z.smoke) { z.smoke.parent?.remove(z.smoke); z.smoke = null; }
    z.root.updateMatrixWorld(true); model.updateMatrixWorld(true); const box = new THREE.Box3(), sz = new THREE.Vector3(), tops = [], v = new THREE.Vector3();
    // 모델 크기에 따라 기준을 맞춘다(열간압연처럼 작게 축소된 모델의 굴뚝도 잡히게)
    const MB = new THREE.Box3().setFromObject(model), MS = MB.getSize(new THREE.Vector3()), minH = Math.max(2.2, Math.min(6, MS.y * 0.28)), G = Math.max(0.6, Math.min(1.2, MS.y * 0.06));
    // 메쉬 하나가 통째로 굴뚝이면 바운딩 박스로, 다른 구조물과 합쳐진 굴뚝은 정점을 xz 격자(1.2 단위)로 묶어 '좁고 높이 솟은 기둥'을 찾는다
    model.traverse(o => { if (!o.isMesh || o.userData.floor) return; const nm = (o.name + ' ' + (o.parent?.name || '')).toLowerCase(); box.setFromObject(o); box.getSize(sz); const w = Math.max(sz.x, sz.z), h = sz.y;
      const mw = Math.min(sz.x, sz.z); if (/chimney|stack|flue|funnel|smoke/.test(nm) || (h >= minH && h > w * 4 && w < minH * 0.7) || (h >= minH * 0.85 && mw < minH * 0.35 && w < minH * 1.4 && h > mw * 3 && !/conveyor|belt|rail|pipe|duct|road|fence|stair|ladder|truss/.test(nm))) { const c = box.getCenter(new THREE.Vector3()); tops.push(new THREE.Vector3(c.x, box.max.y, c.z)); return; }
      if (h < minH * 0.75 || /conveyor|belt|rail|pipe|duct|road|fence|stair|ladder|truss/.test(nm)) return;
      const pa = o.geometry.attributes.position; if (!pa || pa.count > 60000) return; const cells = new Map();
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); const k = Math.floor(v.x / G) + ',' + Math.floor(v.z / G); let c = cells.get(k); if (!c) cells.set(k, c = { lo: v.y, hi: v.y, sx: 0, sz: 0, n: 0 }); if (v.y < c.lo) c.lo = v.y; if (v.y > c.hi) c.hi = v.y; c.sx += v.x; c.sz += v.z; c.n++; }
      const ys = [...cells.values()].map(c => c.hi).sort((p, q) => p - q), roofYs = ys.filter(y => y < box.max.y - 0.3), med = roofYs.length ? roofYs[Math.floor(roofYs.length * 0.5)] : ys[0] ?? 0;
      cells.forEach(c => { if (c.hi >= minH * 0.7 && c.hi - c.lo >= minH * 0.85 && c.hi >= box.max.y - 0.6 && c.hi - med >= minH * 0.42 && c.n >= 8) tops.push(new THREE.Vector3(c.sx / c.n, c.hi, c.sz / c.n)); }); });
    // 서로 가까운 꼭대기는 하나로 합친다
    tops.sort((p, q) => q.y - p.y); for (let i = tops.length - 1; i > 0; i--) for (let j = 0; j < i; j++) { const dx = tops[i].x - tops[j].x, dz = tops[i].z - tops[j].z; if (Math.hypot(dx, dz) < G * 1.8) { tops.splice(i, 1); break; } } // 높은 꼭대기 우선, 가까운 건 하나로
    // 합친 뒤: 같은 높이 꼭대기가 3개 이상 좁은 범위에 모이면 구조물 다리(2×2 기둥)로 보고 제외 — 쌍굴뚝(2개)은 남긴다
    for (let i = 0; i < tops.length; i++) { let same = 0; for (let j = 0; j < tops.length; j++) if (j !== i && Math.abs(tops[j].y - tops[i].y) < 0.15 && Math.hypot(tops[j].x - tops[i].x, tops[j].z - tops[i].z) < G * 6) same++; if (same >= 2) tops[i]._leg = true; }
    for (let i = tops.length - 1; i >= 0; i--) if (tops[i]._leg) tops.splice(i, 1);
    if (!tops.length) return;
    z.root.updateMatrixWorld(true); tops.forEach(t => z.root.worldToLocal(t)); // 공정 묶음(root)이 이동·회전해도 굴뚝을 따라가게 로컬 좌표로 보관
    const n = 14, cnt = tops.length * n, pos = new Float32Array(cnt * 3), life = new Float32Array(cnt), seed = new Float32Array(cnt);
    for (let i = 0; i < cnt; i++) { life[i] = Math.random(); seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const cx = cv.getContext('2d'), gr = cx.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
    const SK = Math.max(0.45, Math.min(1, minH / 6)); const mat = new THREE.PointsMaterial({ size: 2.4 * SK, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, opacity: 0.55, color: 0xc9d2dc, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat); pts.name = 'SMOKE'; pts.frustumCulled = false; pts.renderOrder = 5; pts.userData = { tops, n, life, seed, last: 0, sk: SK };
    z.smoke = pts; z.root.add(pts); this._smokeTick(pts, 0, true);
  }
  _smokeTick(pts, now, init) {
    const U = pts.userData, dt = init ? 0 : Math.min(0.05, (now - U.last) / 1000); U.last = now; const p = pts.geometry.attributes.position.array;
    for (let t = 0; t < U.tops.length; t++) { const T = U.tops[t]; for (let k = 0; k < U.n; k++) { const i = t * U.n + k; let L = U.life[i] + dt * 0.22; if (L > 1) L -= 1; U.life[i] = L; const K = U.sk || 1, s = U.seed[i], drift = L * L * 1.2 * K, wob = Math.sin(L * 9 + s * 20) * 0.25 * L * K;
      // 굴뚝 바로 위에서 거의 수직으로 올라가고, 살짝 왼쪽(-x)으로만 흘러간다
      p[i * 3] = T.x - 0.4 * K + (s - 0.5) * 0.4 * K - drift * 0.6 + wob; p[i * 3 + 1] = T.y + 0.2 * K + L * 6.5 * K; p[i * 3 + 2] = T.z + (Math.sin(s * 40) * 0.2 * K) + drift * 0.25; } }
    pts.geometry.attributes.position.needsUpdate = true; pts.material.opacity = this.dark ? 0.42 : 0.55; this._dirty = true;
  }
  _fx() { return this._stepFx || (this._stepFx = new StepFx(this)); }
  // 공정 화면에서 카메라와 설비 사이를 가리는 부지 건물을 반투명하게 (자기 재질 복제 1회, 부드럽게 페이드)
  _occTick(now) {
    const L = this._occ; if (!L || !L.length) return;
    if (now - (this._occT || 0) > 140) { this._occT = now; const z = this.zone, on = !!z && !this._isOverview && !this._2d, hit = this._occHit || (this._occHit = new Set()); hit.clear();
      if (on && z.eqs?.length) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const e of z.eqs) { x0 = Math.min(x0, e.focus.x); x1 = Math.max(x1, e.focus.x); z0 = Math.min(z0, e.focus.z); z1 = Math.max(z1, e.focus.z); } const pad = 16, bb = this._occBB || (this._occBB = new THREE.Box3());
        for (const o of L) { if (!o.userData.occBox) o.userData.occBox = new THREE.Box3().setFromObject(o); bb.copy(o.userData.occBox); if (bb.max.x > x0 - pad && bb.min.x < x1 + pad && bb.max.z > z0 - pad && bb.min.z < z1 + pad) hit.add(o); } }
      if (on) { const R = this._occRay || (this._occRay = new THREE.Raycaster()), cam = this.camera.position, d = this._occV || (this._occV = new THREE.Vector3());
        for (const e of z.eqs || []) { d.copy(e.focus).sub(cam); const len = d.length(); R.set(cam, d.normalize()); R.far = Math.max(0, len - 2); for (const h of R.intersectObjects(L, false)) hit.add(h.object); } } }
    let moving = false;
    for (const o of L) { const want = this._occHit?.has(o) ? 0 : 1, ud = o.userData, cur = ud.occA ?? 1; if (Math.abs(cur - want) < 0.02) { if (cur !== want) { ud.occA = want; o.visible = want > 0; if (want === 1 && ud.occMat) o.material = ud.occBase; moving = true; } continue; } o.visible = true;
      if (!ud.occMat) { ud.occBase = o.material; ud.occMat = o.material.clone(); ud.occMat.transparent = true; }
      o.material = ud.occMat; const a = cur + (want - cur) * 0.22; ud.occA = a; ud.occMat.opacity = a; ud.occMat.depthWrite = a > 0.95; moving = true; }
    if (moving) this._dirty = true;
  }
  // 보케(가로등 빛점)는 카메라가 가까우면 거대한 원판으로 보이므로 공정 확대 시 크기를 줄인다
  _bokehTick() { const P = this._bokehPts; if (!P) return; const near = !!this.zone && !this._isOverview; for (const pm of P) { const want = near ? pm.userData.bokeh * 0.25 : pm.userData.bokeh; if (pm.material.size !== want) { pm.material.size = want; this._dirty = true; } } }
  _sharkTick(now) { const S = this._sharks; if (!S || !this.backdrop?.visible) return; const t = now * 0.001; for (const g of S) { const u = g.userData, a = u.ph + t * u.sp; g.position.set(u.cx + Math.cos(a) * u.rx, 0.15 + Math.sin(t * 1.3 + u.ph) * 0.12, u.cz + Math.sin(a) * u.rz); const dx = -Math.sin(a) * u.rx * Math.sign(u.sp), dz = Math.cos(a) * u.rz * Math.sign(u.sp); g.rotation.y = Math.atan2(-dz, dx); u.tail.rotation.y = Math.sin(t * 4 + u.ph) * 0.5; } this._dirty = true; }
  _trafficTick(now) { const T = this._traffic; if (!T || !this.backdrop?.visible || document.hidden) return; const dt = Math.min(0.1, (now - (T.last || now)) / 1000); T.last = now; if (!dt) return;
    const { dmy, tmp, at } = T;
    for (const c of T.cars) { c.d += c.v * dt; if (c.d > c.path.len) c.d -= c.path.len; if (c.d < 0) c.d += c.path.len; }
    const inZone = (x, z) => Object.values(SITE).some(q => Math.abs(x - (q.c[0] + q.ap[0])) < q.ap[2] / 2 + 2 && Math.abs(z - (q.c[1] + q.ap[1])) < q.ap[3] / 2 + 2);
    Object.values(T.inst2).forEach(({ b, t, list }) => { list.forEach((c, i) => { at(c.path, c.d, tmp); const nx = Math.sin(tmp.ry), nz = Math.cos(tmp.ry); const hid = inZone(tmp.x + nx * c.off, tmp.z + nz * c.off); c.hid = hid; dmy.position.set(tmp.x + nx * c.off, hid ? -5 : 0.45, tmp.z + nz * c.off); dmy.rotation.set(0, tmp.ry + (c.v < 0 ? Math.PI : 0), 0); dmy.updateMatrix(); b.setMatrixAt(i, dmy.matrix); dmy.position.y = hid ? -5 : 1.0; dmy.updateMatrix(); t.setMatrixAt(i, dmy.matrix); }); b.instanceMatrix.needsUpdate = t.instanceMatrix.needsUpdate = true; });
    if (T.lamps) { const a = T.lamps.geometry.attributes.position.array; T.cars.forEach((c, i) => { at(c.path, c.d, tmp); const dir = c.v < 0 ? -1 : 1, fx = Math.cos(tmp.ry) * dir, fz = -Math.sin(tmp.ry) * dir, nx = Math.sin(tmp.ry), nz = Math.cos(tmp.ry); a[i * 6] = tmp.x + nx * c.off + fx * 1.2; a[i * 6 + 1] = c.hid ? -5 : 0.6; a[i * 6 + 2] = tmp.z + nz * c.off + fz * 1.2; a[i * 6 + 3] = tmp.x + nx * c.off - fx * 1.2; a[i * 6 + 4] = c.hid ? -5 : 0.6; a[i * 6 + 5] = tmp.z + nz * c.off - fz * 1.2; }); T.lamps.geometry.attributes.position.needsUpdate = true; }
    const tr = T.train; tr.d += tr.v * dt; const total = T.rail.len + tr.gap * tr.wagons.length + 10; if (tr.d > total) tr.d = -tr.gap * tr.wagons.length;
    tr.wagons.forEach((w, i) => { const d = tr.d - i * tr.gap; const vis = d > 0 && d < T.rail.len; w.visible = vis; if (!vis) return; at(T.rail, d, tmp); w.position.set(tmp.x, i ? 0.95 : 1.15, tmp.z); w.rotation.y = tmp.ry; });
    this._dirty = true; }
  _fwTick(now) { const F = this._fw; if (!F || !this.dark || !this.backdrop?.visible || document.hidden) return; const dt = Math.min(0.1, (now - (F.last || now)) / 1000); F.last = now; if (!dt) return;
    const { pos, col, PER, rnd, palette, bursts } = F; const c = new THREE.Color(); let glowSum = 0, gx = 0, gz = 0;
    bursts.forEach((b, bi) => { b.t += dt;
      if (b.t < 0) { for (let i = 0; i < PER; i++) pos[(bi * PER + i) * 3 + 1] = -50; return; }
      if (b.life === 0) { b.t = 0; // 새 발사: 위치·색·방향 1회 결정
        const site = F.sites[Math.floor(rnd() * F.sites.length)]; b.x = site[0] + (rnd() - 0.5) * 30; b.z = site[1] + (rnd() - 0.5) * 20; b.hy = 38 + rnd() * 18; b.col.setHex(palette[Math.floor(rnd() * palette.length)]); b.life = 1;
        // 링형은 하늘을 향한 수평 원판 대신, 카메라를 마주보는 세로 원(오른쪽 축 × 위쪽 축)으로 퍼지게
        const ring = false, cd = new THREE.Vector3(b.x - this.camera.position.x, 0, b.z - this.camera.position.z).normalize(), rx = -cd.z, rz = cd.x; // 테두리만 있는 링형은 사용하지 않음 — 전부 속이 찬 구형
        for (let i = 0; i < PER; i++) { let th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
          if (ring) { const j = (rnd() - 0.5) * 0.12; b.dirs[i * 3] = Math.cos(th) * rx + cd.x * j; b.dirs[i * 3 + 1] = Math.sin(th); b.dirs[i * 3 + 2] = Math.cos(th) * rz + cd.z * j; }
          else { b.dirs[i * 3] = Math.sin(ph) * Math.cos(th); b.dirs[i * 3 + 1] = Math.cos(ph); b.dirs[i * 3 + 2] = Math.sin(ph) * Math.sin(th); }
          b.spd[i] = (ring ? 13 : 3 + 12 * Math.cbrt(rnd())); } } // 반지름을 안쪽까지 고르게 분포 → 가운데도 불꽃이 차 보이게
      const RISE = 1.4, BOOM = 2.6, t = b.t;
      if (t < RISE) { const y = b.hy * (1 - Math.pow(1 - t / RISE, 2)); for (let i = 0; i < PER; i++) { const o = (bi * PER + i) * 3; if (i < 6) { pos[o] = b.x + (rnd() - 0.5) * 0.4; pos[o + 1] = y - i * 1.2; pos[o + 2] = b.z; c.set(0xffe6b0).multiplyScalar(1 - i / 6); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; } else pos[o + 1] = -50; } }
      else if (t < RISE + BOOM) { const u = (t - RISE) / BOOM, e = 1 - Math.pow(1 - u, 3), fade = u < 0.15 ? 1 : Math.max(0, 1 - (u - 0.15) / 0.85), fl = 0.75 + 0.25 * Math.sin(t * 25 + bi); glowSum += fade * (1 - u * 0.5); gx += b.x; gz += b.z;
        for (let i = 0; i < PER; i++) { const o = (bi * PER + i) * 3, sp = b.spd[i] * e; pos[o] = b.x + b.dirs[i * 3] * sp; pos[o + 1] = b.hy + b.dirs[i * 3 + 1] * sp - 10 * u * u; pos[o + 2] = b.z + b.dirs[i * 3 + 2] * sp; c.copy(b.col).lerp(new THREE.Color(0xffffff), u < 0.1 ? 1 - u * 10 : 0).multiplyScalar(fade * fl); col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; } }
      else { b.t = -(1.5 + rnd() * 4); b.life = 0; for (let i = 0; i < PER; i++) pos[(bi * PER + i) * 3 + 1] = -50; } });
    F.pts.geometry.attributes.position.needsUpdate = true; F.pts.geometry.attributes.color.needsUpdate = true;
    const nb = bursts.filter(b => b.t > 1.4 && b.life).length; void nb;
    this._dirty = true; }
  _frame(now) { this._bokehTick(); this._sharkTick(now); this._trafficTick(now); this._fwTick(now); this._wavesTick(now); this._occTick(now); this._workTick(now); this._torpTick(now); if (this._stepFx?.tick(now)) this._dirty = true; this._matSinkTick(now); if (this.material && this.material.visible && this.material.userData.tick && (this.touring || this.playing || this.move)) { this.material.updateMatrixWorld(); this.material.userData.tick(now); this._dirty = true; } if (this._vehicle && !this._vehicle.done) this._vehicleTick(now); if (this.zones) for (const id in this.zones) { const z = this.zones[id]; if (z.smoke && z.root.visible) { z.smoke.visible = !this._2d; if (z.smoke.visible) this._smokeTick(z.smoke, now); } else if (z.smoke) z.smoke.visible = false; }
    if (this._navG) { const vis = !!this.zone && !this._2d && this.orbit.dist <= 120 && !this.getAttribute('selected') && !this.touring && !this.playing; if (this._navG.visible !== vis) { this._navG.visible = vis; this._dirty = true; }
      if (vis && now - (this._navT || 0) > 50) { this._navT = now; this._placeNav(); const k = (now / 1000) % 1.4 / 1.4; this._navG.children.forEach(a => { const d = a.userData.dir, [m1, m2] = a.userData.m; m1.position.x = d * k * 0.9; m2.position.x = d * (k * 0.9 - 1.8); m2.material.opacity = 0.2 + 0.4 * (1 - k); }); this._dirty = true; } }
    if (this._skyAnim && !document.hidden && this.orbit.dist > 40) { const st = this._skyAnim; if (!st.last) st.last = now; if (now - st.last > 50) { this._skyStep(st, Math.min(0.2, (now - st.last) / 1000)); st.last = now; this._dirty = true; } }
    this._focusVeil();
    if (this.grid) { const g = this._gridOn !== false && this.orbit.dist > 120; if (this.grid.visible !== g) { this.grid.visible = g; this._dirty = true; } } const ov = this.orbit.dist > 120; if (ov !== this._isOverview) { this._isOverview = ov; this._zoneLight(); this._placeSun(); this._lampFade(); this._zoneVis(); if (ov) { this._showInterior(null); this.dispatchEvent(new CustomEvent('steel-overview', { bubbles: true, composed: true })); } }
    if (this.anim) { const k = Math.min(1, (now - this.anim.t0) / this.anim.dur), s = k * k * (3 - 2 * k);
      this.orbit.target.lerpVectors(this.anim.from.target, this.anim.to.target, s);
      this.orbit.yaw = this.anim.from.yaw + (this.anim.to.yaw - this.anim.from.yaw) * s; this.orbit.pitch = this.anim.from.pitch + (this.anim.to.pitch - this.anim.from.pitch) * s; this.orbit.dist = this.anim.from.dist + (this.anim.to.dist - this.anim.from.dist) * s;
      if (k >= 1) this.anim = null; }
    const o = this.orbit;
    if (!this._2d) {
    if (this.scene.fog && this._fog0) { const ex = Math.max(0, o.dist - 130), fn = this._fog0[0] + ex, ff = this._fog0[1] + ex * 1.3; if (Math.abs(this.scene.fog.near - fn) > 0.5) { this.scene.fog.near = fn; this.scene.fog.far = ff; this._dirty = true; } }
    this.camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch));
    if (this.nightSky) this.nightSky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.camera.lookAt(o.target);
    }
    if (this.move) {
      const mv = this.move, k = Math.min(1, (now - mv.t0) / mv.dur), e = k * k * (3 - 2 * k);
      const ee = this.rail ? 0.5 - 0.5 * Math.cos(Math.PI * k) : e;
      const { pos, dir } = this._along(this._stopIdx(mv.from), this._stopIdx(mv.to), ee);
      if (mv.arc && !this.rail) pos.y += Math.sin(e * Math.PI) * mv.arc;
      if (this._tourTube) { const tt = this._tourTube.userData.total; this._tourTube.geometry.setDrawRange(0, Math.floor(tt * ee / 6) * 6); }
      this._setMaterial(k > 0.5 ? mv.state : mv.prevState, pos);
      if (this.material) { this.material.traverse(o => { if (o.isMesh || o.isPoints) o.visible = !!(this.zone && this.zone.root.visible); }); if (this.rail) this._orient(dir); else this.material.rotation.y += 0.02; }
      this.t = (mv.from + ee) / (this._nStops() - 1);
      if (now - (this.lastEmit || 0) > 120 || k >= 1) { this.lastEmit = now; this._emitProgress(); }
      if (k >= 1) { this.move = null; mv.resolve(); }
    }
    if (this.playing) {
      const t = Math.min(1, (now - this.playT0) / this.playDur); this.t = t;
      const segs = this._nStops() - 1, f = t * segs, i = Math.min(segs - 1, Math.floor(f)), u = f - i, ns = this.states.length;
      let x, dir, sIdx;
      if (this.rail) { const r = this._along(this._stopIdx(0), this._stopIdx(segs), t), S = this._stopList(); x = r.pos; dir = r.dir; let p = 0; for (let s2 = 1; s2 < S.length; s2++) if (S[s2] <= r.seg + r.f + 1e-6) p = s2; sIdx = Math.min(ns - 1, p); }
      else { x = this._along(this._stopIdx(i), this._stopIdx(i + 1), u).pos; sIdx = t >= 1 ? ns - 1 : Math.min(ns - 1, Math.max(0, Math.round(f - 0.5))); }
      this._setMaterial(sIdx, x);
      if (this._flowLine) { const tt = this._flowLine.userData.total; this._flowLine.geometry.setDrawRange(0, Math.floor(tt * t / 6) * 6); }
      if (this.material) { if (this.rail) this._orient(dir); else this.material.rotation.y += 0.01; }
      if (t >= 1) { if (this.getAttribute('view') === 'flow' && !this.touring) { this.playT0 = now; } else this.playing = false; }
      if (now - (this.lastEmit || 0) > 120 || !this.playing) { this.lastEmit = now; this._emitProgress(); }
    }
    const w = this.clientWidth, h = this.clientHeight, v = new THREE.Vector3();
    (this.zoneLabels || []).forEach(z => { v.copy(z.labelPos).project(this.camera); const py = (1 - v.y) / 2 * h; const vis = v.z < 1 && py > 10 && py < h - 30 && !this._zoneLabelsHidden && !this._modelsHidden; const lx = Math.round((v.x + 1) / 2 * w), ly = Math.round((1 - v.y) / 2 * h); if (z._lx !== lx || z._ly !== ly || z._vis !== vis) { z._lx = lx; z._ly = ly; z._vis = vis; z.label.style.display = vis ? 'flex' : 'none'; if (vis) z.label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%,0)`; } });
    (this.zoneArrows || []).forEach(a => { v.copy(a.pos).project(this.camera); const lx = Math.round((v.x + 1) / 2 * w), ly = Math.round((1 - v.y) / 2 * h); const q0 = a.p0.clone().project(this.camera), q1 = a.p1.clone().project(this.camera), ang = Math.round(Math.atan2(-(q1.y - q0.y) * h, (q1.x - q0.x) * w) * 180 / Math.PI); if (a._lx !== lx || a._ly !== ly || a._ang !== ang) { a._lx = lx; a._ly = ly; a._ang = ang; a.el.style.transform = `translate(${lx}px, ${ly}px) translate(-50%,-50%) rotate(${ang}deg)`; } });
    if (this._zoomKey !== (this.orbit.dist > 120)) { this._zoomKey = this.orbit.dist > 120; this._styleZoneLabels(); }
    const far = this.orbit.dist > 120;
    this.eqs.forEach(e => { v.copy(e.anchor).project(this.camera); const vis = v.z < 1 && !far && (!this.zone || this.zone.root.visible); const lx = Math.round((v.x + 1) / 2 * w), ly = Math.round((1 - v.y) / 2 * h); if (e._lx !== lx || e._ly !== ly || e._vis !== vis) { e._lx = lx; e._ly = ly; e._vis = vis; e.label.style.display = vis ? 'flex' : 'none'; if (vis) e.label.style.transform = `translate(${lx - 7}px, ${ly}px) translate(0,-50%)`; } });
    this._declutter(now);
    (this.interiorLabels || []).forEach(l => { if (!l._pos || l._dock || l._hide) return; if (l.style.display === 'none' && l._card) return; v.copy(l._pos).project(this.camera); const vis = v.z < 1; l.style.display = vis ? 'flex' : 'none'; if (vis) { let px = (v.x + 1) / 2 * w; if (l._card && l._up) { const cw = l.offsetWidth || 260; px = Math.min(Math.max(px - cw / 2, 8), w - cw - 8); l.style.transform = 'translate(0,-100%)'; } else if (l._card) { const cw = l.offsetWidth || 260, leftLimit = this.labels.dataset.leftLimit ? +this.labels.dataset.leftLimit : 8, rightLimit = w - 8; if (px + cw <= rightLimit) { l.style.transform = 'translate(0,-50%)'; } else { const alt = l._posL.clone().project(this.camera), lx = (alt.x + 1) / 2 * w; if (lx - cw >= leftLimit) { px = lx; l.style.transform = 'translate(-100%,-50%)'; } else { px = Math.min(Math.max(px - cw / 2, leftLimit), rightLimit - cw); l.style.transform = 'translate(0,-100%)'; const upv = l._pos.clone(); upv.y = (this.interiorTop ?? upv.y); } } } l.style.left = px + 'px'; l.style.top = ((1 - v.y) / 2 * h) + 'px'; } });
    if (this._hl) { const k = (Math.sin((now - this._hl.t0) / 1000 * Math.PI * 1.25) + 1) / 2; this._hl.meshes.forEach(([o, c, sat]) => o.material.color.copy(c).lerp(sat, 0.35 + 0.65 * k)); this._hl.glows.forEach(g => { g.material.opacity = 0.08 + 0.32 * k; }); this._dirty = true; }
    if (this.dark && this._neons) this._neons.forEach(m => { m.uniforms.t.value = now / 1000; });
    if (this.embers) { const p = this.embers.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.getY(i) + 0.012; if (y > 42) y = 2; p.setY(i, y); } p.needsUpdate = true; this._dirty = true; }
    if (this.ring.visible) this.ring.rotation.z += 0.01;
    if (this.hoverRing && this.hoverRing.visible) { this.hoverRing.rotation.z += 0.02; this._dirty = true; }
  }
  // [UI 시안] 자동 시연 말풍선: 지금 설명 중인 설비/층 옆에 붙고, 같은 색 지시선으로 연결
  _tourCallout() {
    const st = this.touring ? this.tourStep : null;
    if (!this._tc) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: '6' });
      svg.innerHTML = '<line stroke-width="1.5" stroke-dasharray="3 3"></line><circle r="5" fill="none" stroke-width="2"></circle><circle r="2.2"></circle>';
      const card = document.createElement('div'); Object.assign(card.style, { position: 'absolute', left: '0', top: '0', width: '300px', display: 'flex', flexDirection: 'column', gap: '5px', padding: '12px 14px', background: 'rgba(12,17,24,.92)', border: '1px solid', borderRadius: '8px', color: '#eef2f6', fontFamily: '"IBM Plex Sans KR", sans-serif', pointerEvents: 'none', zIndex: '7', transition: 'opacity .25s, border-color .25s', backdropFilter: 'blur(8px)', willChange: 'transform' });
      card.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px"><em style="font-style:normal;font-size:11px;font-weight:700;letter-spacing:.08em"></em><code style="font-family:IBM Plex Mono,monospace;font-size:11px;color:#8c98a8"></code></div><b style="font-size:16px;font-weight:700;line-height:1.3"></b><span style="font-size:13px;line-height:1.55;color:#cfd7e1"></span>';
      this.labels.append(svg, card); this._tc = { svg, card, key: null }; }
    const T = this._tc; if (!st) { if (T.card.style.opacity !== '0') { T.card.style.opacity = '0'; T.svg.style.opacity = '0'; } T.key = null; return; }
    let pos = null, col = '#22c7f0'; const e = st.eq ? this.eqs.find(q => q.id === st.eq) : null, it = st.layer != null ? this.layerItems?.[st.layer] : null;
    if (it) { pos = it.mid; col = typeof it.L.color === 'string' ? it.L.color : '#' + new THREE.Color(it.L.color).getHexString(); } else if (e) pos = e.anchor; else if (this.material) pos = this.material.position;
    const key = st.i + '|' + st.layer; if (T.key !== key) { T.key = key; T.card.querySelector('em').textContent = '자동 시연'; T.card.querySelector('code').textContent = st.i + ' / ' + st.total; T.card.querySelector('b').textContent = st.title || ''; T.card.querySelector('span').textContent = st.text || ''; }
    T.card.style.borderColor = col; T.card.querySelector('em').style.color = col; T.card.style.boxShadow = '0 0 0 1px ' + col + '22, 0 10px 30px rgba(0,0,0,.35)';
    const [ln, ring, dot] = T.svg.children; ln.setAttribute('stroke', col); ring.setAttribute('stroke', col); dot.setAttribute('fill', col);
    const w = this.clientWidth, h = this.clientHeight; if (!pos) { T.card.style.opacity = '0'; T.svg.style.opacity = '0'; return; }
    const v = pos.clone().project(this.camera); if (v.z > 1) { T.card.style.opacity = '0'; T.svg.style.opacity = '0'; return; }
    const ax = (v.x + 1) / 2 * w, ay = (1 - v.y) / 2 * h, cw = 300, ch = T.card.offsetHeight || 100, m = 16;
    const right = ax + 70 + cw < w - m; let cx = right ? ax + 70 : ax - 70 - cw, cy = ay - ch - 50; if (cy < 70) cy = ay + 50;
    cx = Math.max(m, Math.min(w - cw - m, cx)); cy = Math.max(m, Math.min(h - ch - 90, cy));
    T.card.style.transform = 'translate(' + Math.round(cx) + 'px,' + Math.round(cy) + 'px)'; T.card.style.opacity = '1'; T.svg.style.opacity = '1';
    const ex = Math.max(cx, Math.min(cx + cw, ax)), ey = Math.max(cy, Math.min(cy + ch, ay)); const bx = ex === ax && ey === ay ? cx : ex;
    ln.setAttribute('x1', ax); ln.setAttribute('y1', ay); ln.setAttribute('x2', bx); ln.setAttribute('y2', ey);
    ring.setAttribute('cx', ax); ring.setAttribute('cy', ay); dot.setAttribute('cx', ax); dot.setAttribute('cy', ay);
  }
  _emitProgress() { this.dispatchEvent(new CustomEvent('steel-progress', { detail: { t: this.t || 0, label: (this.states && this.states[this.matIdx]?.label) || '', playing: !!this.playing || !!this.touring, touring: !!this.touring, step: this.tourStep || null }, bubbles: true, composed: true })); }
  _emitTour(step) { this.tourStep = step; this.dispatchEvent(new CustomEvent('steel-tour', { detail: step, bubbles: true, composed: true })); this._emitProgress(); }
  _moveMaterial(from, to, dur, state, arc) { return new Promise(resolve => { this.move = { from, to, t0: performance.now(), dur, state, prevState: this.matIdx < 0 ? 0 : this.matIdx, arc, resolve }; }); }
  _wait(ms) { return new Promise((res) => { const tk = this._tourToken; const id = setTimeout(res, ms); this._tourWaits.push({ id, res }); }); }
  _skip() { (this._tourWaits || []).forEach(w => { clearTimeout(w.id); w.res(); }); this._tourWaits = []; if (this.move) { const mv = this.move; this.move = null; this._setMaterial(mv.state, this._stopPos(mv.to)); mv.resolve(); } }
  // 자동 시연: 설비마다 소재 이동 → 카메라 → 내부 층 순서대로 설명
  // 특정 설비 구간부터 시연 시작(진행 중이면 그 지점으로 점프)
  async jumpTo(k, speed = 1) {
    if (this.siteMode || !this.eqs.length) return false;
    if (this.touring) { (this._tourWaits || []).forEach(w => { clearTimeout(w.id); w.res(); }); if (this.move) { this.move.resolve(); this.move = null; } this.touring = false; }
    return this.tour(speed, k);
  }
  walk(id, speed = 1) { const k = this.eqs.findIndex(e => e.id === id); if (k < 0) return false; if (this.touring) this.stopTour(); return this.tour(speed, 0, k); }
  async tour(speed = 1, startAt = 0, only = null) {
    if (this.touring || this.siteMode || !this.eqs.length) return false;
    const token = ++this._tourId;
    try { return await this._tourBody(token, speed, startAt, only); }
    catch (err) { console.error('tour error', err); return false; }
    finally { if (token === this._tourId) { this.touring = false; this.tourStep = null; this.move = null; this._emitProgress(); this.dispatchEvent(new CustomEvent('steel-tour-end', { bubbles: true, composed: true })); } }
  }
  async _tourBody(token, speed, startAt = 0, only = null) {
    this.touring = true; this._tourWaits = []; this.playing = false;
    const sp = 1 / (speed * 1.3), /* 기본 재생 속도 1.3배 */ cnt = (e) => 1 + (e.interior && e.data.interior ? e.data.interior.length : 0), total = only != null ? cnt(this.eqs[only]) + 2 : this.eqs.reduce((n, e) => n + cnt(e), 0) + 2; // 설비 하나만 볼 때는 그 설비 단계 수
    let step = 0;
    this._select(null); this._setMaterial(0, this.path[0]); this.t = 0;
    if (startAt > 0) { step = 1 + startAt; this.matIdx = -1; this._setMaterial(startAt, this._stopPos ? this._stopPos(startAt) : this.path[startAt]); this.t = startAt / ((this._nStops ? this._nStops() : this.path.length) - 1); }
    else if (only == null) step = 1; // 개요 단계 없이 바로 첫 설비로
    if (only != null) { const e = this.eqs[only]; step = 0; this.matIdx = -1; this._setMaterial(only, this._stopPos(only));
      this._emitTour({ i: ++step, total, title: e.data.name + ' 작동 보기', text: '먼저 설비 전체 모습을 보고, 소재가 지나가는 순서대로 안쪽을 확대해요.', eq: e.id });
      this._select(e.id); this._animateTo({ yaw: -0.55, pitch: 0.42, dist: e.dist * 1.8, target: e.focus.clone() }); this._startWork(e); await this._wait(2600 * sp); if (token !== this._tourId) return; }
    const kEnd = only != null ? only + 1 : this.eqs.length;
    for (let k = only != null ? only : startAt; k < kEnd; k++) {
      const e = this.eqs[k];
      // 소재가 레일을 따라 설비로 들어간 뒤 → 설비가 작동하고 설명 시작
      const torp = this.process?.id === 'steelmaking' && k === 0 && this._torpSetup(); if (!torp) this._torpReset();
      this._select(e.id); this.focus(e.id); this._hideMat = !!torp; if (torp && this.material) this.material.visible = false; this._matSink = null; if (torp) this._torp.ph = { kind: 'drive', t0: performance.now(), dur: 2400 * sp }; // 제강 첫 단계: 쇳물 덩어리 대신 모델 속 토페도카가 레일로 들어옴 if (this.material) this.material.scale.setScalar(this.matScale || 1);
      const quick = this._pendingTour && k === (only != null ? only : startAt); this._pendingTour = false;
      await this._moveMaterial(k, k + 1, (quick ? 600 : 2400) * sp, k + 1, 0); if (token !== this._tourId) return;
      this._emitTour({ i: ++step, total, title: `${String(k + 1).padStart(2, '0')} ${e.data.name}`, text: e.data.role, eq: e.id }); this._startWork(e);
      if (this._isVehicle(e) && this.material) { const y0 = this.material.position.y; const p = this.material.position; this._sinkSaved = []; this.material.traverse(o => { if (!o.material) return; this._sinkSaved.push([o, o.visible, o.material.depthTest, o.renderOrder]); if (o.isSprite || o.material.blending === THREE.AdditiveBlending) o.visible = false; else { o.material.depthTest = true; o.renderOrder = 0; o.material.needsUpdate = true; } }); /* 차체에 가려지도록: 후광 끄고 깊이 테스트 켬 */ this._matSink = { t0: performance.now() + 100 * sp, dur: 1300 * sp, y0: e.focus.y + 0.35, y1: e.focus.y - 0.9, x0: p.x, z0: p.z, x1: e.focus.x, z1: e.focus.z }; } // 토페도카: 쇳물은 차 안에 실린 것으로 보고 덩어리는 숨김 // _startWork 뒤에 둬야 _stopWork에 지워지지 않음
      if (!this._isVehicle(e) && !torp) this._matSink = { t0: performance.now() + 700 * sp };
      if (torp) { this._hideMat = true; if (this.material) this.material.visible = false; } // _startWork가 소재를 다시 켜므로 한 번 더 숨김
      if (torp) this._torp.ph = { kind: 'pour', t0: performance.now() + 150 * sp, dur: 1400 * sp }; // 토페도카를 기울여 래들로 쇳물 붓기 // 소재는 설비에 들어간 뒤 작아지며 사라진다(설비 설명에 시선이 가게)
      const hasLayers = e.interior && e.data.interior && this.layerItems?.length; // 단면 설명이 있으면 앞 대기 없이 바로 시작
      await this._wait((hasLayers ? 250 : 3000) * sp); if (token !== this._tourId) return;
      if (/torpedo|_car$/.test(e.id)) { await this._driveVehicle(e, k, 3600 * sp); if (token !== this._tourId) return; } // 토페도카: 쇳물을 싣고 레일을 따라 이동
      if (e.interior && e.data.interior && this.layerItems?.length) {
        for (let L = 0; L < this.layerItems.length; L++) {
          const it = this.layerItems[L];
          this._emitTour({ i: ++step, total, title: it.L.temp ? `${e.data.name} · ${it.L.temp}` : `${e.data.name} · ${it.L.label}`, text: it.L.temp ? it.L.label : (e.data.steps?.[L]?.zone || ''), eq: e.id, layer: L });
          this.activeLayer = null; this._focusLayer(L);
          const ln = (it.L.label.length * 26) + ((e.data.steps?.[L]?.text || '').length * 12) + ((it.L.formula || '').length * 22);
          await this._wait(Math.max(5000, 3500 + ln) * sp); if (token !== this._tourId) return;
        }
        this._fx().play(null); if (this._work) this._work.g.visible = true;
        this.activeLayer = null; this.layerItems.forEach(it => { it.m.traverse(o => { if (o.isMesh) o.material.opacity = 0.9; }); it.tl.style.opacity = '1'; it.card.style.display = 'none'; it.tl.style.background = 'rgba(8,12,18,.45)'; it.tl.style.color = '#fff'; it.tl.style.transform = 'translate(-50%,-50%)'; it.tl.style.borderColor = 'rgba(255,255,255,.35)'; });
        this.focus(e.id); // 설명 끝나면 바로 다음 설비로
      }
    }
    if (only != null) { const e = this.eqs[only]; this._emitTour({ i: ++step, total, title: e.data.name + ' 작동 보기 완료', text: e.data.materialOut?.label || e.data.output, eq: e.id }); this.focus(e.id); await this._wait(1800 * sp); this._select(e.id); return true; }
    this._stopWork();
    this._emitTour({ i: ++step, total, title: '완료', text: this.states[this.states.length - 1].label + ' → 다음 공정으로', eq: null });
    this._select(null); this.reset();
    await this._moveMaterial(this.eqs.length, this.eqs.length + 1, 3200 * sp, this.states.length - 1, 0); if (token !== this._tourId) return;
    await this._wait(3000 * sp);
    return true;
  }
  next() { if (this.touring) this._skip(); }
  stopTour() { this._torpReset(); if (!this.touring) return; this._flowTube(false); this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; this._select(null); this.reset(); this.stop(); }
  // [UI 시안] 2D 뷰: 지금 공정을 직교 카메라로 본다. mode = top(위에서 본 실사) | plan(평면도 선화) | front(정면도 선화)
  setDrawMode(m) { if (!['top', 'plan', 'front'].includes(m) || m === this._drawMode) return; this._drawMode = m; if (this._2d) { this._2dStyle(); this._fit2d(false); } }
  _apply2d() {
    const on = this.getAttribute('view') === '2d' && !!this.zone;
    if (on === !!this._2d && (!on || this._2dZone === this.zone)) return;
    if (on) {
      if (!this._ortho) this._ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1200);
      this._2d = true; this._2dZone = this.zone; this.camera = this._ortho; this._drawMode = this._drawMode || 'top';
      this._fit2d(false); this._2dStyle();
    } else {
      this._2d = false; this._2dZone = null; this.camera = this._persp; this._2dStyle(); this._applyTheme();
    }
    this._dirty = true;
  }
  _zoneModel(z = this.zone) { return z?.root.children.find(c => c.name && c.name.startsWith('GLB_')) || z?.root; }
  // 지금 공정 크기에 맞춰 직교 카메라 범위를 잡는다(keepZoom이면 확대·이동 유지)
  _fit2d(keepZoom) { const c = this._ortho, m = this._zoneModel(); if (!c || !m) return;
    const box = new THREE.Box3().setFromObject(m); if (box.isEmpty()) return; const ctr = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), front = this._drawMode === 'front';
    const A = (this.clientWidth || 1) / (this.clientHeight || 1), wd = sz.x, ht = front ? sz.y : sz.z, hw = Math.max(wd / 2, ht / 2 * A) * 1.18, hh = hw / A;
    Object.assign(c, { left: -hw, right: hw, top: hh, bottom: -hh }); if (!keepZoom || !this._2dCenter) { c.zoom = 1; this._2dCenter = ctr.clone(); }
    this._place2d(); c.updateProjectionMatrix(); this._dirty = true; }
  _place2d() { const c = this._ortho, p = this._2dCenter; if (!c || !p) return;
    if (this._drawMode === 'front') { c.up.set(0, 1, 0); c.position.set(p.x, p.y, p.z + 300); } else { c.up.set(0, 0, -1); c.position.set(p.x, p.y + 300, p.z); }
    c.lookAt(p); c.updateMatrixWorld(); }
  _pan2d(dx, dy) { const c = this._ortho; if (!c || !this._2dCenter) return; const k = (c.right - c.left) / c.zoom / (this.clientWidth || 1);
    this._2dCenter.x -= dx * k; if (this._drawMode === 'front') this._2dCenter.y += dy * k; else this._2dCenter.z -= dy * k; this._place2d(); this._dirty = true; }
  _focus2d(e) { const c = this._ortho; if (!c) return; this._2dCenter = e.focus.clone(); const span = Math.max(8, (e.dist || 20) * 0.9); c.zoom = Math.min(10, Math.max(1, (c.right - c.left) / span)); c.updateProjectionMatrix(); this._place2d(); this._dirty = true; }
  // 선화(도면) 스타일: 모델 면은 도면 배경색으로 채워 뒤쪽 선을 가리고, 모서리 선만 밝게 그린다
  _2dStyle() {
    const bp = this._2d && this._drawMode !== 'top', z = this._2dZone || this.zone, m = this._zoneModel(z);
    (this._bpZones || []).forEach(q => { if (q.bp) q.bp.visible = false; if (q.model) q.model.visible = true; });
    if (bp && m) {
      if (z.bp && z.model !== m) { this.scene.remove(z.bp); z.bp = null; } // 모델(GLB)이 늦게 로드되면 도면을 다시 만든다
      if (!z.bp && m !== z.root) { m.updateMatrixWorld(true); const g = new THREE.Group(); g.name = 'BLUEPRINT'; const fill = new THREE.MeshBasicMaterial({ color: 0x14365c, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: false }), line = new THREE.LineBasicMaterial({ color: 0xd7ecff, fog: false, transparent: true, opacity: 0.9 });
        m.traverse(o => { if (!o.isMesh) return; const f = new THREE.Mesh(o.geometry, fill); f.matrixAutoUpdate = false; f.matrix.copy(o.matrixWorld); g.add(f);
          const l = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), line); l.matrixAutoUpdate = false; l.matrix.copy(o.matrixWorld); g.add(l); });
        z.bp = g; z.model = m; this.scene.add(g); (this._bpZones = this._bpZones || []).push(z); }
      if (z.bp) { z.bp.visible = true; m.visible = false; }
    }
    if (!this._bpGrid) { const gr = new THREE.Group(); [[400, 200, 0x24507e, 0.55], [400, 40, 0x3d6c9c, 0.9]].forEach(([size, div, col, op]) => { const h = new THREE.GridHelper(size, div, col, col); h.material.transparent = true; h.material.opacity = op; h.material.fog = false; gr.add(h); }); this._bpGrid = gr; this.scene.add(gr); }
    this._bpGrid.visible = bp; if (bp) { const p = this._2dCenter || new THREE.Vector3(z?.ox || 0, 0, z?.oz || 0); if (this._drawMode === 'front') { this._bpGrid.rotation.set(Math.PI / 2, 0, 0); this._bpGrid.position.set(p.x, 0, new THREE.Box3().setFromObject(m).min.z - 2); } else { this._bpGrid.rotation.set(0, 0, 0); this._bpGrid.position.set(p.x, -0.05, 0); } }
    [this.backdrop, this.ground, this._links?.g, this._waves?.g].forEach(o => { if (o) o.visible = !bp; }); if (this.nightSky) this.nightSky.visible = !bp && !!this.dark; if (this.zl) this.zl.g.visible = !bp && !!this.dark && !this._isOverview;
    if (this.material) this.material.visible = !bp && !!this.zone?.root.visible;
    if (bp) { this.scene.background = new THREE.Color(0x0f2c4c); this.scene.fog = null; this.ring.visible = false; }
    this._dirty = true;
  }
  _ext() { return this.hasAttribute('external-cards') || this.hasAttribute('externalcards'); }
  // 고른 층: 모서리선(흰색)과 면 색이 천천히 깜박인다(_frame에서 맥동)
  _layerHL(idx) { const H = this._hl; if (H) { H.glows.forEach(g => g.parent?.remove(g)); H.meshes.forEach(([o, c]) => o.material.color.copy(c)); this._hl = null; }
    const it = idx == null ? null : this.layerItems?.[idx]; if (!it) return; const list = [], glows = [], meshes = [];
    it.m.traverse(o => { if (o.isMesh) list.push(o); });
    list.forEach(o => { const base = o.material.color.clone(), sat = base.clone(), hsl = {}; sat.getHSL(hsl); sat.setHSL(hsl.h, Math.min(1, hsl.s * 1.4 + 0.25), Math.min(0.62, hsl.l + 0.12));
      const g = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ color: sat, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })); g.renderOrder = 13; g.scale.setScalar(1.015); g.raycast = () => {};
      o.add(g); glows.push(g); meshes.push([o, base, sat]); });
    this._hl = { glows, meshes, t0: performance.now() }; this._dirty = true; }
  // [UI 시안] 페이지 우측 패널에서 단면 층을 고를 때
  layer(idx) { if (!this.layerItems?.length || this.activeLayer === idx) return false; this.pinnedLayer = idx; this.activeLayer = null; this._focusLayer(idx); return true; }
  // [UI 시안] 흐름 보기: 현재 공정의 소재 이동 경로를 관으로 그리고, 소재를 반복해서 흘려 보낸다
  _flowTube(on) { if (this._tourTube) { this.scene.remove(this._tourTube); this._tourTube = null; } if (!on || !this.path || this.path.length < 2) return;
    const cp = new THREE.CurvePath(); for (let i = 0; i < this.path.length - 1; i++) cp.add(new THREE.LineCurve3(this.path[i], this.path[i + 1]));
    const t = new THREE.Mesh(new THREE.TubeGeometry(cp, this.path.length * 24, 0.12 * (this.matScale || 1) + 0.05, 8, false), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.6, depthTest: false })); t.renderOrder = 9; t.userData.total = t.geometry.index.count; t.geometry.setDrawRange(0, 0); this._tourTube = t; this.scene.add(t); this._dirty = true; }
  _applyView() {
    if (this._flowLine) { this.scene.remove(this._flowLine); this._flowLine = null; }
    const flow = this.getAttribute('view') === 'flow' && this.zone && this.path?.length > 1;
    if (!flow) { if (this._flowPlaying) { this._flowPlaying = false; if (this.playing && !this.touring) this.stop(); } this._dirty = true; return; }
    const cp = new THREE.CurvePath(); for (let i = 0; i < this.path.length - 1; i++) cp.add(new THREE.LineCurve3(this.path[i], this.path[i + 1]));
    const r = 0.12 * (this.matScale || 1) + 0.05;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(cp, this.path.length * 24, r, 8, false), new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, depthTest: false }));
    tube.renderOrder = 9; tube.userData.total = tube.geometry.index.count; tube.geometry.setDrawRange(0, 0); this._flowLine = tube; this.scene.add(tube);
    if (!this.playing && !this.touring) { this.play(1); this._flowPlaying = true; }
    this._dirty = true;
  }
  layoutPoints() { const m = this._zoneModel(); if (!m || m === this.zone?.root) return null; const b = new THREE.Box3().setFromObject(m); if (b.isEmpty()) return null;
    return { process: this.zone.id, box: { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z }, pts: this.eqs.map(e => ({ id: e.id, x: e.focus.x, z: e.focus.z })) }; }
  setLeftLimit(px) { this.labels.dataset.leftLimit = String(px); }
  setNavWidth(px) { this.labels.dataset.navWidth = String(px); }
  // 공개 API
  play(speed = 1) { this.playing = true; this.t = 0; this.playT0 = performance.now(); this.playDur = (this._nStops() - 1) * 2600 / speed; this._setMaterial(0, this.path[0]); this._emitProgress(); return true; }
  stop() { if (this.touring) return this.stopTour(); this.playing = false; this.t = 0; this.matIdx = -1; if (this.material) this.material.traverse(o => { if (o.isMesh || o.isPoints) o.visible = false; }); this._emitProgress(); }
  toggle(speed) { (this.playing || this.touring) ? this.stop() : this.tour(speed); }
  focus(id) { const e = this.eqs.find(q => q.id === id); if (!e) return false; if (this._2d) { this._focus2d(e); return true; } const inner = !!e.interior && (this.getAttribute('view') === 'section' || this.touring); this._animateTo({ yaw: inner ? -0.25 : -0.5, pitch: inner ? 0.12 : 0.38, dist: inner ? e.dist * 0.75 : e.dist * 1.25, target: inner ? new THREE.Vector3(e.interior.cx, (e.interior.y0 + e.interior.y1) / 2, e.interior.cz) : e.focus.clone() }); return true; }
  // 왼쪽 네비(~260px)를 피해 남은 화면 중앙에 target이 오도록 카메라 target을 보정
  _navShift(pose) { const nw = this.labels.dataset.navWidth; /* [UI 시안] 3D 영역이 메뉴 밖에 있어 기본은 보정 없음 */ if (nw === undefined || nw === '0') return pose; const w = this.clientWidth || 1200, navPx = (nw === undefined ? 260 : +nw) + 30; const fovH = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(42) / 2) * this.camera.aspect); const worldPerPx = (2 * pose.dist * Math.tan(fovH / 2)) / w; const right = new THREE.Vector3(Math.cos(pose.yaw), 0, -Math.sin(pose.yaw)); return { ...pose, target: pose.target.clone().sub(right.multiplyScalar(navPx / 2 * worldPerPx)) }; }
  // 전체 공정 시점: 4개 공정 구역이 모두 들어오는 거리 (위성 지도처럼 북쪽이 화면 안쪽)
  _overviewPose() { const zs = Object.values(this.zones || {}); const xs = zs.length ? zs.map(z => z.ox) : [0], zz = zs.length ? zs.map(z => z.oz || 0) : [0];
    const x0 = Math.min(...xs) - 26, x1 = Math.max(...xs) + 26, z0 = Math.min(...zz) - 22, z1 = Math.max(...zz) + 28, pitch = 0.6;
    const a = this.camera.aspect || 1.6, t = Math.tan((this.camera.fov || 42) * Math.PI / 360), W = x1 - x0, D = z1 - z0;
    const dist = Math.max(150, Math.min(340, Math.max(W / (2 * t * a) * 1.1, (D * Math.sin(pitch) / (2 * t) + D * Math.cos(pitch) * 0.15) * 1.18)));
    return this._navShift({ yaw: -0.06, pitch, dist, target: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2 + 9) }); }
  overview() { this._showInterior(null); this._dimOthers?.(null); if (this.eqs) this.eqs.forEach(e => { e.label.style.display = 'none'; }); this._animateTo(this._overviewPose()); }
  reset() { if (this.eqs && this.zone?.root.visible) this.eqs.forEach(e => { e.label.style.display = 'flex'; }); this._animateTo(this._navShift({ yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist, target: new THREE.Vector3().fromArray(this.home.target) })); }
  // 인트로: 아주 높은 하늘(안개 속)에서 전체 공정 시점으로 천천히 내려오며 줌인
  // 인트로: 최대로 줌아웃(하늘 높이) → 안개가 걷힌 뒤 전체 공정으로 줌인. 멀리서도 보이게 안개 거리를 카메라 거리만큼 밀어 둠
  introFly(hold = false, dur = 4800) { const to = this._overviewPose(); Object.assign(this.orbit, { yaw: to.yaw, pitch: to.pitch, dist: to.dist * 1.45 }); this.orbit.target.copy(to.target); this._dirty = true;
    const lab = (o) => { (this.zoneLabels || []).forEach(z => { z.label.style.opacity = o; z.label.style.pointerEvents = o < 0.5 ? 'none' : ''; }); (this.zoneArrows || []).forEach(a => { if (a.el) a.el.style.opacity = o; }); };
    const tick = () => { const r = this.orbit.dist / to.dist; lab(r > 1.6 ? 0 : Math.max(0, Math.min(1, (1.6 - r) / 0.5))); if (hold) return; if (r > 1.02) this._fogRaf = requestAnimationFrame(tick); else lab(1); };
    cancelAnimationFrame(this._fogRaf); if (hold) { this.anim = null; tick(); } else { this._animateTo(to, dur); tick(); } }
  _animateTo(to, durOverride) { const d = this.orbit.target.distanceTo(to.target); this.anim = { t0: performance.now(), dur: durOverride || Math.min(1800, 700 + d * 6), from: { yaw: this.orbit.yaw, pitch: this.orbit.pitch, dist: this.orbit.dist, target: this.orbit.target.clone() }, to }; }
}
customElements.define('steel-scene', SteelScene);
