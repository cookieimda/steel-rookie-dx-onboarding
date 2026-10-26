// Learning-lab branch: original process visuals with thermal / What-if panels and a quotation board.
// The process models and existing section views remain; no stage or wall is instantiated.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { createGLTFLoader } from './gltf-loader.js'; // Draco 압축 GLB
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import * as DATA from './data_v2.js';
import { createApiClient } from './api-client.js';
import { conceptStatuses, equipmentStatuses, groupBySection } from './learn-hud-state.js';
import { icon, stepIcon, parseTemp } from './steel-index-ui.js';
import { createIntroTour } from './intro-tour.js'; // [▶] 설비 차례로 보기: 첫 화면 [▶ 재생]과 같은 재생(단계 카드·2D 화살표·안내 창)
import { attachLabConsole } from './lab-console.js';
import { createWorkFx } from './work-fx.js';
import { createOutline } from './lab-outline.js';
import { tuneRenderer, tuneShadowLight, tuneBloom, autoQuality, frameGate, warmShaders } from './perf-mode.js'; // 발표 모드·자동 화질·프레임 상한

const { PROCESSES } = DATA;
const ORANGE = 0xffa63d, RIPPLE = 0xffcc66; // 공정 자리 발광 테두리·선택 설비 물결은 노랑~주황 불빛(2026-10-14 요청, 전에는 물결이 시안)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RISE = { dur: 1100, gap: 240, depth: 22, sinkGap: 60, sinkDur: 480 };
const THEME_KEY = 'st-rookie:index-theme';

const stage = document.getElementById('stage'), hud = document.getElementById('hud');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
tuneRenderer(renderer);
renderer.shadowMap.autoUpdate = false; // 그림자 지도는 frame()에서 필요할 때만 다시 그린다(빛과 공장은 카메라를 돌려도 그대로)
renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.001)]; // 바닥판 밑면(= 테이블 윗면, y=-STAGE_H) 아래는 그리지 않는다
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 600);
let view = '3d'; // '3d' 외관 | 'board' 대시보드 보기
const orbit = { yaw: -0.58, pitch: 0.4, dist: 70, target: new THREE.Vector3(0, 3, 0) };
let home = { yaw: -0.58, pitch: 0.4, dist: 70, target: new THREE.Vector3(0, 3, 0) };

// ---- 조명 --------------------------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0xbfd2e0, 0x1a1410, 0.55); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1e0, 1.4); key.position.set(-35, 70, 60); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04; tuneShadowLight(key);
Object.assign(key.shadow.camera, { left: -50, right: 50, top: 45, bottom: -45, near: 10, far: 260 });
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x7fb0ff, 0.4); fill.position.set(60, 40, -30); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(10, 30, -90); scene.add(rim);
const warm = new THREE.PointLight(0xffb352, 0, 30, 1.6); scene.add(warm);

// ---- 슬레이트 테이블 -----------------------------------------------------------------------------
const work = createWorkFx({ scene, isDark: () => theme === 'dark' }); // 고른 설비의 작동 연출(v4와 같음)

// ---- 테마(3D 영역만. 화면 틀은 v4처럼 항상 어둡다) ------------------------------------------------------------
let theme = 'dark';
try { theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (e) {}
function applyTheme() {
  const dark = theme === 'dark';
  scene.background = new THREE.Color(dark ? 0x0d1114 : 0xdfe3e8); scene.fog = new THREE.Fog(dark ? 0x0d1114 : 0xdfe3e8, 160, 320);
  hemi.color.setHex(dark ? 0xbfd2e0 : 0xf0f5ff); hemi.groundColor.setHex(dark ? 0x1a1410 : 0x5c6470); hemi.intensity = dark ? 0.55 : 0.8;
  key.intensity = dark ? 1.4 : 1.7; renderer.toneMappingExposure = dark ? 1.0 : 1.05;
  $('icTheme').src = icon(dark ? 'sun' : 'moon', '#e6ebf1'); $('btnTheme').title = dark ? '라이트 모드로' : '다크 모드로';

}
$('btnTheme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} applyTheme(); };

// ---- 공정 자리 발광 테두리 + 선택 설비 링 ----------------------------------------------------------------
function glowTexture() {
  if (glowTexture.t) return glowTexture.t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const x = c.getContext('2d');
  x.shadowColor = 'rgba(255,255,255,.8)'; x.shadowBlur = 9; x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1.4;
  x.beginPath(); x.roundRect(28, 28, 200, 136, 18); x.stroke(); // 은은하게: blur 26→9, 굵기 3→1.4, 한 번만
  return (glowTexture.t = new THREE.CanvasTexture(c));
}
const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffc484, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; glow.renderOrder = 1; scene.add(glow); glow.visible = false;
// 선택한 설비를 감싸는 바닥 링(v4의 선택 링과 같은 시안). 참고 영상의 '선택 돔' 역할을 가볍게 한다
// 선택한 설비: 바닥에 굵은 링을 두지 않고, 15% 불투명 물결 두 개가 바깥으로 퍼진다(2026-10-13 요청)
const ripples = [0, 1].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: RIPPLE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.1; r.renderOrder = 2; r.raycast = () => {}; scene.add(r); return r; });
let rippleR = 3;
ripples.forEach((r) => { r.visible = false; }); // 선택 설비는 바닥 물결 대신 카메라 기준 외곽선으로 보인다(lab-outline.js)

// ---- 공정·설비 -------------------------------------------------------------------------------------
const loader = createGLTFLoader();
let anchors = {};
const procs = PROCESSES.map((p, i) => ({ id: p.id, data: p, idx: i, root: null, eqs: [], loaded: false, error: null, foot: null, seen: new Set(), progress: null, review: new Set() }));
let cur = null, curEq = null, seq = null, sinking = null, mode = 'overview';
let panel = null, tourMod = null; // tourMod: 재생 모듈(후처리 composer를 만든 뒤 아래에서 만든다)
const loadbar = $('loadbar');
const api = createApiClient();
// 단면 연출(엑스레이 + 색 층 + step-fx). 단계 보기에서만 켠다
// 3D 핫스팟 핀 ↔ 오른쪽 패널 '현장 포인트' 행을 잇는다(점진적 공개)

function tuneMaterial(o) {
  const m = o.material = o.material.clone(), nm = m.name || '';
  o.castShadow = true; o.receiveShadow = true; m.envMapIntensity = 0.9;
  if (/^(Steel|Steel_Dark|Struct_Gray|Roll_Steel|Coil_Cooled|Chrome_Rod)$/.test(nm)) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 1.15; }
  if (nm === 'Concrete') { m.color.setRGB(0.6, 0.61, 0.62); o.castShadow = false; }
  if (nm === 'Cladding') m.color.setRGB(0.6, 0.63, 0.66);
  if (nm === 'Grating') m.color.setRGB(0.36, 0.38, 0.4);
  if (/^(Molten_Steel|Hot_Slab|Slag_Hot)$/.test(nm)) { m.emissiveIntensity = 1.0; m.toneMapped = true; o.castShadow = false; } // 2.2·톤매핑 제외 → 1.0·톤매핑: 주황 빛번짐 제거
  if (nm === 'Slab_Cooling') m.emissiveIntensity = 0.8;
  if (/Water/.test(nm)) o.castShadow = false;
  if (nm === 'Glass') { m.envMapIntensity = 0.3; m.roughness = 0.35; }
  if (nm === 'Blue_Steel') { m.envMapIntensity = 0.5; m.roughness = Math.max(0.55, m.roughness); }
  m.userData.color = m.color.clone(); m.userData.emissive = m.emissive ? m.emissive.clone() : null; m.userData.emissiveI = m.emissiveIntensity;
}
// 공정 모델은 하나씩 받는다: 지금 볼 공정을 먼저 받아 바로 보여 주고, 나머지는 뒤에서 차례로 받는다(loadRest). 같은 공정을 두 번 받지 않는다
const loadOne = (p) => p.loading ||= new Promise((resolve) => {
  loader.load(`models/${p.id}.glb`, (gltf) => {
    const root = gltf.scene; root.visible = false;
    const cfg = anchors[p.id] || {}; const sc = cfg.scale ?? 1, off = cfg.offset || [0, 0, 0];
    root.scale.setScalar(sc); root.position.set(off[0], off[1], off[2]);
    root.traverse((o) => { if (o.isMesh) tuneMaterial(o); });
    root.updateMatrixWorld(true);
    const fb = new THREE.Box3();
    root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (/^Floor_/.test(q.name)) { o.visible = false; o.castShadow = false; fb.expandByObject(o); break; } });
    const all = new THREE.Box3().setFromObject(root); if (fb.isEmpty()) fb.copy(all);
    p.bounds = all; p.foot = { w: fb.max.x - fb.min.x + 6, d: fb.max.z - fb.min.z + 6, cx: (fb.min.x + fb.max.x) / 2, cz: (fb.min.z + fb.max.z) / 2 };
    p.eqs = p.data.equipment.map((e, i) => { const node = root.getObjectByName(`EQ_${e.id}`); if (!node) return null; const box = new THREE.Box3().setFromObject(node); return { id: e.id, data: e, i, node, box, baseY: node.position.y, y: 0, up: false, tag: null }; }).filter(Boolean);
    p.root = root; p.loaded = true; scene.add(root);
    resolve(true);
  }, (e) => { if (e.total && !cur) loadbar.style.width = `${Math.round(e.loaded / e.total * 100)}%`; }, (err) => { p.error = err?.message || '모델을 불러오지 못했어요'; p.tab?.setAttribute('disabled', ''); p.tab?.setAttribute('title', `${p.data.name}: 3D 모델을 불러오지 못했어요`); resolve(false); });
});
const loadRest = async () => { for (const p of procs) await loadOne(p); };

// ---- 학습 현황(실제 값만) --------------------------------------------------------------------------------
let sectionsInfo = null; // GET /api/sections
async function loadProgress(p) {
  if (!api.hasToken()) { p.progress = { kind: 'anon' }; renderProg(p); return; }
  try {
    if (!sectionsInfo) sectionsInfo = (await api.request('GET', '/api/sections')).sections || [];
    const has = sectionsInfo.find((s) => s.section === p.id)?.checkpoint;
    const [pr, mis] = await Promise.all([has ? api.request('GET', `/api/sections/${encodeURIComponent(p.id)}/progress`).catch(() => null) : null, api.request('GET', '/api/me/misconceptions').catch(() => ({ misconceptions: [] }))]);
    const st = equipmentStatuses(p.id, conceptStatuses(p.id, pr, groupBySection(mis.misconceptions || [])[p.id] || []));
    p.review = new Set(Object.entries(st).filter(([, v]) => v.status === 'review').map(([id]) => id));
    p.progress = { kind: has ? 'cp' : 'none', pr };
  } catch (e) { p.progress = e.status === 401 ? { kind: 'anon' } : { kind: 'error', message: e.message }; } // 토큰이 만료됐으면 로그인 안내로
  renderProg(p);
}
function renderProg(p) { // 학습 현황을 벽 대시보드로 보낸다
  if (!p || p !== cur) return;
  const g = p.progress; let cp, cpTone = '';
  if (!g) cp = '불러오는 중…';
  else if (g.kind === 'anon') cp = '로그인하면 보여요';
  else if (g.kind === 'none') cp = '이 공정은 학습만 해요';
  else if (g.kind === 'error') { cp = '상태를 읽지 못했어요'; cpTone = 'warn'; }
  else { const pr = g.pr, pct = pr?.understanding == null ? null : Math.round(pr.understanding * 100); if (pr?.unlocked) { cp = `통과${pct == null ? '' : ` · 이해도 ${pct}%`}`; cpTone = 'ok'; } else if (pr?.in_progress_attempt_id) cp = '진행 중'; else if (pct == null) cp = '아직 응시 전'; else { cp = `미통과 · 이해도 ${pct}%`; cpTone = 'warn'; } }
  labConsole.setProgress(`${p.seen.size}/${p.eqs.length} equipment ? ${cp}`);
}

// ---- 상단 알약 바 --------------------------------------------------------------------------------------
$('icHome').src = icon('home', '#111111', 1.8); $('btnHome').classList.add('on'); $('btnHome').onclick = () => { location.href = '/login_ui/home-sleek.html'; };
$('icClose').src = icon('close', '#e6ebf1', 1.8); $('btnClose').onclick = () => leaveStep();
$('icUser').src = icon('user', '#e6ebf1', 1.6); $('btnUser').onclick = () => { location.href = '/login'; }; // 마이페이지(학습 기록), steel-intro.html의 마이페이지 링크와 같은 곳
// 로그아웃: 로그아웃 API는 없다(JWT, docs/auth-api.md). 토큰이 있을 때만 보이고, 누르면 이 브라우저의 토큰과 이어 보던 학습 대화 id를 지우고 홈으로 간다(steel-intro.html과 같음).
$('icLogout').src = icon('logout', '#e6ebf1', 1.6);
{ let hasToken = false; try { hasToken = !!(localStorage.getItem('st-rookie-token') || sessionStorage.getItem('st-rookie-token')); } catch (e) {} $('btnLogout').hidden = !hasToken; }
$('btnLogout').onclick = () => { for (const s of [localStorage, sessionStorage]) { try { s.removeItem('st-rookie-token'); } catch (e) {} } try { sessionStorage.removeItem('st-rookie:learning-session'); } catch (e) {} location.href = '/'; };
$('btnView3d').onclick = () => setView('3d'); $('btnViewBoard').onclick = () => setView('board');
const tabs = $('tabs');
procs.forEach((p) => { const b = document.createElement('button'); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.innerHTML = `<code>${p.data.num}</code>${p.data.name}`; b.onclick = () => show(p); p.tab = b; tabs.appendChild(b); });
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms); }

// ---- 하단 재생 바 --------------------------------------------------------------------------------------
$('icPlay').src = icon('play', '#f2f2f2', 1.6);
$('btnPlay').onclick = () => (tourMod?.active ? stopTour() : startTour());
function renderTrack(p) {
  const tr = $('track'); tr.innerHTML = '';
  p.eqs.forEach((e) => { const b = document.createElement('button'); b.className = 'stop'; b.innerHTML = `<i></i><span>${esc(e.data.name)}</span>`; b.onclick = () => enterStep(e); e.dot = b; tr.appendChild(b); });
}
// [▶] 설비 차례로 보기: 첫 화면과 같은 재생 모듈. 공정 모델을 설비 단위 모델로 바꿔 끼우고(재생이 끝나면 되돌린다),
// 이 화면의 오른쪽 패널·아래 바·조업 카드는 숨긴다(steel-index.html body.tour-on). 속도·나가기는 재생 바에 있다
async function startTour(opts = {}) {
  if (!cur || seq || sinking || !tourMod) return;
  if (curEq) { clearDim(cur); closePanel(); curEq = null; mode = 'overview'; renderProg(cur); }
  document.body.classList.add('touring');
  const p = { id: cur.id, data: cur.data, c: [0, 0], root: cur.root, i: cur.idx };
  try { if (!(await tourMod.start(p, opts))) throw new Error('설비 없음'); } catch (e) { console.warn('[index] 재생을 시작하지 못했어요', e); p.root.visible = true; document.body.classList.remove('touring'); return; }
  resize(); syncUi();
}
function stopTour() { if (tourMod?.active) tourMod.stop(); }
function tourEnded(p, e) {
  p.root.visible = true; document.body.classList.remove('touring', 'peek'); resize(); syncUi();
  const back = e && cur?.id === p.id ? cur.eqs.find((q) => q.id === e.id) : null;
  if (back) enterStep(back); else if (cur && view === '3d') animateTo(home, 1100); // 보던 설비 패널로 돌아간다
}
/** 설비 패널의 [단계 보기]·단계 목록: 그 설비·단계부터 첫 화면과 같은 재생으로(공정 개요 창 없이) */
const playFrom = (e, step) => startTour({ eq: e.id, step, guide: false });
// 재생 중 알약 바: 마우스가 화면 위쪽 56px 안에 오면 내려오고, 110px 아래로 내려가면 다시 숨는다(바 위에 있는 동안은 유지). 키보드로 바에 초점이 가도 내려온다
// 위 알약 바는 재생 중이 아니어도 평소에 숨기고(lab-console-glass.css), 마우스를 화면 맨 위로 가져가면 body.peek로 내려온다
addEventListener('pointermove', (e) => { const on = document.body.classList.contains('peek'), want = e.clientY < (on ? 110 : 56); if (want !== on) document.body.classList.toggle('peek', want); });
$('top').addEventListener('focusin', () => document.body.classList.add('peek'));

// ---- 오른쪽 패널 ------------------------------------------------------------------------------------------
const right = $('right');
const labConsole = attachLabConsole({ api, scene, camera, reduced: REDUCED, pickEquipment: id => { const eq = cur?.eqs.find(eq => eq.id === id); if (eq) enterStep(eq); } });
function closePanel() { panel = null; right.classList.remove('on'); right.innerHTML = ''; document.body.classList.remove('panel'); }
function openPanel(kind) { panel = kind; right.classList.add('on'); document.body.classList.add('panel'); renderPanel(); } // 단면 보기 중에는 작동 입자를 숨긴다(v4와 같음)
function renderPanel() {
  if (!panel || !cur) return;
  const e = curEq; if (!e) return closePanel();
  const d = e.data;
  if (panel === 'eq') {
    const steps = (d.steps || []).map((s, i) => `<button data-i="${i}"><span class="tile"><img class="ic" width="30" height="30" alt="" src="${icon(stepIcon(s.zone), '#dfe5ec', 1.5)}"></span><span><span class="zone"><span>${esc(s.zone)}</span>${s.temp ? `<code>${esc(s.temp)}</code>` : ''}</span><span class="tx">${esc(s.text)}</span></span></button>`).join('');
    right.innerHTML = `<div class="scroll">
        <div class="phead"><span class="eyebrow">${cur.data.num} · ${esc(cur.data.name)}</span><h1>${esc(d.name)}</h1></div>
        <button class="x" id="pxClose" title="닫기" aria-label="닫기"><img class="ic" width="22" height="22" alt="" src="${icon('close', '#e6ebf1', 1.8)}"></button>
        <h2>역할</h2><p>${esc(d.role || '')}</p>
        ${d.input || d.output ? `<div class="io"><div><small>들어오는 소재</small><b>${esc(d.input || '-')}</b></div><span>→</span><div><small>나가는 소재</small><b>${esc(d.output || '-')}</b></div></div>` : ''}
        ${(d.notes || []).length ? `<h2>알아 두기</h2>${d.notes.map((n) => `<p class="note"><i>—</i><span>${esc(n)}</span></p>`).join('')}` : ''}
        ${steps ? `<h2>단계별 설명 · ${d.steps.length}단계</h2><div class="steps">${steps}</div>` : ''}
      </div>
      <div class="foot"><button id="askEq" title="마이페이지 AI 튜터로 이동(이 공정·설비를 보고 답해요)"><img class="ic" width="22" height="22" alt="" src="${icon('bot', '#e6ebf1', 1.6)}">튜터에게 묻기</button>${steps ? `<button class="primary" id="openSteps" title="이 설비부터 첫 화면과 같은 방식으로 단계를 재생해요">▶ 단계 재생</button>` : ''}</div>`;
    $('pxClose').onclick = () => closePanel();
    $('askEq').onclick = () => { location.href = `/login_ui/My%20Page.dc.html?p=${encodeURIComponent(cur.id)}&eq=${encodeURIComponent(e.id)}&ask=1`; }; // 마이페이지 튜터로(맥락 전달, #140). /login은 서버가 쿼리 없이 넘겨서 페이지 주소를 직접 쓴다
    $('openSteps')?.addEventListener('click', () => playFrom(e, 0));
    right.querySelectorAll('.steps button').forEach((b) => { b.onclick = () => playFrom(e, +b.dataset.i); });
    return;
  }
}


// ---- 설비 칩(3D 위). 외관: 지금 설비 하나, 평면: 모든 설비 번호 -----------------------------------------------------
// 칩에 강조할 숫자: 그 설비 작동 단계 중 가장 높은 온도(학습 자료 예시값). 숫자가 없으면 '상온'
const peakTemp = (d) => { const hi = Math.max(0, ...(d.steps || []).map((s) => parseTemp(s.temp)?.[1] ?? 0)); return hi > 40 ? `${hi.toLocaleString('ko-KR')}℃` : '상온'; };
function tagFor(e) {
  if (e.tag) return e.tag;
  const t = document.createElement('div'); t.className = 'tag'; t.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-100%);opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;gap:6px;white-space:nowrap;pointer-events:none;';
  t.innerHTML = `<span class="k" style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 7px;background:rgba(13,17,20,.86);border:1px solid rgba(255,255,255,.2);color:#fff;font:600 15px/1 var(--f-body);border-radius:999px;backdrop-filter:blur(6px)"><i style="width:22px;height:22px;border-radius:50%;background:var(--hot);color:#1a1200;font:700 12px/1 var(--f-mono);font-style:normal;display:grid;place-items:center">${String(e.i + 1).padStart(2, '0')}</i><span class="nm">${esc(e.data.name)}</span><small class="tl">최고 온도</small><b class="tv">${peakTemp(e.data)}</b></span><span class="ld" style="width:1px;height:22px;background:linear-gradient(#c9d1d6,transparent)"></span>`;
  hud.appendChild(t); return (e.tag = t);
}
// 설비 이름표(번호 + 이름): 누르지 않아도 지금 공정의 설비가 어디인지 늘 보인다(외관 보기, 솟아오른 설비만). 고른 설비는 큰 칩(.tag)이 대신한다. 누르면 그 설비로 들어간다
function pinFor(e) {
  if (e.pin) return e.pin;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'eq-pin'; b.style.display = 'none';
  b.innerHTML = `<i>${String(e.i + 1).padStart(2, '0')}</i><span>${esc(e.data.name)}</span>`; b.setAttribute('aria-label', `${e.i + 1}번 ${e.data.name} 보기`);
  b.onclick = () => enterStep(e); hud.appendChild(b); return (e.pin = b);
}

// ---- 공정 보이기 / 가라앉히기 ------------------------------------------------------------------------
function fitHome(p) {
  const framing = p.bounds.clone(); const display = labConsole.bounds(); if (display) framing.union(display);
  const size = framing.getSize(new THREE.Vector3()), c = framing.getCenter(new THREE.Vector3());
  // 대시보드 배치(body.lab-dock)에서는 3D 뷰가 패널과 겹치지 않으므로 뷰 전체(재생 바만 빼고)에 맞춘다. 작은 화면 판단은 창 폭으로 한다
  const w = stage.clientWidth, h = stage.clientHeight, small = innerWidth <= 1000, docked = document.body.classList.contains('lab-dock');
  const freeW = small ? w - 24 : docked ? w - 40 : w - (w <= 1250 ? 590 : 700), freeH = small ? h * .42 : docked ? h - 200 : h - 210;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const widthDistance = (size.x + size.z * .25) / (2 * tan * camera.aspect * Math.max(.25, freeW / w));
  const heightDistance = (size.y + size.z * .3) / (2 * tan * Math.max(.25, freeH / h));
  return { yaw: -.2, pitch: .25, dist: Math.max(22, widthDistance, heightDistance) * 1.05, target: new THREE.Vector3(c.x, c.y, c.z) };
}
let want = null;
async function show(p, replay = false) {
  want = p;
  if (!p.loaded && !p.error) { toast(`${p.data.name} 3D 모델을 불러오는 중이에요`, 1500); await loadOne(p); if (want !== p) return; } // 뒤에서 받는 중인 공정을 먼저 누른 경우
  if (!p.loaded) { toast(`${p.data.name}: 3D 모델을 불러오지 못했어요`); return; }
  stopTour(); if (view === 'board') setView('3d', false); // 공정을 바꾸면 외관으로(앞 공정의 옅게 한 재질도 되돌린다)
  if (cur && cur !== p) await sink(cur);
  if (cur === p && !replay) return;
  cur = p; curEq = null; mode = 'overview';
  procs.forEach((q) => { q.tab.classList.toggle('on', q === p); q.tab.setAttribute('aria-selected', String(q === p)); });
  renderTrack(p); closePanel(); clearDim(p); loadProgress(p);
  const { w, d, cx, cz } = p.foot;
  glow.position.set(cx, 0.12, cz); glow.scale.set(w + 9, d + 9, 1);
  labConsole.setProcess(p); renderProg(p);
  home = fitHome(p); orbit.dist = home.dist * 1.3; orbit.yaw = home.yaw - 0.1; animateTo(home, 2200);
  p.root.visible = true;
  p.eqs.forEach((e) => { tagFor(e); pinFor(e); e.up = false; e.y = -RISE.depth; e.node.position.y = e.baseY + e.y; });
  syncUi();
  if (REDUCED) { p.eqs.forEach((e) => { e.up = true; e.y = 0; e.node.position.y = e.baseY; }); glow.material.opacity = 0.07; return; }
  seq = { t0: performance.now() + 650 }; // 바닥판이 다 뻗은 뒤 설비가 솟는다
}
function sink(p) {
  return new Promise((resolve) => {
    seq = null; mode = 'overview'; labConsole.clear(); curEq = null; syncUi(); clearDim(p);
    const n = p.eqs.length, total = REDUCED ? 1 : RISE.sinkDur + n * RISE.sinkGap + 150;
    sinking = { p, t0: performance.now(), total, resolve: () => { p.root.visible = false; resolve(); } };
  });
}

// ---- 설비 보기 ---------------------------------------------------------------------------------------
let drive = null; // { e, ax, L, p0 } 토페도카 주행
const isVehicle = (e) => !!e && /torpedo|_car$/.test(e.id);
function startDrive(e) { stopDrive(); if (!isVehicle(e) || REDUCED) return; const sz = e.box.getSize(new THREE.Vector3()), ax = sz.x >= sz.z ? 'x' : 'z';
  const par = e.node.parent, w0 = e.node.getWorldPosition(new THREE.Vector3()), w1 = w0.clone(); w1[ax] += 1; const l0 = par.worldToLocal(w0.clone()), l1 = par.worldToLocal(w1.clone()), dir = l1.sub(l0);
  drive = { e, dir, L: Math.max(sz.x, sz.z) * 2.2, p0: e.node.position.clone(), w0, warm0: warm.position.clone(), rip0: ripples.map((r) => r.position.clone()), t0: performance.now() + 900 }; }
function stopDrive() { if (!drive) return; drive.e.node.position.x = drive.p0.x; drive.e.node.position.z = drive.p0.z; warm.position.copy(drive.warm0); ripples.forEach((r, i) => r.position.copy(drive.rip0[i])); work.setOffset(0, 0, 0); drive.e.box.setFromObject(drive.e.node); drive = null; } // 상자도 원래 자리로 다시 계산
function driveTick(now) { if (!drive) return; const T = 9000, u = Math.max(0, now - drive.t0) % T / T; // 0~.4 나감, .4~.5 정차, .5~.9 돌아옴, .9~1 정차
  const sm = (k) => k * k * (3 - 2 * k), f = u < 0.4 ? sm(u / 0.4) : u < 0.5 ? 1 : u < 0.9 ? 1 - sm((u - 0.5) / 0.4) : 0;
  const n = drive.e.node, d = drive.dir; n.position.x = drive.p0.x + d.x * drive.L * f; n.position.z = drive.p0.z + d.z * drive.L * f;
  const wp = n.getWorldPosition(_dv), ox = wp.x - drive.w0.x, oz = wp.z - drive.w0.z; // 불빛·물결·작업 입자도 같은 만큼
  warm.position.set(drive.warm0.x + ox, drive.warm0.y, drive.warm0.z + oz); ripples.forEach((r, i) => r.position.set(drive.rip0[i].x + ox, drive.rip0[i].y, drive.rip0[i].z + oz)); work.setOffset(ox, 0, oz);
  drive.e.box.setFromObject(n); }
const _dv = new THREE.Vector3();
function clearDim(p) { outline.clear(); stopDrive(); work.stop(); warm.intensity = 0; ripples.forEach((r) => { r.material.opacity = 0; }); p.eqs.forEach((q) => q.node.traverse((o) => { if (!o.isMesh || !o.material.userData.color) return; const m = o.material; m.color.copy(m.userData.color); if (m.userData.emissive) { m.emissive.copy(m.userData.emissive); m.emissiveIntensity = m.userData.emissiveI; } })); }
function enterStep(e, userAct = true) {
  if (!cur || !e || !e.up || sinking) return;
  stopTour(); // 재생 중에 설비를 직접 고르면 재생을 끝낸다
  stopDrive(); // 움직이던 차를 먼저 제자리로(상자·불빛·입자가 원래 위치 기준으로 잡히게)
  mode = 'step'; curEq = e; cur.seen.add(e.id);
  labConsole.selectEquipment(e.id); // 온도 흐름의 단계 탐색도 이 설비로
  openPanel('eq');
  renderProg(cur); syncUi(); if (!REDUCED) work.start(e);
  const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3());
  warm.position.set(c.x, e.box.max.y + 2, c.z); warm.intensity = 14;
  ripples.forEach((r) => r.position.set(c.x, 0.1, c.z)); rippleR = Math.max(2.5, Math.max(s.x, s.z) * 0.62);
  startDrive(e); outline.select(e.node, cur.eqs.map((q) => q.node));
  cur.eqs.forEach((q) => q.node.traverse((o) => { if (!o.isMesh || !o.material.userData.color) return; const m = o.material; if (q === e) { m.color.copy(m.userData.color); if (m.userData.emissive) { m.emissive.copy(m.userData.emissive); m.emissiveIntensity = m.userData.emissiveI; } } else { m.color.copy(m.userData.color).multiplyScalar(0.6); if (m.userData.emissive) m.emissiveIntensity = m.userData.emissiveI * 0.5; } }));
  if (view === 'board') setView('3d', false); // 설비를 고르면 대시보드 보기에서 나온다
  animateTo(eqPose(e, orbit.yaw), 1200);
}
function step(dir, userAct = true) { if (!cur) return; const n = cur.eqs.length, i = curEq ? (curEq.i + dir + n) % n : (dir > 0 ? 0 : n - 1); enterStep(cur.eqs[i], userAct); }
function leaveStep() { if (!cur) return; stopTour(); mode = 'overview'; curEq = null; clearDim(cur); closePanel(); renderProg(cur); syncUi(); if (view === '3d') animateTo(home, 1100); }
function syncUi() {
  const stepping = mode === 'step' && !!curEq;
  cur?.eqs.forEach((e) => { e.dot?.classList.toggle('cur', e === curEq); e.dot?.classList.toggle('done', stepping && e.i < curEq.i); if (e.tag) { const showTag = view === '3d' && stepping && e === curEq; e.tag.style.opacity = showTag ? '1' : '0'; e.tag.querySelector('.nm').style.display = ''; e.tag.querySelector('.k').style.padding = view === 'plan' && e !== curEq ? '5px' : '7px 12px 7px 7px'; e.tag.querySelector('.ld').style.display = view === 'plan' ? 'none' : ''; } });
  $('btnClose').style.visibility = stepping ? '' : 'hidden';
}
// ---- 외관 / 대시보드 --------------------------------------------------------------------------------------
const GHOST = 0.18; // 대시보드 보기에서 공정 모델의 불투명도
function ghost(p, on) { // 공정 모델을 옅게 하거나(on) 되돌린다. 재질은 설비마다 복제돼 있어(tuneMaterial) 그대로 고친다
  if (!p?.root) return;
  p.root.traverse((o) => { if (!o.isMesh) return; const m = o.material;
    if (on) { if (m.userData.op == null) m.userData.op = m.opacity; m.transparent = true; m.opacity = GHOST; m.depthWrite = false; }
    else if (m.userData.op != null) { m.opacity = m.userData.op; m.transparent = m.userData.op < 1; m.depthWrite = true; m.userData.op = null; } });
}
// 고른 설비 시점(외관). 설비 상자의 긴 변 × 2.4 거리, 살짝 왼쪽
// 오른쪽 패널이 열려 있으면 남은 폭에 맞게 그만큼 더 물러난다(최대 1.6배)
const panelZoom = () => (document.body.classList.contains('panel') && !document.body.classList.contains('lab-dock') ?Math.min(1.6, stage.clientWidth / Math.max(300, stage.clientWidth - (right.offsetWidth || 440))) : 1);
const eqPose = (e, yaw) => { const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3()); return { yaw, pitch: 0.34, dist: Math.max(14, Math.max(s.x, s.z, s.y) * 2.4) * panelZoom(), target: new THREE.Vector3(c.x - s.x * 0.15, c.y, c.z) }; };
function boardPose() { return { ...home, yaw: 0, pitch: .1 }; }
function setView(v, fly = true) {
  if (view === v) return; view = v;
  $('btnView3d').classList.toggle('on', v === '3d'); $('btnView3d').setAttribute('aria-pressed', String(v === '3d'));
  $('btnViewBoard').classList.toggle('on', v === 'board'); $('btnViewBoard').setAttribute('aria-pressed', String(v === 'board'));
  ghost(cur, false);
  if (fly) animateTo(v === 'board' ? boardPose() : curEq ? eqPose(curEq, home.yaw) : home, 900);
  syncUi();
}
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (tourMod?.active) { if (e.key === 'Escape') stopTour(); else if (e.key === ' ') { e.preventDefault(); tourMod.toggle(); } else if (e.key === 'ArrowRight') tourMod.stepEq(1); else if (e.key === 'ArrowLeft') tourMod.stepEq(-1); return; } // 재생 중: 첫 화면과 같은 키
  if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') leaveStep(); else { const n = parseInt(e.key, 10); if (n >= 1 && n <= procs.length) show(procs[n - 1]); } });

// ---- 카메라·입력 --------------------------------------------------------------------------------------
let anim = null, drag = null, hot = null;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeOutBack = (k, s = 0.9) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
function animateTo(to, dur = 1200) { anim = { t0: performance.now(), dur: REDUCED ? 1 : dur, from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, target: orbit.target.clone() }, to: { ...to, target: to.target.clone() } }; }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitAt(ev) {
  if (!cur || tourMod?.active) return null; const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(cur.root, true).find((h) => h.object.visible); if (!hit) return null;
  const eq = cur.eqs.find((e) => { let o = hit.object; while (o) { if (o === e.node) return true; o = o.parent; } return false; });
  return { eq: eq || null };
}
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; stage.classList.add('dragging'); renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.moved && view === 'board') setView('3d', false); // 돌려 보기 시작하면 대시보드 보기에서 나온다
    orbit.yaw -= dx * 0.005; orbit.pitch = Math.min(1.2, Math.max(0.12, orbit.pitch + dy * 0.004)); anim = null;
    drag.x = e.clientX; drag.y = e.clientY; return; }
  const h = hitAt(e); const k = h ? (h.eq || 'any') : null; if (k !== hot) { hot = k; renderer.domElement.style.cursor = k ? 'pointer' : 'grab'; }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const d = drag; drag = null; stage.classList.remove('dragging'); if (!d || d.moved || !cur) return;
  const h = hitAt(e);
  if (!h) { if (mode === 'step') leaveStep(); return; }
  if (h.eq && h.eq !== curEq) enterStep(h.eq); else step(1);
});
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.min(200, Math.max(10, orbit.dist * (1 + e.deltaY * 0.0012))); anim = null; }, { passive: false });

// ---- 루프 ---------------------------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.3, 1.6); composer.addPass(bloom); tuneBloom(bloom); const outline = createOutline(scene, camera); composer.addPass(outline.pass);
tourMod = createIntroTour({ scene, renderer, composer, hud, getCamera: () => camera, loader, reduced: REDUCED, animateTo: (pose, ms) => { anim = null; animateTo(pose, ms); }, yawOf: () => home.yaw, onEnd: tourEnded, keepFloor: true }); composer.addPass(new OutputPass());
function resize() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); applyViewOffset();  if (cur && !curEq) { home = fitHome(cur); animateTo(home, 450); } }
// 오른쪽 패널이 열리면 패널 폭의 절반만큼 장면을 왼쪽으로 밀어, 고른 설비가 패널에 가리지 않고 남은 영역 가운데에 온다(2026-10-14 요청). 천천히 옮겨 간다
let viewOff = 0;
function applyViewOffset() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1, dx = tourMod?.active ? tourMod.panelWidth() / 2 : 0; if (dx) camera.setViewOffset(w, h, dx, 0, w, h); else if (innerWidth <= 1000) camera.setViewOffset(w, h, 0, h * .19, w, h); else camera.clearViewOffset(); }
function viewOffsetTick() {
  const want = 0;
  if (Math.abs(want - viewOff) < 0.5) return; viewOff += (want - viewOff) * (REDUCED ? 1 : 0.12); if (Math.abs(want - viewOff) < 0.5) viewOff = want; applyViewOffset();
}
new ResizeObserver(resize).observe(stage); resize();
autoQuality({ renderer, composer });
// 아래 카드 크기를 손잡이로 바꾼 뒤(lab-dock.js) 설비를 고르지 않은 전체 보기면 새 3D 뷰 크기에 맞춰 다시 담는다
addEventListener('lab-dock-resized', () => { if (cur && !curEq && view === '3d') { home = fitHome(cur); animateTo(home, 500); } });

function riseTick(now) {
  if (sinking) {
    const { p, t0, total } = sinking, n = p.eqs.length;
    p.eqs.forEach((e, i) => { const k = Math.min(1, Math.max(0, (now - t0 - (n - 1 - i) * RISE.sinkGap) / RISE.sinkDur)); e.y = -RISE.depth * easeOut(k); e.node.position.y = e.baseY + e.y; if (k > 0) e.up = false; });
    glow.material.opacity = 0;
    if (now - t0 >= total) { const r = sinking.resolve; sinking = null; r(); }
    return;
  }
  if (seq && cur) {
    const p = cur, t = now - seq.t0, ks = Math.min(1, Math.max(0, t / 600));
    glow.material.opacity = ks < 1 ? 0.1 + 0.3 * Math.sin(ks * Math.PI) : 0.07; // 등장 때 번쩍임도 절반 이하로
    let done = true;
    p.eqs.forEach((e, i) => { const k = Math.min(1, Math.max(0, (t - 150 - i * RISE.gap) / RISE.dur)); e.y = -RISE.depth * (1 - easeOutBack(k)); if (k >= 1) e.y = 0; e.node.position.y = e.baseY + e.y; e.up = k >= 1; if (k < 1) done = false; });
    if (done) { seq = null; syncUi(); }
  }
}
const v = new THREE.Vector3();
let pinProc = null;
function placeHud() {
  if (!cur) return; const w = stage.clientWidth, h = stage.clientHeight;
  if (pinProc !== cur) { pinProc?.eqs.forEach((e) => { if (e.pin) e.pin.style.display = 'none'; }); pinProc = cur; } // 공정을 옮기면 앞 공정 이름표를 감춘다
  for (const e of cur.eqs) {
    if (!e.pin) continue; const big = e.tag && e.tag.style.opacity !== '0';
    if (view !== '3d' || !e.up || big) { e.pin.style.display = 'none'; continue; }
    const c = e.box.getCenter(new THREE.Vector3()); v.set(c.x, e.box.max.y + e.y + 0.6, c.z).project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05; e.pin.style.display = vis ? '' : 'none';
    if (vis) { e.pin.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`; e.pin.classList.toggle('dim', mode === 'step' && !!curEq); }
  }
  for (const e of cur.eqs) {
    if (!e.tag || e.tag.style.opacity === '0') continue; const c = e.box.getCenter(new THREE.Vector3());
    v.set(c.x, e.box.max.y + e.y + 0.6, c.z).project(camera); const vis = v.z < 1;
    e.tag.style.display = vis ? '' : 'none'; if (vis) e.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${Math.max(110, (1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}
const gate = frameGate();
let lastShadow = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const moving = !!(seq || sinking || drive); // 설비가 솟거나 가라앉거나 움직이는 중
  if (!gate(now, moving || !!anim || !!drag || !!tourMod?.active || !!curEq)) return;
  riseTick(now); viewOffsetTick();
  if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), s = easeOut(k); orbit.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * s; orbit.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * s; orbit.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * s; orbit.target.lerpVectors(anim.from.target, anim.to.target, s); if (k >= 1) anim = null; }

  const o = orbit; camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch)); camera.lookAt(o.target);
  if (curEq && !REDUCED) { warm.intensity = 14 + 3 * Math.sin(now / 420); ripples.forEach((r, k) => { const ph = ((now / 2200) + k * 0.5) % 1; r.scale.setScalar(rippleR * (0.8 + 0.8 * ph)); r.material.opacity = 0.15 * (1 - ph); }); }
  driveTick(now); labConsole.tick(now); work.tick(now); tourMod?.tick(now);
  if (moving || now - lastShadow > 200) { renderer.shadowMap.needsUpdate = true; lastShadow = now; } // 움직일 때는 매번, 아니면 1초에 5번
  composer.render(); placeHud();
}

applyTheme();
const q = new URLSearchParams(location.search);
// 주소의 공정(없으면 제선)을 먼저 받는다. 그 공정을 못 받으면 다음 공정을 차례로 시도한다
const firstLoaded = async () => { const want = procs.find((p) => p.id === q.get('p')) || procs[0]; for (const p of [want, ...procs.filter((x) => x !== want)]) if (await loadOne(p)) return p; return null; };
fetch('models/anchors-v2b.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((a) => { anchors = a || {}; return firstLoaded(); }).then((first) => {
  if (!first) { const er = $('loaderr'); er.style.display = 'block'; er.textContent = '3D 모델(models/*.glb)을 불러오지 못했어요. 서버가 켜져 있는지, models 폴더가 있는지 확인해 주세요.'; return; }
  warmShaders(renderer, scene, camera, composer.renderTarget1); composer.render(); // 셰이더를 로딩 화면 뒤에서 미리 만든다(처음 보일 때 멈춤 방지, perf-mode.js)
  $('load').classList.add('off');
  loadRest().then(() => { const failed = procs.filter((p) => !p.loaded); if (failed.length) toast(`${failed.map((p) => p.data.name).join('·')} 모델을 불러오지 못해 탭을 닫아 두었어요`, 5000); });
  requestAnimationFrame(frame);
  setTimeout(() => show(first), 250);
});
