// 공정 인덱스 페이지(steel-index.html)의 3D와 UI. 설계 노트는 저장소 밖에 둔다, 설계 노트는 저장소 밖에 둔다
// 3D: 슬레이트 테이블 위에 공정 하나만 올린다. 공정을 고르면 바닥판이 앞으로 뻗고 뒷벽이 위로 솟아 ㄴ자 무대가 되고(steel-index-stage.js),
//     벽 왼쪽 위에 굵은 공정 이름, 오른쪽에 대시보드(온도 흐름·가장 뜨거운 구간·소재 흐름·학습 현황)가 켜진다. 설비(GLB의 EQ_<id> 노드)는 바닥판을 뚫고 차례로 올라온다
//     (바닥판 아래는 전역 클리핑 평면으로 자른다). 공정을 바꾸면 역순으로 가라앉고 무대도 접힌다.
// UI: v4 3D 화면(Steel Academy v4.dc.html)의 것을 옮겼다. 상단 알약 바(홈·공정 탭·외관/대시보드·닫기 | 튜터·테마·마이페이지. 재생 중에는 숨고 마우스를 위쪽에 가져가면 내려온다), 오른쪽 패널(설비 상세 → 단계 보기 / AI 튜터),
//     하단 재생 바(설비 차례로 보기 + 단계 카드 자동 넘김, 1×·2×). 아이콘·온도 보조는 steel-index-ui.js(v4에서 옮김).
// 학습 현황(벽 대시보드, 왼쪽 위 패널은 없앴다): 지금 보는 것 · 이 세션에서 본 설비 수 · 이해도 확인 상태(GET /api/sections/:section/progress, 로그인 때만) · 다시 볼 설비(GET /api/me/misconceptions의
//     미해결 체크포인트 오개념 → learn-hud-state.js의 개념→설비 표). 실제 값만 보여 주고, 로그인 전에는 안내 문구를 둔다.
// 설비 보기: 하단 점·3D 클릭(설비를 짚으면 그 설비, 그 밖은 다음 설비)·← →. 선택한 설비는 바닥의 시안 링으로 감싸고 나머지 설비는 색을 낮춘다. 전체 보기(공정만)에서는 설비 UI를 띄우지 않는다.
// 대시보드 보기: 뒷벽(공정 이름 + 대시보드 4장)이 화면에 꼭 차게 정면에서 보고, 앞에 선 공정 모델은 옅게(18%) 둬 벽이 읽히게 한다. 드래그·설비 선택·공정 바꾸기로 외관으로 돌아온다(평면 보기를 대신한다, 2026-10-14 요청).
// 튜터: learning-chat.js(createLearningChat)를 그대로 쓴다(POST /api/chat, 로그인 토큰). 페이지 컴포넌트 대신 작은 어댑터(state·setState·scene()·goProcess)를 넘긴다.
// 수치는 data_v2.js와 서버 응답에서만 가져온다. 꾸며 낸 실시간 값은 쓰지 않는다. prefers-reduced-motion이면 솟아오르기·글자 연출·자전 없이 바로 놓는다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { RoomEnvironment } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import * as DATA from './data_v2.js';
import { createLearningChat } from './learning-chat.js';
import { createApiClient } from './api-client.js';
import { conceptStatuses, equipmentStatuses, groupBySection } from './learn-hud-state.js';
import { icon, stepIcon, parseTemp, heatOf } from './steel-index-ui.js';
import { createSection } from './steel-index-section.js';
import { createStage, STAGE_H } from './steel-index-stage.js';

const { PROCESSES } = DATA;
const ORANGE = 0xff7a1a, CYAN = 0x22c7f0;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RISE = { dur: 1100, gap: 240, depth: 22, sinkGap: 60, sinkDur: 480 };
const THEME_KEY = 'st-rookie:index-theme';
const TOUR_MS = 5200;      // 재생 바: 설비 하나당 최소 머무는 시간(1×). 단계가 많으면 단계당 2.6초
const STEP_MS = 2600;

const stage = document.getElementById('stage'), hud = document.getElementById('hud');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), STAGE_H + 0.001)]; // 바닥판 밑면(= 테이블 윗면, y=-STAGE_H) 아래는 그리지 않는다
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
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;
Object.assign(key.shadow.camera, { left: -50, right: 50, top: 45, bottom: -45, near: 10, far: 260 });
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x7fb0ff, 0.4); fill.position.set(60, 40, -30); scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(10, 30, -90); scene.add(rim);
const warm = new THREE.PointLight(0xff8a2a, 0, 30, 1.6); scene.add(warm);

// ---- 슬레이트 테이블 -----------------------------------------------------------------------------
function slateTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#7a7d83'; x.fillRect(0, 0, 512, 512);
  const img = x.getImageData(0, 0, 512, 512), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(img, 0, 0);
  x.globalAlpha = 0.18; for (let i = 0; i < 90; i++) { x.strokeStyle = Math.random() < 0.5 ? '#9a9da4' : '#5a5d63'; x.lineWidth = 0.6 + Math.random() * 1.6; x.beginPath(); const sx = Math.random() * 512, sy = Math.random() * 512; x.moveTo(sx, sy); x.lineTo(sx + (Math.random() - 0.5) * 220, sy + (Math.random() - 0.5) * 60); x.stroke(); }
  // 피드백: 인더스트리얼 격자 바닥. 옅은 격자선(거칠기 맵에 들어가 빛에 따라 은은히 보인다)
  x.globalAlpha = 0.22; x.strokeStyle = '#4a4e55'; x.lineWidth = 1.2; for (let i = 0; i <= 512; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); } x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2.4); t.colorSpace = THREE.NoColorSpace; return t;
}
const slateMap = slateTexture();
const tableMat = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.78, metalness: 0.18, roughnessMap: slateMap, bumpMap: slateMap, bumpScale: 0.12 });
const table = new THREE.Mesh(new THREE.BoxGeometry(150, 6, 90), tableMat); table.position.y = -3 - STAGE_H; table.receiveShadow = true; scene.add(table);
const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(150, 6, 90)), new THREE.LineBasicMaterial({ color: 0x3a3e45, transparent: true, opacity: 0.8 })); edge.position.y = -3 - STAGE_H; scene.add(edge);
const stage3d = createStage({ scene, slateMap, reduced: REDUCED }); // ㄴ자 무대(바닥판 + 뒷벽 + 벽 대시보드)

// ---- 테마(3D 영역만. 화면 틀은 v4처럼 항상 어둡다) ------------------------------------------------------------
let theme = 'dark';
try { theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (e) {}
function applyTheme() {
  const dark = theme === 'dark';
  scene.background = new THREE.Color(dark ? 0x0d1114 : 0xdfe3e8); scene.fog = new THREE.Fog(dark ? 0x0d1114 : 0xdfe3e8, 160, 320);
  tableMat.color.setHex(dark ? 0x24272c : 0x8e949b); edge.material.color.setHex(dark ? 0x3a3e45 : 0xb9bec6);
  hemi.color.setHex(dark ? 0xbfd2e0 : 0xf0f5ff); hemi.groundColor.setHex(dark ? 0x1a1410 : 0x5c6470); hemi.intensity = dark ? 0.55 : 0.8;
  key.intensity = dark ? 1.4 : 1.7; renderer.toneMappingExposure = dark ? 1.0 : 1.05;
  $('icTheme').src = icon(dark ? 'sun' : 'moon', '#e6ebf1'); $('btnTheme').title = dark ? '라이트 모드로' : '다크 모드로';
  stage3d.setTheme(dark);
}
$('btnTheme').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} applyTheme(); };

// ---- 공정 자리 발광 테두리 + 선택 설비 링 ----------------------------------------------------------------
function glowTexture() {
  if (glowTexture.t) return glowTexture.t;
  const c = document.createElement('canvas'); c.width = 256; c.height = 192; const x = c.getContext('2d');
  x.shadowColor = 'rgba(255,255,255,1)'; x.shadowBlur = 26; x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 3;
  x.beginPath(); x.roundRect(28, 28, 200, 136, 18); x.stroke(); x.stroke();
  return (glowTexture.t = new THREE.CanvasTexture(c));
}
const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTexture(), color: ORANGE, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12; glow.renderOrder = 1; scene.add(glow);
// 선택한 설비를 감싸는 바닥 링(v4의 선택 링과 같은 시안). 참고 영상의 '선택 돔' 역할을 가볍게 한다
// 선택한 설비: 바닥에 굵은 링을 두지 않고, 15% 불투명 물결 두 개가 바깥으로 퍼진다(2026-10-13 요청)
const ripples = [0, 1].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.1; r.renderOrder = 2; r.raycast = () => {}; scene.add(r); return r; });
let rippleR = 3;

// ---- 공정·설비 -------------------------------------------------------------------------------------
const loader = new GLTFLoader();
let anchors = {};
const procs = PROCESSES.map((p, i) => ({ id: p.id, data: p, idx: i, root: null, eqs: [], loaded: false, error: null, foot: null, seen: new Set(), progress: null, review: new Set() }));
let cur = null, curEq = null, seq = null, sinking = null, mode = 'overview';
let panel = null, stepIdx = 0, tour = null, speed = 1;
const loadbar = $('loadbar'); let loadedN = 0;
const api = createApiClient();
// 단면 연출(엑스레이 + 색 층 + step-fx). 단계 보기에서만 켠다
const section = createSection({ scene, renderer, hud, getCamera: () => camera, getAnchors: () => anchors, isDark: () => theme === 'dark', onHotspot: (i) => focusHotspot(i) });
// 3D 핫스팟 핀 ↔ 오른쪽 패널 '현장 포인트' 행을 잇는다(점진적 공개)
function focusHotspot(i) { section.highlight(i); right.querySelectorAll('[data-hot]').forEach((r) => { const on = r.dataset.hot === String(i); r.classList.toggle('on', on); if (on) r.scrollIntoView({ block: 'nearest', behavior: REDUCED ? 'auto' : 'smooth' }); }); }
let typer = null;
function typewrite(el, text) { clearInterval(typer); if (REDUCED) { el.textContent = text; return; } let i = 0; el.textContent = ''; const caret = document.createElement('span'); caret.style.color = 'var(--hot)'; caret.textContent = '▍'; el.appendChild(caret); typer = setInterval(() => { i++; el.firstChild.nodeValue = text.slice(0, i); if (i >= text.length) { clearInterval(typer); caret.remove(); } }, Math.max(12, Math.min(28, 1400 / Math.max(1, text.length)))); el.insertBefore(document.createTextNode(''), caret); }
function formulaChips(fml) { if (!fml || !fml.includes('→')) return ''; const [l, r] = fml.split('→').map((t) => t.split('+').map((q) => q.trim()).filter(Boolean)); const chip = (t, hot) => `<span style="padding:6px 10px;border-radius:8px;background:${hot ? 'rgba(255,154,46,.2)' : 'rgba(255,255,255,.08)'};border:1px solid ${hot ? 'rgba(255,154,46,.6)' : 'rgba(255,255,255,.18)'};color:${hot ? '#ffd27a' : '#e6ebf1'};font:700 15px/1 var(--f-mono)">${esc(t)}</span>`; const plus = '<span style="color:#9aa3ad;font:400 15px/1 var(--f-mono)">+</span>'; return `<div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;padding:12px;border-radius:10px;background:rgba(0,0,0,.28)"><span style="font:400 15px/1 var(--f-body);color:#c3ccd7">무엇이 조합되나요</span><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">${l.map((t) => chip(t, false)).join(plus)}<span style="color:#ff9a2e;font:700 18px/1 var(--f-mono)">→</span>${r.map((t) => chip(t, true)).join(plus)}</div></div>`; }

function tuneMaterial(o) {
  const m = o.material = o.material.clone(), nm = m.name || '';
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
  m.userData.color = m.color.clone(); m.userData.emissive = m.emissive ? m.emissive.clone() : null; m.userData.emissiveI = m.emissiveIntensity;
}
const loadAll = () => Promise.all(procs.map((p) => new Promise((resolve) => {
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
    loadedN++; loadbar.style.width = `${Math.round(loadedN / procs.length * 100)}%`; resolve(true);
  }, undefined, (err) => { p.error = err?.message || '모델을 불러오지 못했어요'; p.tab?.setAttribute('disabled', ''); p.tab?.setAttribute('title', `${p.data.name}: 3D 모델을 불러오지 못했어요`); loadedN++; loadbar.style.width = `${Math.round(loadedN / procs.length * 100)}%`; resolve(false); });
})));

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
  stage3d.setLearning({ now: curEq ? curEq.data.name : '공정 전체', seen: p.seen.size, total: p.eqs.length, cp, cpTone, review: [...p.review].filter((id) => p.eqs.some((e) => e.id === id)).length });
}

// ---- 상단 알약 바 --------------------------------------------------------------------------------------
$('icHome').src = icon('home', '#111111', 1.8); $('btnHome').classList.add('on'); $('btnHome').onclick = () => { location.href = '/login_ui/home-sleek.html'; };
$('icClose').src = icon('close', '#e6ebf1', 1.8); $('btnClose').onclick = () => leaveStep();
$('icBot').src = icon('bot', '#e6ebf1', 1.6); $('btnTutor').onclick = () => (panel === 'tutor' ? closePanel() : openTutor());
$('icUser').src = icon('user', '#e6ebf1', 1.6); $('btnUser').onclick = () => { location.href = '/login'; };
$('btnView3d').onclick = () => setView('3d'); $('btnViewBoard').onclick = () => setView('board');
const tabs = $('tabs');
procs.forEach((p) => { const b = document.createElement('button'); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', 'false'); b.innerHTML = `<code>${p.data.num}</code>${p.data.name}`; b.onclick = () => show(p); p.tab = b; tabs.appendChild(b); });
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms); }

// ---- 하단 재생 바 --------------------------------------------------------------------------------------
$('icPlay').src = icon('play', '#f2f2f2', 1.6);
$('btnPlay').onclick = () => (tour ? stopTour() : startTour());
$('btnSpeed').onclick = () => { speed = speed === 1 ? 2 : 1; $('btnSpeed').textContent = `${speed}×`; if (tour) tour.t0 = performance.now(); };
function renderTrack(p) {
  const tr = $('track'); tr.innerHTML = '';
  p.eqs.forEach((e) => { const b = document.createElement('button'); b.className = 'stop'; b.innerHTML = `<i></i><span>${esc(e.data.name)}</span>`; b.onclick = () => enterStep(e); e.dot = b; tr.appendChild(b); });
}
function startTour() { if (!cur || seq || sinking) return; tour = { t0: performance.now() }; document.body.classList.add('touring'); $('icPlay').src = icon('stop', '#f2f2f2', 1.6); $('btnPlay').title = '멈추기'; enterStep(curEq || cur.eqs[0], false); }
function stopTour() { tour = null; document.body.classList.remove('touring', 'peek'); $('icPlay').src = icon('play', '#f2f2f2', 1.6); $('btnPlay').title = '설비 차례로 보기'; }
// 재생 중 알약 바: 마우스가 화면 위쪽 56px 안에 오면 내려오고, 110px 아래로 내려가면 다시 숨는다(바 위에 있는 동안은 유지). 키보드로 바에 초점이 가도 내려온다
addEventListener('pointermove', (e) => { if (!tour) return; const on = document.body.classList.contains('peek'), want = e.clientY < (on ? 110 : 56); if (want !== on) document.body.classList.toggle('peek', want); });
$('top').addEventListener('focusin', () => document.body.classList.add('peek'));

// ---- 오른쪽 패널 ------------------------------------------------------------------------------------------
const right = $('right');
function closePanel() { panel = null; right.classList.remove('on'); right.innerHTML = ''; document.body.classList.remove('panel'); section.hide(); clearInterval(typer); }
function openPanel(kind) { panel = kind; right.classList.add('on'); document.body.classList.add('panel'); renderPanel(); }
function renderPanel() {
  if (!panel || !cur) return;
  if (panel === 'tutor') return renderTutor();
  const e = curEq; if (!e) return closePanel();
  const d = e.data;
  if (panel === 'eq') {
    section.hide(); clearInterval(typer);
    const steps = (d.steps || []).map((s, i) => `<button data-i="${i}"><span class="tile"><img class="ic" width="30" height="30" alt="" src="${icon(stepIcon(s.zone), '#dfe5ec', 1.5)}"></span><span><span class="zone"><span>${esc(s.zone)}</span>${s.temp ? `<code>${esc(s.temp)}</code>` : ''}</span><span class="tx">${esc(s.text)}</span></span></button>`).join('');
    right.innerHTML = `<div class="scroll">
        <span class="eyebrow">${cur.data.num} · ${esc(cur.data.name)}</span><h1>${esc(d.name)}</h1>
        <button class="x" id="pxClose" title="닫기" aria-label="닫기"><img class="ic" width="22" height="22" alt="" src="${icon('close', '#e6ebf1', 1.8)}"></button>
        <h2>역할</h2><p>${esc(d.role || '')}</p>
        ${d.input || d.output ? `<div class="io"><div><small>들어오는 소재</small><b>${esc(d.input || '-')}</b></div><span>→</span><div><small>나가는 소재</small><b>${esc(d.output || '-')}</b></div></div>` : ''}
        ${(d.notes || []).length ? `<h2>알아 두기</h2>${d.notes.map((n) => `<p class="note"><i>—</i><span>${esc(n)}</span></p>`).join('')}` : ''}
        ${steps ? `<h2>단계별 설명 · ${d.steps.length}단계</h2><div class="steps">${steps}</div>` : ''}
      </div>
      <div class="foot"><button id="askEq"><img class="ic" width="22" height="22" alt="" src="${icon('bot', '#e6ebf1', 1.6)}">튜터에게 묻기</button>${steps ? `<button class="primary" id="openSteps">단계 보기</button>` : ''}</div>`;
    $('pxClose').onclick = () => closePanel();
    $('askEq').onclick = () => { openTutor(); chat?.ask(`${d.name}은(는) 어떤 역할을 하나요?`); };
    $('openSteps')?.addEventListener('click', () => { stepIdx = 0; openPanel('steps'); });
    right.querySelectorAll('.steps button').forEach((b) => { b.onclick = () => { stepIdx = +b.dataset.i; openPanel('steps'); }; });
    return;
  }
  if (panel === 'steps') {
    const st = d.steps?.[stepIdx]; if (!st) return openPanel('eq');
    const lay = d.interior?.[stepIdx] || null; // 같은 번호의 단면 층(라벨·수식)
    const rng = parseTemp(st.temp || lay?.temp), hi = rng ? rng[1] : 0, [hA, hB, hC] = heatOf(hi), pct = (v) => `${Math.min(100, Math.max(0, v / 2000 * 100)).toFixed(1)}%`;
    // 단면 연출을 먼저 켜서 핫스팟 글(현장 포인트)을 패널에 함께 그린다
    const ok = section.show(cur, e), L = ok ? section.layer(stepIdx) : null, hots = L?.hotspots || [], kpi = d.facts?.[0] || null;
    right.innerHTML = `<div class="scroll stepcard">
        <!-- L1: 설비 · 단계 · 상태 -->
        <div class="lv l1"><div style="display:flex;align-items:center;gap:12px"><img class="ic" width="40" height="40" alt="" src="${icon(d.shape || 'box', '#e6ebf1', 1.4)}"><div style="flex:1;min-width:0"><div class="eyebrow">${cur.data.num} · ${esc(cur.data.name)} · ${esc(d.name)}</div><h1 style="margin-top:6px;font-size:22px">${String(stepIdx + 1).padStart(2, '0')} ${esc(st.zone)}</h1></div><button class="x" style="position:static" id="stBack" title="설비 설명으로" aria-label="설비 설명으로"><img class="ic" width="22" height="22" alt="" src="${icon('close', '#e6ebf1', 1.8)}"></button></div>
          <div class="badges"><span class="badge ${tour ? 'run' : ''}">${tour ? '재생 중' : '단계 보기'} · ${stepIdx + 1} / ${d.steps.length}</span>${ok ? '<span class="badge">단면</span>' : ''}</div></div>
        <!-- L2: 핵심 수치(예시 온도) · 현장 포인트 -->
        <div class="lv l2"><div class="lvh">핵심 수치 · 현장 포인트</div>
          ${rng ? `<div class="heat"><div class="bg" style="background:radial-gradient(circle at 30% 55%, ${hA} 0%, transparent 55%), radial-gradient(circle at 75% 35%, ${hB} 0%, transparent 50%)"></div>
            <span class="lab">해당 영역의 온도(예시)</span><span class="val" style="color:${hC}">${esc(st.temp || lay?.temp || '')}</span>
            <div><div class="bar"></div><div class="fill" style="left:${pct(rng[0])};width:calc(${pct(rng[1])} - ${pct(rng[0])});box-shadow:0 0 6px ${hA}"></div><div class="scale"><span>0℃</span><span>500</span><span>1,000</span><span>1,500</span><span>2,000℃</span></div></div>
            ${lay?.label ? `<span class="lab" style="line-height:1.5">${esc(lay.label)}</span>` : ''}
            <span class="note2">원본 예시값 · 검증 필요 · 교육용 개념 표현으로, 실제 운전 조건과 다를 수 있습니다.</span></div>` : ''}
          ${kpi ? `<div class="kpi"><b>${esc(kpi.v)}</b><span>${esc(kpi.k)}</span><small>출처 · ${esc(kpi.src || '-')}</small></div>` : ''}
          ${hots.length ? `<ul class="hots">${hots.map((h) => `<li data-hot="${h.i}"><button type="button"><i></i><span><b>${esc(h.text)}</b>${h.sub ? `<small>${esc(h.sub)}</small>` : ''}</span></button></li>`).join('')}</ul>` : ''}
        </div>
        <!-- L3: 원리 · 반응 -->
        <div class="lv l3"><div class="lvh">원리 · 반응</div>
          <p id="stText" style="margin:0 2px;font-size:16px;line-height:1.65;color:#d6dde6;min-height:3.3em">${esc(st.text)}</p>
          ${formulaChips(lay?.formula)}</div>
        <div class="nav"><button id="stPrev">‹ 이전 단계</button><button id="stNext">다음 단계 ›</button></div>
      </div>`;
    typewrite($('stText'), st.text);
    right.querySelectorAll('[data-hot] button').forEach((b) => { b.onclick = () => focusHotspot(+b.parentElement.dataset.hot); });
    if (L && view === '3d') animateTo({ yaw: orbit.yaw, pitch: 0.16, dist: Math.max(12, L.span * 2.1), target: L.target }, 1000);
    $('stBack').onclick = () => openPanel('eq');
    $('stPrev').onclick = () => { stepIdx = (stepIdx - 1 + d.steps.length) % d.steps.length; renderPanel(); };
    $('stNext').onclick = () => { stepIdx = (stepIdx + 1) % d.steps.length; renderPanel(); };
  }
}

// ---- AI 튜터(learning-chat.js 어댑터) --------------------------------------------------------------------------
const page = {
  state: { processId: 'ironmaking', selectedId: null, messages: [], input: '', pending: false, lastReq: null, lastRes: null, lastResults: [], speed: 1, tutorOpen: false, devOpen: false },
  setState(u) { Object.assign(page.state, typeof u === 'function' ? u(page.state) : u); if (panel === 'tutor') renderTutor(); else if (page.state.messages.length && page.state.messages[page.state.messages.length - 1].role === 'assistant' && !page.state.pending) $('btnTutor').classList.add('unread'); },
  data: DATA, chatRef: { current: null },
  scrollChat() { requestAnimationFrame(() => { const el = $('chatBox'); if (el) el.scrollTop = el.scrollHeight; }); },
  scene: () => sceneFacade, goProcess: (id) => { const p = procs.find((q) => q.id === id); if (p) show(p); },
};
const sceneFacade = { localName: 'steel-scene', get process() { return cur ? { id: cur.id } : null; }, focus(id) { const e = cur?.eqs.find((q) => q.id === id); if (!e || !e.up) return false; enterStep(e, false); return true; }, play() { startTour(); return !!tour; } };
let chat = null;
createLearningChat(page).then((c) => { chat = c; if (panel === 'tutor') renderTutor(); });
function openTutor() { page.state.tutorOpen = true; $('btnTutor').classList.remove('unread'); openPanel('tutor'); page.scrollChat(); }
function renderTutor() {
  const v = chat?.vals(DATA) || { messages: [], chips: [], input: '', pending: false };
  const msgs = v.messages.map((m) => m.isUser ? `<div class="msg user">${esc(m.text)}</div>`
    : m.isSafety ? `<div class="msg safety">${esc(m.text)}</div>`
    : m.evidence === 'error' ? `<div class="msg err"><img class="ic" width="24" height="24" alt="" src="${icon('alert', '#f5b13d', 1.6)}"><span>답변을 받지 못했어요 · ${esc(m.text)}</span></div>`
    : `<div class="msg ai"><div class="b">${esc(m.text)}</div>${(m.citations || []).map((c) => `<span class="cite">근거 · ${esc(c.title)}</span>`).join('')}${m.hasFollowUp ? `<button class="fu" data-fu="1"><span style="font-size:15px;color:var(--muted)">이어서 물어보기</span><span>${esc(m.followUp)}</span></button>` : ''}</div>`).join('');
  right.innerHTML = `<div class="tutorhead"><div style="flex:1"><h1>AI 튜터</h1><small>${cur ? `${cur.data.num} ${esc(cur.data.name)}${curEq ? ` · ${esc(curEq.data.name)}` : ''} 화면을 보고 답해요` : '궁금한 것을 물어보세요'}</small></div><button class="x2" id="tClose" title="닫기" aria-label="닫기"><img class="ic" width="22" height="22" alt="" src="${icon('close', '#e6ebf1', 1.8)}"></button></div>
    <div class="chat" id="chatBox">${msgs}${v.pending ? '<div class="typing"><i></i><i></i><i></i></div>' : ''}
      <div class="chiphead">추천 질문<i></i></div><div class="chips">${(v.chips || []).map((c, i) => `<button data-chip="${i}">${esc(c.text)}</button>`).join('')}</div></div>
    <form class="send" id="sendForm"><input id="chatInput" value="${esc(v.input || '')}" placeholder="${cur ? `${esc(cur.data.name)} 공정에 대해 물어보세요` : '질문을 입력하세요'}" autocomplete="off" aria-label="튜터에게 질문"><button type="submit">보내기</button></form>`;
  $('tClose').onclick = () => closePanel();
  right.querySelectorAll('[data-chip]').forEach((b) => { b.onclick = () => v.chips[+b.dataset.chip].onClick(); });
  right.querySelectorAll('[data-fu]').forEach((b, i) => { const ms = v.messages.filter((m) => m.hasFollowUp); b.onclick = () => ms[i]?.askFollowUp(); });
  const input = $('chatInput'); input.oninput = (e) => { page.state.input = e.target.value; };
  $('sendForm').onsubmit = (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; page.state.input = t; chat?.ask(t); };
  page.scrollChat();
}

// ---- 설비 칩(3D 위). 외관: 지금 설비 하나, 평면: 모든 설비 번호 -----------------------------------------------------
function tagFor(e) {
  if (e.tag) return e.tag;
  const t = document.createElement('div'); t.className = 'tag'; t.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-100%);opacity:0;transition:opacity .3s;display:flex;flex-direction:column;align-items:center;gap:6px;white-space:nowrap;pointer-events:none;';
  t.innerHTML = `<span class="k" style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px 7px 7px;background:rgba(13,17,20,.86);border:1px solid rgba(255,255,255,.2);color:#fff;font:600 15px/1 var(--f-body);border-radius:999px;backdrop-filter:blur(6px)"><i style="width:22px;height:22px;border-radius:50%;background:#22c7f0;color:#04202b;font:700 12px/1 var(--f-mono);font-style:normal;display:grid;place-items:center">${e.i + 1}</i><span class="nm">${esc(e.data.name)}</span></span><span class="ld" style="width:1px;height:22px;background:linear-gradient(#c9d1d6,transparent)"></span>`;
  hud.appendChild(t); return (e.tag = t);
}

// ---- 공정 보이기 / 가라앉히기 ------------------------------------------------------------------------
function fitHome(p) {
  const b = stage3d.bounds() || p.bounds, s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const span = Math.max(s.x * 1.04, s.z * 1.3, s.y * 2.0, 16), dist = span / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(0.7, Math.min(1.4, camera.aspect));
  return { yaw: -0.3, pitch: 0.36, dist: Math.max(22, dist), target: new THREE.Vector3(c.x, s.y * 0.36, c.z + 2) }; // 벽 대시보드가 읽히게 거의 정면에서
}
async function show(p, replay = false) {
  if (!p.loaded) { toast(`${p.data.name}: 3D 모델을 불러오지 못했어요`); return; }
  stopTour(); if (view === 'board') setView('3d', false); // 공정을 바꾸면 외관으로(앞 공정의 옅게 한 재질도 되돌린다)
  if (cur && cur !== p) await sink(cur);
  if (cur === p && !replay) return;
  cur = p; curEq = null; mode = 'overview'; page.state.processId = p.id; page.state.selectedId = null;
  procs.forEach((q) => { q.tab.classList.toggle('on', q === p); q.tab.setAttribute('aria-selected', String(q === p)); });
  renderTrack(p); if (panel !== 'tutor') closePanel(); else renderTutor(); clearDim(p); loadProgress(p);
  const { w, d, cx, cz } = p.foot;
  glow.position.set(cx, 0.12, cz); glow.scale.set(w + 9, d + 9, 1);
  stage3d.build(p); stage3d.play(performance.now()); stage3d.setEquipment(null); renderProg(p);
  home = fitHome(p); orbit.dist = home.dist * 1.3; orbit.yaw = home.yaw - 0.1; animateTo(home, 2200);
  p.root.visible = true;
  p.eqs.forEach((e) => { tagFor(e); e.up = false; e.y = -RISE.depth; e.node.position.y = e.baseY + e.y; });
  syncUi();
  if (REDUCED) { p.eqs.forEach((e) => { e.up = true; e.y = 0; e.node.position.y = e.baseY; }); glow.material.opacity = 0.14; return; }
  seq = { t0: performance.now() + 650 }; // 바닥판이 다 뻗은 뒤 설비가 솟는다
}
function sink(p) {
  return new Promise((resolve) => {
    seq = null; mode = 'overview'; stage3d.sink(performance.now()); curEq = null; syncUi(); clearDim(p);
    const n = p.eqs.length, total = REDUCED ? 1 : RISE.sinkDur + n * RISE.sinkGap + 150;
    sinking = { p, t0: performance.now(), total, resolve: () => { p.root.visible = false; resolve(); } };
  });
}

// ---- 설비 보기 ---------------------------------------------------------------------------------------
function clearDim(p) { section.hide(); warm.intensity = 0; ripples.forEach((r) => { r.material.opacity = 0; }); p.eqs.forEach((q) => q.node.traverse((o) => { if (!o.isMesh || !o.material.userData.color) return; const m = o.material; m.color.copy(m.userData.color); if (m.userData.emissive) { m.emissive.copy(m.userData.emissive); m.emissiveIntensity = m.userData.emissiveI; } })); }
function enterStep(e, userAct = true) {
  if (!cur || !e || !e.up || sinking) return;
  if (userAct && tour) stopTour();
  if (curEq !== e) section.hide();
  mode = 'step'; curEq = e; page.state.selectedId = e.id; stepIdx = 0; cur.seen.add(e.id);
  if (tour) tour.t0 = performance.now();
  openPanel(tour ? 'steps' : 'eq');
  renderProg(cur); stage3d.setEquipment(e); syncUi();
  const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3());
  warm.position.set(c.x, e.box.max.y + 2, c.z); warm.intensity = 14;
  ripples.forEach((r) => r.position.set(c.x, 0.1, c.z)); rippleR = Math.max(2.5, Math.max(s.x, s.z) * 0.62);
  cur.eqs.forEach((q) => q.node.traverse((o) => { if (!o.isMesh || !o.material.userData.color) return; const m = o.material; if (q === e) { m.color.copy(m.userData.color); if (m.userData.emissive) { m.emissive.copy(m.userData.emissive); m.emissiveIntensity = m.userData.emissiveI; } } else { m.color.copy(m.userData.color).multiplyScalar(0.6); if (m.userData.emissive) m.emissiveIntensity = m.userData.emissiveI * 0.5; } }));
  if (view === 'board') setView('3d', false); // 설비를 고르면 대시보드 보기에서 나온다
  animateTo(eqPose(e, orbit.yaw), 1200);
}
function step(dir, userAct = true) { if (!cur) return; const n = cur.eqs.length, i = curEq ? (curEq.i + dir + n) % n : (dir > 0 ? 0 : n - 1); enterStep(cur.eqs[i], userAct); }
function leaveStep() { if (!cur) return; stopTour(); mode = 'overview'; curEq = null; page.state.selectedId = null; clearDim(cur); if (panel !== 'tutor') closePanel(); renderProg(cur); stage3d.setEquipment(null); syncUi(); if (view === '3d') animateTo(home, 1100); }
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
const eqPose = (e, yaw) => { const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3()); return { yaw, pitch: 0.34, dist: Math.max(14, Math.max(s.x, s.z, s.y) * 2.4), target: new THREE.Vector3(c.x - s.x * 0.15, c.y, c.z) }; };
function boardPose() { // 뒷벽 전체(폭 W, 높이 Hw)가 화면에 꼭 차게 정면에서 조금 위에서. 벽 폭은 화면 폭의 90%, 높이는 세로의 75%쯤
  const b = stage3d.bounds(); if (!b) return home;
  const W = b.max.x - b.min.x, Hw = b.max.y - b.min.y, half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), a = Math.max(0.7, Math.min(2.2, camera.aspect));
  return { yaw: 0, pitch: 0.16, dist: Math.max(16, W * 1.1 / (2 * half * a), Hw * 1.35 / (2 * half)), target: new THREE.Vector3((b.min.x + b.max.x) / 2, Hw * 0.5 + 0.5, b.min.z) };
}
function setView(v, fly = true) {
  if (view === v) return; view = v;
  $('btnView3d').classList.toggle('on', v === '3d'); $('btnView3d').setAttribute('aria-pressed', String(v === '3d'));
  $('btnViewBoard').classList.toggle('on', v === 'board'); $('btnViewBoard').setAttribute('aria-pressed', String(v === 'board'));
  ghost(cur, v === 'board');
  if (fly) animateTo(v === 'board' ? boardPose() : curEq ? eqPose(curEq, home.yaw) : home, 900);
  syncUi();
}
addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') { if (panel === 'tutor') closePanel(); else leaveStep(); } else { const n = parseInt(e.key, 10); if (n >= 1 && n <= procs.length) show(procs[n - 1]); } });

// ---- 카메라·입력 --------------------------------------------------------------------------------------
let anim = null, drag = null, hot = null;
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeOutBack = (k, s = 0.9) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
function animateTo(to, dur = 1200) { anim = { t0: performance.now(), dur: REDUCED ? 1 : dur, from: { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, target: orbit.target.clone() }, to: { ...to, target: to.target.clone() } }; }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitAt(ev) {
  if (!cur) return null; const r = renderer.domElement.getBoundingClientRect(); ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
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
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 1.35); composer.addPass(bloom); composer.addPass(new OutputPass());
function resize() { const w = stage.clientWidth || 1, h = stage.clientHeight || 1; renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(stage); resize();

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
    glow.material.opacity = ks < 1 ? 0.2 + 0.7 * Math.sin(ks * Math.PI) : 0.14;
    let done = true;
    p.eqs.forEach((e, i) => { const k = Math.min(1, Math.max(0, (t - 150 - i * RISE.gap) / RISE.dur)); e.y = -RISE.depth * (1 - easeOutBack(k)); if (k >= 1) e.y = 0; e.node.position.y = e.baseY + e.y; e.up = k >= 1; if (k < 1) done = false; });
    if (done) { seq = null; syncUi(); }
  }
  if (tour && cur && !seq && curEq) {
    const n = Math.max(1, curEq.data.steps?.length || 1), hold = Math.max(TOUR_MS, STEP_MS * n) / speed, per = hold / n, el = now - tour.t0, si = Math.min(n - 1, Math.floor(el / per));
    if (panel === 'steps' && si !== stepIdx) { stepIdx = si; renderPanel(); }
    if (el >= hold) { const i = curEq.i + 1; if (i >= cur.eqs.length) { stopTour(); leaveStep(); } else enterStep(cur.eqs[i], false); }
  }
}
const v = new THREE.Vector3();
function placeHud() {
  if (!cur) return; const w = stage.clientWidth, h = stage.clientHeight;
  for (const e of cur.eqs) {
    if (!e.tag || e.tag.style.opacity === '0') continue; const c = e.box.getCenter(new THREE.Vector3());
    v.set(c.x, e.box.max.y + e.y + 0.6, c.z).project(camera); const vis = v.z < 1;
    e.tag.style.display = vis ? '' : 'none'; if (vis) e.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${Math.max(110, (1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
  }
}
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  riseTick(now);
  if (anim) { const k = Math.min(1, (now - anim.t0) / anim.dur), s = easeOut(k); orbit.yaw = anim.from.yaw + (anim.to.yaw - anim.from.yaw) * s; orbit.pitch = anim.from.pitch + (anim.to.pitch - anim.from.pitch) * s; orbit.dist = anim.from.dist + (anim.to.dist - anim.from.dist) * s; orbit.target.lerpVectors(anim.from.target, anim.to.target, s); if (k >= 1) anim = null; }
  else if (!drag && !REDUCED && mode === 'overview' && view === '3d') orbit.yaw += dt * 0.01;
  const o = orbit; camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch)); camera.lookAt(o.target);
  if (curEq && !REDUCED) { warm.intensity = 14 + 3 * Math.sin(now / 420); ripples.forEach((r, k) => { const ph = ((now / 2200) + k * 0.5) % 1; r.scale.setScalar(rippleR * (0.8 + 0.8 * ph)); r.material.opacity = 0.15 * (1 - ph); }); }
  section.tick(now); stage3d.tick(now, camera);
  composer.render(); placeHud();
}

applyTheme();
fetch('models/anchors-v2b.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((a) => { anchors = a || {}; return loadAll(); }).then(() => {
  const failed = procs.filter((p) => !p.loaded);
  if (failed.length === procs.length) { const er = $('loaderr'); er.style.display = 'block'; er.textContent = '3D 모델(models/*.glb)을 불러오지 못했어요. 서버가 켜져 있는지, models 폴더가 있는지 확인해 주세요.'; return; }
  $('load').classList.add('off');
  if (failed.length) toast(`${failed.map((p) => p.data.name).join('·')} 모델을 불러오지 못해 탭을 닫아 두었어요`, 5000);
  const q = new URLSearchParams(location.search), first = procs.find((p) => p.id === q.get('p') && p.loaded) || procs.find((p) => p.loaded);
  requestAnimationFrame(frame);
  if (first) setTimeout(() => { show(first); if (q.get('tutor')) openTutor(); }, 250);
});
