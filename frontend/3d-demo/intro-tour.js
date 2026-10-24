// 첫 화면(steel-intro) 공정 칩의 [▶ 재생]: 고른 공정만 남기고(다른 공정 숨김은 steel-intro.js의 isolate) v4 단면 보기처럼 설비를 차례로 재생한다.
// - 설비마다: 공정 모델을 반투명(엑스레이)으로, 설비 안 색 층 중 지금 단계만 밝게 + 불티(steel-index-section.js = v4 _showInterior와 step-fx),
//   설비 작동 연출(work-fx.js), 고른 설비만 초록·나머지 흑백 + 얇은 외곽선(lab-outline.js).
// - 화면: 오른쪽 단계 카드(반투명 유리, 지금 단계 하나만: 설명 · 해당 영역의 온도 · 조합), 아래 설비 재생 바(■/▶ · 설비 · 0.5×~2×).
// - 뺀 것(2026-10-16 요청): 설비 위 '최고 온도' 지시선, 3D 위 핫스팟 핀(intro-tour.css에서 숨김), 3D 화살표 → 카메라 기준 2D 화살표(아래 StepFx._arrow 바꿔 끼움).
// - 렉 줄이기: 지도의 공정 모델은 재질별로 합쳐 두었으므로(batchStatic) 재생하는 동안만 설비 단위 모델로 바꿔 끼운다(처음 한 번 불러와 기억).
//   이 모델도 설비마다 재질끼리 합친다(mergeByEquipment): 단면·외곽선은 설비 단위로만 색·투명도를 바꾸므로 겉모습은 같고 그리기 횟수만 준다.
// 공정 화면(steel-index.js)의 재생과 같은 시간 규칙: 1×에서 설비 하나당 최소 10.4초, 단계당 5.2초. 속도는 0.5·1·1.5·2×(steel-index-ui.js).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js/+esm';
import { createSection } from './steel-index-section.js';
import { StepFx } from './step-fx.js';
import { createWorkFx } from './work-fx.js';
import { createOutline } from './lab-outline.js';
import { icon, parseTemp, heatOf, TOUR_MS, STEP_MS, nextSpeed, keepProgress } from './steel-index-ui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function formulaChips(f) { if (!f || !f.includes('→')) return ''; const [l, r] = f.split('→').map((t) => t.split('+').map((q) => q.trim()).filter(Boolean)); const chip = (t, hot) => `<span class="${hot ? 'hot' : ''}">${esc(t)}</span>`; return `<div class="tp-fml"><small>무엇이 조합되나요</small><div>${l.map((t) => chip(t)).join('<i>+</i>')}<b>→</b>${r.map((t) => chip(t, true)).join('<i>+</i>')}</div></div>`; }

// ---- 2D 화살표: step-fx의 3D 화살표(원기둥+원뿔)를 이 페이지에서만 바꿔 끼운다(공정 화면은 그대로) ----------------------------------
// 시작·끝 3D 점을 매 프레임 화면 좌표로 옮겨, 그 사이에 자라나는 선 + 화살촉(SVG)을 그린다. 글은 다른 말풍선처럼 핀이 된다(숨김)
const ease = (k) => { k = Math.min(1, Math.max(0, k)); return 1 - Math.pow(1 - k, 3); };
StepFx.prototype._arrow = function (o, f) {
  const A0 = this._p(f, o.from), B0 = this._p(f, o.to); if (A0.distanceTo(B0) < 1e-4) return;
  const el = this._dom('sfx-arrow2d', `<svg width="1" height="1"><line/><path/></svg>`, A0, 'c', 0, o.color2 || o.color || '#ffffff');
  const svg = el.querySelector('svg'), line = svg.querySelector('line'), head = svg.querySelector('path'), d = o.delay || 0, dur = o.dur || 1, v = new THREE.Vector3(), a = new THREE.Vector3();
  this.items.push((t) => {
    const h = this.h, w = h.clientWidth, H = h.clientHeight, g = ease((t - d) / dur);
    a.copy(A0).project(h.camera); v.copy(B0).project(h.camera);
    const dx = (v.x - a.x) / 2 * w * g, dy = -(v.y - a.y) / 2 * H * g, L = Math.hypot(dx, dy);
    svg.style.opacity = g > 0 && L > 6 ? '1' : '0'; if (L <= 6) return;
    const ux = dx / L, uy = dy / L, hl = Math.min(14, L * 0.45), bx = dx - ux * hl, by = dy - uy * hl;
    line.setAttribute('x1', '0'); line.setAttribute('y1', '0'); line.setAttribute('x2', bx.toFixed(1)); line.setAttribute('y2', by.toFixed(1));
    head.setAttribute('d', `M${dx.toFixed(1)} ${dy.toFixed(1)}L${(bx - uy * 6).toFixed(1)} ${(by + ux * 6).toFixed(1)}L${(bx + uy * 6).toFixed(1)} ${(by - ux * 6).toFixed(1)}Z`);
  });
};

// ---- 설비 단위 모델 ------------------------------------------------------------------------------------------
/** 원본 재질 하나를 지도 장면 값으로 맞춘 복제본(steel-intro.js의 tune과 같은 값) + 외곽선·단면이 되돌릴 원래 색 */
function tuneDetail(src) {
  const m = src.clone(), nm = m.name || ''; m.envMapIntensity = 0.3;
  if (/^(Steel|Steel_Dark|Struct_Gray|Roll_Steel|Coil_Cooled|Chrome_Rod)$/.test(nm)) { m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 0.45; }
  if (nm === 'Concrete') m.color.setRGB(0.5, 0.51, 0.52);
  if (/^(Molten_Steel|Hot_Slab|Slag_Hot)$/.test(nm)) { m.emissiveIntensity = 1.6; m.toneMapped = false; }
  m.userData.color = m.color.clone(); m.userData.emissive = m.emissive ? m.emissive.clone() : null; m.userData.emissiveI = m.emissiveIntensity;
  return m;
}
/** GLB 정점은 끼워 넣은(interleaved) 형식이라 합칠 수 있게 위치·법선을 낱 배열로 푼다(steel-intro.js의 plainGeometry와 같다) */
function plainGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) { const a = src.attributes[k]; if (!a) continue; const out = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); } g.setAttribute(k, new THREE.BufferAttribute(out, 3)); }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}
/** 설비(EQ_ 노드)마다, 그리고 설비 밖 구조물은 따로, 보이는 메시를 원본 재질끼리 하나로 합친다. 합친 메시는 그 설비 노드 아래에 둔다 */
function mergeByEquipment(root, nodes) {
  const owner = (o) => { for (let q = o; q && q !== root; q = q.parent) if (nodes.includes(q)) return q; return root; };
  const shown = (o) => { for (let q = o; q && q !== root; q = q.parent) if (!q.visible) return false; return true; };
  const buckets = new Map(), meshes = []; // 주인 노드 → 원본 재질 → 형상들
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (!o.isMesh) return; meshes.push(o); if (!shown(o)) return; const n = owner(o);
    if (!buckets.has(n)) buckets.set(n, new Map()); const byMat = buckets.get(n); if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(plainGeometry(o.geometry).applyMatrix4(new THREE.Matrix4().copy(n.matrixWorld).invert().multiply(o.matrixWorld))); });
  meshes.forEach((o) => o.parent?.remove(o));
  for (const [n, byMat] of buckets) for (const [src, list] of byMat) {
    const geo = list.length > 1 ? mergeGeometries(list) : list[0]; if (!geo) continue;
    const m = new THREE.Mesh(geo, tuneDetail(src)); m.castShadow = m.receiveShadow = true; n.add(m);
  }
}

/**
 * @param {{ scene, renderer, composer, hud: HTMLElement, getCamera: () => THREE.Camera, loader, reduced: boolean,
 *   animateTo: (pose: object, ms: number) => void, yawOf: (p) => number, onEnd: (p) => void }} o
 */
export function createIntroTour({ scene, renderer, composer, hud, getCamera, loader, reduced, animateTo, yawOf, onEnd }) {
  let anchors = {}; fetch('models/anchors-v2b.json').then((r) => (r.ok ? r.json() : {})).then((a) => { anchors = a || {}; }).catch(() => {});
  const placed = {}; // 단면 층 좌표: anchors의 모델 좌표 + 지도에서 공정 자리
  const section = createSection({ scene, renderer, hud, getCamera, getAnchors: () => placed, isDark: () => true });
  const work = createWorkFx({ scene, isDark: () => true });
  const outline = createOutline(scene, getCamera());
  composer.insertPass(outline.pass, composer.passes.length - 1); // 출력 패스 앞. 고른 설비가 없으면 아무것도 그리지 않는다
  const warm = new THREE.PointLight(0xffb352, 0, 30, 1.6); scene.add(warm);

  const panel = document.createElement('aside'); panel.className = 'tpanel'; panel.setAttribute('aria-label', '설비 단계 설명'); panel.setAttribute('aria-live', 'polite');
  const bar = document.createElement('div'); bar.className = 'tbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '설비 재생');
  document.body.append(panel, bar);
  const details = new Map(); // 공정 id → { root, eqs } (설비 단위 모델, 한 번 불러와 기억)
  let run = null; // { p, d, sp, e, step, t0, playing, speed }

  function loadDetail(p) {
    if (details.has(p.id)) return Promise.resolve(details.get(p.id));
    return new Promise((resolve, reject) => loader.load(`models/${p.id}.glb`, (gltf) => {
      const root = gltf.scene; root.position.set(p.c[0], 0, p.c[1]); root.updateMatrixWorld(true);
      root.traverse((o) => { if (!o.isMesh) return; for (let q = o; q && q !== root; q = q.parent) if (/^Floor_/.test(q.name)) { o.visible = false; break; } });
      const list = p.data.equipment.map((e) => ({ e, node: root.getObjectByName(`EQ_${e.id}`) })).filter((x) => x.node);
      const eqs = list.map(({ e, node }, i) => ({ id: e.id, data: e, i, node, box: new THREE.Box3().setFromObject(node) }));
      mergeByEquipment(root, eqs.map((q) => q.node));
      const d = { root, eqs }; details.set(p.id, d); resolve(d);
    }, undefined, reject));
  }
  function paintBar() {
    const { d, e, playing, speed } = run;
    bar.innerHTML = `<button type="button" class="tb-play" data-play aria-label="${playing ? '멈추기' : '재생'}" title="${playing ? '멈추기' : '재생'}"><img class="ic" width="18" height="18" alt="" src="${icon(playing ? 'stop' : 'play', '#f2f2f2', 1.6)}"></button>
      <div class="tb-track">${d.eqs.map((q) => `<button type="button" class="tb-stop ${q === e ? 'cur' : q.i < e.i ? 'done' : ''}" data-eq="${q.i}"><i></i><span>${esc(q.data.name)}</span></button>`).join('')}</div>
      <button type="button" class="tb-speed" data-speed title="재생 속도">${speed}×</button><button type="button" class="tb-x" data-x title="재생을 끝내고 지도로 (Esc)"><span aria-hidden="true">✕</span>나가기</button>`;
    bar.querySelector('[data-play]').onclick = () => toggle();
    bar.querySelector('[data-speed]').onclick = () => { const to = nextSpeed(run.speed); run.t0 = keepProgress(run.t0, performance.now(), run.speed, to); run.speed = to; paintBar(); };
    bar.querySelector('[data-x]').onclick = () => stop();
    bar.querySelectorAll('[data-eq]').forEach((b) => { b.onclick = () => { run.playing = false; enter(run.d.eqs[+b.dataset.eq]); }; });
  }
  // 오른쪽 단계 카드: 지금 단계 하나만(1이면 1만, 2면 2만). 위 진행 막대로 몇 번째 단계인지 보인다
  function paintPanel() {
    const { p, e, step } = run, dd = e.data, steps = dd.steps || [], st = steps[step], lay = dd.interior?.[step] || null, n = steps.length;
    const rng = st ? parseTemp(st.temp || lay?.temp) : null, [hA, , hC] = heatOf(rng ? rng[1] : 0), pct = (v) => `${Math.min(100, Math.max(0, v / 2000 * 100)).toFixed(1)}%`;
    panel.innerHTML = `<header><img class="ic" width="34" height="34" alt="" src="${icon(dd.shape || 'box', '#e6ebf1', 1.4)}"><div><small>${esc(p.data.num)} · ${esc(p.data.name)}</small><h2>${esc(dd.name)}</h2></div></header>
      <div class="tp-body">${st ? `<div class="tp-prog"><span>STEP ${step + 1} / ${n}</span><div>${steps.map((_, i) => `<i class="${i < step ? 'done' : i === step ? 'on' : ''}"></i>`).join('')}</div></div>
        <h3>${esc(st.zone)}</h3><p class="tp-text">${esc(st.text)}</p>` : `<p class="tp-text">${esc(dd.role || '')}</p>`}
        ${rng ? `<div class="tp-heat" style="--hA:${hA};--hC:${hC}"><span>해당 영역의 온도(예시)</span><strong>${esc(st.temp || lay?.temp || '')}</strong>
          <div class="tp-hbar"><div class="fill" style="left:${pct(rng[0])};width:calc(${pct(rng[1])} - ${pct(rng[0])})"></div></div><div class="tp-scale"><span>0℃</span><span>500</span><span>1,000</span><span>1,500</span><span>2,000℃</span></div>
          ${lay?.label ? `<em>${esc(lay.label)}</em>` : ''}</div>` : ''}
        ${formulaChips(lay?.formula)}
        <small class="tp-note">원본 예시값 · 교육용 개념 표현으로, 실제 운전 조건과 다를 수 있습니다.</small></div>
      <footer><button type="button" data-prev>‹ 이전 단계</button><button type="button" class="primary" data-next>다음 단계 ›</button></footer>`;
    if (st) typewrite(panel.querySelector('.tp-text'), st.text); // 설명은 타자 치듯 한 글자씩(시선 유도, 공정 화면 steel-index.js의 typewrite와 같은 방식)
    panel.querySelector('[data-prev]').onclick = () => { run.playing = false; paintBar(); move(-1); };
    panel.querySelector('[data-next]').onclick = () => { run.playing = false; paintBar(); move(1); };
  }
  let typer = null;
  function typewrite(el, text) {
    clearInterval(typer); if (reduced) { el.textContent = text; return; }
    let i = 0; el.textContent = ''; const out = document.createTextNode(''), caret = document.createElement('span'); caret.className = 'tp-caret'; caret.textContent = '▍'; el.append(out, caret);
    typer = setInterval(() => { i++; out.nodeValue = text.slice(0, i); if (i >= text.length) { clearInterval(typer); caret.remove(); } }, Math.max(12, Math.min(28, 1400 / Math.max(1, text.length))));
  }
  function move(dir) { // 단계 → 끝나면 다음 설비
    const n = run.e.data.steps?.length || 0, s = run.step + dir;
    if (s >= 0 && s < n) return showStep(s);
    const i = run.e.i + (dir > 0 ? 1 : -1); if (i < 0 || i >= run.d.eqs.length) return; enter(run.d.eqs[i], dir < 0);
  }
  function showStep(s) {
    run.step = s; paintPanel();
    if (section.show(run.sp, run.e)) { flattenLayerArrows(); const L = section.layer(s); if (L) animateTo({ yaw: yawOf(run.p), pitch: 0.16, dist: Math.max(12, L.span * 2.1), target: L.target }, 1000); }
  }
  // 단면 층 안의 3D 화살표(열풍로 마지막 층: 원기둥 관 + 원뿔 머리, steel-index-section.js)도 2D로: 두 메시는 숨기고 관 시작 → 원뿔 끝을 화면 좌표 화살표로 그린다.
  // 그 층이 지금 단계면 진하게, 아니면 흐리게(다른 층처럼). 단면 모듈은 고치지 않는다
  let flat = { group: null, arrows: [] };
  function flattenLayerArrows() {
    const g = scene.getObjectByName('INDEX_INTERIOR'); if (!g || g === flat.group) return;
    clearFlat(); flat.group = g;
    const cones = [], cyls = []; g.traverse((o) => { if (!o.isMesh) return; if (o.geometry.type === 'ConeGeometry') cones.push(o); else if (o.geometry.type === 'CylinderGeometry') cyls.push(o); });
    const axis = (o) => new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())).normalize();
    for (const cone of cones) {
      const dir = axis(cone), cp = cone.getWorldPosition(new THREE.Vector3()), tip = cp.clone().addScaledVector(dir, cone.geometry.parameters.height / 2);
      const shaft = cyls.filter((c) => Math.abs(axis(c).dot(dir)) > 0.95).sort((a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(cp) - b.getWorldPosition(new THREE.Vector3()).distanceTo(cp))[0];
      const from = shaft ? shaft.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, -shaft.geometry.parameters.height / 2) : cp.clone().addScaledVector(dir, -cone.geometry.parameters.height * 2);
      cone.visible = false; if (shaft) shaft.visible = false;
      const el = document.createElement('div'); el.className = 'sfx sfx-arrow2d'; el.innerHTML = '<svg width="1" height="1"><line/><path/></svg>';
      el.style.setProperty('--c', `#${cone.material.color.getHexString()}`); hud.appendChild(el);
      flat.arrows.push({ from, tip, el, layer: shaft?.userData.layerIdx });
    }
  }
  function clearFlat() { flat.arrows.forEach((a) => a.el.remove()); flat = { group: null, arrows: [] }; }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function drawFlat() {
    if (!flat.arrows.length) return;
    if (!flat.group.parent) { clearFlat(); return; } // 단면이 지워졌으면(다른 설비로) 화살표도 지운다
    const cam = getCamera(), w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const a of flat.arrows) {
      _a.copy(a.from).project(cam); _b.copy(a.tip).project(cam);
      const ax = (_a.x + 1) / 2 * w, ay = (1 - _a.y) / 2 * h, dx = (_b.x - _a.x) / 2 * w, dy = -(_b.y - _a.y) / 2 * h, L = Math.hypot(dx, dy), svg = a.el.firstChild;
      a.el.style.left = `${ax.toFixed(1)}px`; a.el.style.top = `${ay.toFixed(1)}px`; a.el.style.display = _a.z < 1 && L > 6 ? '' : 'none'; if (L <= 6) continue;
      svg.style.opacity = a.layer == null || a.layer === run?.step ? '1' : '.35';
      const ux = dx / L, uy = dy / L, hl = Math.min(14, L * 0.45), bx = dx - ux * hl, by = dy - uy * hl;
      const [line, head] = svg.children; line.setAttribute('x2', bx.toFixed(1)); line.setAttribute('y2', by.toFixed(1));
      head.setAttribute('d', `M${dx.toFixed(1)} ${dy.toFixed(1)}L${(bx - uy * 6).toFixed(1)} ${(by + ux * 6).toFixed(1)}L${(bx + uy * 6).toFixed(1)} ${(by - ux * 6).toFixed(1)}Z`);
    }
  }
  function clearDim(d) { outline.clear(); section.hide(); work.stop(); warm.intensity = 0; d.eqs.forEach((q) => q.node.traverse((o) => { if (!o.isMesh || !o.material.userData.color) return; const m = o.material; m.color.copy(m.userData.color); if (m.userData.emissive) { m.emissive.copy(m.userData.emissive); m.emissiveIntensity = m.userData.emissiveI; } })); }
  function enter(e, last = false) {
    const d = run.d; if (run.e !== e) section.hide(); run.e = e; run.t0 = performance.now();
    clearDim(d); if (!reduced) work.start(e); outline.select(e.node, d.eqs.map((q) => q.node));
    const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3()); warm.position.set(c.x, e.box.max.y + 2, c.z); warm.intensity = 14;
    animateTo({ yaw: yawOf(run.p), pitch: 0.34, dist: Math.max(14, Math.max(s.x, s.z, s.y) * 2.4), target: new THREE.Vector3(c.x - s.x * 0.15, c.y, c.z) }, 1200);
    paintBar(); const n = e.data.steps?.length || 0; showStep(last && n ? n - 1 : 0);
  }
  function toggle() { run.playing = !run.playing; run.t0 = performance.now(); paintBar(); }

  async function start(p) {
    if (run) stop(false);
    const d = await loadDetail(p); if (!d.eqs.length) return false;
    placed[p.id] = { ...(anchors[p.id] || {}), scale: 1, offset: [p.c[0], 0, p.c[1]] };
    p.root.visible = false; p.swapped = true; scene.add(d.root);
    run = { p, d, sp: { id: p.id, root: d.root, eqs: d.eqs }, e: null, step: 0, t0: 0, playing: true, speed: 1 }; // sp: 단면 모듈이 보는 공정(설비 단위 모델)
    document.body.classList.add('tour-on'); enter(d.eqs[0]); return true;
  }
  function stop(notify = true) {
    if (!run) return; const { p, d } = run; clearDim(d); clearFlat();
    clearInterval(typer); scene.remove(d.root); p.swapped = false; run = null; document.body.classList.remove('tour-on'); panel.innerHTML = ''; bar.innerHTML = '';
    if (notify) onEnd(p);
  }
  function tick(now) {
    if (!run) return;
    if (run.playing) { // 공정 화면과 같은 규칙: 설비 하나에 max(TOUR_MS, 단계 수 × STEP_MS), 단계는 고르게 나눈다
      const n = Math.max(1, run.e.data.steps?.length || 1), hold = Math.max(TOUR_MS, STEP_MS * n) / run.speed, el = now - run.t0, si = Math.min(n - 1, Math.floor(el / (hold / n)));
      if ((run.e.data.steps?.length || 0) && si !== run.step) showStep(si);
      if (el >= hold) { const i = run.e.i + 1; if (i >= run.d.eqs.length) { run.playing = false; paintBar(); } else enter(run.d.eqs[i]); }
    }
    if (!reduced) warm.intensity = 14 + 3 * Math.sin(now / 420);
    section.tick(now); work.tick(now); drawFlat();
  }
  return {
    start, stop, tick, toggle,
    get active() { return !!run; },
    get process() { return run?.p || null; },
    /** ← → : 이전·다음 설비 */
    stepEq(dir) { if (!run) return; const i = run.e.i + dir; if (i < 0 || i >= run.d.eqs.length) return; run.playing = false; enter(run.d.eqs[i]); },
    /** 오른쪽 단계 카드 폭(px): 카메라 화면 중심을 그만큼 왼쪽으로 민다 */
    panelWidth() { return run && innerWidth > 900 ? panel.offsetWidth + 24 : 0; },
  };
}
