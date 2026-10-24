// 첫 화면(밤의 지도 테이블, steel-intro.html). 설계 노트는 저장소 밖에 둔다
// - 여는 장면(점 구름)과 솟을 때 흙먼지는 뺐다(2026-10-14 요청). 바로 밤의 지도에서 제선부터 솟는다. 제목 카드(제철 공정 지도)는 TITLE_MS 동안만 보이고 사라진다.
// - 땅: 포항제철소 부지 윤곽(위성 사진 기준, scene_v3.js의 SITE_LAND·SITE_CITY·SITE_ROADS)을 밤 지도처럼 칠한 판. 도로는 외곽선을 먼저 모두 그리고 속을 나중에 그려
//   교차로가 한 덩어리 십자로 합쳐진다. 공정 사이 레일은 점선.
// - 밤: 짙은 남색 하늘·바다, 달빛, 주황 불빛(보케: 팔각 원판, 크기·밝기 제각각, 무리 지어 불규칙하게 흩어짐, 초점에서 멀수록 커지고 옅어짐) + 블룸.
//   화각 27° ≈ 50mm. 피사계 심도 흐림은 3D에서 전체가 안 보인다는 의견으로 뺐다(2026-10-15).
// - 새벽빛(세상이 밝아짐): 로그인 직후는 어둡다. 제선이 솟으면 그 둘레부터 푸른 블루아워 빛이 땅에 깔리고, 구역이 하나씩 솟을 때마다 번져 나간다
//   (땅의 푸른 빛 웅덩이가 커지고, 솟은 구역마다 푸른 조명이 켜지고, 하늘·안개·주변광이 밤 → 블루아워로). 진행도 = 솟은 정도 합 / 4.
// - 주변 모델: 구역이 솟으면 그 공정에 맞는 소품(plant-props.js: 원료·고철 야적더미, 슬래브 야드·더미, 코일 야드)이 땅에서 차례로 자라고
//   소나무(로우폴리, 6각 원뿔 3단 + 4각 줄기)가 둘레에 돋는다. 소품은 오브젝트 하나가 삼각형 1,000개를 넘으면 쓰지 않는다(만들 때 세어서 거른다).
// - 트럭: 10초마다 북쪽(해안 도로)에서 한 대, 남쪽에서 한 대(가끔 한쪽만)가 남북 간선도로를 따라 지나간다. 전조등·후미등과 앞 땅의 불빛.
// - 원료 열차: 한 번에 한 편만. 동쪽 항구에서 철광석을 싣고 제선 공장으로 들어가고, 다음 편은 빈 차로 항구로 돌아간다(번갈아).
//   선로는 땅에 깔린 띠(자갈 + 침목 + 레일 무늬). 트럭·열차는 제선 구역이 솟은 뒤부터 다닌다.
// - 공정 사이 연결: 구역 아래 둥근 주황 테두리와 같은 주황 선(가운데 선 + 번짐), 모서리는 둥글게. 제선에서 열연까지 다 이어지면 위에서 전체를 보여 주며
//   선이 세 번 깜빡이고, 그 뒤 밝기를 42%로 낮춘다.
// - 카메라: 네 구역 전체가 화면에 꼭 차는 거리(overviewPose)보다 멀리 빠지지 않는다. 지도 버튼은 그 시점으로 간다. 앞 구역 오른쪽 변에서 나와 돌아 내려가 다음 구역 왼쪽 변으로 들어간다(구역 경계로 경로를 만든다).
// - 공정 구역: 제선 → 제강 → 연주 → 열연이 1·2·3·4 순서로 땅에서 솟는다(받침 없음, 지역 클리핑으로 땅 위만 그림). 구역 둘레 발광 테두리·연결선·투광등·물결은 노랑~주황 불빛(0xffa63d·0xffb352·0xffcc66, 2026-10-14 요청), 지금 구역은 15% 물결.
// - 칩(번호·이름·[시연])과 흐름 라벨은 한꺼번에 띄우지 않는다: 구역이 솟을 때 3초만 보이고, 그 구역(또는 칩)에 마우스를 올리면 다시 보인다.
// - 진행: ▶/⏸, 타임라인 점, ← →, 숫자 키, Space. Enter = 지금 구역 시연(공정 화면). 수치는 data_v2.js에서만.
// - 칩 버튼 두 개, 역할을 나눈다(2026-10-16 요청).
//   [▶ 재생]: 다른 공정·소품·연결선·트럭을 숨기고 이 공정만 남겨 그 자리에서 확대, v4 단면 보기처럼 설비·단계를 재생한다(intro-tour.js: 단면 층·불티·작동 연출·외곽선,
//   오른쪽 단계 설명 패널, 아래 설비 재생 바). 단계 설명은 이제 여기서만 본다(공정 화면 아래 카드에서 뺐다). Space 멈춤, ← → 설비 옮기기.
//   [시연](Enter): 공정 화면(steel-index: 3D · 조업 전광판 · What-if 대시보드)으로 간다.
//   재생하는 동안 트럭·열차·불빛 깜빡임은 멈춘다.
// - 렉 줄이기(2026-10-16): 공정 모델 재질 공유 + 재질별 정적 병합(batchStatic), 그림자 지도는 무언가 솟거나 자랄 때만 다시 그림(shadowDirty),
//   트럭·열차는 그림자를 드리우지 않음. 네 공정 전체 보기 기준 그리기 776 → 139번, 삼각형 495k → 249k(겉모습은 같다).
// - 조작 안내(2026-10-15 요청): 들어오면 조작 안내 카드를 먼저 보이고, [시작하기] 뒤 위 연출이 시작된다. 보기 버튼 이름은 '2D | 3D'(2D = 위에서 본 전체 보기).
//   2D에서 드래그하면 위에서 본 채로 평면 회전만 하고, 위아래로 끌거나 V 키를 누르면 3D로 바뀐다(markView로 위 토글도 같이).

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { createGLTFLoader } from './gltf-loader.js'; // Draco 압축 GLB
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import { PROCESSES } from './data_v2.js';
import { icon } from './steel-index-ui.js';
import { makeStockpile, makeSlabYard, makeSlabStack, makeCoilYard } from './plant-props.js';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { tuneRenderer, tuneShadowLight, tuneBloom, autoQuality, frameGate } from './perf-mode.js'; // 발표 모드·자동 화질·프레임 상한
import { createIntroTour } from './intro-tour.js'; // [▶ 재생]: 단면·단계 재생

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutBack = (k, s = 0.9) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);

// ---- 부지 데이터(scene_v3.js와 같은 값: 포항제철소 위성 사진 px → 월드. X = (px-640)·0.18, Z = (py-620)·0.18, 북쪽이 -Z) -------------------
const S = 0.18, PX = (x, y) => [(x - 640) * S, (y - 620) * S];
const SITE = { ironmaking: PX(760, 235), steelmaking: PX(470, 440), continuous_casting: PX(400, 620), rolling: PX(618, 809) };
const LAND = [[590, 40], [1180, 215], [1232, 300], [1196, 388], [746, 350], [700, 440], [614, 580], [538, 700], [500, 745], [760, 745], [760, 660], [1010, 630], [1040, 680], [1050, 800], [900, 870], [600, 1244], [62, 800], [235, 300], [340, 230]].map((p) => PX(p[0], p[1]));
const CITY = [[-320, -95], [-125, -95], [-86, -62], [-117, 36], [47, 47], [125, 92], [210, 160], [320, 230], [320, 320], [-320, 320]];
const ROADS = [[[-30, -80], [0, -90], [40, -84], [88, -70]], [[-30, -80], [-30, -72]], [[50, -53], [102, -47]], [[-2, -89], [-2, -24], [-12, -6], [-20, 10], [-27, 24], [-40, 48], [-46, 62], [-38, 80], [-22, 96], [-14, 102]], [[-86, -19], [0, -21]], [[-84, 46], [44, 46]], [[-24, 26], [20, 26]], [[-125, 10], [-106, 34], [-9, 114], [14, 125], [70, 126], [130, 98], [200, 120]]];
const MAT = ['용선', '용강', '슬래브'];
const RISE_DEPTH = 26, HOLD_MS = 1200, SHOW_MS = 3000, HOVER_GRACE = 350, TITLE_MS = 6000; // TITLE_MS: 여는 장면 뒤 제목 카드를 보여 주는 시간

// ---- 렌더러·장면(밤) ----------------------------------------------------------------------------------------------
const stage = $('stage'), hud = $('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.localClippingEnabled = true;
tuneRenderer(renderer);
// 그림자 캐시(게임의 정적 그림자): 그림자 지도를 매 프레임 다시 그리지 않고, 공정이 솟거나 소품·소나무가 자라는 동안에만 다시 그린다(shadowDirty).
// 다 솟은 뒤에는 그림자 패스 그리기가 0번이 된다. 트럭·열차는 밤에 그림자가 거의 안 보여 그림자를 드리우지 않는다
renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; let shadowDirty = true;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
// 하늘: 밤(NIGHT_SKY) → 블루아워(BLUE_SKY)로 진행도에 따라 다시 칠한다
const NIGHT_SKY = ['#03050a', '#0b1220', '#1b2638'], BLUE_SKY = ['#06213f', '#14508a', '#3f86bf'];
const skyCanvas = document.createElement('canvas'); skyCanvas.width = 4; skyCanvas.height = 256; const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace; scene.background = skyTex;
function paintSky(k) { const x = skyCanvas.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256), mix = (a, b) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); g.addColorStop(0, mix(NIGHT_SKY[0], BLUE_SKY[0])); g.addColorStop(0.6, mix(NIGHT_SKY[1], BLUE_SKY[1])); g.addColorStop(1, mix(NIGHT_SKY[2], BLUE_SKY[2])); x.fillStyle = g; x.fillRect(0, 0, 4, 256); skyTex.needsUpdate = true; }
paintSky(0);
scene.fog = new THREE.Fog(0x111a29, 260, 720);
const camera = new THREE.PerspectiveCamera(27, 1, 1, 2000); // 세로 화각 27° ≈ 풀프레임 50mm

const hemi = new THREE.HemisphereLight(0x5a6f96, 0x0a0c10, 0.6); scene.add(hemi);
const moon = new THREE.DirectionalLight(0xaecbff, 0.9); moon.position.set(120, 220, -90); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0004; moon.shadow.normalBias = 0.05;
Object.assign(moon.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 20, far: 520 }); scene.add(moon, moon.target); tuneShadowLight(moon);

// ---- 바다 -------------------------------------------------------------------------------------------------------
const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x0b1a2e, roughness: 0.28, metalness: 0, envMapIntensity: 0.12, emissive: 0x2a6fb5, emissiveIntensity: 0 })); // 새벽빛이 오면 바다만 스스로 밝아진다
sea.rotation.x = -Math.PI / 2; sea.position.y = -0.9; sea.receiveShadow = true; scene.add(sea);

// ---- 땅(밤 지도처럼 칠한 판) ----------------------------------------------------------------------------------------
function slab(points, depth, drawTop, sideColor, topY = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  const xs = points.map((p) => p[0]), zs = points.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), W = x1 - x0, H = z1 - z0;
  const cw = 2048, ch = Math.round(2048 * H / W), c = document.createElement('canvas'); c.width = cw; c.height = ch; const ctx = c.getContext('2d');
  drawTop(ctx, (x, z) => [(x - x0) / W * cw, (z - z0) / H * ch], cw / W);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.repeat.set(1 / W, 1 / H); tex.offset.set(-x0 / W, z1 / H);
  const m = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, envMapIntensity: 0.15 }), new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.9, envMapIntensity: 0.1 })]);
  m.rotation.x = -Math.PI / 2; m.position.y = topY - depth; m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
}
const path2d = (ctx, toPx, pts) => { ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = toPx(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
// 도로: 외곽선을 모든 도로에 먼저, 속을 나중에 → 교차로의 선이 겹쳐 보이지 않고 십자로 합쳐진다
function roads(ctx, toPx, list, k, edge, fill, wEdge, wFill) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  list.forEach((r) => { path2d(ctx, toPx, r); ctx.lineWidth = wEdge * k; ctx.strokeStyle = edge; ctx.stroke(); });
  list.forEach((r) => { path2d(ctx, toPx, r); ctx.lineWidth = wFill * k; ctx.strokeStyle = fill; ctx.stroke(); });
}
slab(LAND, 1.4, (ctx, toPx, k) => {
  ctx.fillStyle = '#1f242b'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#242a32'; for (let i = 0; i < 70; i++) { const x = -100 + Math.random() * 200, z = -100 + Math.random() * 210, w = 4 + Math.random() * 12, d = 3 + Math.random() * 8; const [px, py] = toPx(x, z); ctx.fillRect(px, py, w * k, d * k); } // 공장 건물 자리
  roads(ctx, toPx, ROADS, k, '#14181d', '#363d47', 2.8, 2.0);
}, 0x14171c);
slab(CITY, 1.2, (ctx, toPx, k) => {
  ctx.fillStyle = '#181b20'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const streets = []; for (let x = -320; x < 320; x += 7 + Math.random() * 5) streets.push([[x, -95], [x + (Math.random() - 0.5) * 6, 320]]); for (let z = -95; z < 320; z += 7 + Math.random() * 5) streets.push([[-320, z], [320, z + (Math.random() - 0.5) * 6]]);
  roads(ctx, toPx, streets, k, '#121418', '#252a31', 1.3, 0.8);
  ctx.fillStyle = '#18211d'; for (let i = 0; i < 26; i++) { const [px, py] = toPx(-300 + Math.random() * 600, -80 + Math.random() * 380); ctx.beginPath(); ctx.arc(px, py, (3 + Math.random() * 6) * k, 0, Math.PI * 2); ctx.fill(); } // 공원
}, 0x111316, -0.15);

// ---- 주황 불빛(점 스프라이트, 블룸이 걸리도록 1을 넘는 밝기) -------------------------------------------------------------------
// 보케: 초점 거리(uFocus)에서 멀수록 원판이 커지고(착란원) 옅어진다. 모양은 조리개 날 8장처럼 팔각, 가장자리가 살짝 밝다
const LIGHT_VS = 'attribute vec3 color; attribute float size; attribute float phase; attribute float bright; uniform float uK, uT, uOn, uPR, uFocus, uCoc; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float dist = -mv.z; float coc = abs(dist - uFocus) * uCoc; gl_PointSize = (size * 300.0 / dist + coc) * uPR; vC = color; vA = uOn * bright * (0.82 + 0.18 * sin(uT * (0.8 + phase) + phase * 6.28)) * clamp(5.0 / (5.0 + coc), 0.15, 1.0); }';
const LIGHT_FS = 'varying vec3 vC; varying float vA; void main(){ vec2 p = abs(gl_PointCoord - 0.5); float d = max(max(p.x, p.y), (p.x + p.y) * 0.7071); if (d > 0.5) discard; float disc = smoothstep(0.5, 0.42, d); float rim = smoothstep(0.26, 0.44, d) * 0.35; gl_FragColor = vec4(vC * (1.15 + rim), vA * disc * (0.75 + rim)); }';
const lightLayers = [];
function lightLayer(list) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), bright = new Float32Array(n), c = new THREE.Color();
  list.forEach((l, i) => { pos.set(l.p, i * 3); c.set(l.c); col.set([c.r, c.g, c.b], i * 3); size[i] = l.s; phase[i] = Math.random(); bright[i] = l.b ?? 1; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('phase', new THREE.BufferAttribute(phase, 1)); g.setAttribute('bright', new THREE.BufferAttribute(bright, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uK: { value: 1 }, uT: { value: 0 }, uOn: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uFocus: { value: 300 }, uCoc: { value: 0.07 } }, vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts); lightLayers.push(pts); return pts;
}
// 보케 색: 흰 금빛 ~ 주황(사진처럼 섞임), 크기는 작은 것이 많고 큰 것이 드물게, 밝기도 제각각
const BOKEH = ['#fff0cf', '#ffe1a6', '#ffd27a', '#ffd27a', '#ffb35c', '#ffb35c', '#ff9a3c', '#ff6b35'];
const bokehLight = (p, scale = 1) => ({ p, c: BOKEH[(Math.random() * BOKEH.length) | 0], s: (1.6 + Math.pow(Math.random(), 2.2) * 7.5) * scale, b: 0.35 + Math.random() * 0.65 });
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function alongLines(lines, n, y, jitter = 0.4) {
  const segs = []; lines.forEach((l) => { for (let i = 0; i < l.length - 1; i++) segs.push([l[i], l[i + 1], Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1])]); });
  const L = segs.reduce((s, x) => s + x[2], 0), out = [];
  for (let j = 0; j < n; j++) { let d = (j + Math.random()) / n * L, e = 0; while (e < segs.length - 1 && d > segs[e][2]) d -= segs[e++][2]; const [p, q, len] = segs[e], u = Math.min(1, d / len); out.push([p[0] + (q[0] - p[0]) * u + (Math.random() - 0.5) * jitter, y, p[1] + (q[1] - p[1]) * u + (Math.random() - 0.5) * jitter]); }
  return out;
}
const PICK = (arr) => arr[(Math.random() * arr.length) | 0];
function inside(poly, x, z) { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) r = !r; } return r; }
// 보케 분포: 고른 간격이 아니라 무리(가우스 퍼짐) + 드문 낱개. 넓은 공간에 무리의 중심을 흩어 두고, 무리마다 개수·퍼짐을 다르게 한다
function randomIn(poly, x0, x1, z0, z1) { for (let k = 0; k < 400; k++) { const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0); if (inside(poly, x, z)) return [x, z]; } return null; }
function clusters(L, poly, box, nClusters, [nMin, nMax], [sMin, sMax], [y0, y1], scale = 1) {
  for (let c = 0; c < nClusters; c++) { const ctr = randomIn(poly, ...box); if (!ctr) continue; const n = nMin + ((Math.random() * (nMax - nMin + 1)) | 0), s = sMin + Math.random() * (sMax - sMin);
    for (let i = 0; i < n; i++) { const x = ctr[0] + gauss() * s, z = ctr[1] + gauss() * s * (0.5 + Math.random()); if (!inside(poly, x, z)) continue; L.push(bokehLight([x, y0 + Math.random() * (y1 - y0), z], scale)); } }
}
let ambientLights = null;
function buildAmbientLights() {
  const zones = procs.filter((p) => p.foot).map((p) => p.foot), onZone = (x, z) => zones.some((f) => Math.abs(x - f.cx) < f.w / 2 + 8 && Math.abs(z - f.cz) < f.d / 2 + 8); // 구역 위·둘레는 비운다
  const L = [], keep = (l) => { if (!onZone(l.p[0], l.p[2])) L.push(l); };
  const tmp = []; clusters(tmp, LAND, [-104, 106, -104, 112], 14, [3, 9], [1.5, 5], [0.5, 4]); tmp.forEach(keep);            // 공장 작업등 무리(줄임)
  const city = []; clusters(city, CITY, [-200, 150, -95, 200], 16, [4, 12], [3, 8], [0.3, 2], 1.05); city.forEach(keep);   // 도시 불빛 무리(줄임)
  for (let i = 0; i < 30; i++) { const [p] = alongLines([PICK(ROADS)], 1, 0.7, 1.2); keep(bokehLight(p)); if (Math.random() < 0.25) keep(bokehLight([p[0] + gauss() * 2, 0.7, p[2] + gauss() * 2])); } // 길가
  for (let i = 0; i < 26; i++) { const [p] = alongLines([[...LAND, LAND[0]]], 1, 0.6, 3); keep(bokehLight(p)); }                  // 항만·해안
  for (let i = 0; i < 10; i++) keep(bokehLight([60 + Math.random() * 260, 0.25, -150 + Math.random() * 300], 0.9));             // 먼바다 배
  ambientLights = lightLayer(L);
}

// ---- 공정 구역(받침 없이 땅에서 솟는 모델) --------------------------------------------------------------------------
const loader = createGLTFLoader();
const above = (y) => [new THREE.Plane(new THREE.Vector3(0, 1, 0), -y)]; // y 이상만 그린다
function glowTex() { const c = document.createElement('canvas'); c.width = 256; c.height = 192; const x = c.getContext('2d'); x.shadowColor = '#fff'; x.shadowBlur = 24; x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 4; x.beginPath(); x.roundRect(28, 28, 200, 136, 14); x.stroke(); x.stroke(); return new THREE.CanvasTexture(c); }
const GLOW = glowTex();
// 재질 공유: 같은 원본 재질은 한 번만 복제해 같이 쓴다(메시마다 복제하던 343개 → 공정당 14~25개). 아래 정적 병합이 재질별로 묶는 기준이 된다
const tuned = new Map();
function tune(src) {
  if (tuned.has(src)) return tuned.get(src);
  const m = src.clone(); tuned.set(src, m); const nm = m.name || ''; m.envMapIntensity = 0.3;
  if (/^(Steel|Steel_Dark|Struct_Gray|Roll_Steel|Coil_Cooled|Chrome_Rod)$/.test(nm)) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 0.45; }
  if (nm === 'Concrete') m.color.setRGB(0.5, 0.51, 0.52);
  if (/^(Molten_Steel|Hot_Slab|Slag_Hot)$/.test(nm)) { m.emissiveIntensity = 1.6; m.toneMapped = false; } // 빛번짐 완화 2.6 → 1.6
  m.clippingPlanes = above(0.0); return m;
}
// 정적 병합(게임의 static batching): 움직이지 않는 공정 모델의 보이는 메시를 재질별로 한 덩어리로 합친다.
// 그리기 횟수가 메시 수(공정당 63~117)에서 재질 수(14~25)로 준다. 모양·색은 그대로이고, 솟는 연출은 root를 움직이므로 그대로 된다
// GLB 정점은 끼워 넣은(interleaved) 형식이라 그대로는 합칠 수 없다: 위치·법선을 낱 배열로 풀어 새 형상을 만든다
function plainGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) { const a = src.attributes[k]; if (!a) continue; const out = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); } g.setAttribute(k, new THREE.BufferAttribute(out, 3)); }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}
function batchStatic(root) {
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), groups = new Map(), _mx = new THREE.Matrix4();
  root.traverse((o) => { if (!o.isMesh) return; let vis = true; for (let q = o; q && q !== root; q = q.parent) if (!q.visible) vis = false; if (!vis) return;
    const g = plainGeometry(o.geometry).applyMatrix4(_mx.multiplyMatrices(inv, o.matrixWorld)); if (!groups.has(o.material)) groups.set(o.material, []); groups.get(o.material).push(g); });
  const merged = [];
  for (const [mat, list] of groups) { const geo = list.length > 1 ? mergeGeometries(list) : list[0]; if (!geo) return; const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; m.raycast = () => {}; merged.push(m); }
  root.children.slice().forEach((c) => root.remove(c)); merged.forEach((m) => root.add(m));
}
const procs = PROCESSES.map((p, i) => ({ id: p.id, data: p, i, c: SITE[p.id], root: null, glow: null, ripples: [], hit: null, flood: null, warm: null, foot: null, modelTop: 10, t0: null, up: false, upAt: 0, chip: null, showUntil: 0, hoverZone: false, hoverOff: 0, hoverChip: false }));
let loaded = 0;
const loadAll = () => Promise.all(procs.map((p) => new Promise((resolve) => {
  loader.load(`models/${p.id}.glb`, (gltf) => {
    const root = gltf.scene; root.position.set(p.c[0], 0, p.c[1]);
    root.traverse((o) => { if (!o.isMesh) return; o.material = Array.isArray(o.material) ? o.material.map(tune) : tune(o.material); o.castShadow = true; o.receiveShadow = true; });
    root.updateMatrixWorld(true);
    const fb = new THREE.Box3();
    root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (/^Floor_/.test(q.name)) { o.visible = false; o.castShadow = false; fb.expandByObject(o); break; } });
    const all = new THREE.Box3().setFromObject(root); if (fb.isEmpty()) fb.copy(all);
    const w = fb.max.x - fb.min.x + 5, d = fb.max.z - fb.min.z + 5, cx = (fb.min.x + fb.max.x) / 2, cz = (fb.min.z + fb.max.z) / 2;
    p.foot = { w, d, cx, cz }; p.modelTop = all.max.y;
    // 시뮬레이터용 설비 상자(솟은 뒤의 자리 = 지금 자리). 병합하면 설비 노드가 사라지므로 먼저 잰다
    p.eqs = p.data.equipment.map((e) => { const node = root.getObjectByName(`EQ_${e.id}`); return node ? { id: e.id, data: e, box: new THREE.Box3().setFromObject(node) } : null; }).filter(Boolean);
    p.bounds = all.clone();
    batchStatic(root);
    // 구역 둘레 주황 발광 테두리(받침 대신)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w + 10, d + 10), new THREE.MeshBasicMaterial({ map: GLOW, color: 0xffa63d, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); glow.rotation.x = -Math.PI / 2; glow.position.set(cx, 0.06, cz); scene.add(glow);
    for (let k = 0; k < 2; k++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0, depthWrite: false })); r.rotation.x = -Math.PI / 2; r.position.set(cx, 0.08, cz); scene.add(r); p.ripples.push(r); }
    // 마우스 판정용 보이지 않는 상자(구역 전체)
    const hh = Math.max(4, p.modelTop), hit = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(cx, hh / 2, cz); scene.add(hit);
    // 구역 투광등(솟은 뒤 켜짐) + 따뜻한 빛
    const warm = new THREE.PointLight(0xffb352, 0, 90, 1.6); warm.position.set(cx, p.modelTop + 8, cz); scene.add(warm);
    root.position.y = -RISE_DEPTH; root.visible = false; scene.add(root);
    Object.assign(p, { root, glow, hit, warm });
    loaded++; $('loadbar').style.width = `${Math.round(loaded / procs.length * 100)}%`; resolve(true);
  }, undefined, () => { loaded++; resolve(false); });
})));


// ---- 공정 사이 흐름선 ------------------------------------------------------------------------------------------
// 공정 연결 선: 구역 아래 둥근 주황 테두리(glowTex)와 같은 모양 — 가운데 얇은 주황 선 + 양옆 부드러운 번짐(가산 합성).
// 띠 폭 4 안에서 uv.y(폭 방향)로 선을 그린다. reach까지만 보여 앞 구역에서 다음 구역으로 그어지듯 나타난다
const flowMat = () => new THREE.ShaderMaterial({
  uniforms: { t: { value: 0 }, reach: { value: 0 }, gain: { value: 1 }, color: { value: new THREE.Color(0xffa63d) }, W: { value: 4.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float t, reach, W, gain; uniform vec3 color; varying vec2 vUv; void main(){ if (vUv.x > reach) discard; float d = abs(vUv.y - 0.5) * W; float core = 1.0 - smoothstep(0.3, 0.46, d); float halo = exp(-d * d / 1.6) * 0.5; float a = max(core * 0.95, halo) * 0.5 * gain; gl_FragColor = vec4(color, a); }',
  transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
});
// 경로: 앞 구역 오른쪽 변 가운데 → 오른쪽으로 m → 두 구역 사이 높이(midZ)까지 → 다음 구역 왼쪽 변 바깥(x - m)까지 → 그 구역 가운데 높이 → 왼쪽 변으로
function linkPath(A, B, m = 4) {
  const ax = A.cx + A.w / 2, bx = B.cx - B.w / 2, midZ = ((A.cz + A.d / 2) + (B.cz - B.d / 2)) / 2;
  const raw = [[ax, A.cz], [ax + m, A.cz], [ax + m, midZ], [bx - m, midZ], [bx - m, B.cz], [bx, B.cz]];
  return raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.05);
}
// 모서리를 둥글게(반지름 R) 만든 뒤 촘촘히 펴서, 땅 위에 납작한 띠(폭 W)를 만든다. uv.x = 시작부터 길이 비율(흐름 셰이더가 쓴다)
function ribbon(pts, W = 1.1, y = 0.12, R = 2.2) {
  const P = [];
  for (let i = 0; i < pts.length; i++) {
    const cur = new THREE.Vector2(...pts[i]);
    if (i === 0 || i === pts.length - 1) { P.push(cur); continue; }
    const prev = new THREE.Vector2(...pts[i - 1]), next = new THREE.Vector2(...pts[i + 1]), d1 = cur.clone().sub(prev), d2 = next.clone().sub(cur), l1 = d1.length(), l2 = d2.length(); d1.normalize(); d2.normalize();
    const r = Math.min(R, l1 / 2, l2 / 2), p1 = cur.clone().addScaledVector(d1, -r), p2 = cur.clone().addScaledVector(d2, r);
    for (let k = 0; k <= 8; k++) { const s = k / 8, a = p1.clone().multiplyScalar((1 - s) * (1 - s)).add(cur.clone().multiplyScalar(2 * s * (1 - s))).add(p2.clone().multiplyScalar(s * s)); P.push(a); }
  }
  const D = [P[0]]; for (let i = 1; i < P.length; i++) { const a = D[D.length - 1], b = P[i], L = a.distanceTo(b), n = Math.max(1, Math.ceil(L / 0.6)); for (let k = 1; k <= n; k++) D.push(a.clone().lerp(b, k / n)); }
  const len = [0]; for (let i = 1; i < D.length; i++) len.push(len[i - 1] + D[i].distanceTo(D[i - 1])); const total = len[len.length - 1] || 1;
  const pos = [], uv = [], idx = [];
  D.forEach((p, i) => { const a = D[Math.max(0, i - 1)], b = D[Math.min(D.length - 1, i + 1)], tng = b.clone().sub(a).normalize(), nrm = new THREE.Vector2(-tng.y, tng.x).multiplyScalar(W / 2);
    pos.push(p.x + nrm.x, y, p.y + nrm.y, p.x - nrm.x, y, p.y - nrm.y); uv.push(len[i] / total, 0, len[i] / total, 1);
    if (i > 0) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const mid = D[len.findIndex((l) => l >= total / 2)] || D[0];
  return { geo: g, mid: new THREE.Vector3(mid.x, y, mid.y) };
}
let links = [];
function buildLinks() { // 구역 경계(GLB 바닥판 크기)가 정해진 뒤에 만든다
  links = PROCESSES.slice(0, -1).map((_, i) => {
    const a = procs[i], b = procs[i + 1]; if (!a.foot || !b.foot) return null;
    const pathPts = linkPath(a.foot, b.foot), { geo, mid } = ribbon(pathPts, 4.0, 0.06, 3);
    const mesh = new THREE.Mesh(geo, flowMat()); mesh.material.side = THREE.DoubleSide; mesh.visible = false; mesh.renderOrder = 3; scene.add(mesh);
    const label = document.createElement('div'); label.className = 'fl'; label.innerHTML = `${esc(a.data.name)} → ${esc(b.data.name)} · <i>${MAT[i]}</i>`; hud.appendChild(label);
    return { a, b, mesh, mid, label, on: false, t0: 0, showUntil: 0, pathPts };
  }).filter(Boolean);
}

// ---- 주변 모델(소품 + 소나무): 구역이 솟을 때 함께 자란다 -----------------------------------------------------------------
// 소품은 미터 단위(plant-props.js)라 예전 v4와 같은 1/7로 줄인다. 슬래브·코일은 그 비율이면 점처럼 보여 sc배 키운다(삼각형 수는 같다). x·z는 원하는 자리이고, 실제 자리는 그 둘레에서
// 땅 안이면서 도로·연결 띠·구역·다른 소품과 겹치지 않는 가장 가까운 곳을 찾는다(findSpot)
const M2U = 1 / 7, MAX_TRIS = 1000, PROP_NIGHT = 0.5; // 밤 장면에 맞춰 소품 색을 어둡게(v4 밤 테마와 같은 방식)
const nightTone = new Set();
const SURROUND = {
  ironmaking: [ // 제선: 철광석·석탄·석회석 야적더미(북쪽 해안 원료 야드)
    { make: () => makeStockpile({ L: 80, W: 26, H: 12, kind: 'ore', seed: 5 }), x: 6, z: -93.3 },
    { make: () => makeStockpile({ L: 80, W: 26, H: 12, kind: 'coal', seed: 6 }), x: 6, z: -86.5 },
    { make: () => makeStockpile({ L: 40, W: 22, H: 9, kind: 'lime', seed: 7 }), x: 26, z: -90 },
  ],
  steelmaking: [ // 제강: 고철 야적더미(전로에 넣는 고철)
    { make: () => makeStockpile({ L: 40, W: 24, H: 10, kind: '#45484d', seed: 12 }), x: -54, z: -33, ry: Math.PI / 2 },
  ],
  continuous_casting: [ // 연주: 뽑아낸 슬래브를 쌓는 야드와 더미
    { make: () => makeSlabYard({ rows: 2, cols: 3, seed: 4 }), x: -47, z: 17, sc: 2.2 },
    { make: () => makeSlabStack({ layers: 8, seed: 2 }), x: -36, z: 17, sc: 2.2 },
  ],
  rolling: [ // 열연: 가열로 앞 슬래브 더미, 권취기 옆 코일 야드
    { make: () => makeSlabStack({ layers: 9, seed: 6 }), x: -25, z: 33, ry: Math.PI / 2, sc: 2.2 },
    { make: () => makeCoilYard({ rows: 1, perRow: 2, tiers: 1, seed: 5 }), x: 19, z: 34, sc: 4.5 },
  ],
};
const triCount = (o) => { let n = 0; o.traverse((m) => { if (!m.isMesh) return; const g = m.geometry, c = g.index ? g.index.count / 3 : g.attributes.position.count / 3; n += m.isInstancedMesh ? c * m.count : c; }); return Math.round(n); };
// 로우폴리 소나무(땅 = 0, 높이 약 2.2). 색은 꼭짓점 색(단마다 아래 어둡게·위 밝게, 줄기 갈색)
function pineGeometry() {
  const paint = (g, f) => { g = g.toNonIndexed(); const P = g.attributes.position, c = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) c.set(f(P.getY(i)), i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const green = new THREE.Color(0x2f6a3f), trunk = new THREE.Color(0x5a4334);
  const parts = [[0.45, 1.4, 0.62], [0.9, 1.78, 0.47], [1.35, 2.2, 0.32]].map(([y0, y1, r]) => paint(new THREE.ConeGeometry(r, y1 - y0, 6, 1, true).translate(0, (y0 + y1) / 2, 0), (y) => { const k = 0.62 + 0.45 * (y - y0) / (y1 - y0); return [green.r * k, green.g * k, green.b * k]; }));
  parts.push(paint(new THREE.CylinderGeometry(0.07, 0.1, 0.6, 4, 1, true).translate(0, 0.3, 0), () => [trunk.r, trunk.g, trunk.b]));
  return mergeGeometries(parts);
}
const PINE_GEO = pineGeometry(), PINE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, envMapIntensity: 0.2 });
const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); return Math.hypot(x - a[0] - u * dx, z - a[1] - u * dz); };
const nearLines = (x, z, lines, r) => lines.some((l) => l.some((p, i) => i > 0 && segDist(x, z, l[i - 1], p) < r));
function buildSurroundings() {
  const boxes = []; // 소품 자리 [x0, x1, z0, z1](소나무와 다른 소품이 피한다)
  const lines = [...ROADS, RAIL, ...links.map((l) => l.pathPts)], feet = procs.filter((q) => q.foot).map((q) => q.foot);
  const inFoot = (x, z, m) => feet.some((f) => Math.abs(x - f.cx) < f.w / 2 + m && Math.abs(z - f.cz) < f.d / 2 + m);
  const inBox = (x, z) => boxes.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const fits = (x, z, hx, hz) => { for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const px = x + hx * i / 2, pz = z + hz * j / 2; if (!inside(LAND, px, pz) || nearLines(px, pz, lines, 1.4) || inFoot(px, pz, 1.5) || inBox(px, pz)) return false; } return true; };
  const findSpot = (x, z, hx, hz) => { if (fits(x, z, hx, hz)) return [x, z]; for (let r = 1; r <= 24; r += 1) for (let k = 0, n = Math.ceil(r * 6); k < n; k++) { const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (fits(px, pz, hx, hz)) return [px, pz]; } return null; };
  procs.forEach((p) => {
    p.props = []; if (!p.foot) return;
    (SURROUND[p.id] || []).forEach((s, k) => {
      const o = s.make(), n = triCount(o);
      if (n > MAX_TRIS) { console.warn('[intro] 삼각형', n, '개라 뺍니다:', p.id, k); return; } // 규칙: 오브젝트 하나 1,000개 이하
      o.traverse((m) => { if (!m.isMesh) return; m.castShadow = true; m.receiveShadow = true; [m.material].flat().forEach((mt) => { if (mt && mt.color && !nightTone.has(mt)) { nightTone.add(mt); mt.color.multiplyScalar(PROP_NIGHT); } }); });
      const g = new THREE.Group(); g.add(o); g.rotation.y = s.ry || 0; const S = M2U * (s.sc || 1); g.scale.setScalar(S); g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g), hx = (bb.max.x - bb.min.x) / 2, hz = (bb.max.z - bb.min.z) / 2, ox = (bb.max.x + bb.min.x) / 2, oz = (bb.max.z + bb.min.z) / 2;
      const spot = findSpot(s.x, s.z, hx, hz); if (!spot) { console.warn('[intro] 자리가 없어 뺍니다:', p.id, k); return; }
      g.position.set(spot[0] - ox, 0, spot[1] - oz); g.scale.y = 0.0001; g.visible = false; scene.add(g);
      boxes.push([spot[0] - hx - 1, spot[0] + hx + 1, spot[1] - hz - 1, spot[1] + hz + 1]);
      p.props.push({ g, S, delay: 700 + k * 260 + Math.random() * 200, tris: n });
    });
  });
  const blocked = (x, z) => !inside(LAND, x, z) || nearLines(x, z, lines, 2.2) || inFoot(x, z, 3.5) || inBox(x, z);
  procs.forEach((p) => {
    if (!p.foot) return; const { cx, cz, w, d } = p.foot, list = [];
    for (let tries = 0; tries < 900 && list.length < 34; tries++) { // 구역 둘레 띠(가장자리에서 4~16)에 무리 지어 심는다
      const side = Math.random(), a = Math.random() * Math.PI * 2, rx = w / 2 + 4 + Math.random() * 12, rz = d / 2 + 4 + Math.random() * 12;
      const x = cx + Math.cos(a) * rx * (0.7 + 0.3 * side), z = cz + Math.sin(a) * rz * (0.7 + 0.3 * side);
      if (blocked(x, z) || list.some((q) => Math.hypot(q.x - x, q.z - z) < 1.3)) continue;
      list.push({ x, z, s: 0.75 + Math.random() * 0.6, ry: Math.random() * Math.PI * 2, delay: 900 + Math.random() * 1400 });
      for (let c = 0, nc = Math.random() < 0.5 ? 2 : 0; c < nc && list.length < 34; c++) { const xx = x + gauss() * 1.4, zz = z + gauss() * 1.4; if (!blocked(xx, zz)) list.push({ x: xx, z: zz, s: 0.6 + Math.random() * 0.5, ry: Math.random() * Math.PI * 2, delay: 1000 + Math.random() * 1400 }); }
    }
    const inst = new THREE.InstancedMesh(PINE_GEO, PINE_MAT, list.length); inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false; inst.raycast = () => {};
    list.forEach((q, i) => inst.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0))); inst.instanceMatrix.needsUpdate = true; scene.add(inst);
    p.pines = { inst, list, done: false };
  });
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const P_DONE = (p) => (p.pines?.done ?? true) && (p.props || []).every((it) => it.full);
function growSurroundings(p, now) { // 구역이 솟기 시작한 뒤 소품은 위로 자라고, 소나무는 톡 돋는다
  if (p.t0 == null) return; const t = now - p.t0;
  if (!P_DONE(p)) shadowDirty = true;
  (p.props || []).forEach((it) => { const k = REDUCED ? 1 : Math.min(1, Math.max(0, (t - it.delay) / 900)); it.g.visible = k > 0 && !p.hidden; if (k > 0 && !it.full) { it.g.scale.y = it.S * Math.max(0.0001, k >= 1 ? 1 : easeOutBack(k, 1.1)); if (k >= 1) it.full = true; } });
  const P = p.pines; if (!P || P.done) return; let all = true;
  P.list.forEach((q, i) => { const k = REDUCED ? 1 : Math.min(1, Math.max(0, (t - q.delay) / 500)); if (k < 1) all = false; const sc = q.s * (k <= 0 ? 0 : k >= 1 ? 1 : easeOutBack(k, 1.4)); _q.setFromAxisAngle(_Y, q.ry); _m.compose(_p.set(q.x, 0, q.z), _q, _s.setScalar(Math.max(0, sc))); P.inst.setMatrixAt(i, _m); });
  P.inst.instanceMatrix.needsUpdate = true; if (all) P.done = true;
}


// ---- 칩: 번호 · 이름 · [시연] -----------------------------------------------------------------------------------
procs.forEach((p) => {
  const el = document.createElement('div'); el.className = 'pc';
  el.innerHTML = `<div class="box"><span class="num">${String(p.i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.data.name)}</span><button type="button" data-enter aria-label="${esc(p.data.name)} 공정 시연 화면으로">시연 →</button></div><div class="stem"></div><div class="dot"></div>`;
  el.querySelector('[data-enter]').onclick = () => enter(p); // [▶ 재생]은 칩이 아니라 아래 가운데(#btnTour)에 있다. 공정을 고르면 타임라인 대신 보인다(2026-10-19 요청)
  el.onmouseenter = () => { p.hoverChip = true; }; el.onmouseleave = () => { p.hoverChip = false; p.hoverOff = performance.now(); };
  hud.appendChild(el); p.chip = el;
});
// [시연](또는 Enter): 공정 화면(steel-index: 3D · 조업 전광판 · What-if)으로 간다
function enter(p) { location.href = `/3d-demo/steel-index.html?p=${encodeURIComponent(p.id)}`; }
// 재생 중에는 오른쪽 단계 카드만큼 장면을 왼쪽으로 민다(카메라 view offset)
function shiftView() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1, dx = tour && typeof tourMod !== 'undefined' ? tourMod.panelWidth() / 2 : 0; if (dx) camera.setViewOffset(w, h, dx, 0, w, h); else camera.clearViewOffset(); }

// ---- [▶ 재생]: 고른 공정만 남기고(isolate) 그 자리에서 확대해 v4 단면 보기처럼 설비·단계를 재생한다(intro-tour.js) -----------------------
// 다른 공정(모델·테두리·조명·소품·소나무)·연결선·트럭·열차는 숨긴다(p.hidden). 재생 모듈은 composer가 생긴 뒤 아래(후처리)에서 만든다(tourMod)
function isolate(p) { // p = 남길 공정, null이면 모두 다시 보인다
  procs.forEach((q) => { q.hidden = !!p && q !== p; if (q.pines) q.pines.inst.visible = !q.hidden; if (q.glow) q.glow.visible = !q.hidden; });
  const T = traffic, show = !p; if (T.body) { T.body.visible = T.lamps.visible = T.pool.visible = show; if (!show) T.train.cars.forEach((c) => (c.g.visible = false)); }
  lightLayers.forEach((l) => { l.visible = !p; }); // 땅·도시 불빛(보케): 확대하면 화면 앞에 큰 팔각형으로 겹쳐 보여 재생 중에는 숨긴다
  document.body.classList.toggle('touring', !!p); shadowDirty = true;
}
let tour = false;
async function startTour(p) {
  if (!p.up) return; goTo(p.i); pause(); isolate(p); tour = true; anim = null;
  try { if (!(await tourMod.start(p))) throw new Error('설비 없음'); } catch (e) { console.warn('[intro] 재생을 시작하지 못했어요', e); tour = false; isolate(null); return; }
  shiftView();
}
function stopTour() { if (tourMod.active) tourMod.stop(); }
function tourEnded(p) { tour = false; isolate(null); shiftView(); animateTo(zonePose(p), 1300); }
const chipVisible = (p, now) => p.up && (p.hinting || now < p.showUntil || p.hoverZone || p.hoverChip || now - p.hoverOff < HOVER_GRACE);

// ---- 첫 클릭 안내: 구역을 처음 눌렀을 때 한 번만(이 브라우저에 기억) 칩의 [시연]에 선을 긋고 무엇이 보이는지 알려 준다 ---------------------------
// 안내는 칩 안에 붙여 칩과 함께 움직인다. 선 좌표는 칩 버튼 위치를 재서 정한다. 아무 곳이나 누르거나 10초가 지나면 사라진다
// [▶ 재생]은 아래 가운데 버튼이라 그 안내는 버튼 위의 말풍선 대신 버튼 이름표(title)로 둔다
const HINT_KEY = 'st-rookie:chip-hint';
let hintDone = (() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } })();
function showChipHint(p) {
  if (hintDone) return; hintDone = true; try { localStorage.setItem(HINT_KEY, '1'); } catch {}
  const pc = p.chip, at = (b) => { const r = b.getBoundingClientRect(), o = pc.getBoundingClientRect(); return { x: r.left - o.left + r.width / 2, top: r.top - o.top, bottom: r.bottom - o.top }; };
  const eb = at(pc.querySelector('[data-enter]')), W = 300;
  const bx = eb.x + 40, by = eb.bottom + 64; // 글 위치: 시연은 오른쪽 아래
  const el = document.createElement('div'); el.className = 'chip-hint'; el.setAttribute('role', 'note');
  el.innerHTML = `<svg width="1" height="1" aria-hidden="true"><path d="M${eb.x} ${eb.bottom + 6} L${bx} ${by} H${bx + W}"/><circle cx="${eb.x}" cy="${eb.bottom + 6}" r="3"/></svg>
    <p style="left:${bx}px;top:${by + 10}px;width:${W}px"><b>시연</b>에서 조건을 바꾸면 공정이 서로 어떻게 영향을 주는지 볼 수 있어요.</p>`;
  pc.appendChild(el); p.hinting = true;
  const close = () => { if (!p.hinting) return; p.hinting = false; p.hoverOff = performance.now(); el.classList.add('out'); setTimeout(() => el.remove(), 400); removeEventListener('pointerdown', close, true); clearTimeout(timer); };
  const timer = setTimeout(close, 10000); setTimeout(() => addEventListener('pointerdown', close, true), 0);
}

// ---- 카메라 --------------------------------------------------------------------------------------------------
const orbit = { yaw: -0.42, pitch: 0.62, dist: 420, target: new THREE.Vector3(-8, 0, 0) };
const POSE = { all: { yaw: -0.42, pitch: 0.55, dist: 330, target: new THREE.Vector3(-14, 4, -12) }, map: { yaw: 0, pitch: 1.5, dist: 420, target: new THREE.Vector3(-10, 0, 0) } };
// 구역 시점: 구역이 화면 폭의 절반쯤 차도록 가깝게(요청: 최소 이 크기)
const zonePose = (p) => { const cx = p.foot ? p.foot.cx : p.c[0], cz = p.foot ? p.foot.cz : p.c[1], w = p.foot ? p.foot.w : 40; return { yaw: -0.42 + (p.i - 1.5) * 0.06, pitch: 0.42, dist: Math.min(120, Math.max(80, w * 2.2)), target: new THREE.Vector3(cx, 3, cz) }; };
let anim = null, view = '3d';
// 전체 보기: 네 공정 구역(+둘레 소품)이 화면에 꼭 차게 위에서 본 시점. 카메라는 이보다 멀리 빠지지 않는다(지도 버튼·휠·여는 장면 끝 모두).
// 빈 땅·바다만 보이는 먼 시점을 없애려는 것(2026-10-14 요청)
let viewBox = null;
function overviewPose(pitch = 1.32) {
  if (!viewBox) { const f = procs.filter((p) => p.foot).map((p) => p.foot); if (!f.length) return { ...POSE.map };
    viewBox = { x0: Math.min(...f.map((q) => q.cx - q.w / 2)) - 8, x1: Math.max(...f.map((q) => q.cx + q.w / 2)) + 8, z0: Math.min(...f.map((q) => q.cz - q.d / 2)) - 6, z1: Math.max(...f.map((q) => q.cz + q.d / 2)) + 6 }; }
  const { x0, x1, z0, z1 } = viewBox, half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const USE = 0.8; // 위 제목·아래 재생 바가 화면 높이의 약 20%를 가리므로 그만큼 여유를 둔다
  return { yaw: 0, pitch, dist: Math.max(z1 - z0, (x1 - x0) / Math.max(0.6, camera.aspect)) / (2 * half * USE), target: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2 + 4) };
}
const maxDist = () => overviewPose().dist * 1.06;
const clampPose = (p) => ({ ...p, dist: Math.min(p.dist, maxDist()) });
function animateTo(to, dur = 1600) { anim = { t0: performance.now(), dur: REDUCED ? 1 : dur, from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, target: orbit.target.clone() }, to: { ...to, target: to.target.clone() } }; }

// ---- 시작 ----------------------------------------------------------------------------------------------------------
// 여는 장면 없이 바로 밤의 지도. 3D 대각선 전체 보기(pose3D)에 머문 채 제선 → 제강 → 연주 → 열연이 차례로 솟는다.
// 구역마다 다가가며 보여 주던 연출은 뺐다(2026-10-15 요청). 구역에 다가가는 것은 사용자가 구역·숫자 키·타임라인으로 고를 때만.
// 조작 안내 카드를 먼저 띄우고, [시작하기](또는 Enter·Space·Esc)를 누르면 시작한다(2026-10-15 요청)
// 카드는 한 번만(이 브라우저에 기억). 한 번 닫았으면 다음부터는 카드 없이 바로 시작한다(2026-10-19 요청)
const GUIDE_KEY = 'st-rookie:intro-guide';
let started = false, guideOpen = false;
function startMap() {
  if (ambientLights) ambientLights.material.uniforms.uOn.value = 1;
  const all = pose3D(); Object.assign(orbit, { yaw: all.yaw, pitch: all.pitch, dist: all.dist }); orbit.target.copy(all.target);
  wide = true; // 전체 보기에서 시작하므로 자동 재생은 카메라를 옮기지 않는다
  guideOpen = true;
  let seen = false; try { seen = localStorage.getItem(GUIDE_KEY) === '1'; } catch {}
  if (seen) { closeGuide(); return; }
  $('guide').classList.remove('off'); $('guideGo').focus();
}
function closeGuide() {
  if (!guideOpen) return; guideOpen = false; $('guide').classList.add('off');
  try { localStorage.setItem(GUIDE_KEY, '1'); } catch {}
  setTimeout(() => $('ttl').classList.add('out'), TITLE_MS); // 제목 카드는 잠깐만
  setTimeout(() => { if (!started) { started = true; goTo(0, true); } }, REDUCED ? 0 : 500);
}
$('guideGo').onclick = closeGuide;

// ---- 진행(타임라인) --------------------------------------------------------------------------------------------
let cur = -1, playing = true, finished = false, hot = null;
const tl = $('tl'); procs.forEach((p, i) => { const b = document.createElement('button'); b.style.left = `${(i / (procs.length - 1)) * 100}%`; b.innerHTML = `<span>${i + 1} ${esc(p.data.name)}</span>`; b.title = `${p.data.name} 구역`; b.onclick = () => { goTo(i); pause(); }; p.stop = b; tl.appendChild(b); });
$('icPlay').src = icon('play', '#111111', 1.8);
function pause() { playing = false; $('icPlay').src = icon('play', '#111111', 1.8); $('btnPlay').title = '재생'; $('btnPlay').setAttribute('aria-label', '재생'); }
function play() { playing = true; $('icPlay').src = icon('stop', '#111111', 1.8); $('btnPlay').title = '멈춤'; $('btnPlay').setAttribute('aria-label', '멈춤'); if (finished || cur >= procs.length - 1) { finished = false; goTo(0, true); } }
$('btnPlay').onclick = () => (playing ? pause() : play());
// auto: 자동 재생이 부른 것. 2D·3D 전체 보기를 고른 뒤(wide)에는 자동 재생이 카메라를 구역으로 끌고 가지 않는다(구역을 직접 고르면 다가간다)
let wide = false;
function goTo(i, auto = false) {
  cur = i; finished = false; const now = performance.now();
  procs.forEach((p, k) => { if (k <= i && p.t0 == null) p.t0 = now + (k === i ? (REDUCED ? 0 : 700) : 0); p.chip.classList.toggle('cur', k === i); p.stop.classList.toggle('cur', k === i); p.stop.classList.toggle('up', k < i); });
  if (procs[i].up) procs[i].showUntil = now + SHOW_MS; // 이미 솟은 구역을 고르면 칩을 다시 3초
  $('tlFill').style.width = `${(i / (procs.length - 1)) * 100}%`;
  if (!auto) setPicked(true);
  if (view === '3d' && !(auto && wide)) { wide = false; animateTo(zonePose(procs[i]), 1700); }
}
// 공정 하나를 고른 동안(picked)은 아래 타임라인 대신 [▶ 재생]을 보인다. 2D·3D 전체 보기를 누르면 타임라인으로 돌아간다(2026-10-19 요청)
function setPicked(on) { document.body.classList.toggle('picked', on); }
$('btnTour').onclick = () => { if (cur >= 0) startTour(procs[cur]); };
function finish() { finished = true; pause(); procs.forEach((p) => p.stop.classList.add('up')); } // 멀리 빠지지 않고 마지막 구역 가까이에서 천천히 돈다(전체는 [지도]나 휠로)
addEventListener('keydown', (e) => { if (tour) { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return; if (e.key === 'Escape') stopTour(); else if (e.key === ' ') { e.preventDefault(); tourMod.toggle(); } else if (e.key === 'ArrowRight') tourMod.stepEq(1); else if (e.key === 'ArrowLeft') tourMod.stepEq(-1); return; } if (guideOpen) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); closeGuide(); } return; } if (e.key === ' ') { e.preventDefault(); playing ? pause() : play(); } else if (e.key === 'ArrowRight') { goTo(Math.min(procs.length - 1, cur + 1)); pause(); } else if (e.key === 'ArrowLeft') { goTo(Math.max(0, cur - 1)); pause(); } else if (e.key === 'Enter' && cur >= 0) enter(procs[cur]); else if (e.key === 'v' || e.key === 'V') setView(view === 'map' ? '3d' : 'map'); else { const n = parseInt(e.key, 10); if (n >= 1 && n <= procs.length) { goTo(n - 1); pause(); } } });

// ---- 지도 / 3D ---------------------------------------------------------------------------------------------------
// 2D(view 'map')에서는 드래그해도 위에서 본 채로 평면 회전만 한다. 위아래로 TILT_PX 넘게 드래그하거나 V 키를 누르면 3D로 바뀐다(위 토글도 같이)
const TILT_PX = 30;
function markView(v) { view = v; $('v2d').classList.toggle('on', v === 'map'); $('v2d').setAttribute('aria-pressed', String(v === 'map')); $('v3d').classList.toggle('on', v === '3d'); $('v3d').setAttribute('aria-pressed', String(v === '3d')); }
// 3D 버튼·V 키는 지금 구역이 아니라 3D 전체 보기로 간다: PITCH_3D만큼 기울이고 YAW_3D만큼 살짝 대각선으로 돌려 네 구역이 다 보이게(2026-10-15 요청)
const PITCH_3D = 0.52, YAW_3D = -0.58, DIST_3D = 0.68; // DIST_3D: 위에서 본 전체 보기 거리 대비(기울이면 앞뒤가 줄어 더 가까이 와도 다 보인다)
const pose3D = () => { const p = overviewPose(PITCH_3D); return { ...p, yaw: YAW_3D, dist: p.dist * DIST_3D }; };
function setView(v) { markView(v); wide = true; setPicked(false); animateTo(v === 'map' ? overviewPose() : pose3D(), 1400); }
$('v2d').onclick = () => setView('map'); $('v3d').onclick = () => setView('3d');

// ---- 입력 ----------------------------------------------------------------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let drag = null;
function pick(ev) { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); const h = ray.intersectObjects(procs.filter((p) => p.up).map((p) => p.hit), false)[0]; return h ? procs.find((p) => p.hit === h.object) : null; }
function setHot(p) { if (p === hot) return; const now = performance.now(); if (hot) { hot.hoverZone = false; hot.hoverOff = now; } hot = p; if (p) p.hoverZone = true; renderer.domElement.style.cursor = p ? 'pointer' : 'grab'; }
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, tilt: 0 }; stage.classList.add('dragging'); renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', (e) => { if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; orbit.yaw -= dx * 0.004;
    if (view === 'map') { drag.tilt += dy; if (Math.abs(drag.tilt) > TILT_PX) markView('3d'); } // 2D: 기울이지 않고, 위아래로 충분히 끌면 3D로
    else orbit.pitch = Math.min(1.52, Math.max(0.3, orbit.pitch + dy * 0.003)); drag.x = e.clientX; drag.y = e.clientY; anim = null; return; } setHot(pick(e)); });
renderer.domElement.addEventListener('pointerleave', () => setHot(null));
renderer.domElement.addEventListener('pointerup', (e) => { const d = drag; drag = null; stage.classList.remove('dragging'); if (!d || d.moved) return; if (tour) return; const p = pick(e); if (p) { goTo(p.i); pause(); p.showUntil = performance.now() + SHOW_MS; requestAnimationFrame(() => showChipHint(p)); } }); // 칩이 자리 잡은 다음 프레임에 첫 클릭 안내
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(maxDist(), Math.max(tour ? 10 : 50, orbit.dist * (1 + e.deltaY * 0.0012))); anim = null; }, { passive: false });

// ---- 후처리: 블룸 → 출력 ---------------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.4, 0.97); // 불빛·쇳물만 번지게 임계값을 높게(빛번짐 완화)
composer.addPass(bloom); tuneBloom(bloom);
composer.addPass(new OutputPass());
const tourMod = createIntroTour({ scene, renderer, composer, hud, getCamera: () => camera, loader, reduced: REDUCED, animateTo: (pose, ms) => { anim = null; animateTo(pose, ms); }, yawOf: (p) => zonePose(p).yaw, onEnd: tourEnded });
function resize() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); shiftView(); }
new ResizeObserver(resize).observe(stage); resize();
autoQuality({ renderer, composer });

// ---- 새벽빛(세상이 밝아짐) -------------------------------------------------------------------------------------------
// 땅에 깔리는 푸른 빛 웅덩이: 가운데가 밝고 가장자리로 갈수록 사라지는 원형 그라데이션(가산). 솟은 구역들의 가운데에서 커진다
const pool = (() => { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'), g = x.createRadialGradient(256, 256, 0, 256, 256, 256); g.addColorStop(0, 'rgba(110,190,255,0.75)'); g.addColorStop(0.35, 'rgba(60,140,235,0.42)'); g.addColorStop(0.7, 'rgba(30,90,200,0.14)'); g.addColorStop(1, 'rgba(20,60,160,0)'); x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); m.rotation.x = -Math.PI / 2; m.position.y = -0.85; m.renderOrder = 1; scene.add(m); return m; })(); // 바다 높이: 땅판이 가려 바다만 밝아진다
const dawn = { p: 0, cx: 0, cz: 0, skyK: -1 };
const FOG_NIGHT = new THREE.Color(0x111a29), FOG_BLUE = new THREE.Color(0x2b5f92), HEMI_SKY = [new THREE.Color(0x5a6f96), new THREE.Color(0x9ccaff)], HEMI_GND = [new THREE.Color(0x0a0c10), new THREE.Color(0x1b3049)];
function dawnTick() {
  let sum = 0, wx = 0, wz = 0;
  procs.forEach((p) => { if (!p.root || p.t0 == null) return; const k = p.root.visible ? Math.max(0, 1 + p.root.position.y / RISE_DEPTH) : 0; sum += k; wx += p.foot.cx * k; wz += p.foot.cz * k; }); // 솟은 정도(0~1)
  const target = sum / procs.length; dawn.p += (target - dawn.p) * (REDUCED ? 1 : 0.018); // 천천히 번진다
  if (sum > 0) { dawn.cx += (wx / sum - dawn.cx) * 0.03; dawn.cz += (wz / sum - dawn.cz) * 0.03; } else if (procs[0].foot) { dawn.cx = procs[0].foot.cx; dawn.cz = procs[0].foot.cz; }
  const k = dawn.p, r = 60 + 340 * Math.pow(k, 1.2), B = 0.6; // 첫 구역 때는 좁게, 구역이 늘수록 넓게 번진다. B = 밝기 배율(요청: 60%)
  pool.position.set(dawn.cx, -0.85, dawn.cz); pool.scale.set(r * 2, r * 2, 1); pool.material.opacity = Math.min(1, k * 5) * (0.55 + 0.25 * k) * B * 1.4; sea.material.emissiveIntensity = 0.55 * k * B;
  scene.fog.color.copy(FOG_NIGHT).lerp(FOG_BLUE, k * 0.85 * B); hemi.color.copy(HEMI_SKY[0]).lerp(HEMI_SKY[1], k * B); hemi.groundColor.copy(HEMI_GND[0]).lerp(HEMI_GND[1], k * B); hemi.intensity = 0.6 + 0.45 * k; moon.intensity = 0.9 + 0.2 * k; // 땅은 어둡게(주변광은 조금만)
  if (Math.abs(k - dawn.skyK) > 0.008) { dawn.skyK = k; paintSky(Math.min(1, k) * B); }
}

// ---- 트럭과 원료 열차 ----------------------------------------------------------------------------------------------------
// 트럭 길: 북쪽 해안 도로(동쪽 끝)에서 들어와 남북 간선도로를 따라 남쪽 끝으로. 남쪽 트럭은 같은 길을 거꾸로 달린다(오른쪽 차선)
const TRUCK_PATH = [[88, -70], [40, -84], [-2, -89.5], [-2, -24], [-12, -6], [-20, 10], [-27, 24], [-40, 48], [-46, 62], [-38, 80], [-22, 96], [-14, 102], [-9, 114]];
// 선로: 동쪽 항구 → 제선 구역 동쪽 변(공장 안으로 들어가며 사라진다)
const RAIL = [[104, -58], [62, -58], [50, -62], [41, -62]];
const TRUCK_COLORS = [0xe8e4da, 0x2f62a8, 0xd0782e, 0xb83a32, 0x3d8a5a, 0x8a9099];
const TRUCK_MAX = 10, TRUCK_EVERY = 10000, TRUCK_SPEED = 10, TRAIN_SPEED = 6;
const traffic = { trucks: [], body: null, lamps: null, pool: null, last: 0, next: 0, train: null };
const mkPath = (pts) => { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { P: pts, L, len: L[L.length - 1] }; };
const pathAt = ({ P, L, len }, s) => { s = Math.max(0, Math.min(len, s)); let k = 1; while (k < L.length - 1 && L[k] < s) k++; const u = (s - L[k - 1]) / Math.max(1e-6, L[k] - L[k - 1]); return [P[k - 1][0] + (P[k][0] - P[k - 1][0]) * u, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * u]; };
// 위치 + 진행 방향(앞뒤 0.9씩 떨어진 점으로 구해 꺾이는 곳에서 부드럽게 돈다). dir -1이면 길을 거꾸로 달린다
function pose(path, s, dir, lane = 0) {
  const at = (q) => pathAt(path, dir > 0 ? q : path.len - q), [x, z] = at(s), f = at(s + 0.9), r = at(s - 0.9);
  let tx = f[0] - r[0], tz = f[1] - r[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: x - tz * lane, z: z + tx * lane, tx, tz, ry: Math.atan2(-tz, tx) };
}
const paintGeo = (g, c) => { g = g.toNonIndexed(); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
function truckGeometry() { // 앞이 +x. 운전석(차 색) + 짐칸(차 색을 조금 어둡게) + 앞유리·차대(검게). 삼각형 48개
  return mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.55, 0.6, 0.72).translate(0.8, 0.4, 0), [1, 1, 1]),
    paintGeo(new THREE.BoxGeometry(0.05, 0.22, 0.62).translate(1.08, 0.52, 0), [0.08, 0.09, 0.1]),
    paintGeo(new THREE.BoxGeometry(1.5, 0.66, 0.78).translate(-0.28, 0.45, 0), [0.62, 0.62, 0.64]),
    paintGeo(new THREE.BoxGeometry(2.15, 0.13, 0.6).translate(0.02, 0.12, 0), [0.1, 0.1, 0.11]),
  ]);
}
function glowTexture(stops) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, s]) => g.addColorStop(o, s)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex; }
function railTexture() { // 가로 = 선로 길이 방향(침목 1개), 세로 = 폭(자갈 → 레일 2줄)
  const c = document.createElement('canvas'); c.width = 32; c.height = 32; const x = c.getContext('2d');
  x.fillStyle = '#3a3e44'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#6a5442'; x.fillRect(9, 3, 14, 26); x.fillStyle = '#d6dbe0'; x.fillRect(0, 8, 32, 3); x.fillRect(0, 21, 32, 3);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.anisotropy = 8; return tex;
}
function buildTraffic() {
  const N = TRUCK_MAX, path = mkPath(TRUCK_PATH);
  for (let i = 0; i < N; i++) traffic.trucks.push({ path, dir: 1, s: 0, on: false, vis: 0, wait: 0 });
  const body = new THREE.InstancedMesh(truckGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.4 }), N);
  body.castShadow = false; body.frustumCulled = false; body.raycast = () => {}; const col = new THREE.Color();
  for (let i = 0; i < N; i++) { body.setColorAt(i, col.set(TRUCK_COLORS[i % TRUCK_COLORS.length]).multiplyScalar(0.7)); body.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); } body.instanceColor.needsUpdate = true; scene.add(body);
  // 전조등·후미등: 트럭마다 점 2개(앞 흰빛, 뒤 빨강) + 열차 기관차 전조등 1개(마지막 칸)
  const lg = new THREE.BufferGeometry(), lc = new Float32Array((N * 2 + 1) * 3); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N * 2 + 1) * 3).fill(-9), 3));
  for (let i = 0; i < N; i++) { lc.set([1, 0.93, 0.78], i * 6); lc.set([1, 0.16, 0.1], i * 6 + 3); } lc.set([1, 0.93, 0.78], N * 6); lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const lamps = new THREE.Points(lg, new THREE.PointsMaterial({ size: 1.0, sizeAttenuation: true, vertexColors: true, map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  lamps.frustumCulled = false; lamps.renderOrder = 4; scene.add(lamps);
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture([[0, 'rgba(255,214,150,0.55)'], [0.5, 'rgba(255,190,120,0.18)'], [1, 'rgba(255,170,100,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), N + 1);
  pool.frustumCulled = false; pool.renderOrder = 2; pool.raycast = () => {}; for (let i = 0; i <= N; i++) pool.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); scene.add(pool);
  // 선로(땅에 깔린 띠) + 열차(기관차 1 + 호퍼차 5, 실은 철광석은 짐을 실었을 때만 보인다)
  const rail = mkPath(RAIL), bed = ribbon(RAIL, 1.0, 0.07, 3).geo, tex = railTexture(); tex.repeat.set(rail.len / 0.55, 1);
  bed.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(bed.attributes.position.count * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // 띠에는 법선이 없어 조명을 못 받으므로 위쪽으로 넣는다
  const bedMesh = new THREE.Mesh(bed, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.9, envMapIntensity: 0.2, side: THREE.DoubleSide })); // 밤에도 레일이 희미하게 보이게
  bedMesh.receiveShadow = true; bedMesh.renderOrder = 1; bedMesh.raycast = () => {}; scene.add(bedMesh);
  const M = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.3, envMapIntensity: 0.4 });
  const locoM = M(0x2f5a8a), cabM = M(0x1f3d5e), hopM = M(0x4a3e36, 0.8), oreM = M(0x5a3426, 0.95), cars = [], ores = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    if (!i) { g.add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 0.66).translate(0, 0.45, 0), locoM)); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.6).translate(0.55, 0.92, 0), cabM)); }
    else { g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.7).translate(0, 0.45, 0), hopM)); const ore = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.2, 0.56).translate(0, 0.8, 0), oreM); g.add(ore); ores.push(ore); }
    g.visible = false; scene.add(g); cars.push({ g, len: i ? 1.5 : 2.0 });
  }
  let off = 0; cars.forEach((c, i) => { if (i) off += cars[i - 1].len / 2 + 0.22 + c.len / 2; c.off = off; }); // 기관차 앞에서부터 각 칸 가운데까지의 거리
  traffic.train = { rail, cars, ores, total: off + 2, s: 0, dir: 1, run: false, next: 0, loaded: true };
  Object.assign(traffic, { body, lamps, pool });
}
const _cm = new THREE.Matrix4(), _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3();
function trafficTick(now) {
  const T = traffic; if (!T.body) return; const dt = Math.min(0.1, (now - (T.last || now)) / 1000); T.last = now;
  if (!procs[0].up) return; // 제선이 솟은 뒤부터 다닌다
  if (!T.next) T.next = now + 800;
  if (now >= T.next) { // 10초마다 북쪽에서 한 대 + 남쪽에서 한 대(가끔 한쪽만)
    T.next = now + TRUCK_EVERY * (0.85 + Math.random() * 0.3);
    const spawn = (dir, delay) => { const k = T.trucks.find((q) => !q.on && !q.wait); if (k) Object.assign(k, { dir, s: 0, vis: 0, wait: now + delay }); };
    const both = Math.random() < 0.7, first = Math.random() < 0.5 ? 1 : -1;
    spawn(first, 0); if (both) spawn(-first, 2500 + Math.random() * 3500);
  }
  const la = T.lamps.geometry.attributes.position.array, N = T.trucks.length;
  T.trucks.forEach((c, i) => {
    if (c.wait && now >= c.wait) { c.wait = 0; c.on = true; }
    if (c.on) { c.s += (REDUCED ? 3 : TRUCK_SPEED) * dt; if (c.s >= c.path.len) c.on = false; }
    if (!c.on) { T.body.setMatrixAt(i, _cm.makeScale(0, 0, 0)); T.pool.setMatrixAt(i, _cm); la.fill(-9, i * 6, i * 6 + 6); return; }
    const p = pose(c.path, c.s, c.dir, 0.5);
    c.vis += ((inside(LAND, p.x, p.z) ? 1 : 0) - c.vis) * Math.min(1, dt * 6); // 땅 밖 구간은 서서히 숨김
    const sc = c.vis * Math.min(1, c.s / 2, (c.path.len - c.s) / 2); _cq.setFromAxisAngle(_Y, p.ry);
    T.body.setMatrixAt(i, _cm.compose(_cp.set(p.x, 0, p.z), _cq, _cs.setScalar(Math.max(0, sc))));
    T.pool.setMatrixAt(i, _cm.compose(_cp.set(p.x + p.tx * 2.2, 0.05, p.z + p.tz * 2.2), _cq, _cs.set(3.2 * sc, 1, 1.6 * sc)));
    const hy = sc > 0.05 ? 0.32 : -9; la.set([p.x + p.tx * 1.15, hy, p.z + p.tz * 1.15, p.x - p.tx * 1.1, hy, p.z - p.tz * 1.1], i * 6);
  });
  // 원료 열차: 한 번에 한 편. 실은 편(항구 → 공장)과 빈 편(공장 → 항구)이 번갈아
  const R = T.train; la.fill(-9, N * 6, N * 6 + 3); T.pool.setMatrixAt(N, _cm.makeScale(0, 0, 0));
  if (!R.run && now >= R.next) { R.run = true; R.s = 0; R.ores.forEach((o) => (o.visible = R.loaded)); }
  if (R.run) {
    R.s += (REDUCED ? 3 : TRAIN_SPEED) * dt;
    R.cars.forEach((c, i) => {
      const s = R.s - c.off, inRail = s > 0 && s < R.rail.len; c.g.visible = inRail; if (!inRail) return;
      const p = pose(R.rail, s, R.dir), sc = Math.min(1, s / 1.2, (R.rail.len - s) / 1.2); // 선로 양 끝에서 작아졌다 커진다(항구·공장으로 드나듦)
      c.g.position.set(p.x, 0, p.z); c.g.rotation.y = p.ry; c.g.scale.set(Math.max(0.001, sc), 1, 1);
      if (!i) { la.set([p.x + p.tx * 1.05, 0.55, p.z + p.tz * 1.05], N * 6); _cq.setFromAxisAngle(_Y, p.ry); T.pool.setMatrixAt(N, _cm.compose(_cp.set(p.x + p.tx * 2.6, 0.06, p.z + p.tz * 2.6), _cq, _cs.set(3.2 * sc, 1, 1.4 * sc))); }
    });
    if (R.s > R.rail.len + R.total) { R.run = false; R.cars.forEach((c) => (c.g.visible = false)); R.dir = -R.dir; R.loaded = !R.loaded; R.next = now + 6000 + Math.random() * 5000; }
  }
  T.body.instanceMatrix.needsUpdate = true; T.pool.instanceMatrix.needsUpdate = true; T.lamps.geometry.attributes.position.needsUpdate = true;
}

const finale = { t0: 0 }, FINALE = { blink: 1500, low: 0.42 }; // 깜빡임 1.5초(3번), 그 뒤 밝기 42%

// ---- 루프 ----------------------------------------------------------------------------------------------------------
const V = new THREE.Vector3();
function rise(p, now) {
  if (!p.root) return;
  const t = p.t0 == null ? -1 : now - p.t0, k1 = t < 0 ? 0 : REDUCED ? 1 : Math.min(1, t / 700), k2 = t < 0 ? 0 : REDUCED ? 1 : Math.min(1, Math.max(0, (t - 250) / 1300));
  if (k2 > 0 && !p.up) shadowDirty = true;
  p.root.visible = k2 > 0 && !p.hidden && !p.swapped; p.root.position.y = -RISE_DEPTH * (1 - (k2 >= 1 ? 1 : easeOutBack(k2))); // swapped: 재생 중에는 설비 단위 모델(intro-tour.js)이 대신 보인다
  p.glow.material.opacity = k1 <= 0 ? 0 : k1 < 1 ? 0.6 + 0.6 * Math.sin(k1 * Math.PI) : 0.5;
  p.warm.intensity = p.hidden ? 0 : 220 * easeOut(k2); // 은은한 주황 반사만(세면 모델이 하얗게 타고 블룸이 번진다)
  if (k2 >= 1 && !p.up) { p.up = true; p.upAt = now; p.showUntil = now + SHOW_MS; } // 솟은 직후 3초만 칩을 보인다
  const on = p.up && p.i === cur && !REDUCED && !tour, r0 = Math.max(p.foot.w, p.foot.d) * 0.62; // 지금 구역: 15% 물결(재생 중에는 확대해 보므로 끈다)
  p.ripples.forEach((r, k) => { if (!on) { r.material.opacity = 0; return; } const ph = ((now / 2200) + k * 0.5) % 1; r.scale.setScalar(r0 * (0.9 + 0.7 * ph)); r.material.opacity = 0.15 * (1 - ph); });
}
function placeHud(now) {
  const w = stage.clientWidth, h = stage.clientHeight;
  procs.forEach((p) => { if (!chipVisible(p, now)) { p.chip.classList.remove('on'); return; } V.set(p.foot.cx, p.modelTop + 3, p.foot.cz).project(camera); const vis = V.z < 1; p.chip.classList.toggle('on', vis); if (vis) p.chip.style.transform = `translate(${Math.min(w - 140, Math.max(140, (V.x + 1) / 2 * w)).toFixed(1)}px, ${Math.max(150, (1 - V.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`; p.chip.style.zIndex = p.i === cur ? '3' : '1'; });
  links.forEach((l) => { const vis = l.on && (now < l.showUntil || l.a.hoverZone || l.b.hoverZone); l.label.classList.toggle('on', vis); if (!vis) return; V.copy(l.mid).setY(2).project(camera); l.label.style.transform = `translate(${((V.x + 1) / 2 * w).toFixed(1)}px, ${((1 - V.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`; });
}
const gate = frameGate();
function frame(now) {
  requestAnimationFrame(frame);
  if (!gate(now, tour || !!anim || !!drag || (playing && !finished))) return; // 공정이 차례로 올라오는 동안은 60fps, 다 올라온 뒤 천천히 도는 대기 화면은 30fps
  procs.forEach((p) => { rise(p, now); growSurroundings(p, now); });
  const busy = tour; // [재생] 중에는 장식(트럭·열차·불빛 깜빡임)을 멈춘다(계산·업로드를 쉰다)
  if (!busy) trafficTick(now);
  dawnTick();
  const focusD = camera.position.distanceTo(orbit.target); if (!busy) lightLayers.forEach((l) => { const u = l.material.uniforms; u.uT.value = now / 1000; u.uFocus.value = focusD; u.uCoc.value = 0; }); // 흐림 없음: 3D에서도 전체가 선명하게(2026-10-15 요청)
  links.forEach((l) => { const on = l.a.up && l.b.up; if (on && !l.on) { l.t0 = now; l.showUntil = now + SHOW_MS; } l.on = on; l.mesh.visible = on && !tour; if (on) { l.mesh.material.uniforms.reach.value = REDUCED ? 1 : Math.min(1, (now - l.t0) / 1400); l.mesh.material.uniforms.t.value = now / 1000; } });
  // 연결선이 제선에서 열연까지 다 그어지면(마지막 선이 다 뻗은 뒤): 위에서 전체를 보여 주며 선이 세 번 깜빡이고, 그 뒤 선 밝기를 낮춘다(한 번만)
  if (!finale.t0 && links.length === procs.length - 1 && links.every((l) => l.on && now - l.t0 >= 1400)) { finale.t0 = now; } // 3D 대각선 전체 보기 그대로 깜빡인다(2D로 바꾸지 않는다)
  if (finale.t0) { const ft = now - finale.t0, gain = REDUCED ? FINALE.low : ft < FINALE.blink ? FINALE.low + (1.6 - FINALE.low) * (0.5 + 0.5 * Math.cos(ft / FINALE.blink * Math.PI * 6)) : Math.max(FINALE.low, 1.6 - (1.6 - FINALE.low) * Math.min(1, (ft - FINALE.blink) / 800));
    links.forEach((l) => { l.mesh.material.uniforms.gain.value = gain; }); }
  if (playing && cur >= 0 && procs[cur].up && now - procs[cur].upAt > HOLD_MS) { if (cur < procs.length - 1) goTo(cur + 1, true); else finish(); }
  if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), s = easeInOut(k); orbit.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * s; orbit.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * s; orbit.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * s; orbit.target.lerpVectors(anim.from.target, anim.to.target, s); if (k >= 1) anim = null; }
  else if (!drag && !REDUCED && finished && view === '3d') orbit.yaw += 0.0003;
  const o = orbit; camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch)); camera.lookAt(o.target);
  tourMod.tick(now);
  if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  composer.render();
  placeHud(now);
}
// 셰이더 미리 준비: 공정 모델은 솟기 전까지 숨겨 두어 처음 보일 때 셰이더를 만드느라 0.2초쯤 멈췄다. 숨긴 채로 한 번 컴파일해 둔다
function warmUp() {
  const hidden = []; scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { renderer.compile(scene, camera); } catch (e) { console.warn('셰이더 미리 준비 실패', e); }
  hidden.forEach((o) => { o.visible = false; });
}
loadAll().then(() => { buildLinks(); buildTraffic(); buildSurroundings(); buildAmbientLights(); warmUp(); $('load').classList.add('off'); startMap(); requestAnimationFrame(frame); });
