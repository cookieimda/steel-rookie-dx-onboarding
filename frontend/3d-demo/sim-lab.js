// 3D 시뮬레이션 실습(v4 화면): ① 조업 실험(What-if)과 ② 이상 상황 훈련. 원인과 결과를 3D 위에 같이 보여 준다.
// <steel-scene>(scene_v3.js)을 고치지 않고 바깥에서 붙는다(learn-hud.js와 같은 방식: el.scene·el.zones·el._frame).
// - 조업 실험: 조건을 바꾸면 원인 설비 → 고로 → 출선구로 흐르는 입자, 출선구 쇳물 빛(온도 색), 값 이름표, 경고 링, 다음 공정(제강)으로 이어지는 흐름.
//   서버 POST /api/lab/whatif가 원인별 효과(effects)와 다음 공정 영향(downstream)을 준다(교육용 간이 모델).
// - 이상 상황 훈련: 설비에 이상 징후(붉은 링·계기 값) → ① 범위를 벗어난 값 찾기 → ② 원인(맞히면 원인 → 결과 사슬이 3D에 흐른다)
//   → ③ 조치(맞히면 값이 정상으로 돌아오고 링이 초록, 다음 공정 영향 흐름). 서버는 /api/lab/faults(content/faults/faults.json).
// 로그인 토큰이 없으면 붙지 않는다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const TOKEN_KEY = 'st-rookie-token';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패(${res.status})`);
  return data;
}
const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
const btn = (text, onClick, cls = 'sl-btn') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

const SLIDERS = [
  ['sinter_pct', '소결광 비율', '%', 0, 100, 5], ['pellet_pct', '펠릿 비율', '%', 0, 100, 5], ['lump_pct', '괴광 비율', '%', 0, 100, 5],
  ['coke_kg', '코크스', 'kg/t', 250, 550, 10], ['pci_kg', '미분탄', 'kg/t', 0, 250, 10],
  ['blast_temp_c', '송풍 온도', '℃', 900, 1300, 10], ['oxygen_pct', '산소 부화', '%p', 0, 10, 0.5], ['limestone_kg', '석회석', 'kg/t', 0, 150, 5],
];
// 조사: 받침이 있으면 이·은, 없으면 가·는(숫자·기호로 끝나면 받침 없음으로 본다)
const batchim = (w) => { const t = String(w).replace(/\s*\([^)]*\)\s*$/, '').trim(); const c = t.charCodeAt(t.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; }; // 끝의 (S)·(Si) 같은 괄호는 빼고 본다
const iGa = (w) => `${w}${batchim(w) ? '이' : '가'}`, eunNeun = (w) => `${w}${batchim(w) ? '은' : '는'}`, eulReul = (w) => `${w}${batchim(w) ? '을' : '를'}`;
const SECTION = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const fmt = (n, d = 0) => Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (n, d = 0, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n), d)}${unit}`;
/** 용선 온도 → 빛 색(어두운 빨강 → 주황 → 밝은 노랑). */
const tempColor = (t) => { const k = Math.min(1, Math.max(0, (t - 1380) / 180)); return new THREE.Color().setHSL(0.02 + 0.12 * k, 1, 0.35 + 0.3 * k); };

function injectStyle() {
  if (document.getElementById('sl-style')) return;
  const s = document.createElement('style'); s.id = 'sl-style';
  s.textContent = `
    .sl-launch { position: fixed; right: 16px; bottom: 96px; z-index: 61; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: min(620px, calc(100vw - 32px)); }
    .sl-launch button { height: 42px; padding: 0 16px; border: 0; border-radius: 999px; background: rgba(14,24,40,.92); color: #eef2f7; font: 600 15px/1 "Pretendard", sans-serif; cursor: pointer; box-shadow: 0 8px 20px rgba(0,0,0,.3); }
    .sl-launch button[aria-pressed="true"] { background: #ff9e64; color: #1a0b03; }
    .sl-panel { position: fixed; right: 16px; top: 84px; bottom: var(--sl-panel-bottom, 152px); min-height: min(240px, calc(100vh - 100px)); z-index: 62; width: min(340px, calc(100vw - 32px)); overflow-y: auto; padding: 16px; border-radius: 16px; background: rgba(12,20,34,.95); color: #eef2f7; font: 15px/1.55 "Pretendard", sans-serif; box-shadow: 0 18px 40px rgba(0,0,0,.4); display: flex; flex-direction: column; gap: 12px; }
    .sl-panel h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    .sl-panel h3 span { flex: 1; }
    .sl-muted { color: #a9b6c8; font-size: 14px; }
    .sl-panel.compact .sl-hide { display: none; }
    .sl-box { padding: 12px; border-radius: 12px; background: rgba(255,255,255,.06); display: flex; flex-direction: column; gap: 8px; }
    .sl-btn { border: 0; border-radius: 10px; height: 36px; padding: 0 14px; background: #ff9e64; color: #1a0b03; font: 700 15px/1 "Pretendard", sans-serif; cursor: pointer; }
    .sl-btn.ghost { background: rgba(255,255,255,.1); color: #eef2f7; font-weight: 600; }
    .sl-s { display: grid; grid-template-columns: 82px 1fr 70px; gap: 8px; align-items: center; font-size: 14px; }
    .sl-s input { width: 100%; accent-color: #ff9e64; }
    .sl-s b { text-align: right; font-family: "JetBrains Mono", monospace; font-size: 13px; }
    .sl-out { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .sl-out div { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); display: flex; flex-direction: column; }
    .sl-out small { color: #a9b6c8; } .sl-out b { font-size: 18px; } .sl-out i { font-style: normal; font-size: 13px; }
    .sl-up { color: #ff8a65; } .sl-down { color: #7fb2ff; } .sl-ok { color: #6fcf97; } .sl-bad { color: #ff6b6b; }
    .sl-cause { padding: 10px 12px; border-radius: 10px; background: rgba(255,158,100,.1); border-left: 3px solid #ff9e64; font-size: 15px; }
    .sl-next { padding: 10px 12px; border-radius: 10px; background: rgba(255,107,107,.1); border-left: 3px solid #ff6b6b; font-size: 15px; }
    .sl-cause.sl-on, .sl-next.sl-on { box-shadow: 0 0 0 2px #2bd4b4; } .sl-cause.sl-dim, .sl-next.sl-dim { opacity: .45; }
    .sl-tour { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .sl-link { width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.06); color: inherit; font: 14px/1.4 ui-monospace, monospace; }
    .sl-scenes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sl-read { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.06); border: 1px solid transparent; text-align: left; color: inherit; font: inherit; cursor: pointer; }
    .sl-read:disabled { cursor: default; }
    .sl-read.bad { border-color: #ff6b6b; background: rgba(255,107,107,.12); } .sl-read.fixed { border-color: #6fcf97; }
    .sl-read b { font-family: "JetBrains Mono", monospace; }
    .sl-gauge { grid-column: 1 / -1; position: relative; height: 8px; border-radius: 4px; background: rgba(255,255,255,.12); }
    .sl-gauge .band { position: absolute; top: 0; bottom: 0; background: rgba(111,207,151,.45); border-radius: 4px; }
    .sl-gauge .mark { position: absolute; top: -4px; width: 4px; height: 16px; margin-left: -2px; border-radius: 2px; background: #fff; transition: left 1.2s ease; }
    .sl-opt { text-align: left; padding: 9px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.18); background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .sl-opt.wrong { border-color: #ff6b6b; opacity: .7; } .sl-opt.right { border-color: #6fcf97; background: rgba(111,207,151,.14); }
    .sl-steps { display: flex; gap: 6px; } .sl-steps span { flex: 1; text-align: center; padding: 6px; border-radius: 8px; background: rgba(255,255,255,.06); font-size: 13px; color: #a9b6c8; }
    .sl-steps span.on { background: #ff9e64; color: #1a0b03; font-weight: 700; } .sl-steps span.done { color: #6fcf97; }
    .sl-tag { position: fixed; z-index: 55; transform: translate(-50%, -100%); padding: 4px 9px; border-radius: 8px; font: 700 13px/1.3 "Pretendard", sans-serif; color: #fff; background: rgba(14,24,40,.88); border: 1px solid rgba(255,255,255,.25); pointer-events: none; white-space: nowrap; }
    .sl-tag.warn { border-color: #ff6b6b; color: #ffd0d0; } .sl-tag.ok { border-color: #6fcf97; color: #d6ffe6; } .sl-tag.hot { border-color: #ff9e64; color: #ffe0c2; } .sl-tag.cold { border-color: #7fb2ff; color: #d8e7ff; }
    .sl-var { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 4px 6px; border: 0; border-radius: 8px; background: transparent; color: inherit; font: 14px/1.4 "Pretendard", sans-serif; text-align: left; cursor: pointer; }
    .sl-var:hover, .sl-var[aria-pressed="true"] { background: rgba(43,212,180,.14); }
    .sl-var:focus-visible, .sl-opt:focus-visible, .sl-btn:focus-visible { outline: 2px solid #2bd4b4; outline-offset: 2px; }
    .sl-card { border: 1px solid rgba(43,212,180,.5); }
    .sl-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .sl-panel h3:focus { outline: none; } .sl-panel h3:focus-visible, .sl-read:focus-visible, .sl-launch button:focus-visible { outline: 2px solid #2bd4b4; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .sl-shake { animation: none !important; } .sl-panel, .sl-panel * { transition: none !important; scroll-behavior: auto !important; } }
    .sl-shake { animation: slShake .35s; } @keyframes slShake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
    /* hidden이어도 display:flex가 이겨 빈 띠가 보이던 문제 */
    .sl-panel[hidden] { display: none !important; }
    /* 좁은 화면: 실행 버튼이 두 줄로 접히므로 패널 아래 끝을 버튼 묶음 위로 맞춘다(--sl-panel-bottom은 버튼 묶음 높이로 계산) */
    @media (max-width: 740px) { .sl-panel { top: auto; bottom: var(--sl-panel-bottom, 150px); max-height: min(55vh, calc(100vh - var(--sl-panel-bottom, 150px) - 72px)); } .sl-launch { bottom: 120px; } }`;
  document.head.appendChild(s);
}

/** 3D 효과 층: 링·흐름 입자·빛·이름표. 모두 월드 좌표(설비 focus)에 둔다. */
function createFx(scene) {
  const fx = { rings: [], flows: [], glows: [], tags: [] };
  const allEqs = () => Object.values(scene.zones || {}).flatMap((z) => z.eqs || []);
  const eq = (id) => allEqs().find((e) => e.id === id);
  const posOf = (id, lift = 0) => { const e = eq(id); return e ? e.focus.clone().add(new THREE.Vector3(0, lift, 0)) : null; };
  const own = (obj) => { obj.raycast = () => {}; obj.renderOrder = 10; scene.scene.add(obj); return obj; };
  // 흐름 입자: 화면에서 늘 같은 크기(가까이 가도 커지지 않게)로 그리는 점
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const nameOf = (id) => eq(id)?.data?.name || id;
  fx.nameOf = nameOf;

  fx.ring = (id, color, pulse = true) => {
    const e = eq(id); if (!e) return;
    const m = own(new THREE.Mesh(new THREE.RingGeometry(0.84, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
    m.rotation.x = -Math.PI / 2; m.position.set(e.focus.x, 0.12, e.focus.z);
    fx.rings.push({ m, r: Math.max(3, (e.dist || 20) * 0.22), pulse, id });
  };
  fx.setRingColor = (id, color) => { for (const r of fx.rings) if (r.id === id) r.m.material.color.set(color); };
  /** 원인 → 결과 흐름: 두 설비 사이 호를 따라 흐르는 빛 입자와 옅은 선. */
  fx.flow = (fromId, toId, color = 0xff9e64, opt = {}) => {
    const a = posOf(fromId, 1), b = posOf(toId, 1); if (!a || !b) return;
    const mid = a.clone().lerp(b, 0.5); mid.y += 6 + a.distanceTo(b) * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const line = own(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: opt.opacity ?? 0.6, depthWrite: false, fog: false })));
    const n = opt.dots ?? 8, geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const points = own(new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, map: dotTex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false })));
    fx.flows.push({ curve, line, points, n, t0: performance.now() });
  };
  /** 출선구 쇳물 빛: 온도 색과 크기. */
  fx.glow = (id, color, size = 6) => {
    const p = posOf(id, 0.5); if (!p) return;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,.6)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    const sp = own(new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    sp.position.copy(p); sp.scale.setScalar(size);
    fx.glows.push({ sp, size });
  };
  fx.tag = (id, text, tone = '', lift = 6) => {
    const p = posOf(id, lift); if (!p) return;
    const t = el('div', `sl-tag ${tone}`, text); document.body.appendChild(t);
    fx.tags.push({ el: t, p });
  };
  fx.clear = () => {
    for (const r of fx.rings) { scene.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); }
    for (const f of fx.flows) { for (const o of [f.line, f.points]) { scene.scene.remove(o); o.geometry.dispose(); o.material.dispose(); } }
    for (const g of fx.glows) { scene.scene.remove(g.sp); g.sp.material.map.dispose(); g.sp.material.dispose(); }
    for (const t of fx.tags) t.el.remove();
    fx.rings = []; fx.flows = []; fx.glows = []; fx.tags = [];
    scene._dirty = true;
  };
  fx.active = () => fx.rings.length + fx.flows.length + fx.glows.length + fx.tags.length > 0;
  const v = new THREE.Vector3();
  fx.tick = (now) => {
    if (!fx.active()) return;
    const k = (Math.sin(now / 1000 * Math.PI * 2 / 1.4) + 1) / 2;
    for (const r of fx.rings) { r.m.scale.setScalar(r.r * (r.pulse && !reduceMotion ? 1 + 0.12 * k : 1)); r.m.material.opacity = r.pulse ? 0.3 + 0.5 * k : 0.6; }
    for (const f of fx.flows) {
      const t = reduceMotion ? 0 : ((now - f.t0) / 2200) % 1;
      const arr = f.points.geometry.attributes.position;
      for (let i = 0; i < f.n; i++) { const p = f.curve.getPoint((t + i / f.n) % 1); arr.setXYZ(i, p.x, p.y, p.z); }
      arr.needsUpdate = true;
    }
    for (const g of fx.glows) g.sp.scale.setScalar(g.size * (reduceMotion ? 1 : 0.92 + 0.12 * k));
    // 이름표: 월드 → 화면 좌표(장면 요소 기준). 카메라 뒤이거나 화면 밖이면 숨긴다
    const rect = scene.getBoundingClientRect();
    for (const t of fx.tags) {
      v.copy(t.p).project(scene.camera);
      const hidden = v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1 || scene._2d;
      t.el.style.display = hidden ? 'none' : '';
      if (!hidden) { t.el.style.left = `${rect.left + (v.x + 1) / 2 * rect.width}px`; t.el.style.top = `${rect.top + (1 - v.y) / 2 * rect.height}px`; }
    }
    scene._dirty = true;
  };
  return fx;
}

export async function attachSimLab() {
  if (!token()) return;
  let scene = null;
  while (!(scene = document.querySelector('steel-scene'))) await sleep(150);
  while (!scene.scene || !scene.zones || !scene.camera || typeof scene._frame !== 'function') await sleep(150);
  if (scene.__simLab) return;
  scene.__simLab = true;
  injectStyle();
  const fx = createFx(scene);
  const frame = scene._frame.bind(scene);
  scene._frame = function (now) { const r = frame(now); try { fx.tick(now); } catch (e) { console.warn('시뮬레이션 효과 실패', e); } return r; };

  /** 공정을 옮기고(v4의 steel-goto) 장면이 그 공정이 되면 설비로 카메라를 옮긴다. */
  async function goTo(section, equipmentId) {
    if (scene.process?.id !== section) {
      document.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: section } }));
      for (let i = 0; i < 40 && scene.process?.id !== section; i++) await sleep(100);
      await sleep(400);
    }
    if (equipmentId) scene.focus?.(equipmentId); else scene.reset?.();
  }

  // ── 화면 틀 ──
  const launch = el('div', 'sl-launch');
  // 접근성: 패널은 이름 있는 영역(전체를 aria-live로 두면 슬라이더를 움직일 때마다 다 읽는다). 결과·판정은 live 상태 줄(say)로만 읽어 준다.
  const panel = el('aside', 'sl-panel'); panel.hidden = true; panel.id = 'sl-panel'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '3D 실습');
  const live = el('div', 'sl-sr'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  let sayTimer = 0;
  const say = (text) => { clearTimeout(sayTimer); live.textContent = ''; sayTimer = setTimeout(() => { live.textContent = text; }, 60); };
  // Esc로 패널을 닫고 연 버튼으로 돌아간다
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mode) { e.stopPropagation(); open(null); } });
  // 튜터에게 묻느라 잠시 숨긴 패널이면, 그 실습 버튼은 진행 중인 패널을 그대로 다시 보인다
  const toggle = (m, b) => { if (panel.hidden && mode && launcherOf[mode] === b) { panel.hidden = false; b.setAttribute('aria-expanded', 'true'); panel.querySelector('h3')?.focus({ preventScroll: true }); return; } open(mode === m ? null : m); };
  const bWhatif = btn('🧪 조업 실험', () => toggle('whatif', bWhatif), ''), bFault = btn('🚨 이상 상황 훈련', () => toggle('fault', bFault), '');
  const bMap = btn('🗺 공정 인과 지도', () => toggle('map', bMap), ''), bPlant = btn('🏭 공장 전체 보기', () => plantView(), '');
  launch.append(bMap, bWhatif, bFault, bPlant);
  launch.setAttribute('role', 'toolbar'); launch.setAttribute('aria-label', '3D 실습 도구');
  for (const b of [bMap, bWhatif, bFault]) b.setAttribute('aria-controls', 'sl-panel');
  bPlant.title = '공정 4개가 한 화면에 들어오게 카메라를 물려요';
  document.body.append(launch, panel, live);
  // 패널 아래 끝 = 실행 버튼 묶음 위 + 10px. 버튼이 줄바꿈되거나 창 크기가 바뀌면 다시 잰다.
  const fitPanel = () => { const top = launch.getBoundingClientRect().top; if (top > 0) document.documentElement.style.setProperty('--sl-panel-bottom', `${Math.round(innerHeight - top + 10)}px`); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitPanel).observe(launch);
  addEventListener('resize', fitPanel); fitPanel();
  let mode = null;
  const TITLES = { map: '공정 인과 지도', whatif: '조업 실험', fault: '이상 상황 훈련', quiz: '인과 퀴즈', incident: '사고 사례 갈림길' };
  const launcherOf = { map: bMap, whatif: bWhatif, fault: bFault, quiz: bMap, incident: bFault };
  function open(next, preset, opt = {}) {
    const prev = mode;
    mode = next; fx.clear(); panel.classList.remove('compact');
    for (const b of [bMap, bWhatif, bFault]) b.setAttribute('aria-expanded', String(!!mode && launcherOf[mode] === b));
    if (mode) panel.setAttribute('aria-label', `3D 실습 · ${TITLES[mode]}`);
    // 닫으면 그 실습을 연 버튼으로 포커스를 돌려준다(패널 안에 포커스가 있었을 때만)
    else if (prev && panel.contains(document.activeElement)) launcherOf[prev]?.focus();
    bWhatif.setAttribute('aria-pressed', String(mode === 'whatif')); bFault.setAttribute('aria-pressed', String(mode === 'fault')); bMap.setAttribute('aria-pressed', String(mode === 'map'));
    panel.hidden = !mode; panel.replaceChildren();
    if (mode === 'whatif') void whatifPanel(preset); else if (mode === 'fault') void (opt.fault ? faultDrill(opt.fault) : faultList()); else if (mode === 'map') void causalMap(preset, opt.var, opt.tour); else if (mode === 'quiz') void causalQuizPanel(opt.process); else if (mode === 'incident') void incidentPanel(opt.scenario, Number(opt.at), Number(opt.pick));
  }
  const head = (title, foldable = false) => {
    const h = el('h3'); h.append(el('span', '', title)); h.tabIndex = -1;
    setTimeout(() => { if (panel.contains(h) && !panel.contains(document.activeElement)) h.focus({ preventScroll: true }); }, 0);
    if (foldable) { const f = btn('결과만 보기', () => { const c = panel.classList.toggle('compact'); f.textContent = c ? '조건 펼치기' : '결과만 보기'; }, 'sl-btn ghost'); h.append(f); }
    const x = btn('닫기', () => open(null), 'sl-btn ghost'); x.setAttribute('aria-label', `${title.replace(/^\S+\s/, '')} 닫기 (Esc)`);
    h.append(x); return h;
  };

  /** 틀린 연결을 튜터 질문으로: v4 입력창에 질문을 채우고 튜터 패널을 연다(보내기는 학습자가). 3D 실습 패널은 접어 둔다. */
  function askTutor(text) {
    document.dispatchEvent(new CustomEvent('steel-tutor-draft', { detail: { text } }));
    // 튜터 패널과 같은 오른쪽이라 잠시 숨긴다(진행은 그대로, 실습 버튼을 다시 누르면 돌아온다)
    panel.hidden = true; launcherOf[mode]?.setAttribute('aria-expanded', 'false');
    say(`튜터 입력창에 질문을 채웠어요. 고쳐서 보내도 돼요. 실습은 ${launcherOf[mode]?.textContent.replace(/^\S+\s/, '') || '실습'} 버튼을 누르면 그대로 돌아와요.`);
  }
  const tutorBtn = (text) => btn('🎓 튜터에게 이 연결 묻기', () => askTutor(text), 'sl-btn ghost');

  /** 공장 전체 보기: 공정 4개가 한 화면에 들어오는 드론 시점(sleek-overview가 정한 _overviewPose). 공정을 넘는 흐름을 볼 때 쓴다. */
  function plantView() {
    // 2D 보기에서는 카메라가 없으므로 아무 일도 안 일어나던 것을 알려 준다
    if (scene._2d) { say('2D 보기에서는 공장 전체 보기를 쓸 수 없어요. 3D 보기로 돌아온 뒤 눌러 주세요.'); bPlant.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], 240); return; }
    const pose = scene._overviewPose?.();
    if (pose && scene._animateTo) scene._animateTo(pose); else scene.overview?.();
    scene._dirty = true;
  }

  // ── ⓪ 공정 인과 지도: 조정 변수 6개 → 공정 사이로 퍼지는 반응 ──
  const SECTION_ORDER = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
  async function causalMap(preset = {}, startVar = null, autoTour = false) {
    const input = { ...preset };
    panel.append(head('🗺 공정 인과 지도', true),
      el('p', 'sl-muted sl-hide', '조정할 수 있는 값 하나를 바꾸면, 그 영향이 다음 공정으로 어떻게 번지는지 3D 공장 위에 흐름으로 보여요. 주황은 값이 오르는 연결, 파랑은 내리는 연결이에요.'));
    const presets = el('div', 'sl-box sl-hide'); presets.append(el('b', '', '바로 해 보기'));
    const PRESETS = [
      ['코크스를 줄이면?', { coke_rate: 290 }],
      ['출강을 뜨겁게 + 빨리 주조하면?', { tap_temp: 1670, cast_speed: 1.6 }],
      ['염기도를 낮추면?', { basicity: 0.95 }],
      ['냉각 뱅크를 많이 열면?', { cool_banks: 14 }],
    ];
    const pr = el('div'); pr.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    for (const [label, v] of PRESETS) pr.append(btn(label, () => { for (const k of Object.keys(input)) delete input[k]; Object.assign(input, v); void run(); }, 'sl-btn ghost'));
    presets.append(pr, btn('🧩 인과 퀴즈로 확인하기', () => open('quiz'), 'sl-btn'));
    const controls = el('div', 'sl-box sl-hide'), story = el('div'), detail = el('div'), byProc = el('div'), note = el('p', 'sl-muted');
    panel.append(presets, controls, story, detail, byProc, note);
    let timer = 0, data = null, first = true, picked = startVar, lastCard = null;
    // ── 인과 따라가기: 이야기 줄 순서(원인 → 결과)대로 카메라가 설비를 하나씩 찾아가고, 앞 줄의 원인 설비에서 흐름을 잇는다 ──
    const tour = (() => {
      let token = 0, step = -1, skip = null;
      const STEP_MS = 3800;
      const running = () => step >= 0;
      const boxes = () => [...story.querySelectorAll('[data-i]')];
      function mark() { for (const b of boxes()) { const i = Number(b.dataset.i); b.classList.toggle('sl-on', i === step); b.classList.toggle('sl-dim', running() && i > step); } boxes()[step]?.scrollIntoView({ block: 'nearest' }); }
      function draw() {
        fx.clear();
        const eqOf = new Map(data.nodes.map((n) => [n.id, n.equipment_id]));
        data.story.slice(0, step + 1).forEach((st, i) => {
          for (const c of st.causes) { const a = eqOf.get(c); if (a && a !== st.equipment_id) fx.flow(a, st.equipment_id, i === step ? 0xff7a3d : 0xffb38a, i === step ? {} : { opacity: 0.45, dots: 3 }); }
          if (i === step) {
            const n = data.nodes.find((x) => x.id === st.id);
            fx.ring(st.equipment_id, st.status === 'warn' ? 0xff4d4d : 0x2bd4b4, true);
            fx.tag(st.equipment_id, `${i + 1}. ${n.label} ${n.delta > 0 ? '▲' : '▼'} ${fmt(n.value, n.digits)}${n.unit}`, st.status === 'warn' ? 'warn' : 'hot', 6);
          }
        });
        scene._dirty = true;
      }
      async function go(my) {
        while (my === token && panel.contains(story) && step < data.story.length - 1) {
          step++; mark(); draw(); refresh();
          const st = data.story[step];
          say(`${step + 1}단계. ${st.text}`);
          await goTo(st.process, st.equipment_id);
          await new Promise((r) => { skip = r; setTimeout(r, STEP_MS); });
        }
        if (my === token && panel.contains(story)) { say('끝까지 따라왔어요. 공장 전체로 돌아가요.'); stop(true); }
      }
      function stop(toPlant) {
        if (!running()) return;
        token++; step = -1; skip?.(); skip = null;
        if (data && panel.contains(story)) { mark(); render(); }
        if (toPlant) plantView();
      }
      let ctl = null;
      function refresh() {
        if (!ctl) return;
        ctl.replaceChildren(...(running()
          ? [btn(`다음 ▶ (${step + 1}/${data.story.length})`, () => skip?.(), 'sl-btn ghost'), btn('■ 그만 보기', () => { say('따라가기를 멈췄어요.'); stop(true); }, 'sl-btn ghost')]
          : data.story.length > 1 ? [btn(`▶ 인과 따라가기 (${data.story.length}단계)`, () => start(), 'sl-btn')] : []));
      }
      const start = () => { if (data?.story.length > 1) { token++; step = -1; void go(token); } };
      return { stop, start, controls() { ctl = el('div', 'sl-tour'); refresh(); if (running()) setTimeout(mark, 0); return ctl; }, get running() { return running(); } };
    })();
    async function run() {
      tour.stop(false);
      try { data = await api('POST', '/api/lab/causal', input); } catch (e) { story.replaceChildren(el('p', 'sl-bad', e.message)); return; }
      if (first) { first = false; renderControls(); }
      else { const warn = data.nodes.filter((x) => x.status === 'warn').map((x) => x.label); say(`${data.story.length}개 값이 바뀌었어요.${warn.length ? ` 정상 범위 밖: ${warn.join(', ')}.` : ''}`); }
      for (const n of data.nodes.filter((x) => x.control)) { const row = controls.querySelector(`[data-k="${n.id}"]`); if (row) { row.querySelector('input').value = n.value; row.querySelector('input').setAttribute('aria-valuetext', `${fmt(n.value, n.digits)}${n.unit}`); row.querySelector('b').textContent = `${fmt(n.value, n.digits)}${n.unit}`; } }
      render();
    }
    function renderControls() {
      controls.replaceChildren(el('b', '', '조정할 수 있는 값'));
      for (const n of data.nodes.filter((x) => x.control)) {
        const row = el('label', 'sl-s'); row.dataset.k = n.id;
        const range = el('input'); Object.assign(range, { type: 'range', min: n.control.min, max: n.control.max, step: n.control.step, value: n.value }); range.setAttribute('aria-label', n.label); range.setAttribute('aria-valuetext', `${fmt(n.value, n.digits)}${n.unit}`);
        range.addEventListener('input', () => { input[n.id] = Number(range.value); row.querySelector('b').textContent = `${range.value}${n.unit}`; range.setAttribute('aria-valuetext', `${range.value}${n.unit}`); clearTimeout(timer); timer = setTimeout(run, 200); });
        row.append(el('span', '', `${SECTION[n.process]} · ${n.label}`), range, el('b', '', '')); controls.append(row);
      }
      controls.append(btn('기준 조건으로', () => { for (const k of Object.keys(input)) delete input[k]; void run(); }, 'sl-btn ghost'));
      // 조건 링크: 기준과 다른 조정 값을 주소(?lab=map&set=id:값,…&tour=1)로 복사한다. 교육 담당자가 같은 실험을 수업 자료로 나눌 때 쓴다.
      const linkOut = el('input', 'sl-link'); linkOut.readOnly = true; linkOut.hidden = true; linkOut.setAttribute('aria-label', '조건 링크');
      const copy = async (tourToo) => {
        const moved = data.nodes.filter((n) => n.control && n.delta), changed = moved.map((n) => `${n.id}:${n.value}`);
        if (!changed.length) { say('기준 조건과 같아서 담을 값이 없어요. 값을 하나 바꾼 뒤 눌러 주세요.'); return; }
        const url = `${location.origin}${location.pathname}?p=${moved[0]?.process || 'ironmaking'}&lab=map&set=${changed.join(',')}${tourToo ? '&tour=1' : ''}`;
        linkOut.value = url; linkOut.hidden = false;
        let ok = false;
        try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { linkOut.select(); try { ok = document.execCommand('copy'); } catch (e2) {} }
        say(ok ? `링크를 복사했어요. 바꾼 값 ${changed.length}개${tourToo ? ', 열면 따라가기가 바로 시작돼요' : ''}.` : '복사하지 못했어요. 아래 칸의 주소를 직접 복사해 주세요.');
      };
      const linkRow = el('div', 'sl-tour');
      linkRow.append(btn('🔗 이 조건 링크 복사', () => void copy(false), 'sl-btn ghost'), btn('🔗 따라가기까지', () => void copy(true), 'sl-btn ghost'));
      controls.append(linkRow, linkOut);
    }
    function render() {
      // 설명: 위에서 아래로 따라간 인과
      story.replaceChildren(...(data.story.length ? [el('b', '', '무엇이 어떻게 번졌나'), tour.controls()] : []), ...(data.story.length ? data.story.map((s, i) => {
        const box = el('div', s.status === 'warn' ? 'sl-next' : 'sl-cause'); box.dataset.i = i; box.append(el('small', 'sl-muted', `${i + 1}. ${SECTION[s.process]}`), el('div', '', s.text)); return box;
      }) : [el('p', 'sl-muted', '값을 하나 바꾸거나 위 예시를 눌러 보세요. 공정 4개를 잇는 연결이 지금은 옅게 그려져 있어요.')]));
      // 공정별 값
      byProc.replaceChildren(el('small', 'sl-muted', '값을 누르면 무슨 뜻인지, 무엇과 이어져 있는지 보여 줘요.'), ...SECTION_ORDER.map((sec) => {
        const box = el('div', 'sl-box'); box.append(el('b', '', SECTION[sec]));
        for (const n of data.nodes.filter((x) => x.process === sec)) {
          const line = btn('', () => { picked = n.id; renderDetail(); render(); }, 'sl-var'); line.setAttribute('aria-pressed', String(picked === n.id)); line.title = `${n.label} 설명 보기`;
          const v = el('span', n.status === 'warn' ? 'sl-bad' : n.delta ? (n.delta > 0 ? 'sl-up' : 'sl-down') : '', `${fmt(n.value, n.digits)}${n.unit}${n.delta ? ` (${signed(n.delta, n.digits)})` : ''}`);
          if (n.status === 'warn') v.append(el('span', 'sl-sr', ' · 정상 범위 밖'));
          line.dataset.var = n.id; line.append(el('span', '', n.label), v); box.append(line);
        }
        return box;
      }));
      note.textContent = data.note;
      if (tour.running) return;
      // 3D: 모든 연결을 옅게, 바뀐 연결은 진하게(오름 주황·내림 파랑), 범위 밖은 붉은 링, 바뀐 값은 설비 이름표
      fx.clear();
      const eqOf = new Map(data.nodes.map((n) => [n.id, n.equipment_id]));
      for (const e of data.edges) {
        const a = eqOf.get(e.from), b = eqOf.get(e.to);
        if (a === b) continue;
        if (e.active) fx.flow(a, b, e.effect > 0 ? 0xff7a3d : 0x5aa0ff);
        else fx.flow(a, b, 0x9aa4b2, { opacity: 0.22, dots: 2 });
      }
      const tags = new Map();
      for (const n of data.nodes.filter((x) => x.delta)) {
        const t = tags.get(n.equipment_id) || { lines: [], warn: false };
        t.lines.push(`${n.label} ${signed(n.delta, n.digits)}${n.unit}`); t.warn ||= n.status === 'warn'; tags.set(n.equipment_id, t);
      }
      for (const [eqId, t] of tags) { fx.tag(eqId, `${t.warn ? '⚠ ' : ''}${t.lines.join(' · ')}`, t.warn ? 'warn' : 'hot', 5); if (t.warn) fx.ring(eqId, 0xff4d4d, true); }
      const sel = picked && data.nodes.find((x) => x.id === picked);
      if (sel) { fx.ring(sel.equipment_id, 0x2bd4b4, true); if (!tags.has(sel.equipment_id)) fx.tag(sel.equipment_id, `🔎 ${sel.label}`, 'ok', 5); }
      scene._dirty = true;
      renderDetail();
    }
    // 변수 설명 카드: 뜻·단위·정상 범위·지금 값, 영향을 주는 값·받는 값(누르면 그 변수로), 설비로 카메라 이동
    function renderDetail() {
      const n = picked && data?.nodes.find((x) => x.id === picked);
      if (!n) { lastCard = null; detail.replaceChildren(); return; }
      const box = el('div', 'sl-box sl-card'), nameOf = (id) => data.nodes.find((x) => x.id === id);
      const headRow = el('div'); headRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
      const title = el('b', '', `🔎 ${n.label}`); title.tabIndex = -1;
      const close = btn('✕', () => { const id = picked; picked = null; renderDetail(); render(); byProc.querySelector(`[data-var="${id}"]`)?.focus(); }, 'sl-btn ghost'); close.setAttribute('aria-label', `${n.label} 설명 닫기`);
      headRow.append(title, close);
      // 카드는 render()에서 한 번 더 그려지므로, 그때 남아 있는 카드 제목에 포커스
      if (lastCard !== n.id) { lastCard = n.id; setTimeout(() => detail.querySelector('.sl-card b[tabindex]')?.focus(), 0); }
      box.append(headRow, el('small', 'sl-muted', `${SECTION[n.process]}${n.control ? ' · 조정할 수 있는 값' : ''}`), el('div', '', n.desc || ''));
      box.append(el('div', n.status === 'warn' ? 'sl-bad' : '', `지금 ${fmt(n.value, n.digits)}${n.unit} · 기준 ${fmt(n.base, n.digits)}${n.unit} · 정상 ${fmt(n.normal[0], n.digits)}~${fmt(n.normal[1], n.digits)}${n.unit}`));
      const links = (title, list, other) => {
        if (!list.length) return;
        box.append(el('b', '', title));
        for (const e of list) {
          const o = nameOf(other(e)), b = btn(`${o.label} · ${e.coef > 0 ? '같은 방향' : '반대 방향'}`, () => { picked = o.id; renderDetail(); render(); }, 'sl-opt');
          b.append(el('div', 'sl-muted', e.why)); box.append(b);
        }
      };
      links('영향을 주는 값', data.edges.filter((e) => e.to === n.id), (e) => e.from);
      links('영향을 받는 값', data.edges.filter((e) => e.from === n.id), (e) => e.to);
      box.append(btn('3D에서 이 설비 보기', () => goTo(n.process, n.equipment_id), 'sl-btn ghost'));
      detail.replaceChildren(box);
    }
    plantView();
    await run();
    if (autoTour) tour.start();
  }

  // ── 인과 퀴즈: 원인 → 결과 → 다음 공정 영향을 한 칸씩 묻는다 ──
  async function causalQuizPanel(process) {
    panel.append(head('🧩 인과 퀴즈'), el('p', 'sl-muted', '한 값을 올리거나 내리면 다음 값, 그다음 공정의 값이 어떻게 될까요? 한 칸씩 고르면 3D에서 그 연결이 흐르며 이유를 알려 줘요.'));
    let chains;
    try { chains = (await api('GET', `/api/lab/causal/quiz?seed=${Date.now() % 100000}${process ? `&process=${process}` : ''}`)).chains; } catch (e) { panel.append(el('p', 'sl-bad', e.message)); return; }
    const box = el('div', 'sl-box'), scoreLine = el('p', 'sl-muted');
    panel.append(box, scoreLine, btn('🗺 인과 지도로 돌아가기', () => open('map'), 'sl-btn ghost'));
    let qi = 0, right = 0, total = 0, round = 1;
    // 틀린 칸: 길 id → { c, hops }. 끝 화면의 [틀린 칸만 다시 풀기]가 같은 길·같은 방향으로 그 칸만 다시 묻는다(다 맞힐 때까지 반복 가능)
    let wrong = new Map();
    plantView();
    const word = (d) => (d > 0 ? '오르면' : '내려가면');
    const dirWord = (up) => (up ? '올라요 ▲' : '내려가요 ▼');
    function show() {
      fx.clear();
      if (qi >= chains.length) {
        const misses = [...wrong.values()].reduce((n, w) => n + w.hops.size, 0);
        const tools = el('div', 'sl-tour');
        if (misses) tools.append(btn(`↻ 틀린 칸만 다시 풀기 (${misses}칸)`, () => {
          chains = [...wrong.values()].map((w) => ({ ...w.c, only: new Set(w.hops) }));
          wrong = new Map(); qi = 0; right = 0; total = 0; round++;
          scoreLine.textContent = ''; show();
          box.querySelector('button')?.focus();
        }, 'sl-btn'));
        tools.append(btn('새 문제로 다시', () => open('quiz'), misses ? 'sl-btn ghost' : 'sl-btn'));
        box.replaceChildren(el('b', '', `${round > 1 ? `다시 풀기 ${round - 1}회차 끝` : '다 풀었어요'} · ${right} / ${total} 칸 맞힘`),
          el('p', 'sl-muted', misses ? '틀린 칸은 "같은 방향/반대 방향" 규칙을 떠올려 보세요. 두 칸을 지나면 방향은 규칙 두 개를 곱한 것과 같아요.' : (round > 1 ? '틀렸던 칸을 모두 바로잡았어요!' : '모든 칸을 맞혔어요!')), tools);
        say(`${right} / ${total} 칸 맞힘.${misses ? ` 틀린 칸 ${misses}개를 다시 풀 수 있어요.` : ''}`);
        return;
      }
      const c = chains[qi], [a, b, d] = c.nodes;
      box.replaceChildren(el('small', 'sl-muted', `${round > 1 ? '다시 풀기 · ' : ''}${qi + 1} / ${chains.length} · ${SECTION[a.process]}${c.cross ? ' → 다른 공정' : ''}`),
        el('b', '', `${iGa(a.label)} ${word(c.dir)}…`));
      fx.ring(a.equipment_id, c.dir > 0 ? 0xff7a3d : 0x5aa0ff, true);
      fx.tag(a.equipment_id, `원인 · ${a.label} ${c.dir > 0 ? '▲' : '▼'}`, c.dir > 0 ? 'hot' : 'cold', 5);
      const finish = () => { const next = btn('다음 문제 ▶', () => { qi++; show(); }, 'sl-btn'); box.append(next); next.focus(); };
      const second = () => (c.only && !c.only.has(2) ? finish() : ask(c, 2, b, d, finish));
      if (c.only && !c.only.has(1)) {
        // 첫 칸은 지난번에 맞혔다: 답(방향 = 원인 방향 × 연결 방향)을 보여 주고 둘째 칸으로
        const up1 = c.hop1_up;
        box.append(el('p', 'sl-ok', `① ${SECTION[b.process]} · ${eunNeun(b.label)} ${dirWord(up1)} (지난번에 맞힌 칸)`));
        second();
      } else ask(c, 1, a, b, second);
    }
    function ask(c, hop, from, to, done) {
      const q = el('div'); q.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      q.append(el('span', '', `${hop === 1 ? '①' : '②'} ${hop === 2 ? '그러면 ' : ''}${SECTION[to.process]} · ${eunNeun(to.label)}?`));
      const row = el('div'); row.style.cssText = 'display:flex;gap:6px;'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', `${to.label}: 오른다 또는 내린다`);
      for (const [choice, label] of [['up', '▲ 오른다'], ['down', '▼ 내린다']]) {
        row.append(btn(label, async () => {
          for (const x of row.querySelectorAll('button')) x.disabled = true;
          let r;
          try { r = await api('POST', '/api/lab/causal/quiz/check', { chain_id: c.id, dir: c.dir, hop, choice }); } catch (e) { q.append(el('p', 'sl-bad', e.message)); return; }
          total++; if (r.correct) right++;
          if (hop === 1) c.hop1_up = r.answer === 'up';
          if (!r.correct) { const w = wrong.get(c.id) || { c: { id: c.id, dir: c.dir, cross: c.cross, nodes: c.nodes, hop1_up: c.hop1_up }, hops: new Set() }; w.hops.add(hop); wrong.set(c.id, w); }
          else if (hop === 1) { const w = wrong.get(c.id); if (w) w.c.hop1_up = c.hop1_up; }
          scoreLine.textContent = `지금까지 ${right} / ${total} 칸 맞힘`;
          const up = r.answer === 'up';
          const verdict = `${r.correct ? '✓ 맞아요' : '✗ 아니에요'} — ${eunNeun(to.label)} ${up ? '올라요 ▲' : '내려가요 ▼'}. ${r.why} (${r.sign_rule})`;
          q.append(el('p', r.correct ? 'sl-ok' : 'sl-bad', verdict)); say(verdict.replace(/[▲▼✓✗]/g, ''));
          if (!r.correct) {
            const a = c.nodes[0], move = c.dir > 0 ? '오르면' : '내려가면', res = up ? '올라가나요' : '내려가나요';
            q.append(tutorBtn(hop === 1
              ? `${iGa(a.label)} ${move} 왜 ${eunNeun(to.label)} ${res}? 두 값이 공정에서 어떻게 이어지는지 설명해 줘.`
              : `${iGa(a.label)} ${move} ${eulReul(from.label)} 거쳐 왜 ${eunNeun(to.label)} ${res}? 방향이 어떻게 이어지는지 단계별로 설명해 줘.`));
          }
          // 3D: 이 칸의 연결을 흐르게 하고 결과 이름표
          if (from.equipment_id !== to.equipment_id) fx.flow(from.equipment_id, to.equipment_id, up ? 0xff7a3d : 0x5aa0ff);
          fx.tag(to.equipment_id, `${hop === 1 ? '결과' : '다음 영향'} · ${to.label} ${up ? '▲' : '▼'}`, up ? 'hot' : 'cold', hop === 1 ? 7 : 9);
          done();
        }, 'sl-opt'));
      }
      q.append(row); box.append(q);
    }
    show();
  }

  // ── 사고 사례 갈림길 재현(학습 기록의 '3D 공장에서 이 갈림길 보기'): 갈림길 장면까지 설비를 따라가고,
  //    고른 선택이 실제로 일어난 일이면 이후 장면의 설비를 붉게 이어 보여 주고, 다른 선택이면 그 자리에서 막힌 결과를 초록으로 보여 준다 ──
  async function incidentPanel(scenarioId, at, pick) {
    panel.append(head('🔀 사고 사례 갈림길'));
    let sc;
    try { sc = (await api('GET', `/api/lab/incidents/${scenarioId}`)).scenario; } catch (e) { panel.append(el('p', 'sl-bad', e.message)); return; }
    const t = sc.timeline[at];
    if (!t?.branch || !t.branch.options[pick]) { panel.append(el('p', 'sl-bad', '그 갈림길을 찾지 못했어요. 학습 기록에서 다시 열어 주세요.')); return; }
    const short = (x, n = 34) => (x.length > n ? `${x.slice(0, n)}…` : x);
    const intro = el('div', 'sl-box'); intro.append(el('b', '', `${SECTION[sc.section]} · ${sc.title}`), el('small', 'sl-muted', `위험 · ${sc.hazard} · 교육용 가상 사례`));
    const scenes = el('ol', 'sl-scenes'), choice = el('div', 'sl-box'), result = el('div');
    panel.append(intro, scenes, choice, result, el('p', 'sl-muted', '학습 기록의 사고 사례에서 장면과 원인 분석 문제를 이어서 풀 수 있어요.'));
    scenes.append(...sc.timeline.slice(0, at + 1).map((s, i) => {
      const li = el('li'), b = btn(`${s.time} · ${short(s.text, 60)}`, () => void goTo(sc.section, s.equipment_id), 'sl-opt');
      if (i === at) b.classList.add('right'); li.append(b); return li;
    }));
    choice.append(el('b', '', `🔀 ${t.branch.prompt}`));
    const opts = el('div'); opts.style.cssText = 'display:flex;flex-direction:column;gap:6px;'; opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', t.branch.prompt);
    choice.append(opts);
    const actualIdx = t.branch.options.findIndex((o) => o.actual);
    function show(k) {
      pick = k;
      opts.replaceChildren(...t.branch.options.map((o, j) => { const b = btn(o.text, () => show(j), 'sl-opt'); b.setAttribute('aria-pressed', String(j === k)); if (j === k) b.classList.add(o.actual ? 'wrong' : 'right'); return b; }));
      const o = t.branch.options[k], after = sc.timeline.slice(at + 1);
      result.replaceChildren();
      const box = el('div', o.actual ? 'sl-next' : 'sl-cause');
      // 실제 선택의 결과 문장은 "실제로 일어난 일이에요"처럼 머리와 겹치므로, 이어진 장면을 결과로 보여 준다
      box.append(el('b', '', o.actual ? '그대로 가면 — 실제로 이렇게 이어졌어요' : '다르게 했다면'), el('div', '', o.actual ? (after.length ? '아래 장면처럼 사고로 이어졌어요. 3D에서 붉게 이어진 설비를 따라가 보세요.' : o.outcome) : o.outcome));
      result.append(box);
      if (o.actual && after.length) {
        const list = el('div', 'sl-box'); list.append(el('b', '', '이어진 장면'));
        for (const s of after) list.append(el('div', 'sl-bad', `${s.time} · ${s.text}`));
        result.append(list);
      } else if (!o.actual && actualIdx >= 0) {
        result.append(btn(`실제 선택과 비교: "${short(t.branch.options[actualIdx].text, 24)}"`, () => show(actualIdx), 'sl-btn ghost'));
      }
      // 3D: 지난 장면 설비를 옅은 흐름으로 잇고, 갈림길 설비에 결과 링
      fx.clear();
      const path = sc.timeline.slice(0, at + 1).map((s) => s.equipment_id);
      path.forEach((id, i) => { if (i && path[i - 1] !== id) fx.flow(path[i - 1], id, 0x9aa4b2, { opacity: 0.5, dots: 3 }); });
      fx.ring(t.equipment_id, o.actual ? 0xff3b3b : 0x3ddc84, true);
      fx.tag(t.equipment_id, `${t.time} ${o.actual ? '⚠ 그대로 가면' : '✓ 다르게 했다면'}`, o.actual ? 'warn' : 'ok', 6);
      if (o.actual) {
        // 실제로 일어난 일: 이후 장면의 설비로 붉은 흐름
        let prev = t.equipment_id;
        after.forEach((s, i) => { if (s.equipment_id !== prev) fx.flow(prev, s.equipment_id, 0xff3b3b); fx.ring(s.equipment_id, 0xff3b3b, true); if (i === after.length - 1) fx.tag(s.equipment_id, `${s.time} ⚠ ${short(s.text, 18)}`, 'warn', 8); prev = s.equipment_id; });
      }
      scene._dirty = true;
      say(o.actual ? `그대로 가면 실제로 이렇게 이어졌어요. ${after.map((s) => `${s.time}, ${s.text}`).join(' ') || o.outcome}` : `다르게 했다면. ${o.outcome}`);
    }
    await goTo(sc.section, t.equipment_id);
    show(pick);
  }

  // ── ① 조업 실험(What-if) ──
  async function whatifPanel(preset = {}) {
    const input = { ...preset };
    panel.append(head('🧪 조업 실험 · 고로', true), el('p', 'sl-muted sl-hide', '조건을 바꾸면 3D에서 원인 설비 → 고로 → 출선구로 영향이 흐르고, 쇳물 빛과 값이 바뀌어요. 교육용 간이 모델이라 실제 조업 값이 아니에요.'));
    const sliders = el('div', 'sl-box sl-hide'), out = el('div', 'sl-out'), causes = el('div'), next = el('div'), warn = el('div');
    panel.append(sliders, out, causes, next, warn);
    let timer = 0, data = null;
    const run = async () => {
      try { data = await api('POST', '/api/lab/whatif', input); } catch (e) { warn.replaceChildren(el('p', 'sl-bad', e.message)); return; }
      for (const [k] of SLIDERS) { const row = sliders.querySelector(`[data-k="${k}"]`); if (row) { row.querySelector('input').value = data.input[k]; row.querySelector('b').textContent = `${fmt(data.input[k], k === 'oxygen_pct' ? 1 : 0)}${SLIDERS.find((s) => s[0] === k)[2]}`; } }
      render();
    };
    for (const [k, label, unit, min, max, step] of SLIDERS) {
      const row = el('label', 'sl-s'); row.dataset.k = k;
      const range = el('input'); Object.assign(range, { type: 'range', min, max, step }); range.setAttribute('aria-label', label); range.setAttribute('aria-valuetext', `${input[k] ?? ''}${unit}`);
      range.addEventListener('input', () => { input[k] = Number(range.value); row.querySelector('b').textContent = `${range.value}${unit}`; range.setAttribute('aria-valuetext', `${range.value}${unit}`); clearTimeout(timer); timer = setTimeout(run, 250); });
      row.append(el('span', '', label), range, el('b', '', '')); sliders.append(row);
    }
    sliders.append(btn('기준 조건으로', () => { for (const k of Object.keys(input)) delete input[k]; void run(); }, 'sl-btn ghost'));
    function render() {
      const r = data.result, b = data.baseline;
      const tile = (label, now, base, unit, d = 0, upGood = false) => {
        const t = el('div'), diff = now - base, cls = Math.abs(diff) < 10 ** -d / 2 ? '' : (diff > 0) === upGood ? 'sl-ok' : diff > 0 ? 'sl-up' : 'sl-down';
        t.append(el('small', '', label), el('b', '', `${fmt(now, d)}${unit}`), el('i', cls, cls ? signed(diff, d) : '기준과 같음')); return t;
      };
      out.replaceChildren(tile('용선 온도', r.hot_metal_temp_c, b.hot_metal_temp_c, '℃', 0, true), tile('슬래그', r.slag_kg, b.slag_kg, 'kg/t', 0), tile('염기도', r.basicity, b.basicity, '', 2), tile('CO2(상한)', r.co2_kg, b.co2_kg, 'kg/t', 0));
      // 원인별 설명(조건 하나만 바꿨을 때의 효과)
      causes.replaceChildren(...(data.effects.length ? data.effects.map((e) => {
        const box = el('div', 'sl-cause'), ch = e.changes.map((c) => `${fmt(c.from)}→${fmt(c.to)}`).join(', '), d = e.deltas;
        box.append(el('b', '', `${e.label} (${ch})`), el('div', '', e.why), el('div', 'sl-muted', `이것만 바꾸면 → 용선 온도 ${signed(d.hot_metal_temp_c, 0, '℃')} · 슬래그 ${signed(d.slag_kg, 0, 'kg/t')} · 염기도 ${signed(d.basicity, 2)} · CO2 ${signed(d.co2_kg, 0, 'kg/t')}`));
        return box;
      }) : [el('p', 'sl-muted', '슬라이더를 움직여 보세요. 바꾼 조건마다 무엇이 왜 달라졌는지 여기에 나와요.')]));
      next.replaceChildren(...data.downstream.map((d) => { const box = el('div', 'sl-next'); box.append(el('b', '', `다음 공정 영향 · ${SECTION[d.process]}`), el('div', '', d.text), btn(`${SECTION[d.process]}으로 따라가 보기`, () => goTo(d.process, d.equipment_id), 'sl-btn ghost')); return box; }));
      warn.replaceChildren(...r.warnings.map((w) => el('p', 'sl-bad', `⚠ ${w}`)));
      // 3D: 흐름·빛·이름표·링
      fx.clear();
      for (const e of data.effects) {
        const color = e.deltas.hot_metal_temp_c > 0 ? 0xff7a3d : e.deltas.hot_metal_temp_c < 0 ? 0x5aa0ff : 0xffd166;
        if (e.equipment_id !== 'blast_furnace') fx.flow(e.equipment_id, 'blast_furnace', color);
        fx.tag(e.equipment_id, `${e.label} ${signed(e.deltas.hot_metal_temp_c, 0, '℃')}`, e.deltas.hot_metal_temp_c >= 0 ? 'hot' : 'cold', 4);
        fx.ring(e.equipment_id, color, false);
      }
      if (data.effects.length) fx.flow('blast_furnace', 'taphole_casthouse', 0xffffff);
      fx.glow('taphole_casthouse', tempColor(r.hot_metal_temp_c), 4 + (r.hot_metal_temp_c - 1380) / 30);
      const dt = r.hot_metal_temp_c - b.hot_metal_temp_c;
      fx.tag('taphole_casthouse', `용선 ${fmt(r.hot_metal_temp_c)}℃${dt ? ` (${signed(dt)})` : ''}`, dt > 0 ? 'hot' : dt < 0 ? 'cold' : '');
      fx.tag('blast_furnace', `슬래그 ${fmt(r.slag_kg)}kg/t · 염기도 ${fmt(r.basicity, 2)}`, r.warnings.length ? 'warn' : '', 9);
      if (r.warnings.length) fx.ring('blast_furnace', 0xff4d4d, true);
      for (const d of data.downstream) { fx.flow('taphole_casthouse', 'torpedo_car', 0xff6b6b); fx.flow('torpedo_car', d.equipment_id, 0xff6b6b); fx.ring(d.equipment_id, 0xff4d4d, true); fx.tag(d.equipment_id, '⚠ 다음 공정 영향', 'warn'); }
      scene._dirty = true;
    }
    await goTo('ironmaking');
    await run();
  }

  // ── ② 이상 상황 훈련 ──
  async function faultList() {
    panel.append(head('🚨 이상 상황 훈련'));
    try {
      const data = await api('GET', '/api/lab/faults');
      panel.append(el('p', 'sl-muted', data.disclaimer));
      for (const f of data.faults) {
        const b = btn(`${SECTION[f.section]} · ${f.title}`, () => void faultDrill(f.id), 'sl-opt');
        b.append(el('div', 'sl-muted', f.best == null ? '아직 안 해 봤어요' : `최고 ${Math.round(f.best * 100)}점 · ${f.attempts}번`));
        panel.append(b);
      }
    } catch (e) { panel.append(el('p', 'sl-bad', e.message)); }
  }
  async function faultDrill(id) {
    fx.clear(); panel.replaceChildren(head('🚨 이상 상황 훈련'));
    let f;
    try { f = (await api('GET', `/api/lab/faults/${id}`)).fault; } catch (e) { panel.append(el('p', 'sl-bad', e.message)); return; }
    const tries = { signal: 0, cause: 0, action: 0 };
    const steps = el('div', 'sl-steps'), names = ['① 이상 값 찾기', '② 원인', '③ 조치'];
    const setStep = (i) => steps.replaceChildren(...names.map((n, j) => el('span', j === i ? 'on' : j < i ? 'done' : '', n)));
    const situation = el('div', 'sl-box'); situation.append(el('b', '', `${SECTION[f.section]} · ${f.title}`), el('div', '', f.situation));
    const reads = el('div', 'sl-box'), work = el('div', 'sl-box');
    panel.append(steps, situation, reads, work, btn('목록으로', () => { fx.clear(); panel.replaceChildren(); void faultList(); }, 'sl-btn ghost'));
    setStep(0);
    // 3D: 이상 징후
    await goTo(f.section, f.equipment_id);
    fx.ring(f.equipment_id, 0xff3b3b, true);
    fx.tag(f.equipment_id, '⚠ 이상 징후', 'warn');
    // 계기 값: 정상 범위(초록 띠)와 지금 값(흰 막대)
    const rows = new Map();
    for (const r of f.readings) {
      const lo = Math.min(r.normal[0], r.value) - Math.abs(r.normal[1] - r.normal[0]) * 0.6, hi = Math.max(r.normal[1], r.value) + Math.abs(r.normal[1] - r.normal[0]) * 0.6;
      const pos = (x) => `${((x - lo) / (hi - lo)) * 100}%`;
      const row = btn('', () => void pickSignal(r.id, row), 'sl-read'), gauge = el('div', 'sl-gauge'), band = el('i', 'band'), mark = el('i', 'mark');
      band.style.left = pos(r.normal[0]); band.style.width = `calc(${pos(r.normal[1])} - ${pos(r.normal[0])})`; mark.style.left = pos(r.value);
      gauge.append(band, mark);
      const val = el('b', '', `${r.value}${r.unit}`);
      row.append(el('span', '', `${r.name}`), val, el('span', 'sl-muted', `정상 ${r.normal[0]}~${r.normal[1]}${r.unit}`), el('span'), gauge);
      rows.set(r.id, { row, val, mark, pos, r });
      reads.append(row);
    }
    work.append(el('b', '', '① 정상 범위를 벗어난 값을 하나 골라 보세요'), el('p', 'sl-muted', '초록 띠가 정상 범위, 흰 막대가 지금 값이에요.'));
    let stage = 'signal';
    async function pickSignal(rid, row) {
      if (stage !== 'signal') return;
      tries.signal++;
      const res = await api('POST', `/api/lab/faults/${f.id}/check`, { step: 'signal', key: rid });
      if (!res.correct) { row.classList.add('sl-shake'); setTimeout(() => row.classList.remove('sl-shake'), 400); work.querySelector('.sl-hint')?.remove(); work.append(el('p', 'sl-hint sl-muted', res.hint)); say(`아니에요. ${res.hint}`); return; }
      say(`맞아요. ${res.explain} 다음, 무엇이 원인일까요?`);
      stage = 'cause';
      for (const a of res.abnormal) { const x = rows.get(a); x?.row.classList.add('bad'); x?.row.append(el('span', 'sl-sr', ' · 정상 범위 밖')); }
      for (const { row: x } of rows.values()) x.disabled = true;
      work.replaceChildren(el('p', '', `✓ ${res.explain}`), el('b', '', '② 무엇이 원인일까요?'));
      setStep(1);
      choose(f.cause_options, 'cause', (res2) => {
        say(`맞아요. ${res2.explain} 원인에서 결과까지: ${res2.chain_text}. 다음, 어떻게 조치할까요?`);
        work.append(el('p', 'sl-ok', `✓ ${res2.explain}`), Object.assign(el('div', 'sl-cause'), { textContent: `원인 → 결과: ${res2.chain_text}` }));
        // 3D: 원인 사슬을 차례로 흐르게(공정 전체가 보이게 카메라를 물린다)
        scene.reset?.();
        res2.chain.forEach((id, i, all) => { if (i) fx.flow(all[i - 1], id, 0xff5a3d); fx.tag(id, `${i === 0 ? '원인' : i === all.length - 1 ? '결과' : '경로'} ${'①②③④⑤'[i]} ${fx.nameOf(id)}`, 'warn', 3); });
        work.append(el('b', '', '③ 어떻게 조치할까요?'));
        setStep(2); stage = 'action';
        choose(f.action_options, 'action', (res3) => {
          stage = 'done';
          work.append(el('p', 'sl-ok', `✓ ${res3.explain}`)); say(`맞아요. ${res3.explain} ${res3.downstream.text}`);
          // 값이 정상으로 돌아온다(앞 공정에서 온 값은 그대로 남는다)
          for (const [rid2, v] of Object.entries(res3.fixed)) { const x = rows.get(rid2); if (!x) continue; x.mark.style.left = x.pos(v); x.val.textContent = `${v}${x.r.unit}`; const ok = v >= x.r.normal[0] && v <= x.r.normal[1]; x.row.classList.toggle('bad', !ok); x.row.classList.toggle('fixed', ok); }
          fx.setRingColor(f.equipment_id, 0x3ddc84);
          fx.tag(f.equipment_id, '✓ 정상화', 'ok', 9);
          const nb = el('div', 'sl-next'); nb.append(el('b', '', '다음·앞 공정과의 연결'), el('div', '', res3.downstream.text));
          work.append(nb);
          fx.flow(f.equipment_id, res3.downstream.equipment_id, 0xffb020); fx.ring(res3.downstream.equipment_id, 0xffb020, true);
          const tools = el('div'); tools.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
          tools.append(btn('연결된 설비 보기', () => goTo(sectionOf(res3.downstream.equipment_id), res3.downstream.equipment_id), 'sl-btn ghost'));
          if (res3.whatif) tools.append(btn('🧪 조업 실험에서 재현해 보기', () => open('whatif', res3.whatif), 'sl-btn'));
          work.append(tools);
          api('POST', `/api/lab/faults/${f.id}/complete`, { tries }).then((r) => work.append(el('p', 'sl-ok', `점수 ${Math.round(r.score * 100)}점 · 시도 ${tries.signal}/${tries.cause}/${tries.action}번`)), () => {});
        });
      });
    }
    function choose(options, step, onRight) {
      const list = el('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
      for (const o of options) {
        const b = btn(o.text, async () => {
          if (b.disabled) return;
          tries[step]++;
          const res = await api('POST', `/api/lab/faults/${f.id}/check`, { step, key: o.key });
          if (!res.correct) {
            b.classList.add('wrong'); b.disabled = true;
            list.querySelector('.sl-hint')?.remove();
            list.querySelector('.sl-ask')?.remove();
            list.append(el('p', 'sl-hint sl-bad', res.consequence ? `결과: ${res.consequence}` : res.hint));
            const ask = tutorBtn(step === 'cause' ? `'${f.title}' 상황에서 ${iGa(o.text)} 원인이 아닌 이유가 뭐야? 진짜 원인을 찾으려면 어떤 값을 봐야 해?` : `'${f.title}' 상황에서 '${o.text}' 조치는 왜 안 돼? 조치를 고를 때 무엇을 먼저 따져야 해?`);
            ask.classList.add('sl-ask'); list.append(ask); say(`아니에요. ${res.consequence ? `그렇게 하면 ${res.consequence}` : res.hint}`);
            return;
          }
          b.classList.add('right');
          for (const x of list.querySelectorAll('button')) x.disabled = true;
          list.querySelector('.sl-hint')?.remove(); list.querySelector('.sl-ask')?.remove();
          onRight(res);
        }, 'sl-opt');
        list.append(b);
      }
      work.append(list);
    }
  }
  // 학습 기록의 '오늘의 실습 경로' 링크(?p=공정&lab=map&var=… · lab=quiz&process=… · lab=fault&fault=…)로 들어오면 그 실습을 바로 연다.
  const qs = new URLSearchParams(location.search), lab = qs.get('lab');
  if (['map', 'quiz', 'fault', 'whatif', 'incident'].includes(lab)) {
    const id = (k) => (/^[a-z0-9_-]{1,40}$/.test(qs.get(k) || '') ? qs.get(k) : undefined);
    // set=coke_rate:290,cast_speed:1.4 (id는 영문·숫자·_, 값은 숫자만. 범위는 서버가 다시 자른다)
    const preset = Object.fromEntries((qs.get('set') || '').split(',').map((kv) => kv.split(':')).filter(([k, v]) => /^[a-z0-9_]{1,40}$/.test(k || '') && Number.isFinite(Number(v)) && v !== '').slice(0, 10).map(([k, v]) => [k, Number(v)]));
    setTimeout(() => open(lab, preset, { tour: qs.get('tour') === '1', var: id('var'), process: id('process'), fault: id('fault'), scenario: id('scenario'), at: id('at'), pick: id('pick') }), 1200);
  }
  const sectionOf = (eqId) => Object.entries(scene.zones || {}).find(([, z]) => (z.eqs || []).some((e) => e.id === eqId))?.[0] || 'ironmaking';
}
