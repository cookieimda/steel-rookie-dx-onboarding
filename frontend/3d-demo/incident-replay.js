// 사고 사례 갈림길 재현(새 3D 화면 steel-index.html). 학습 기록 → 학습 랩 → 사고 사례의 '🏭 3D 공장에서 이 갈림길 보기'
// (?p=공정&lab=incident&scenario=사례 id&at=장면 번호&pick=고른 선택)로 들어오면 붙는다. v4(sim-lab.js의 incidentPanel)와 같은 동작을
// steel-index의 장면·설비(EQ_ 노드 상자) 위에 다시 만든 것이다.
// - 오른쪽 What-if 열 자리에 사례 패널(장면 · 갈림길 선택 · 결과)을 띄우고, 닫으면 What-if 열이 돌아온다.
// - 3D: 지난 장면 설비를 옅은 흐름으로 잇고, 갈림길 설비에 결과 링(그대로 가면 빨강 · 다르게 했다면 초록)과 이름표.
//   실제로 일어난 선택이면 이후 장면 설비까지 붉은 흐름과 링으로 잇는다.
// steel-index.js는 이 파일을 부르는 몇 줄만 갖는다. 장면 상태(cur·eqs)는 넘겨받은 함수로만 읽고 고치지 않는다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const SECTION = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const RED = 0xff5a5a, GREEN = 0x3ddc84, GRAY = 0x9aa4b2;
const ID = /^[a-z0-9_-]{1,40}$/;

const CSS = `
.ir-pane { z-index: 8; }
body.ir-on .lab-inputs:not(.ir-pane) { visibility: hidden !important; }
.ir-pane .lab-pane-head { position: relative; padding-right: 64px; }
.ir-pane .ir-x { position: absolute; top: 14px; right: 14px; width: 36px; height: 36px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: inherit; font-size: 18px; cursor: pointer; }
.ir-pane .ir-x:hover { background: rgba(255,255,255,.12); }
.ir-pane .ir-x:focus-visible, .ir-pane button:focus-visible, .ir-pane a:focus-visible { outline: 2px solid rgba(255,255,255,.7); outline-offset: 2px; }
.ir-pane .ir-src { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,.55); }
.ir-pane .ir-src a { color: inherit; }
.ir-pane .ir-h { font-size: 13px; letter-spacing: .08em; color: rgba(255,255,255,.55); margin: 0 0 6px; }
.ir-pane ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ir-pane li { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: start; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); font-size: 14px; line-height: 1.55; }
.ir-pane li.cur { border-color: rgba(255,166,61,.55); background: rgba(255,166,61,.08); }
.ir-pane li b { display: block; font-size: 13px; color: rgba(255,255,255,.6); font-weight: 600; }
.ir-pane .ir-mini { white-space: nowrap; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: inherit; font-size: 13px; cursor: pointer; }
.ir-pane .ir-mini:hover { background: rgba(255,255,255,.12); }
.ir-pane .ir-opts { display: flex; flex-direction: column; gap: 6px; }
.ir-pane .ir-opt { text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: inherit; font-size: 14px; line-height: 1.5; cursor: pointer; }
.ir-pane .ir-opt:hover { background: rgba(255,255,255,.1); }
.ir-pane .ir-opt[aria-pressed="true"].actual { border-color: #ff6b6b; background: rgba(255,107,107,.14); }
.ir-pane .ir-opt[aria-pressed="true"].safe { border-color: #3ddc84; background: rgba(61,220,132,.13); }
.ir-pane .ir-out { padding: 12px; border-radius: 10px; font-size: 14px; line-height: 1.6; border: 1px solid; }
.ir-pane .ir-out.actual { border-color: rgba(255,107,107,.6); background: rgba(255,107,107,.1); }
.ir-pane .ir-out.safe { border-color: rgba(61,220,132,.6); background: rgba(61,220,132,.1); }
.ir-pane .ir-out b { display: block; margin-bottom: 4px; }
.ir-pane .ir-after { font-size: 14px; line-height: 1.55; color: #ffb3b3; }
.ir-pane .ir-muted { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,.55); }
.ir-pane .ir-err { color: #ff9b9b; font-size: 14px; }
.ir-tag { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; white-space: nowrap; }
.ir-tag span { padding: 6px 12px; border-radius: 999px; font: 600 14px/1.2 var(--f-body, system-ui); color: #fff; background: rgba(13,17,20,.86); border: 1.5px solid; backdrop-filter: blur(6px); }
.ir-tag span.warn { border-color: #ff6b6b; }
.ir-tag span.ok { border-color: #3ddc84; }
`;

const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
const btn = (text, onClick, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
const short = (x, n) => (x.length > n ? `${x.slice(0, n)}…` : x);

/** URL 쿼리에서 재현할 사례를 읽는다. 형식이 틀리면 null. */
export function readIncidentQuery(q) {
  if (q.get('lab') !== 'incident') return null;
  const scenario = q.get('scenario') || '', at = Number(q.get('at')), pick = Number(q.get('pick'));
  if (!ID.test(scenario) || !Number.isInteger(at) || at < 0 || !Number.isInteger(pick) || pick < 0) return null;
  return { scenario, at, pick };
}

/**
 * @param {{ api: { request: Function }, scene: THREE.Scene, camera: THREE.Camera, hud: HTMLElement, stage: HTMLElement, reduced: boolean,
 *   current: () => any, focusEquipment: (id: string) => boolean, showProcess: (id: string) => void, toast: (msg: string) => void,
 *   query: { scenario: string, at: number, pick: number } }} deps
 */
export function attachIncidentReplay({ api, scene, camera, hud, stage, reduced, current, focusEquipment, showProcess, toast, query }) {
  if (!document.getElementById('ir-style')) { const s = el('style'); s.id = 'ir-style'; s.textContent = CSS; document.head.append(s); }
  const pane = el('aside', 'lab-pane lab-inputs ir-pane'); pane.setAttribute('aria-label', '사고 사례 갈림길');
  const head = el('header', 'lab-pane-head'), body = el('div', 'lab-pane-body');
  head.append(el('span', '', 'INCIDENT'), el('h2', '', '사고 사례 갈림길'));
  const close = btn('✕', () => detach(), 'ir-x'); close.title = '닫기'; close.setAttribute('aria-label', '사고 사례 닫기');
  head.append(close); pane.append(head, body);
  document.body.append(pane); document.body.classList.add('ir-on');
  body.append(el('p', 'ir-muted', '사례를 불러오는 중…'));

  // ── 3D 표시: 링·흐름·이름표. 사례 공정이 아닌 공정을 보고 있으면 숨긴다 ──
  const group = new THREE.Group(); group.name = 'incident-replay'; scene.add(group);
  let rings = [], flows = [], tags = new Map(), proc = null, raf = 0, alive = true;
  const eqOf = (id) => proc?.eqs.find((e) => e.id === id) || null;
  function clearFx() {
    for (const o of [...group.children]) { group.remove(o); o.traverse((m) => { m.geometry?.dispose(); m.material?.dispose(); }); }
    rings = []; flows = [];
    for (const t of tags.values()) t.node.remove();
    tags = new Map();
  }
  function ring(id, color) {
    const e = eqOf(id); if (!e) return;
    const old = rings.find((r) => r.id === id); if (old) { old.mesh.material.color.setHex(color); return; }
    const c = e.box.getCenter(new THREE.Vector3()), s = e.box.getSize(new THREE.Vector3()), r = Math.max(2.5, Math.max(s.x, s.z) * 0.62);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(c.x, 0.16, c.z); mesh.renderOrder = 3; mesh.raycast = () => {};
    group.add(mesh); rings.push({ id, mesh });
  }
  function flow(a, b, color, opacity = 0.9) {
    const ea = eqOf(a), eb = eqOf(b); if (!ea || !eb || ea === eb) return;
    const p0 = ea.box.getCenter(new THREE.Vector3()), p2 = eb.box.getCenter(new THREE.Vector3());
    p0.y = ea.box.max.y + 1; p2.y = eb.box.max.y + 1;
    const p1 = p0.clone().lerp(p2, 0.5); p1.y = Math.max(p0.y, p2.y) + p0.distanceTo(p2) * 0.25;
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity * 0.6, depthWrite: false }));
    line.raycast = () => {}; group.add(line);
    const dots = [0, 1, 2].map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })); d.raycast = () => {}; group.add(d); return d; });
    flows.push({ curve, dots });
  }
  function tag(id, text, tone) {
    const e = eqOf(id); if (!e) return;
    let t = tags.get(id);
    if (!t) { const node = el('div', 'ir-tag'); hud.append(node); t = { e, node }; tags.set(id, t); }
    t.node.append(el('span', tone, text));
  }
  const v = new THREE.Vector3();
  function tick(now) {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const on = !!proc && current() === proc;
    group.visible = on;
    const w = stage.clientWidth, h = stage.clientHeight;
    for (const t of tags.values()) {
      if (!on) { t.node.style.display = 'none'; continue; }
      const c = t.e.box.getCenter(v); v.set(c.x, t.e.box.max.y + (t.e.y || 0) + 3, c.z).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && v.y > -1.1; // 설비에 가까이 가서 이름표 자리가 화면 위로 넘어가면 위 가장자리에 붙여 둔다(아래 Math.max)
      t.node.style.display = vis ? '' : 'none';
      if (vis) t.node.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${Math.max(70, (1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
    }
    if (!on) return;
    const k = reduced ? 1 : 0.6 + 0.4 * Math.sin(now / 380);
    for (const r of rings) r.mesh.material.opacity = 0.85 * k;
    for (const f of flows) f.dots.forEach((d, i) => { const u = reduced ? (i + 1) / 4 : ((now / 2400) + i / 3) % 1; d.position.copy(f.curve.getPoint(u)); });
  }
  raf = requestAnimationFrame(tick);

  function detach() {
    alive = false; cancelAnimationFrame(raf); clearFx(); scene.remove(group);
    pane.remove(); document.body.classList.remove('ir-on');
  }

  // 사례 공정이 화면에 올라오고 설비가 다 솟을 때까지 기다린다(steel-index가 ?p로 공정을 연다. 다르면 사례 공정으로 옮긴다)
  async function ready(section) {
    let asked = false;
    for (let i = 0; i < 120 && alive; i++) {
      const p = current();
      if (p?.id === section && p.eqs.every((e) => e.up)) return p;
      if (!asked && i >= 10 && p?.id !== section) { asked = true; showProcess(section); }
      await new Promise((r) => setTimeout(r, 100));
    }
    return current()?.id === section ? current() : null;
  }

  (async () => {
    let sc;
    try { sc = (await api.request('GET', `/api/lab/incidents/${encodeURIComponent(query.scenario)}`)).scenario; }
    catch (e) { body.replaceChildren(el('p', 'ir-err', e.status === 401 ? '로그인하면 사고 사례를 볼 수 있어요.' : e.message)); return; }
    const at = query.at, t = sc?.timeline?.[at];
    if (!t?.branch || !t.branch.options[query.pick]) { body.replaceChildren(el('p', 'ir-err', '그 갈림길을 찾지 못했어요. 학습 기록에서 다시 열어 주세요.')); return; }
    head.querySelector('h2').textContent = sc.title;
    head.querySelector('span').textContent = `${SECTION[sc.section] || sc.section} · 사고 사례 갈림길`;

    const intro = el('div');
    intro.append(el('p', 'ir-muted', `위험 · ${sc.hazard}`));
    if (sc.source?.title) {
      const src = el('p', 'ir-src'), name = `${sc.source.publisher ? `${sc.source.publisher} ` : ''}「${sc.source.title}」${sc.source.case ? ` ${sc.source.case}` : ''}${sc.source.page ? ` (${sc.source.page}쪽)` : ''}`;
      if (/^https?:\/\//.test(sc.source.url || '')) { const a = el('a', '', name); a.href = sc.source.url; a.target = '_blank'; a.rel = 'noopener'; src.append('출처 · ', a); } else src.textContent = `출처 · ${name}`;
      intro.append(src);
    }
    const scenesBox = el('div'), scenes = el('ol');
    scenesBox.append(el('h3', 'ir-h', '장면'), scenes);
    scenes.append(...sc.timeline.slice(0, at + 1).map((s, i) => {
      const li = el('li', i === at ? 'cur' : ''), tx = el('span');
      tx.append(el('b', '', s.time), document.createTextNode(s.text));
      li.append(tx, btn('설비 보기', () => { if (!focusEquipment(s.equipment_id)) toast('이 장면의 설비를 3D에서 찾지 못했어요'); }, 'ir-mini'));
      return li;
    }));
    const choice = el('div'), opts = el('div', 'ir-opts'), result = el('div');
    result.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', t.branch.prompt);
    choice.append(el('h3', 'ir-h', `🔀 ${t.branch.prompt}`), opts);
    const back = el('a', 'ir-mini', '학습 기록에서 이어서 풀기'); back.href = '/login'; back.style.cssText = 'align-self:flex-start;text-decoration:none;';
    body.replaceChildren(intro, scenesBox, choice, result, el('p', 'ir-muted', '학습 기록의 사고 사례에서 다음 장면과 원인 분석 문제를 이어서 풀 수 있어요.'), back);

    proc = await ready(sc.section);
    if (!alive) return;
    if (!proc) toast('사례 공정의 3D 모델을 불러오지 못해 패널만 보여 줘요');
    const actualIdx = t.branch.options.findIndex((o) => o.actual);

    function choose(k, record) {
      if (record) api.request('POST', `/api/lab/incidents/${encodeURIComponent(sc.id)}/branch`, { at, pick: k }).catch(() => {});
      opts.replaceChildren(...t.branch.options.map((o, j) => {
        const b = btn(o.text, () => choose(j, true), `ir-opt${j === k ? (o.actual ? ' actual' : ' safe') : ''}`);
        b.setAttribute('aria-pressed', String(j === k)); return b;
      }));
      const o = t.branch.options[k], after = sc.timeline.slice(at + 1);
      const out = el('div', `ir-out ${o.actual ? 'actual' : 'safe'}`);
      out.setAttribute('role', 'status');
      out.append(el('b', '', o.actual ? '그대로 가면 — 실제로 이렇게 이어졌어요' : '다르게 했다면'),
        document.createTextNode(o.actual ? (after.length ? '아래 장면처럼 사고로 이어졌어요. 3D에서 붉게 표시된 설비를 보세요.' : o.outcome) : o.outcome));
      result.replaceChildren(out);
      if (o.actual && after.length) {
        const list = el('div'); list.append(el('h3', 'ir-h', '이어진 장면'));
        for (const s of after) list.append(el('p', 'ir-after', `${s.time} · ${s.text}`));
        result.append(list);
      } else if (!o.actual && actualIdx >= 0) {
        result.append(btn(`실제 선택과 비교: "${short(t.branch.options[actualIdx].text, 24)}"`, () => choose(actualIdx, true), 'ir-mini'));
      }
      // 3D: 지난 장면 설비를 옅은 흐름으로 잇고, 갈림길 설비에 결과 링과 이름표
      clearFx();
      if (!proc) return;
      const path = sc.timeline.slice(0, at + 1).map((s) => s.equipment_id);
      path.forEach((id, i) => { if (i && path[i - 1] !== id) flow(path[i - 1], id, GRAY, 0.5); });
      ring(t.equipment_id, o.actual ? RED : GREEN);
      tag(t.equipment_id, `${t.time} ${o.actual ? '⚠ 그대로 가면' : '✓ 다르게 했다면'}`, o.actual ? 'warn' : 'ok');
      if (o.actual) {
        let prev = t.equipment_id;
        after.forEach((s, i) => {
          if (s.equipment_id !== prev) flow(prev, s.equipment_id, RED);
          ring(s.equipment_id, RED);
          if (i === after.length - 1) tag(s.equipment_id, `${s.time} ⚠ ${short(s.text, 18)}`, 'warn');
          prev = s.equipment_id;
        });
      }
    }
    choose(query.pick, false);
    api.request('POST', '/api/me/lab/xapi', { verb: 'experienced', practice: 'incident-3d', object_id: sc.id }).catch(() => {});
  })();

  return { detach };
}
