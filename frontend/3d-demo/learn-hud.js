// 학습 상태 HUD + 장면 마감(블룸·도착 연출). 설계 노트는 저장소 밖에 둔다
// <steel-scene>(scene_v3.js)을 고치지 않고 바깥에서 붙는다(sleek-overview.js·night-lights.js와 같은 방식). 순수 계산은 learn-hud-state.js.
// - 설비 이름표(e.label)에 학습 상태 핀(통과·다시 보기·미확인)과 숫자 칩(data_v2.js facts, 선택·호버 때만)을 붙인다.
// - '다시 보기' 설비(미해결 오개념·재도전 개념)는 바닥에 호박색 맥동 링을 둔다. 통과 설비는 핀만.
// - focus(설비)로 카메라가 도착하는 순간 바닥에 한 번 퍼지는 링(도착 연출). 클릭·튜터 화면 조작·주소(?eq=) 모두 같은 길을 지난다.
// - 다크 모드에서 블룸(UnrealBloomPass → OutputPass). localStorage 'st-rookie:bloom' = 'off'면 끄고, 평균 프레임 간격이 40ms를 넘으면 스스로 끈다.
// - 학습 상태는 로그인 토큰이 있을 때만 읽는다(GET /api/sections, /api/sections/:section/progress, /api/me/misconceptions). 없으면 숫자 칩만.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutputPass.js/+esm';
import { createApiClient } from './api-client.js';
import { PIN, conceptStatuses, equipmentStatuses, groupBySection, factChip, pinVisibility } from './learn-hud-state.js';

const BLOOM_KEY = 'st-rookie:bloom';
const BLOOM_AUTO_KEY = 'st-rookie:bloom-auto';
const BLOOM = { strength: 0.4, radius: 0.3, threshold: 1.2 }; // 톤매핑 전 HDR 값 기준. 1.2 아래(건물·바닥 지도)는 번지지 않고 쇳물·탕도·투광등만 번진다
const SLOW_MS = 40, SLOW_FRAMES = 90; // 연속 90프레임 평균 간격이 40ms(25fps)를 넘으면 블룸을 끈다
const REFRESH_GAP_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { get(k) { try { return localStorage.getItem(k) || sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }, session(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

function injectStyle() {
  if (document.getElementById('lh-style')) return;
  const s = document.createElement('style'); s.id = 'lh-style';
  s.textContent = `
    .lh-pin { display: none; align-items: center; gap: 4px; margin-top: 3px; text-decoration: none; line-height: 1; }
    .lh-pin.on { display: inline-flex; }
    .lh-pin > b { display: none; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: .01em; color: #fff; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.18); white-space: nowrap; }
    .lh-pin > b.on { display: inline-flex; }
    .lh-pin > b > em { width: 6px; height: 6px; border-radius: 50%; font-style: normal; background: currentColor; box-shadow: 0 0 0 0 currentColor; }
    .lh-pin > b.pulse > em { animation: lhPulse 1.6s ease-out infinite; }
    .lh-pin > b.lh-fact { font-family: "IBM Plex Mono", monospace; font-weight: 700; color: #ffd9a8; border-color: rgba(255,158,100,.45); background: rgba(255,158,100,.1); }
    @keyframes lhPulse { 0% { box-shadow: 0 0 0 0 currentColor; opacity: 1; } 70% { box-shadow: 0 0 0 7px transparent; opacity: 1; } 100% { box-shadow: 0 0 0 0 transparent; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .lh-pin > b.pulse > em { animation: none; } }`;
  document.head.appendChild(s);
}

/** 바닥 링(맥동·도착 공용). 월드 좌표에 둔다(e.focus는 월드 좌표). */
function ringMesh(color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.84, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 9; m.raycast = () => {}; m.name = 'LEARN_HUD_RING';
  return m;
}
const groundY = (zone) => 0.06 + (zone?.anchorMode ? 0.4 : 0); // scene_v3.js _spotlight의 바닥 번짐과 같은 높이
const ringRadius = (e) => Math.max(3, (e.dist || 20) * 0.2);

/**
 * @param {{ api?: ReturnType<typeof createApiClient>, el?: HTMLElement }} [options]
 */
export async function attachLearnHud({ api = createApiClient(), el: given = null } = {}) {
  let el = given;
  while (!(el = el || document.querySelector('steel-scene'))) await sleep(100);
  while (!el.scene || !el.zones || !el.renderer || !el.eqs) await sleep(120);
  if (el.__learnHud) return el.__learnHud;
  injectStyle();
  const hud = { statuses: {}, rings: new Map(), arrivals: [], pending: null, bloomOn: false, dark: (el.getAttribute('theme') || 'dark') === 'dark', lastRefresh: 0 };
  el.__learnHud = hud; el.learnHud = hud;
  const allEqs = () => Object.values(el.zones).flatMap((z) => z.eqs || []);

  // ---- 이름표 핀 -------------------------------------------------------------------------
  const pinOf = (e) => {
    if (e._lhPin) return e._lhPin;
    const s = document.createElement('s'); s.className = 'lh-pin';
    const st = document.createElement('b'); st.className = 'lh-st'; st.appendChild(document.createElement('em')); st.appendChild(document.createElement('span'));
    const fc = document.createElement('b'); fc.className = 'lh-fact';
    const fact = factChip(e.data);
    if (fact) { fc.textContent = fact.value; fc.title = fact.label + (fact.src ? ` · 출처: ${fact.src}` : ''); }
    s.append(st, fc); (e.label.querySelector('.nm') || e.label).appendChild(s); // 이름 캡슐 안, 이름 아래 줄
    return (e._lhPin = { root: s, st, fc, fact });
  };
  const statusOf = (e) => hud.statuses[e.zone]?.[e.id]?.status || 'open';
  function applyPins() {
    const sel = el.getAttribute('selected');
    for (const e of el.eqs || []) {
      const p = pinOf(e), status = statusOf(e), vis = pinVisibility(status, { selected: e.id === sel, hovered: e.id === el.hoverId, fact: p.fact });
      const pin = PIN[status] || PIN.open;
      p.root.classList.toggle('on', vis.statusChip || vis.factChip);
      p.st.classList.toggle('on', vis.statusChip); p.st.classList.toggle('pulse', !!pin.pulse);
      p.st.style.color = pin.color; p.st.style.borderColor = pin.color ? pin.color + '66' : ''; p.st.lastChild.textContent = pin.text; p.st.lastChild.style.color = '#fff';
      p.st.title = (hud.statuses[e.zone]?.[e.id]?.concepts || []).map((c) => `${c.concept_id}: ${PIN[c.status]?.text || c.status}`).join(', ');
      p.fc.classList.toggle('on', vis.factChip);
    }
  }
  const styleLabels = el._styleLabels.bind(el);
  el._styleLabels = function () { const r = styleLabels(); try { applyPins(); } catch (e) { console.warn('학습 핀 실패', e); } return r; };

  // ---- 바닥 링: '다시 보기' 맥동 + 도착 연출 ------------------------------------------------------
  function syncRings() {
    const want = new Set();
    for (const e of allEqs()) if (statusOf(e) === 'review') want.add(e);
    for (const [e, m] of hud.rings) if (!want.has(e)) { el.scene.remove(m); m.geometry.dispose(); m.material.dispose(); hud.rings.delete(e); }
    for (const e of want) {
      let m = hud.rings.get(e); if (!m) { m = ringMesh(0xf5b13d); el.scene.add(m); hud.rings.set(e, m); }
      m.position.set(e.focus.x, groundY(el.zones[e.zone]), e.focus.z); m.userData.r = ringRadius(e);
    }
    el._dirty = true;
  }
  function spawnArrival(e) {
    const m = ringMesh(0x9fd8ff); m.position.set(e.focus.x, groundY(el.zones[e.zone]) + 0.01, e.focus.z); m.userData = { r: ringRadius(e) * 1.1, t0: performance.now() };
    el.scene.add(m); hud.arrivals.push(m); el._dirty = true;
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tick(now) {
    if (hud.pending && !el.anim) { const e = (el.eqs || []).find((q) => q.id === hud.pending); hud.pending = null; if (e && !el._2d && !reduceMotion) spawnArrival(e); }
    const far = el.orbit.dist > 120, k = (Math.sin(now / 1000 * Math.PI * 2 / 1.6) + 1) / 2;
    for (const [e, m] of hud.rings) {
      const z = el.zones[e.zone], vis = !!z?.root?.visible && !el._2d && !far;
      if (m.visible !== vis) { m.visible = vis; el._dirty = true; }
      if (!vis) continue;
      m.material.opacity = reduceMotion ? 0.35 : 0.16 + 0.34 * k; m.scale.setScalar(m.userData.r * (reduceMotion ? 1 : 1 + 0.08 * k)); el._dirty = true;
    }
    if (hud.arrivals.length) {
      hud.arrivals = hud.arrivals.filter((m) => { const t = (now - m.userData.t0) / 900; if (t >= 1) { el.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; } const ease = 1 - Math.pow(1 - t, 3); m.scale.setScalar(m.userData.r * (0.45 + 1.25 * ease)); m.material.opacity = 0.7 * (1 - t); return true; });
      el._dirty = true;
    }
  }
  const frame = el._frame.bind(el);
  el._frame = function (now) { const r = frame(now); try { tick(now); } catch (e) { console.warn('학습 HUD 틱 실패', e); } return r; };
  const focus = el.focus.bind(el);
  el.focus = function (id) { const ok = focus(id); if (ok) hud.pending = id; return ok; };

  // ---- 블룸 ---------------------------------------------------------------------------------
  const R = el.renderer;
  const composer = new EffectComposer(R);
  const renderPass = new RenderPass(el.scene, el.camera), bloomPass = new UnrealBloomPass(R.getSize(new THREE.Vector2()), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(renderPass); composer.addPass(bloomPass); composer.addPass(new OutputPass());
  hud.bloom = { composer, pass: bloomPass };
  const origRender = R.render.bind(R); let inside = false, last = 0; const gaps = [];
  R.render = (scene, camera) => {
    if (inside || !hud.bloomOn || scene !== el.scene || camera !== el.camera || R.getRenderTarget() || scene.overrideMaterial) return origRender(scene, camera);
    inside = true; try { renderPass.camera = camera; composer.render(); } finally { inside = false; }
    const now = performance.now();
    if (last && now - last < 250) { gaps.push(now - last); if (gaps.length > SLOW_FRAMES) { gaps.shift(); const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length; if (avg > SLOW_MS) { store.session(BLOOM_AUTO_KEY, 'off'); setBloom(false); console.info(`[learn-hud] 평균 프레임 간격 ${avg.toFixed(1)}ms라 블룸을 껐습니다.`); } } }
    last = now;
  };
  const resize = el._resize.bind(el);
  el._resize = function () { const r = resize(); const w = this.clientWidth || 1, h = this.clientHeight || 1; composer.setSize(w, h); bloomPass.resolution.set(w, h); return r; };
  { const s = R.getSize(new THREE.Vector2()); composer.setSize(s.x, s.y); }
  const bloomAllowed = () => store.get(BLOOM_KEY) !== 'off' && store.get(BLOOM_AUTO_KEY) !== 'off';
  function setBloom(on) { hud.bloomWanted = !!on; hud.bloomOn = !!on && hud.dark && bloomAllowed(); el._dirty = true; }
  hud.setBloom = setBloom;
  const applyTheme = el._applyTheme.bind(el);
  el._applyTheme = function () { const r = applyTheme(); hud.dark = (this.getAttribute('theme') || 'dark') === 'dark'; setBloom(hud.bloomWanted); return r; };
  setBloom(true);

  // ---- 학습 상태 읽기 ------------------------------------------------------------------------
  async function refresh(force = false) {
    const now = Date.now(); if (!force && now - hud.lastRefresh < REFRESH_GAP_MS) return hud.statuses; hud.lastRefresh = now;
    if (!api.hasToken()) { hud.statuses = {}; sync(); return hud.statuses; }
    try {
      const [secs, mis] = await Promise.all([api.request('GET', '/api/sections'), api.request('GET', '/api/me/misconceptions')]);
      const bySection = groupBySection(mis.misconceptions || []), statuses = {};
      for (const s of secs.sections || []) {
        if (!s.checkpoint) continue;
        const progress = await api.request('GET', `/api/sections/${encodeURIComponent(s.section)}/progress`).catch(() => null);
        statuses[s.section] = equipmentStatuses(s.section, conceptStatuses(s.section, progress, bySection[s.section] || []));
      }
      hud.statuses = statuses;
    } catch (e) { console.warn('학습 상태를 읽지 못했어요', e); }
    sync(); return hud.statuses;
  }
  function sync() { try { el._styleLabels(); syncRings(); } catch (e) { console.warn('학습 HUD 반영 실패', e); } }
  hud.refresh = refresh;
  const activate = el._activate.bind(el);
  el._activate = function (id, fly) { const r = activate(id, fly); refresh(); sync(); return r; };
  addEventListener('focus', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  // GLB가 늦게 와서 e.focus·dist가 바뀌면 링 위치도 따라간다
  document.addEventListener('steel-model', () => sync());
  sync(); refresh(true);
  return hud;
}
