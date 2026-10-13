// 작동 보기·단면 보기에서 층(단계)을 고르면, 그 단계 설명(data_v2.js의 steps[i])에 맞는 시각화를 단면 위에 그린다.
// 좌표: 항목마다 기준 상자(span: 단면 층 번호 [a, b], 기본은 지금 층, 'all'은 단면 전체)를 잡고 [u, v]를 -1~1로 쓴다.
//       u는 오른쪽이 +, v는 위가 +. 1을 넘으면 상자 바깥.
// 종류: arrow(자라나는 화살표), grad(온도 그라데이션), bands(층층이 쌓기), stream(방향 있는 입자), spin(회전),
//       pulse(지점 강조), squash(두께 줄이기), shake(진동), badge(큰 수치), tag(짧은 설명)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const START = 0.6; // 카메라가 층으로 옮겨 가는 동안 기다림(초)
const ease = (k) => k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(1 - k, 3);
const c01 = (k) => Math.max(0, Math.min(1, k));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 입자 종류: [시작색, 끝색, 크기, 수명(초), 기본 개수, 움직임(0 감속·1 가속·2 등속), 빛남(밤에 가산 혼합)]
const KIND = {
  gas: ['#d3dae2', '#8e99a6', 1.7, 2.4, 60, 0, 0], steam: ['#f4f7fa', '#cfd8e1', 2.0, 2.2, 45, 0, 0],
  co: ['#6fd0ff', '#a3adb8', 1.4, 2.4, 70, 0, 0], air: ['#bfe6ff', '#4aa8f0', 0.7, 1.6, 70, 2, 0],
  heat: ['#ffd070', '#ff5a10', 0.9, 1.5, 70, 2, 1], flame: ['#fff0b0', '#ff4a08', 1.2, 0.9, 80, 0, 1],
  metal: ['#fff0c0', '#ff7a1a', 0.75, 1.1, 60, 1, 1], spark: ['#fff6d0', '#ff9020', 0.4, 0.6, 80, 0, 1],
  water: ['#e0f4ff', '#3a9cf0', 0.6, 0.8, 80, 1, 0], bubble: ['#ffffff', '#bfe9ff', 0.6, 1.5, 50, 2, 0],
  powder: ['#ffffff', '#d9dcd6', 0.55, 1.4, 60, 1, 0], dust: ['#b8bec6', '#7d848c', 0.6, 1.6, 50, 2, 0],
  coal: ['#3a3d42', '#1c1e22', 0.9, 1.3, 50, 1, 0], scrap: ['#b0b8c2', '#6b7280', 1.1, 1.2, 30, 1, 0],
  flake: ['#4a4f57', '#24282d', 0.65, 1.8, 50, 2, 0], imp: ['#24282d', '#4a4f57', 0.55, 2.6, 40, 2, 0],
};
const ICON = {
  weight: '<path d="M8.5 8a3.5 3.5 0 1 1 7 0"/><path d="M5 9h14l2 11H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  thermo: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v8"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
  cycle: '<path d="M20 12a8 8 0 0 1-14 5"/><path d="M4 12a8 8 0 0 1 14-5"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
};
const CS = '#include <colorspace_fragment>\n';
const VS_UV = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FS_ARROW = 'uniform vec3 c1, c2; uniform float t, grow, op, rep, bk; varying vec2 vUv; void main(){ float y = vUv.y; if (y > grow) discard; float s = step(0.55, fract(y * rep - t * 1.4)); vec3 c = mix(c1, c2, y); c = mix(c, vec3(1.0), s * 0.45); gl_FragColor = bk > 0.5 ? vec4(0.0, 0.0, 0.0, op * 0.32) : vec4(c, op);\n' + CS + '}';
const VS_W = 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const FS_GRAD = 'uniform vec3 cA, cB; uniform float yT, yB, cx, hx, rv, ax, op; varying vec3 wp; void main(){ float k = ax > 0.5 ? 1.0 - clamp(abs(wp.x - cx) / hx, 0.0, 1.0) : clamp((yT - wp.y) / max(1e-4, yT - yB), 0.0, 1.0); if (k > rv) discard; float edge = smoothstep(rv - 0.08, rv, k) * step(rv, 0.999); vec3 c = mix(mix(cA, cB, k), vec3(1.0), edge * 0.6); gl_FragColor = vec4(c, op * 0.92);\n' + CS + '}';
const VS_PT = 'attribute float k; varying float vk; uniform float size, scale; void main(){ vk = k; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }';
const FS_PT = 'uniform vec3 c1, c2; uniform sampler2D map; uniform float op; varying float vk; void main(){ if (vk < 0.0) discard; float a = smoothstep(0.0, 0.12, vk) * (1.0 - smoothstep(0.7, 1.0, vk)); vec4 tx = texture2D(map, gl_PointCoord); gl_FragColor = vec4(mix(c1, c2, vk), tx.a * a * op);\n' + CS + '}';

const CSS = `.sfx{position:absolute;width:0;height:0;pointer-events:none;z-index:4}.sfx-in{position:absolute;left:0;top:0;white-space:nowrap}
.sfx-tag .sfx-body{font:600 12.5px/1.3 "IBM Plex Sans KR",sans-serif;padding:5px 10px;border-radius:3px;border-left:3px solid var(--c);background:var(--bg);color:var(--fg);box-shadow:0 4px 14px rgba(0,0,0,.18);animation:sfxIn .4s ease-out both}
.sfx-mark .sfx-body{font:700 12px/1 "IBM Plex Mono",monospace;padding:4px 8px;border-radius:2px;background:var(--c);color:#0b0f14;animation:sfxIn .35s ease-out both}
.sfx-badge .sfx-body{display:flex;align-items:center;gap:10px;padding:10px 16px 10px 12px;border-radius:4px;border:1px solid var(--c);background:var(--bg);color:var(--fg);box-shadow:0 10px 28px rgba(0,0,0,.25);animation:sfxPop .5s cubic-bezier(.2,1.5,.4,1) both}
.sfx-badge.drop .sfx-body{animation:sfxDrop .8s cubic-bezier(.3,0,.4,1) both}
.sfx-badge svg{width:30px;height:30px;flex:none;stroke:var(--c);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sfx-badge b{display:block;font:800 24px/1.1 "IBM Plex Sans KR",sans-serif;letter-spacing:-.02em}.sfx-badge small{display:block;font:500 12px/1.3 "IBM Plex Sans KR",sans-serif;opacity:.8;margin-top:3px}
@keyframes sfxIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sfxPop{0%{opacity:0;transform:scale(.6)}100%{opacity:1;transform:scale(1)}}
@keyframes sfxDrop{0%{opacity:0;transform:translateY(-140px)}55%{opacity:1;transform:translateY(0)}68%{transform:translateY(-12px)}80%{transform:translateY(0)}90%{transform:translateY(-3px)}100%{opacity:1;transform:none}}`;
const ALIGN = { c: 'translate(-50%,-50%)', r: 'translate(12px,-50%)', l: 'translate(calc(-100% - 12px),-50%)', b: 'translate(-50%,12px)', t: 'translate(-50%,calc(-100% - 12px))' };
const sideOf = (uv) => uv[0] <= -1.1 ? 'l' : uv[0] >= 1.1 ? 'r' : uv[1] >= 0 ? 't' : 'b';

// 단계별 시각화. STEP_FX[설비 id][단면 층 번호] = 항목 목록. 작동 보기는 층 번호 i에서 steps[i] 설명을 보여 준다.
const A = (from, to, color, label, x = {}) => ({ t: 'arrow', from, to, color, label, ...x });
const S = (kind, from, to, x = {}) => ({ t: 'stream', kind, from, to, ...x });
const T = (at, text, x = {}) => ({ t: 'tag', at, text, ...x });
const B = (at, text, sub, icon, x = {}) => ({ t: 'badge', at, text, sub, icon, ...x });
const G = (from, to, x = {}) => ({ t: 'grad', from, to, ...x });
const HOT = '#ff8a2a', AIR = '#5ab8ff', O2 = '#8fd3ff', GAS = '#9aa4b0', WHITE = '#ffffff', ROLL = '#c8ced6', UI = '#22c7f0';
export const STEP_FX = {
  sinter_plant: [
    [S('dust', [0, 3], [0, 0.5], { spread: [0.8, 0.2], toSpread: [0.9, 0.35], label: '가루 철광석 + 석회석 + 분코크스', labelAt: [0, 3.2] }), A([-1.4, -1], [-1.4, 1], WHITE, null, { w: 0.7 }), B([-1.6, 0], '약 50cm', '원료를 까는 두께', 'ruler', { delay: 0.8 })],
    [S('flame', [0, 1], [0, 1.8], { spread: [0.9, 0.05] }), A([0, 1.4], [0, -0.9], HOT, '불이 위 → 아래로 내려감', { w: 1.3, dur: 2.2, labelAt: [1.3, 0.2] }), S('air', [0, 2.6], [0, -2.4], { spread: [1, 0.1], toSpread: [0.3, 0.1], delay: 0.6, label: '아래에서 공기를 빨아들임', labelAt: [0, -2.4] })],
    [S('heat', [0, 0], [0, 0], { spread: [1, 1], toSpread: [0.2, 0.2], n: 90, label: '가루가 일부 녹아 서로 붙음', labelAt: [0, 1.3] }), A([1.4, 0], [1.4, 1], '#ffb03a', null, { w: 0.7, delay: 1 }), A([1.4, 0], [1.4, -1], '#ffb03a', '이 층이 두꺼울수록 단단', { w: 0.7, delay: 1, labelAt: [1.5, 0] })],
    [S('steam', [0, -0.2], [0, 2.3], { spread: [0.9, 0.6], label: '수분 증발 (H₂O ↑)', labelAt: [-1.2, 2.2] }), S('gas', [0.3, 0], [0.6, 2.6], { spread: [0.7, 0.5], delay: 1, label: '석회석 분해 (CO₂ ↑)', labelAt: [1.2, 2.6] })],
    [S('dust', [0, 0.8], [0, -1.4], { spread: [0.9, 0.2], n: 40 }), A([0.6, -0.4], [3, -0.4], '#ffb03a', '5~50mm → 고로로', { w: 1.2 }), A([-0.6, -0.8], [-3, -0.8], GAS, '작은 것 → 다시 배합', { delay: 1.2 })],
  ],
  coke_oven: [
    [A([0, 2.2], [0, 1.08], WHITE, '위에서 넣고 뚜껑을 닫음'), S('coal', [0, 1.1], [0, -0.9], { spread: [0.5, 0.05], toSpread: [0.7, 0.2] }), B([-1.6, 0.2], '폭 45cm', '높이 6~7m의 좁은 방', 'ruler', { delay: 0.8 }), T([0, -1.25], '공기 차단', { delay: 1.4 })],
    [A([-2, 0.2], [-1.05, 0.2], HOT, null), A([2, 0.2], [1.05, 0.2], HOT, '양쪽 벽에서 열이 들어옴', { labelAt: [2.1, 0.2] }), S('gas', [0, 0.3], [0, 2.2], { spread: [0.6, 0.4], delay: 0.8, label: '타르·가스(COG) → 연료로 재사용', labelAt: [0, 2.2] })],
    [G('#ff6a1a', '#ffc070', { axis: 'r', dur: 3 }), B([0, 1.5], '18~24시간', '벽 쪽부터 가운데로 익음', 'clock', { delay: 0.8 })],
    [...[-1, -0.5, 0, 0.5, 1].map(u => S('flame', [u, -0.9], [u, 0.9], { spread: [0.03, 0.1], n: 30 })), T([0, 1.15], '연소실: 가스를 태워 벽을 가열', { delay: 0.6 }), T([0, -1.15], '석탄은 직접 타지 않고 벽 너머 열로 구워짐', { delay: 1.4 })],
    [A([-0.6, 0], [2.2, 0], HOT, '붉은 코크스를 밀어냄', { w: 1.3, labelAt: [1, 0.5] }), S('water', [2.8, 1.6], [2.8, 0.1], { spread: [0.4, 0.05], delay: 1, label: '물로 급히 식힘 (소화)', labelAt: [2.9, 1.7] }), S('steam', [2.8, 0.1], [2.8, 2.2], { delay: 1.6 })],
  ],
  blast_furnace: [
    [{ t: 'bands', colors: ['#2b2d31', '#a0603a'], n: 6 }, S('gas', [0, -2.4], [0, 1.4], { spread: [0.5, 0.3], delay: 2.2, label: '올라오는 고로가스가 원료를 미리 데움', labelAt: [1.2, -1.2] }), T([-1.2, 0.4], '코크스 · 철광석을 층층이 번갈아', { delay: 0.4 })],
    [S('co', [0, -2], [0, 2], { spread: [0.6, 0.2], toSpread: [0.6, 0.3], n: 90 }), T([-1.2, -0.8], 'CO ↑ (코크스가 타며 생김)', { color: '#6fd0ff', delay: 0.4 }), T([1.2, 0.8], 'CO₂ ↑ (광석의 산소를 빼앗아 감)', { color: GAS, delay: 1.4 }), T([1.2, -0.6], '철은 아직 고체', { delay: 2.2 })],
    [S('gas', [0, -0.4], [0, 1.8], { spread: [0.6, 0.3], label: 'CaCO₃ → CaO + CO₂ ↑', labelAt: [1.2, 0.8] }), A([-0.4, 0.6], [-0.4, -0.84], GAS, 'CaO + SiO₂ → 슬래그', { span: [2, 5], delay: 1.2, dur: 1.6, labelAt: [-1.2, -0.5] })],
    [S('metal', [0, 0.2], [0, -3.2], { spread: [0.6, 0.4], toSpread: [0.5, 0.1], label: '녹은 철이 방울로 떨어짐', labelAt: [1.2, -1.6] }), S('gas', [0, -1.2], [0, 1.6], { spread: [0.6, 0.3], n: 30, delay: 0.8, label: '고체 코크스 사이 = 가스 통로', labelAt: [-1.2, 0.8] })],
    [A([-2.8, 0], [-1.0, 0], '#ffb050', null, { w: 1.3 }), A([2.8, 0], [1.0, 0], '#ffb050', '열풍 1,200℃ (풍구)', { w: 1.3, labelAt: [2.2, 0.9] }), S('flame', [-0.9, 0], [-0.2, 1.2], { spread: [0.1, 0.3], delay: 0.8 }), S('flame', [0.9, 0], [0.2, 1.2], { spread: [0.1, 0.3], delay: 0.8 }), B([-1.6, 1.6], '약 2,000℃', '고로에서 가장 뜨거운 곳', 'thermo', { delay: 1.2 })],
    [T([-1.2, 0.6], '슬래그: 가벼워서 위에 뜸', { span: [5, 6], color: GAS }), T([-1.2, -0.45], '용선: 무거워서 아래 (탄소 약 4%)', { span: [5, 6], color: HOT, delay: 0.8 }), A([0.9, -0.5], [3, -0.9], '#ffb050', '출선구 → 토페도카', { span: [5, 6], delay: 1.6, w: 1.2, labelAt: [2.4, -1.4] }), S('metal', [0.9, -0.5], [3, -0.9], { span: [5, 6], spread: 0.05, toSpread: 0.1, delay: 1.9 })],
    [{ t: 'pulse', at: [0, 0], color: '#ffd08a' }, T([-1.2, 0], '용선 약 1,500℃ · 탄소 약 4%', { color: HOT })],
  ],
  hot_stove: [
    [S('flame', [0, -0.7], [0, 0.6], { spread: [0.5, 0.1], n: 90, label: 'BFG + 공기 → 연소', labelAt: [-1.2, 0.2] }), B([1.3, 0.6], '약 1,400℃', '열풍로에서 가장 뜨거운 곳', 'thermo', { delay: 0.8 })],
    [G('#ffe08a', '#ff6a1a', { dur: 2.4 }), A([-1.5, 1.6], [-1.5, -1], '#ff9a3a', '뜨거운 연소가스 ↓', { labelAt: [-1.6, 1.5] }), S('heat', [0, 1.4], [0, -0.6], { spread: [0.7, 0.1], toSpread: [0.8, 0.4] }), T([1.3, 0], '벽돌이 열을 흡수·저장 (축열)', { delay: 1.6 })],
    [G('#ff6a1a', '#2f7dff', { span: [1, 3], dur: 2.6, marks: [[0.85, '1,200~1,300℃'], [0, '약 800℃'], [-0.85, '약 300℃']] }), A([-1.5, 1], [-1.5, -1], '#ff8a3a', '아래로 갈수록 식음', { span: [1, 3], color2: '#2f7dff', w: 1.3, dur: 2.6, labelAt: [-1.6, -1.05] }), B([-1.9, 0.25], '수천 톤', '체커 벽돌 무게', 'weight', { span: [1, 3], anim: 'drop', press: true, delay: 2.8, color: '#ffb03a' })],
    [A([0, -0.4], [-2.6, -1.3], GAS, '배가스 → 굴뚝', { labelAt: [-2.6, -1.3] }), S('gas', [0, 0.6], [-2.6, -1.3], { spread: [0.5, 0.2] }), A([0.6, -2.9], [0.6, -0.3], AIR, '밸브 전환 → 찬 공기를 아래에서 넣음', { delay: 2.4, w: 1.2, labelAt: [1.2, -2.4] }), B([1.3, 0.7], '축열 ↔ 송풍', '밸브를 바꿔 반대로', 'cycle', { delay: 3, color: AIR })],
    [A([0, -0.95], [0, 0.95], AIR, '찬 공기가 뜨거운 체커를 거꾸로 지나며 데워짐', { span: [1, 3], color2: HOT, w: 1.4, dur: 2, labelAt: [-1.2, 0] }), A([-1, 0], [1.6, 0], HOT, '열풍 약 1,200℃ → 고로 풍구', { delay: 2, w: 1.3, labelAt: [1.7, 0] }), S('heat', [-1, 0], [1.6, 0], { spread: [0.1, 0.3], delay: 2.2 }), B([1.3, 0.7], '3~4기 교대', '축열 ↔ 송풍을 번갈아', 'cycle', { span: [1, 3], delay: 3 })],
  ],
  hot_metal_pretreatment: [
    [S('metal', [0, 2.6], [0, 0.2], { spread: [0.08, 0.1], toSpread: [0.6, 0.2], label: '토페도카 → 래들', labelAt: [1.2, 2.2] }), S('imp', [0, 0], [0, 0], { spread: [0.85, 0.8], toSpread: [0.85, 0.8], delay: 0.8 }), B([-1.4, 0.2], 'S · P · Si', '아직 불순물이 많음', null, { delay: 1.2, color: GAS })],
    [A([0, 2.6], [0, 0.3], O2, '산화철·산소 투입', { labelAt: [1.2, 2.2] }), S('bubble', [0, -0.6], [0, 1.4], { spread: [0.7, 0.3], delay: 0.8, label: 'Si → SiO₂ (슬래그로)', labelAt: [-1.2, 1] })],
    [A([0.3, 3.6], [0.3, -0.7], ROLL, '랜스를 깊이 꽂아 분말 취입', { w: 1.2, dur: 1.4, labelAt: [1.2, 2.6] }), S('powder', [0.3, -0.7], [0, 1.6], { spread: 0.1, toSpread: [0.8, 0.3], delay: 1.2, label: 'S·P → 슬래그로 떠오름', labelAt: [-1.2, 1.2] })],
    [A([-0.6, 0.4], [2.6, 0.8], GAS, '위에 뜬 슬래그를 걷어냄', { w: 1.3 }), S('dust', [-0.6, 0.3], [2.6, 0.8], { spread: [0.5, 0.3] }), T([-1.2, -0.6], '남기면 전로에서 불순물이 되돌아옴', { delay: 1.2 })],
  ],
  bof_converter: [
    [S('scrap', [-0.5, 1], [0, -0.3], { span: [1, 3], spread: [0.3, 0.1], toSpread: [0.6, 0.3], label: '① 고철 먼저', labelAt: [-1.2, 0.8] }), S('metal', [0.5, 1], [0, -0.4], { span: [1, 3], delay: 1.8, label: '② 그 위에 용선', labelAt: [1.2, 0.6] })],
    [A([0, 1], [0, -0.1], O2, '순산소를 초음속으로', { span: [0, 3], w: 1.4, labelAt: [1.2, 0.8] }), S('spark', [0, -0.15], [0, 0.4], { span: [0, 3], spread: [0.1, 0.02], toSpread: [0.9, 0.4], delay: 1 }), B([-1.4, 0], '15~20분', '탄소 4% → 0.1% 이하', 'clock', { span: [0, 3], delay: 1.4 })],
    [S('powder', [0, 2.6], [0, 0.2], { label: '석회(CaO) 투입', labelAt: [1.2, 2.2] }), S('dust', [0, -2.4], [0, 0], { spread: [0.7, 0.3], delay: 0.8, label: 'P·Si·Mn 산화물 → 슬래그', labelAt: [-1.2, -1.4] })],
    [S('gas', [0, -0.2], [0, 1.05], { span: 'all', spread: [0.4, 0.1], toSpread: [0.4, 0.1], label: '탄소가 타며 CO 발생', labelAt: [-1.2, 0.3] }), A([0.2, 0.9], [2.4, 1.2], GAS, '후드 → 연료로 재사용', { span: 'all', delay: 1.2 })],
    [A([0.4, 0.2], [2.8, -0.8], '#ffb050', '출강구 → 래들', { w: 1.3, labelAt: [2.2, -1.2] }), S('metal', [0.4, 0.2], [2.8, -0.8], { spread: 0.08, delay: 0.4 }), S('powder', [2.8, 1.8], [2.8, -0.6], { delay: 1.4, label: '합금철 투입 (성분 조정)', labelAt: [2.8, 2] })],
  ],
  oxygen_lance_offgas: [
    [A([0, 1.2], [0, -1.8], O2, '수냉 랜스를 내림', { w: 1.4, labelAt: [1.2, 0.6] }), B([-1.4, -1], '약 2m', '쇳물 표면 위에 맞춤', 'ruler', { delay: 1.2 })],
    [A([0, 2.4], [0, -0.6], O2, '초음속 순산소', { labelAt: [1.2, 1.8] }), S('spark', [0, -0.7], [0, -0.1], { spread: 0.05, toSpread: [0.9, 0.4], delay: 0.8 }), S('co', [0, -0.6], [0, 1.6], { spread: [0.6, 0.2], delay: 0.6, n: 90, label: 'CO 대량 발생', labelAt: [-1.2, 0.8] })],
    [S('gas', [0, -2.4], [0, 1.2], { spread: [0.8, 0.2], toSpread: [0.2, 0.1], label: '후드가 배가스를 빨아들임', labelAt: [1.2, 0] }), T([-1.2, -0.4], '공기를 적게 섞어 CO 그대로 회수', { delay: 1 })],
    [G('#d8551a', '#5a7fa0', { span: [1, 3], dur: 2.4, marks: [[0.85, '약 1,500℃'], [-0.85, '약 70℃']] }), S('water', [0, 1.2], [0, -0.6], { spread: [0.8, 0.05], label: '물 분사로 냉각·집진', labelAt: [-1.2, 1] }), T([-1.2, -0.6], '깨끗한 CO → 공장 연료', { delay: 2 })],
  ],
  tapping_ladle_crane: [
    [A([-2.8, 1.6], [-0.2, 0.6], '#ffb050', '전로를 기울여 용강만 따름', { span: 'all', w: 1.3, labelAt: [-1.6, 1.7] }), S('metal', [-2.8, 1.6], [0, 0.2], { span: 'all', spread: 0.05, delay: 0.5 })],
    [S('powder', [0.6, 2.8], [0.2, 0], { label: 'Mn·Si·Al 합금 투입', labelAt: [1.2, 2] }), S('bubble', [0, -0.6], [0, 0.8], { spread: [0.7, 0.3], delay: 1, label: '산소를 빼고 성분을 맞춤', labelAt: [-1.2, 0] })],
    [{ t: 'pulse', at: [-0.9, 1.1], span: 'all', color: '#ffd08a' }, B([-1.6, 1.2], '다트로 차단', '슬래그가 래들에 섞이지 않게', null, { span: 'all', delay: 0.6, color: GAS })],
    [A([0, 1.1], [0, 1.9], WHITE, null, { span: 'all' }), A([0, 1.9], [2.4, 1.9], WHITE, '천장 크레인 → 2차 정련', { span: 'all', delay: 1, labelAt: [2.5, 1.9] }), B([-1.4, 0.2], '300톤', '래들 한 개를 들어 옮김', 'weight', { span: 'all', count: true, delay: 0.4 })],
  ],
  secondary_refining: [
    [...[-0.45, 0, 0.45].map(u => S('spark', [u, -0.9], [u, -0.3], { span: [1, 1], spread: 0.04, toSpread: [0.25, 0.3], n: 40 })), ...[-0.45, 0, 0.45].map(u => A([u, 2.4], [u, -0.8], ROLL, null, { span: [1, 1], w: 0.8 })), B([-1.4, 0], '아크 가열', '흑연 전극 3개로 온도를 맞춤', 'bolt', { span: [1, 1], delay: 1 })],
    [S('powder', [0, 1.6], [0, -2.4], { label: '합금 미세 조정', labelAt: [1.2, 1.2] }), S('dust', [0, -3.6], [0, -1.8], { spread: [0.7, 0.2], delay: 1, label: '황 → 환원 슬래그로', labelAt: [-1.2, -2.2] })],
    [S('bubble', [0, -0.9], [0, 0.9], { span: [3, 4], spread: [0.5, 0.1], n: 80, label: 'Ar 버블 ↑ 개재물이 떠오름', labelAt: [1.2, 0.6] }), { t: 'spin', at: [0, 0.1], span: [3, 4], rad: 0.5, color: O2, label: '용강을 섞음 (교반)', delay: 0.6 }],
    [A([-0.4, -0.5], [-0.4, 0.75], '#ffb54a', '올라감', { span: [0, 3], labelAt: [-1.2, 0.2] }), A([0.4, 0.75], [0.4, -0.5], '#ffb54a', '내려감', { span: [0, 3], delay: 0.6, labelAt: [1.2, 0.2] }), S('gas', [0, 0.7], [0, 1.6], { span: [0, 3], delay: 1, label: 'H₂·N₂·CO를 빼냄', labelAt: [-1.2, 1.3] }), B([1.3, 0.9], '진공', '용강을 순환시켜 가스 제거', 'gauge', { span: [0, 3], delay: 1.6, color: O2 })],
    [A([-0.6, 0], [2.8, 0], '#ffb54a', '크레인 → 연주 턴디시 위로', { w: 1.3, labelAt: [1.4, 0.8] })],
  ],
  ladle_transfer: [
    [A([0.4, 3.4], [0.4, -0.8], ROLL, '측온 프로브', { labelAt: [1.2, 2.6] }), { t: 'pulse', at: [0.4, -1.6], color: '#ffd08a', delay: 1 }, B([-1.4, -0.6], '온도 확인', '낮으면 LF로 돌아가 재가열', 'thermo', { delay: 1.2 })],
    [A([-2, -1.6], [2, -1.6], WHITE, '래들 카로 레일 위 이동', { span: 'all', w: 1.3, labelAt: [2.1, -1.6] }), S('heat', [0, 0.9], [0, 1.6], { span: 'all', n: 20, spread: [0.6, 0.05] }), T([-1.2, 0.9], '뚜껑을 덮어 열이 덜 빠짐', { span: 'all', delay: 1 })],
    [A([0, 2.2], [0, 1.15], WHITE, '크레인 → 래들 터릿', { span: 'all' }), { t: 'pulse', at: [0, -1.1], span: 'all', color: UI, delay: 1 }, T([1.2, -1], '여기서부터 연주 공정', { span: 'all', delay: 1.2 })],
  ],
  ladle_turret: [
    [A([-2.6, 1.8], [-1.1, 0.4], WHITE, '래들을 터릿 한쪽 팔에 올림', { span: 'all', labelAt: [-1.8, 1.9] }), { t: 'pulse', at: [-1.1, 0.4], span: 'all', color: UI, delay: 1 }],
    [{ t: 'spin', at: [0, 0], span: 'all', rad: 1.2, deg: 180, color: UI, label: '180° 회전 → 턴디시 바로 위로' }],
    [{ t: 'pulse', at: [0, 0.75], span: [1, 2], color: '#ffd08a' }, S('metal', [0, 0.8], [0, -1], { span: [1, 2], spread: 0.05, toSpread: 0.08, delay: 0.6, label: '보호관(쉬라우드)으로 공기 차단', labelAt: [1.2, -0.4] })],
  ],
  tundish: [
    [S('metal', [0, 1.6], [0, -0.2], { span: 'all', spread: 0.05, toSpread: [0.5, 0.1], label: '래들에서 용강 유입', labelAt: [1.2, 1.3] }), B([-1.4, 0], '약 60톤', '담아 두는 양 (버퍼)', 'weight', { span: 'all', count: true, delay: 0.8 })],
    [A([-1, -0.2], [1, -0.2], '#ffb54a', '둑을 지나며 흐름이 느려짐', { span: 'all', speed: 0.4, labelAt: [1.2, -0.2] }), S('dust', [0, -0.4], [0, 0.75], { span: 'all', spread: [0.8, 0.2], toSpread: [0.8, 0.05], delay: 1, label: '가벼운 불순물 ↑ → 덮개 분말에 흡수', labelAt: [-1.2, 0.9] })],
    [S('metal', [0, -0.3], [0, -1.3], { span: 'all', spread: 0.05, toSpread: 0.05, label: '침지 노즐 → 주형 (일정한 양)', labelAt: [1.2, -1] }), A([1.5, -0.3], [1.5, -1.3], '#ffb54a', null, { span: 'all', delay: 0.6 })],
    [{ t: 'pulse', at: [0, 0], color: '#ffa04a' }, T([1.2, 0], '쇳물 아래에서 주형으로', { delay: 0.6 })],
  ],
  cc_mold: [
    [S('metal', [0, 1.6], [0, 0.1], { span: 'all', spread: 0.05, toSpread: [0.6, 0.2], label: '침지 노즐로 용강 유입', labelAt: [1.2, 1.3] }), T([-1.2, 0.85], '표면은 몰드 파우더로 덮음', { span: 'all', delay: 1 })],
    [G('#4a2a20', '#ffb54a', { axis: 'r', span: 'all', dur: 3 }), S('water', [-1.1, 1], [-1.1, -1], { span: 'all', spread: [0.03, 0.05], n: 40 }), S('water', [1.1, 1], [1.1, -1], { span: 'all', spread: [0.03, 0.05], n: 40, label: '구리 벽 속 냉각수', labelAt: [1.3, 0.5] }), T([-1.3, -0.3], '벽에 닿은 겉면부터 굳음 (쉘)', { span: 'all', delay: 1.5 })],
    [{ t: 'shake', span: 'all', amp: 0.03, hz: 2.5 }, A([1.6, -0.4], [1.6, 0.4], WHITE, null, { span: 'all' }), A([1.9, 0.4], [1.9, -0.4], WHITE, '위아래로 진동', { span: 'all', labelAt: [2, 0] }), T([-1.2, 0], '녹은 파우더 = 윤활유', { span: 'all', delay: 1 })],
    [G('#4a2a20', '#ffb54a', { axis: 'r', span: 'all', dur: 1.2 }), B([-1.4, -0.4], '쉘 10~20mm', '겉만 굳고 속은 아직 액체', 'ruler', { span: 'all', delay: 0.8 }), { t: 'pulse', at: [0.9, -0.9], span: 'all', color: '#ff5a3a', label: '쉘이 터지면 큰 사고(브레이크아웃)', delay: 1.8 }],
  ],
  secondary_cooling: [
    [S('water', [-2.2, 0.6], [-0.9, 0], { span: 'all', spread: [0.05, 0.3], n: 60 }), S('water', [2.2, 0.6], [0.9, 0], { span: 'all', spread: [0.05, 0.3], n: 60, label: '롤 사이 노즐: 물·공기 분사', labelAt: [2.2, 1] }), G('#4a2a20', '#ffb54a', { axis: 'r', span: 'all', dur: 3 }), S('steam', [0, 0.9], [0, 1.8], { span: 'all', delay: 1 })],
    [A([-2.4, 0.2], [-1.05, 0.2], ROLL, null, { span: 'all' }), A([2.4, 0.2], [1.05, 0.2], ROLL, '롤이 양면을 받침', { span: 'all', labelAt: [2.4, 0.2] }), T([-1.2, -0.6], '속은 아직 액체 → 부풀지 않게', { span: 'all', delay: 1 })],
    [G('#ffb54a', '#6a2a20', { span: 'all', dur: 2.4 }), { t: 'pulse', at: [0, -0.55], span: 'all', color: UI, label: '완전 응고점 (품질의 핵심)', delay: 2.2 }, T([-1.2, 0.5], '아래로 갈수록 액체 중심이 줄어듦', { span: 'all', delay: 0.8 })],
    [{ t: 'pulse', at: [0, 0], color: UI }, T([1.2, 0], '중심까지 다 굳음', { delay: 0.6 })],
  ],
  withdrawal_straightener: [
    [A([0, 1.6], [0, -0.6], WHITE, '구동 롤이 끌어냄', { w: 1.2, labelAt: [1.2, 1.2] }), B([-1.4, 0], '분당 1~2m', '이 속도 = 주조 속도', 'gauge', { delay: 0.8 })],
    [A([-0.6, 1.4], [0, 0], WHITE, null), A([0, 0], [2, -0.3], UI, '곡선을 조금씩 수평으로 폄', { delay: 0.8, labelAt: [2.1, -0.3] }), T([-1.2, -0.6], '덜 굳었을 때 무리하면 내부 균열', { delay: 1.6 })],
    [A([-1, 0], [2.6, 0], WHITE, '절단기 쪽으로 배출', { w: 1.3, labelAt: [1.4, 0.7] })],
  ],
  torch_cutter: [
    [A([0, 1.4], [1, 1.4], UI, null, { w: 0.7 }), A([0, 1.4], [-1, 1.4], UI, '주문 길이에 맞춰 자를 위치', { w: 0.7, labelAt: [0, 1.9] }), { t: 'pulse', at: [1, 0], color: UI, delay: 1 }],
    [S('spark', [0, 0.8], [0, -2], { spread: [0.06, 0.05], toSpread: [0.6, 0.2], n: 90, label: '토치 불꽃 (약 3,000℃)', labelAt: [1.2, 0.2] }), A([-1.4, 1.8], [1.4, 1.8], WHITE, '주편과 같은 속도로 따라가며 자름', { delay: 0.6, labelAt: [0, 2.3] })],
    [A([-1, 0], [2.6, 0], WHITE, '배출 롤러 → 냉각대', { w: 1.3, labelAt: [1.4, 0.7] }), { t: 'pulse', at: [0, 0.6], color: '#ffd08a', label: '번호 표시', delay: 1 }],
    [G('#ff8a3a', '#6b6f76', { span: 'all', dur: 2.6 }), B([-1.4, 0], '20~30톤', '슬라브 한 장 · 두께 약 250mm', 'weight', { span: 'all', anim: 'drop', press: true, delay: 1.2 })],
  ],
  reheating_furnace: [
    [A([-3, 0], [-0.6, 0], ROLL, '슬라브를 한 장씩 넣음', { w: 1.3, labelAt: [-2.2, 0.8] }), T([1.2, 0], '바닥 빔이 앞으로 옮겨 줌', { delay: 1 })],
    [S('heat', [0, -2.2], [0, 0.6], { spread: [0.6, 0.2], label: '뒤에서 넘어온 연소가스로 서서히 데움', labelAt: [1.2, -1] })],
    [S('flame', [-1.4, 0], [-0.3, 0.2], { spread: [0.05, 0.5], n: 60 }), S('flame', [1.4, 0], [0.3, 0.2], { spread: [0.05, 0.5], n: 60, label: '버너로 강하게 가열', labelAt: [1.5, 0.6] }), B([-1.6, 0.6], '1,250~1,300℃', '겉면을 목표 온도까지', 'thermo', { delay: 1 })],
    [G('#ffd08a', '#ff8a2a', { axis: 'r', dur: 2.6 }), B([-1.4, 0], '약 2~3시간', '속까지 온도를 고르게', 'clock', { delay: 0.6 }), A([0.8, -0.2], [3, -0.2], '#ffa04a', '꺼내서 압연으로', { delay: 2, labelAt: [2.2, -0.8] })],
  ],
  descaler: [
    [S('flake', [0, 0], [0, 0], { spread: [0.85, 0.7], toSpread: [0.85, 0.7], n: 70, label: '표면을 덮은 산화철 껍질(스케일)', labelAt: [1.2, 0.6] })],
    [S('water', [0, 2.2], [0, 0.2], { spread: [0.8, 0.05], n: 90 }), B([-1.4, 0.4], '150~200 bar', '고압수를 세게 분사', 'gauge', { delay: 0.6, color: AIR }), S('flake', [0, 0], [2.6, 1.2], { spread: [0.8, 0.3], delay: 0.8, label: '껍질이 깨져 날아감', labelAt: [2.6, 1.6] })],
    [{ t: 'pulse', at: [0, 0.6], color: '#ffd08a' }, T([-1.2, 0.4], '맨 강 표면이 드러남'), A([0.6, 0], [3, 0], '#ffa04a', '압연기로', { delay: 0.8, labelAt: [2.2, -0.6] })],
  ],
  roughing_mill: [
    [A([-2.6, 0], [-1.05, 0], ROLL, null, { w: 1.3 }), A([2.6, 0], [1.05, 0], ROLL, '세로 롤(에저)이 폭을 맞춤', { w: 1.3, labelAt: [2.6, 0.6] }), { t: 'squash', sx: 0.85, delay: 0.8 }],
    [A([0, 2.2], [0, 1.05], ROLL, null, { w: 1.3 }), A([0, -2.2], [0, -1.05], ROLL, '큰 롤이 위아래로 누름', { w: 1.3, labelAt: [1.2, -1.8] }), { t: 'squash', sy: 0.55, sx: 1.25, dur: 3, delay: 0.8 }, A([-1.4, 0], [1.4, 0], '#ffa04a', null, { delay: 0.8, w: 0.8, speed: 2 }), B([-1.5, 0.6], '5~7회 왕복', '앞뒤로 오가며 두께를 줄임', 'cycle', { delay: 1.2 })],
    [{ t: 'squash', sy: 0.4, sx: 1.5, dur: 2 }, B([-1.6, 0], '250 → 35mm', '두께가 확 줄어듦', 'ruler', { delay: 0.6 }), T([1.6, 0], '길이 약 7배로 늘어남', { delay: 1.4 })],
  ],
  finishing_mill: [
    [S('spark', [1, 0], [1.4, -0.6], { spread: [0.05, 0.3], toSpread: [0.4, 0.4], n: 50 }), T([1.3, 0.5], '앞뒤 끝의 고르지 않은 부분을 잘라냄', { delay: 0.6 })],
    [A([0, 2], [0, 1.05], ROLL, null), A([0, -2], [0, -1.05], ROLL, 'F1~F7: 매번 조금씩 누름', { labelAt: [1.2, -1.6] }), { t: 'squash', sy: 0.6, sx: 1.2, dur: 3, delay: 0.6 }, A([-1.4, 0], [1.6, 0], '#ffa04a', '뒤로 갈수록 빨라짐', { delay: 1, speed: 3, labelAt: [-1.2, 0.6] })],
    [{ t: 'pulse', at: [1.5, 0], color: UI, label: '두께 센서' }, A([1.5, 0.5], [0.2, 1.6], UI, '롤 간격을 자동으로 고침', { delay: 1.2, labelAt: [-1.2, 1.6] })],
    [B([-1.6, 0], '850~900℃', '사상 온도가 조직·성질을 결정', 'thermo', { delay: 0.4 })],
  ],
  runout_table: [
    [A([-1.8, 0], [2.4, 0], '#ffa04a', '긴 롤러 테이블 위를 빠르게 달림', { w: 1.3, speed: 4, labelAt: [1.2, 0.8] })],
    [G('#ffa04a', '#5a3a30', { span: 'all', dur: 3, marks: [[0.8, '약 870℃'], [-0.8, '약 600℃']] }), S('water', [0, 2.2], [0, 0.4], { spread: [1, 0.05], n: 110, label: '위아래로 물 커튼 (층류 냉각)', labelAt: [-1.2, 1.8] }), S('water', [0, -2.2], [0, -0.4], { spread: [1, 0.05], n: 70 }), S('steam', [0, 0.4], [0, 2.4], { delay: 1, n: 30 })],
    [B([-1.6, 0], '550~650℃', '권취 온도에 정확히 맞춤', 'thermo', { delay: 0.4 }), A([0.8, 0], [3, 0], '#9a5a48', '권취기로', { delay: 1, labelAt: [2.2, 0.6] })],
  ],
  coiler: [
    [A([-3, 0.8], [-0.3, 0], '#9a5a48', '핀치 롤이 앞끝을 잡아 맨드릴로', { w: 1.3, labelAt: [-2, 1.4] })],
    [{ t: 'spin', at: [0, 0], rad: 0.7, color: '#ffa04a', label: '맨드릴이 돌며 단단히 감음', speed: 1.6 }],
    [{ t: 'pulse', at: [0, 0], color: UI, label: '묶고 번호를 붙임' }, A([0.8, 0], [3, 0], ROLL, '코일 배출', { delay: 1, labelAt: [2.2, 0.6] })],
    [G('#9a5a48', '#5c6068', { span: 'all', dur: 2.6 }), B([-1.4, 0], '약 20톤', '길이 1km가 넘는 열연 코일', 'weight', { span: 'all', anim: 'drop', press: true, delay: 1.2 })],
  ],
};

export class StepFx {
  constructor(host) { this.h = host; this.g = null; this.items = []; this.els = []; this.added = []; this.restore = []; this.mats = []; }
  has(id) { return !!STEP_FX[id]; }
  // e: 장면의 설비 객체(e.id, e.interior), idx: 단면 층 번호. 둘 중 하나가 없으면 지운다.
  play(e, idx) {
    this.clear();
    const spec = e && idx != null ? STEP_FX[e.id]?.[idx] : null, L = this.h.layerItems;
    if (!spec || !L?.length || !this.h.interior) return false;
    if (!document.getElementById('sfx-style')) { const st = document.createElement('style'); st.id = 'sfx-style'; st.textContent = CSS; document.head.appendChild(st); }
    this.h.interior.updateMatrixWorld(true);
    this.U = e.interior.r; this.g = new THREE.Group(); this.g.name = 'STEP_FX'; this.h.scene.add(this.g); this.t0 = performance.now();
    spec.forEach(o => { const fn = this['_' + o.t]; if (fn) fn.call(this, o, this._frame(o.span, idx)); });
    return true;
  }
  clear() {
    this.items = []; this.els.forEach(el => el.remove()); this.els = [];
    this.added.forEach(o => o.parent?.remove(o)); this.added = [];
    this.restore.reverse().forEach(fn => fn()); this.restore = [];
    this.mats.forEach(m => m.dispose()); this.mats = [];
    if (this.g) { this.h.scene.remove(this.g); this.g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); this.g = null; }
    this.h._dirty = true;
  }
  tick(now) {
    if (!this.g) return false;
    const t = (now - this.t0) / 1000 - START; this.items.forEach(it => it(t));
    const h = this.h, w = h.clientWidth, H = h.clientHeight, v = V();
    this.els.forEach(el => { v.copy(el._pos).project(h.camera); const vis = v.z < 1; el.style.display = vis ? '' : 'none'; if (vis) { el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px'; el.style.top = ((1 - v.y) / 2 * H).toFixed(1) + 'px'; } });
    return true;
  }
  _frame(span, idx) {
    const L = this.h.layerItems, n = L.length, [a, b] = span === 'all' ? [0, n - 1] : Array.isArray(span) ? span : [idx, idx];
    const box = new THREE.Box3(), lo = Math.max(0, a), hi = Math.min(n - 1, b); for (let i = lo; i <= hi; i++) box.expandByObject(L[i].m);
    const c = box.getCenter(V()), s = box.getSize(V());
    return { c, hx: Math.max(s.x / 2, 0.05), hy: Math.max(s.y / 2, 0.05), a: lo, b: hi };
  }
  _p(f, uv) { return V(f.c.x + uv[0] * f.hx, f.c.y + uv[1] * f.hy, f.c.z); }
  _layers(f) { const out = []; for (let i = f.a; i <= f.b; i++) out.push(this.h.layerItems[i].m); return out; }
  _tex() { if (!this._dot) { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); this._dot = new THREE.CanvasTexture(c); } return this._dot; }
  _scale() { return this.h.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.h.camera.fov || 42) / 2)); }
  _basic(color) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0, depthTest: false, depthWrite: false }); }
  // 화면 글자: 3D 점에 붙는 DOM. align은 점 기준 어느 쪽에 놓을지(c 가운데, l 왼쪽, r 오른쪽, t 위, b 아래)
  _dom(cls, html, pos, align, delay, color) {
    const el = document.createElement('div'), dark = !!this.h.dark; el.className = 'sfx ' + cls; el._pos = pos;
    el.style.setProperty('--c', color); el.style.setProperty('--bg', dark ? 'rgba(12,16,22,.84)' : 'rgba(255,255,255,.93)'); el.style.setProperty('--fg', dark ? '#f3f5f8' : '#14202c');
    el.innerHTML = `<div class="sfx-in" style="transform:${ALIGN[align] || ALIGN.c}"><div class="sfx-body" style="animation-delay:${(START + delay).toFixed(2)}s">${html}</div></div>`;
    el.style.display = 'none'; this.h.labels.appendChild(el); this.els.push(el); return el;
  }
  _label(text, pos, align, color, delay) { return this._dom('sfx-tag', text, pos, align, delay, color || UI); }
  _tag(o, f) { this._label(o.text, this._p(f, o.at), o.align || sideOf(o.at), o.color, o.delay || 0); }
  _badge(o, f) {
    const d = o.delay || 0, svg = o.icon ? `<svg viewBox="0 0 24 24">${ICON[o.icon]}</svg>` : '';
    const el = this._dom('sfx-badge' + (o.anim === 'drop' ? ' drop' : ''), `${svg}<div><b>${o.text}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>`, this._p(f, o.at), o.align || sideOf(o.at), d, o.color || '#ffb03a');
    const m = o.count && o.text.match(/\d[\d,]*/);
    if (m) { const b = el.querySelector('b'), N = +m[0].replace(/,/g, ''); this.items.push((t) => { b.textContent = o.text.replace(m[0], Math.round(N * ease((t - d) / 1.2)).toLocaleString()); }); }
    if (o.press) this._press(f, d + 0.44); // 무게 배지가 내려앉는 순간 층이 눌렸다 돌아온다
  }
  _press(f, at) {
    const ms = this._layers(f), s0 = ms.map(m => m.scale.clone());
    this.restore.push(() => ms.forEach((m, i) => m.scale.copy(s0[i])));
    this.items.push((t) => { const k = c01((t - at) / 0.45), s = 1 - 0.08 * Math.sin(Math.PI * k) * (1 - k * 0.5); ms.forEach((m, i) => m.scale.set(s0[i].x * (2 - s), s0[i].y * s, s0[i].z)); });
  }
  _arrow(o, f) {
    const A0 = this._p(f, o.from), B0 = this._p(f, o.to), dir = B0.clone().sub(A0), len = dir.length(); if (len < 1e-4) return; dir.normalize();
    const r = this.U * 0.045 * (o.w || 1), hl = Math.min(len * 0.45, r * 6), sl = len - hl, d = o.delay || 0, dur = o.dur || 1;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir), c1 = new THREE.Color(o.color || WHITE), c2 = new THREE.Color(o.color2 || o.color || WHITE);
    const shaft = (rad, bk, ro) => { const mat = new THREE.ShaderMaterial({ uniforms: { c1: { value: c1 }, c2: { value: c2 }, t: { value: 0 }, grow: { value: 0 }, op: { value: 0 }, rep: { value: Math.max(1, sl / (r * 5)) }, bk: { value: bk } }, vertexShader: VS_UV, fragmentShader: FS_ARROW, transparent: true, depthTest: false, depthWrite: false });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, sl, 12, 1, true), mat); m.quaternion.copy(q); m.position.copy(A0).addScaledVector(dir, sl / 2); m.renderOrder = ro; this.g.add(m); return mat; };
    const back = shaft(r * 1.9, 1, 30), front = shaft(r, 0, 31), hm = this._basic(o.color2 || o.color || WHITE);
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, hl, 16), hm); head.quaternion.copy(q); head.renderOrder = 32; this.g.add(head);
    this.items.push((t) => { const g = ease((t - d) / dur), op = c01((t - d) / 0.25); [back, front].forEach(m => { m.uniforms.grow.value = g; m.uniforms.op.value = op; m.uniforms.t.value = t * (o.speed || 1); }); hm.opacity = g > 0 ? op : 0; head.position.copy(A0).addScaledVector(dir, sl * g + hl / 2); });
    if (o.label) { const al = o.labelAt ? sideOf(o.labelAt) : Math.abs(dir.x) > Math.abs(dir.y) ? (dir.x > 0 ? 'r' : 'l') : (dir.y > 0 ? 't' : 'b'); this._label(o.label, o.labelAt ? this._p(f, o.labelAt) : B0, al, o.color2 || o.color, d + dur * 0.7); }
  }
  // 온도 그라데이션: 층 모양을 그대로 덮어 위→아래(axis 'y') 또는 가장자리→가운데(axis 'r')로 색이 번진다
  _grad(o, f) {
    const d = o.delay || 0, dur = o.dur || 1.6;
    const mat = new THREE.ShaderMaterial({ uniforms: { cA: { value: new THREE.Color(o.from) }, cB: { value: new THREE.Color(o.to) }, yT: { value: f.c.y + f.hy }, yB: { value: f.c.y - f.hy }, cx: { value: f.c.x }, hx: { value: f.hx }, rv: { value: 0 }, ax: { value: o.axis === 'r' ? 1 : 0 }, op: { value: 0 } }, vertexShader: VS_W, fragmentShader: FS_GRAD, transparent: true, depthTest: false, depthWrite: false });
    this.mats.push(mat);
    this._layers(f).forEach(root => root.traverse(m => { if (!m.isMesh || m.userData.layerIdx === undefined) return; const ov = new THREE.Mesh(m.geometry, mat); ov.renderOrder = 14; ov.raycast = () => {}; m.add(ov); this.added.push(ov); }));
    this.items.push((t) => { mat.uniforms.rv.value = ease((t - d) / dur); mat.uniforms.op.value = c01((t - d) / 0.3); });
    (o.marks || []).forEach(([v, text]) => { const k = (1 - v) / 2, col = '#' + new THREE.Color(o.from).lerp(new THREE.Color(o.to), k).getHexString(); this._dom('sfx-mark', text, this._p(f, [1.12, v]), 'r', d + dur * k, col); });
  }
  // 층층이 쌓기: 두 색 띠가 위에서 떨어져 아래부터 차곡차곡 쌓인다
  _bands(o, f) {
    const n = o.n || 6, bh = (2 * f.hy) / n, cols = o.colors || ['#2b2d31', '#a0603a'];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * f.hx * 0.92, bh * 0.88), this._basic(cols[i % cols.length])); m.renderOrder = 15; this.g.add(m);
      const y1 = f.c.y - f.hy + (i + 0.5) * bh, y0 = f.c.y + f.hy + bh * 2, at = (o.delay || 0) + i * 0.32;
      this.items.push((t) => { const k = c01((t - at) / 0.45); m.material.opacity = k > 0 ? 0.95 : 0; m.position.set(f.c.x, y0 + (y1 - y0) * (k * k), f.c.z); });
    }
  }
  _stream(o, f) {
    const K = KIND[o.kind] || KIND.gas, n = o.n || K[4], pos = new Float32Array(n * 3), kk = new Float32Array(n).fill(-1), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('k', new THREE.BufferAttribute(kk, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { c1: { value: new THREE.Color(o.color || K[0]) }, c2: { value: new THREE.Color(o.color2 || K[1]) }, map: { value: this._tex() }, size: { value: this.U * 0.12 * K[2] * (o.size || 1) }, scale: { value: 600 }, op: { value: 0.95 } }, vertexShader: VS_PT, fragmentShader: FS_PT, transparent: true, depthTest: false, depthWrite: false, blending: K[6] && this.h.dark ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 33; this.g.add(pts);
    const two = (s, dflt) => Array.isArray(s) ? s : [s ?? dflt, s ?? dflt], [sx, sy] = two(o.spread, 0.25), [ex, ey] = two(o.toSpread ?? o.spread, 0.25);
    const S0 = this._p(f, o.from), E0 = this._p(f, o.to || o.from), dir = E0.clone().sub(S0), side = dir.lengthSq() > 1e-8 ? V(-dir.y, dir.x, 0).normalize() : V(1, 0, 0);
    const life = K[3] * (o.life || 1), mode = K[5], wob = this.U * 0.06, d = o.delay || 0, rnd = () => Math.random() * 2 - 1;
    const P = Array.from({ length: n }, (_, i) => ({ ph: (i + Math.random()) / n, cyc: -1, s: V(), e: V(), w: Math.random() * 6.28 }));
    this.items.push((t) => {
      const tt = t - d;
      for (let i = 0; i < n; i++) { const p = P[i], x = tt / life - p.ph; if (x < 0) { kk[i] = -1; continue; }
        const cyc = Math.floor(x), k = x - cyc; if (cyc !== p.cyc) { p.cyc = cyc; p.s.set(S0.x + rnd() * sx * f.hx, S0.y + rnd() * sy * f.hy, S0.z); p.e.set(E0.x + rnd() * ex * f.hx, E0.y + rnd() * ey * f.hy, E0.z); }
        const m = mode === 0 ? 1 - (1 - k) * (1 - k) : mode === 1 ? k * k : k, wb = Math.sin(k * 5 + p.w) * wob;
        pos[i * 3] = p.s.x + (p.e.x - p.s.x) * m + side.x * wb; pos[i * 3 + 1] = p.s.y + (p.e.y - p.s.y) * m + side.y * wb; pos[i * 3 + 2] = p.s.z; kk[i] = k; }
      geo.attributes.position.needsUpdate = true; geo.attributes.k.needsUpdate = true; mat.uniforms.scale.value = this._scale();
    });
    if (o.label) { const at = o.labelAt || o.to || o.from; this._label(o.label, this._p(f, at), sideOf(at), o.color || K[1], d + 0.4); }
  }
  // 회전: 원호 화살표가 돈다(권취, 터릿 회전, 교반)
  _spin(o, f) {
    const c = this._p(f, o.at || [0, 0]), R = (o.rad || 0.6) * f.hx, arc = (o.deg || 300) * Math.PI / 180, tube = this.U * 0.05 * (o.w || 1), d = o.delay || 0, m = this._basic(o.color || UI);
    const grp = new THREE.Group(); grp.position.copy(c); this.g.add(grp);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 8, 64, arc), m); ring.renderOrder = 31; grp.add(ring);
    const head = new THREE.Mesh(new THREE.ConeGeometry(tube * 2.8, tube * 6, 16), m); head.position.set(Math.cos(arc) * R, Math.sin(arc) * R, 0); head.rotation.z = arc; head.renderOrder = 32; grp.add(head);
    if (o.dir === -1) grp.scale.x = -1;
    this.items.push((t) => { m.opacity = c01((t - d) / 0.3); grp.rotation.z = Math.max(0, t - d) * (o.speed || 1.2); });
    if (o.label) this._label(o.label, c.clone().add(V(0, R + tube * 4, 0)), 't', o.color, d + 0.3);
  }
  // 지점 강조: 퍼져 나가는 고리
  _pulse(o, f) {
    const c = this._p(f, o.at || [0, 0]), R = this.U * 0.16, d = o.delay || 0, col = o.color || UI;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(R * 0.5, 24), this._basic(col)); dot.position.copy(c); dot.renderOrder = 33; this.g.add(dot);
    const rings = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(R * 0.8, R, 48), this._basic(col)); m.position.copy(c); m.renderOrder = 32; this.g.add(m); return m; });
    this.items.push((t) => { const tt = t - d; dot.material.opacity = c01(tt / 0.3); rings.forEach((m, i) => { const k = tt < 0 ? 0 : ((tt / 1.5) + i / 3) % 1; m.scale.setScalar(1 + k * 2.6); m.material.opacity = tt < 0 ? 0 : (1 - k) * 0.9; }); });
    if (o.label) this._label(o.label, c.clone().add(V(R * 2.2, 0, 0)), 'r', col, d + 0.3);
  }
  // 두께 줄이기: 층을 위아래로 누르고(sy) 옆으로 늘린다(sx)
  _squash(o, f) {
    const ms = this._layers(f), s0 = ms.map(m => m.scale.clone()), d = o.delay || 0, dur = o.dur || 2;
    this.restore.push(() => ms.forEach((m, i) => m.scale.copy(s0[i])));
    this.items.push((t) => { const k = ease((t - d) / dur), sx = 1 + ((o.sx ?? 1) - 1) * k, sy = 1 + ((o.sy ?? 1) - 1) * k; ms.forEach((m, i) => m.scale.set(s0[i].x * sx, s0[i].y * sy, s0[i].z)); });
  }
  _shake(o, f) {
    const ms = this._layers(f), p0 = ms.map(m => m.position.clone()), amp = (o.amp || 0.03) * 2 * f.hy, d = o.delay || 0;
    this.restore.push(() => ms.forEach((m, i) => m.position.copy(p0[i])));
    this.items.push((t) => { const y = t > d ? Math.sin((t - d) * (o.hz || 2.5) * Math.PI * 2) * amp : 0; ms.forEach((m, i) => { m.position.y = p0[i].y + y; }); });
  }
}
