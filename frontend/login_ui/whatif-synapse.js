// What-if 시냅스(학습 기록 화면 → 학습 랩 → 'What-if 시냅스' 탭). <whatif-synapse theme="light|dark">
// What-if 계산(POST /api/lab/whatif, backend/src/lab/whatif.ts)을 '조건 → 성분·반응 → 결과' 그래프로 그린다. 응답의 synapse가 선마다 흐르는 양(지금·기준)과
// 그 선이 거치는 고로 반응(reaction·also), 반응 목록(식·설명·근거 문헌)을 준다.
// - 조건을 바꾸면 바뀐 선을 따라 빛이 조건 → 성분 → 결과 순서로 번지고(시냅스 발화), 늘어난 선은 빨강·줄어든 선은 파랑, 그대로인 선은 흐리게.
// - 실선은 성분 질량 수지(kg), 점선은 풍구 앞 화염 온도의 문헌 계수(℃). 끝이 막대(⊣)인 선은 억제(늘면 결과가 줄어듦: SiO2 → 염기도, 미분탄 → 화염 온도).
// - 아래 '반응' 버튼을 누르면 그 반응이 일어나는 선만 밝히고, 풀이에 반응식·설명·출처를 보여 준다.
// - 노드를 누르면 그 노드로 들어오고 나가는 선을 풀이(아래 '풀이')하고, 이어진 경로만 밝힌다. 조건을 바꿀 때마다 '변화 기록'에 한 줄씩 남는다.
// - 학습 미션(2026-10-24): 현장 상황에서 시작해 목표(염기도·화염 온도·CO2·슬래그)를 맞춘다. 목표는 바꿀 때마다 ✓/✗로 바로 보이고, 다 맞추면 배울 점과 출처를 보여 준다.
// - 결과 노드를 누르면 근거 수준(질량 수지 · 문헌 계수 · 가정)과 보통 범위·출처가 같이 보인다(응답의 synapse.evidence).
// 그래프 판은 테마와 상관없이 어두운 바탕(참고: Graphify 화면)이고, 나머지 글자·판은 페이지 토큰(--text, --panel …)을 따른다.

const TOKEN_KEY = 'st-rookie-token';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NS = 'http://www.w3.org/2000/svg';

const SLIDERS = [
  ['sinter_pct', '소결광 비율', '%', 0, 100, 1], ['pellet_pct', '펠릿 비율', '%', 0, 100, 1], ['lump_pct', '괴광 비율', '%', 0, 100, 1],
  ['coke_kg', '코크스', 'kg/t', 250, 550, 10], ['pci_kg', '미분탄(PCI)', 'kg/t', 0, 250, 10], ['blast_temp_c', '송풍 온도', '℃', 900, 1300, 10],
  ['oxygen_pct', '산소 부화', '%p', 0, 10, 0.5], ['limestone_kg', '석회석', 'kg/t', 0, 150, 5],
];
const PRESETS = [
  ['석회석 넣기', { limestone_kg: 60 }], ['코크스 줄이기', { coke_kg: 320 }], ['펠릿 위주 배합', { sinter_pct: 30, pellet_pct: 60, lump_pct: 10 }],
  ['송풍 온도 올리기', { blast_temp_c: 1250 }], ['산소 부화 늘리기', { oxygen_pct: 8 }],
];
// 열 순서(겹침이 적게): 조건 · 성분 · 결과
const COLS = [
  ['sinter_pct', 'pellet_pct', 'lump_pct', 'limestone_kg', 'coke_kg', 'pci_kg', 'blast_temp_c', 'oxygen_pct'],
  ['fe', 'sio2', 'al2o3', 'cao', 'mgo', 'c', 'raceway'],
  ['ore_kg', 'slag_kg', 'basicity', 'co2_kg', 'fuel_rate_kg', 'raft_c'],
];
const COLOR = {
  ore: '#c8a26a', fuel: '#ff8a5b', air: '#6aa8ff', flux: '#7fd1b9', heat: '#ff6b3d', output: '#e9eef5',
  fe: '#b8c0cc', sio2: '#e0c35a', al2o3: '#a98bef', cao: '#5fd0b5', mgo: '#ef8b6f', c: '#d6d6d6',
};
const UP = '#ff5d5d', DOWN = '#4f9dff';
const KIND_LABEL = { ore: '철 원료', fuel: '연료', air: '바람', flux: '플럭스', element: '성분', heat: '반응', output: '결과' };
const W = 760, H = 600, X = [130, 380, 580];

const fmt = (x, unit) => {
  const a = Math.abs(x), d = unit === '' ? 2 : a >= 100 ? 0 : 1;
  return `${Number(x).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: unit === '' ? 2 : 0 })}${unit ? ` ${unit}` : ''}`;
};
const changed = (v, b) => Math.abs(v - b) > Math.max(0.05, Math.abs(b) * 0.002);
const arrow = (v, b, unit) => (changed(v, b) ? `${v > b ? '▲' : '▼'} ${fmt(Math.abs(v - b), unit)}` : '기준과 같음');
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// 달성한 미션(이 브라우저에만, 실패해도 화면은 그대로)
const MISSION_KEY = 'st-rookie:whatif-missions';
const doneMissions = () => { try { return new Set(JSON.parse(localStorage.getItem(MISSION_KEY) || '[]')); } catch (e) { return new Set(); } };
const markMissionDone = (id) => { try { const s = doneMissions(); s.add(id); localStorage.setItem(MISSION_KEY, JSON.stringify([...s])); } catch (e) { /* 저장 못 해도 괜찮다 */ } };

const CSS = `
:host { display: block; color: var(--text, #1d1714); font: inherit; }
* { box-sizing: border-box; }
.top { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; font-size: 14px; color: var(--muted, #574a44); margin-bottom: 10px; }
.top b { color: var(--text); font-size: 15px; margin-right: 6px; }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.ln { width: 22px; height: 0; border-top: 3px solid; display: inline-block; }
.ln.dash { border-top-style: dashed; border-top-width: 2px; }
.split { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr); gap: 12px; height: clamp(440px, calc(100vh - 230px), 820px); }
.side { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; }
.side .chips, .side .ms { margin-top: 0; }
.side .note { margin: 0; align-self: center; }
.sl { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; }
.box h4 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.box { background: var(--panel, rgba(255,255,255,.5)); border-radius: 14px; padding: 14px 16px; min-width: 0; }
.box h4 { margin: 0 0 10px; font-size: 15px; }
.s { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; font-size: 14px; margin-bottom: 8px; }
.s input { grid-column: 1 / -1; width: 100%; accent-color: var(--orange, #ff9e64); }
.s b { font-family: var(--mono, monospace); font-size: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chips button[aria-pressed="true"] { background: var(--text); color: var(--bg, #fff); }
.ex-d a { color: inherit; }
.eq { font-family: var(--mono, monospace); font-size: 15px; background: var(--panel2, rgba(0,0,0,.06)); border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 9px; padding: 6px 10px; font-size: 14px; background: var(--panel2, rgba(0,0,0,.06)); color: var(--text); }
button:hover { background: var(--chip-on, rgba(0,0,0,.12)); }
button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.note { font-size: 13px; color: var(--muted); margin-top: 8px; line-height: 1.5; }
.stage { position: relative; background: var(--surface-dark, #12141a); border-radius: 14px; overflow: hidden; min-height: 0; height: 100%; }
.stage .hd { position: absolute; right: 14px; top: 10px; font: 600 13px var(--mono, monospace); color: #9aa3ad; letter-spacing: .02em; pointer-events: none; }
svg { display: block; width: 100%; height: auto; }
.stage svg { height: 100%; } /* 판 높이에 맞춰 줄인다(viewBox 비율 유지) */
svg text { font-family: var(--font-ko, sans-serif); paint-order: stroke; stroke: var(--surface-dark, #12141a); stroke-width: 4px; stroke-linejoin: round; }
.node { cursor: pointer; }
.node:focus { outline: none; }
.node:focus-visible circle.core { stroke: #fff; stroke-width: 2.5; }
.dim { opacity: .14; transition: opacity .2s; }
.mono { font-size: 14px; line-height: 1.6; font-variant-numeric: tabular-nums; }
.ex-t { font-weight: 700; font-size: 15px; }
.ex-d { font-size: 14px; color: var(--muted); margin: 4px 0 8px; line-height: 1.55; }
.row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.up { color: var(--bad, #c53030); } .down { color: #2f6fd6; } .same { color: var(--dim, #776a64); }
.tag { font-size: 12px; color: var(--dim); }
.log div { line-height: 1.5; margin-bottom: 4px; }
.log .t { color: var(--dim); margin-right: 8px; }
.warn { color: var(--bad, #c53030); font-size: 14px; margin-top: 6px; }
.err { color: var(--bad, #c53030); font-size: 14px; }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; height: auto; } .stage { height: 70vw; } .side { overflow: visible; } .sl { grid-template-columns: 1fr; } }
.ms { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
.ms button.done::after { content: " ✓"; color: var(--good, #2f855a); font-weight: 800; }
.ms button[aria-pressed="true"] { background: var(--text); color: var(--bg, #fff); }
.mission { padding: 14px 16px; border-radius: 14px; background: var(--panel, rgba(255,255,255,.5)); display: grid; grid-template-columns: 1fr; gap: 8px; }
.mission[hidden] { display: none; }
.mission h4 { margin: 0; font-size: 16px; grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.mission .sit { margin: 0; font-size: 14px; line-height: 1.55; color: var(--muted); }
.mission ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.mission li { display: flex; gap: 8px; align-items: baseline; }
.mission li b { font-family: var(--mono, monospace); }
.mission li .ok { color: var(--good, #2f855a); font-weight: 800; } .mission li .no { color: var(--bad, #c53030); font-weight: 800; }
.mission .acts { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mission .hint, .mission .learn { grid-column: 1 / -1; margin: 0; font-size: 14px; line-height: 1.55; }
.mission .learn { padding: 10px 12px; border-radius: 10px; background: var(--panel2, rgba(0,0,0,.06)); }
.mission .learn b { color: var(--good, #2f855a); }
.mission a { color: inherit; }
.ev { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 12px; font-weight: 700; vertical-align: 1px; }
.ev-balance { background: rgba(47,133,90,.16); color: var(--good, #2f855a); }
.ev-literature { background: rgba(47,111,214,.16); color: #2f6fd6; }
.ev-assumption { background: rgba(197,48,48,.14); color: var(--bad, #c53030); }
`;

class WhatIfSynapse extends HTMLElement {
  constructor() {
    super();
    this.input = {}; this.data = null; this.prev = null; this.sel = null; this.rx = null; this.log = []; this.mission = null; this.hint = false; this.fireAt = 0; this.timer = 0; this.raf = 0;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="top"><b>What-if 시냅스</b>
        <span class="lg"><i class="dot" style="background:${COLOR.ore}"></i>철 원료</span><span class="lg"><i class="dot" style="background:${COLOR.fuel}"></i>연료</span>
        <span class="lg"><i class="dot" style="background:${COLOR.air}"></i>바람</span><span class="lg"><i class="dot" style="background:${COLOR.flux}"></i>플럭스</span>
        <span class="lg"><i class="dot" style="background:${COLOR.sio2}"></i>성분</span><span class="lg"><i class="dot" style="background:#9aa3ad;outline:2px solid #e9eef5"></i>결과</span>
        <span class="lg"><i class="ln" style="border-color:${UP}"></i>늘어남</span><span class="lg"><i class="ln" style="border-color:${DOWN}"></i>줄어듦</span>
        <span class="lg"><i class="ln dash" style="border-color:#9aa3ad"></i>화염 온도 계수(℃, 문헌)</span><span class="lg">⊣ 억제</span>
        <span class="lg">근거: <i class="ev ev-balance">질량 수지</i><i class="ev ev-literature">문헌 계수</i><i class="ev ev-assumption">가정</i></span></div>
      <!-- 2026-10-26: 한 화면에 들어오게 2분할. 왼쪽 그래프(화면 높이에 맞춤) · 오른쪽 조절 슬라이더·해 보기·미션·풀이(오른쪽만 스크롤) -->
      <div class="split">
        <div class="stage"><div class="hd">synapse · 제선 고로</div>
          <svg id="g" viewBox="0 0 ${W} ${H}" role="img" aria-label="조건이 성분을 거쳐 결과로 이어지는 그래프"></svg></div>
        <div class="side">
          <div class="box"><h4>조건 조절 <button id="reset" type="button">기준 조건으로</button></h4><div id="sl" class="sl"></div><div class="note" id="share"></div></div>
          <div class="chips" id="pre"><span class="note">해 보기</span></div>
          <div class="chips" id="rx"><span class="note">고로 반응</span></div>
          <div class="ms" id="ms"><span class="note">학습 미션</span></div>
          <section class="mission" id="mission" hidden aria-live="polite"></section>
          <div class="box"><h4>풀이</h4><div id="ex" class="mono"></div></div>
          <div class="box"><h4>변화 기록</h4><div id="log" class="mono log"></div><div id="warn"></div></div>
        </div>
      </div>
      <div class="note">교육용 간이 모델이에요. kg 선은 성분 질량 수지, ℃ 선은 풍구 앞 화염 온도의 문헌 계수(Babich & Senk 2015 표 17.3 범위의 가운데 값)예요(학습 랩 What-if의 '계산 가정'과 같아요). <span id="err" class="err"></span></div>`;
    this.$ = (id) => root.getElementById(id);
    this.$('reset').addEventListener('click', () => this.apply({}, '기준 조건으로'));
    for (const [label, patch] of PRESETS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => this.apply(patch, label));
      this.$('pre').append(b);
    }
  }

  connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.run('기준 조건');
    if (!reduceMotion) { const loop = (t) => { this.frame(t); this.raf = requestAnimationFrame(loop); }; this.raf = requestAnimationFrame(loop); }
  }
  disconnectedCallback() { cancelAnimationFrame(this.raf); this._started = false; }

  apply(patch, why) { this.input = { ...patch }; this.run(why); }

  async run(why) {
    const t = token();
    if (!t) { this.$('err').textContent = '로그인한 뒤 쓸 수 있어요.'; return; }
    try {
      const res = await fetch('/api/lab/whatif', { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(this.input) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `요청 실패(${res.status})`);
      this.prev = this.data; this.data = data; this.$('err').textContent = '';
      this.record(why);
      this.fireAt = performance.now();
      this.render();
    } catch (e) { this.$('err').textContent = e.message; }
  }

  // 변화 기록: 바꾼 조건과 크게 바뀐 결과 셋(기준 대비)
  record(why) {
    const n = Object.fromEntries(this.data.synapse.nodes.map((x) => [x.id, x]));
    const outs = COLS[2].map((id) => n[id]).filter((x) => changed(x.value, x.base))
      .sort((a, b) => Math.abs((b.value - b.base) / (b.base || 1)) - Math.abs((a.value - a.base) / (a.base || 1))).slice(0, 3)
      .map((x) => `${x.label} ${arrow(x.value, x.base, x.unit)}`);
    const now = new Date();
    this.log.unshift({ t: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`, text: `${why} · ${outs.join(' · ') || '결과 기준과 같음'}` });
    this.log = this.log.slice(0, 6);
  }

  render() {
    const d = this.data, input = d.input;
    // 슬라이더
    const sl = this.$('sl');
    sl.innerHTML = SLIDERS.map(([k, label, unit, min, max, step]) => `<label class="s"><span>${label}</span><b>${fmt(input[k], unit)}</b><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${input[k]}" aria-label="${label}"></label>`).join('');
    // 값은 이벤트 때 바로 읽는다: 0.25초 뒤에는 e.target이 섀도 루트 밖 <whatif-synapse>로 바뀌어 value가 없다(변화 기록에 'NaN kg/t'가 찍히던 원인)
    sl.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.k, def = SLIDERS.find((s) => s[0] === k), v = Number(el.value);
      this.input = { ...this.data.input, ...this.input, [k]: v };
      el.previousElementSibling.textContent = fmt(v, def[2]);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.run(`${def[1]} ${fmt(this.prevVal(k), def[2])} → ${fmt(v, def[2])}`), 250);
    }));
    this.$('share').textContent = `철 원료 비율은 합이 100%가 되게 맞춰 계산해요(지금 소결 ${Math.round(input.sinter_pct)} · 펠릿 ${Math.round(input.pellet_pct)} · 괴광 ${Math.round(input.lump_pct)}).`;
    this.drawRx();
    this.drawMissions();
    this.drawGraph();
    this.explain();
    this.$('log').innerHTML = this.log.map((l) => `<div><span class="t">${l.t}</span>${esc(l.text)}</div>`).join('');
    this.$('warn').innerHTML = (d.result.warnings || []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
  }
  prevVal(k) { return this.data?.input?.[k] ?? 0; }

  layout() {
    const pos = {};
    COLS.forEach((ids, ci) => {
      const top = 54, bottom = H - (ci === 1 ? 64 : 34), step = (bottom - top) / (ids.length - 1);
      ids.forEach((id, i) => { pos[id] = { x: X[ci], y: top + i * step, col: ci }; });
    });
    return pos;
  }

  drawGraph() {
    const svg = this.$('g'), { nodes, edges } = this.data.synapse, pos = this.layout();
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const maxKg = Math.max(...edges.filter((e) => e.unit === 'kg').map((e) => Math.max(e.value, e.base)), 1);
    const reach = this.rx ? this.byReaction(this.rx, edges) : this.sel ? this.connected(this.sel, edges) : null;
    svg.replaceChildren();
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      + [['up', UP], ['down', DOWN], ['same', '#5b6470']].map(([k, c]) => `<marker id="bar-${k}" viewBox="0 0 4 12" refX="2" refY="6" markerWidth="4" markerHeight="12" orient="auto"><rect width="3" height="12" fill="${c}"/></marker>`).join('');
    svg.append(defs);
    // 배경 점(시냅스 느낌)
    const bg = document.createElementNS(NS, 'g');
    for (let i = 0; i < 70; i++) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', (i * 137.5) % W); c.setAttribute('cy', (i * 71.3 + 40) % H); c.setAttribute('r', i % 5 ? 0.8 : 1.4); c.setAttribute('fill', '#2a2f38'); bg.append(c); }
    svg.append(bg);
    ['조건', '성분', '결과'].forEach((t, i) => { const tx = document.createElementNS(NS, 'text'); tx.setAttribute('x', X[i]); tx.setAttribute('y', 22); tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('fill', '#6e7681'); tx.setAttribute('font-size', '13'); tx.setAttribute('font-weight', '600'); tx.textContent = t; svg.append(tx); });

    this.paths = [];
    const eg = document.createElementNS(NS, 'g');
    for (const e of edges) {
      const a = pos[e.from], b = pos[e.to], ra = 14, rb = 16;
      let dAttr;
      if (a.col === b.col) { const bx = a.x - 70; dAttr = `M${a.x - ra},${a.y} C${bx},${a.y} ${bx},${b.y} ${b.x - rb},${b.y}`; }
      else { const mx = (a.x + b.x) / 2; dAttr = `M${a.x + ra},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x - rb},${b.y}`; }
      const ch = changed(e.value, e.base), dir = !ch ? 'same' : e.value > e.base ? 'up' : 'down';
      const w = e.unit === 'kg' ? 0.8 + 4.2 * Math.sqrt(Math.max(e.value, 0) / maxKg) : 1.2 + 3 * Math.min(1, Math.abs(e.value) / 40);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', dAttr); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', dir === 'up' ? UP : dir === 'down' ? DOWN : '#5b6470');
      p.setAttribute('stroke-opacity', ch ? '0.85' : '0.28'); p.setAttribute('stroke-width', w.toFixed(2));
      if (e.unit === '℃') p.setAttribute('stroke-dasharray', '5 4');
      if (e.sign < 0) p.setAttribute('marker-end', `url(#bar-${dir})`);
      if (reach && !reach.edges.has(e)) p.classList.add('dim');
      const tt = document.createElementNS(NS, 'title');
      const rxName = (id) => this.data.synapse.reactions?.find((r) => r.id === id)?.name;
      tt.textContent = `${byId[e.from].label} → ${byId[e.to].label} · ${fmt(e.value, e.unit)} (기준 ${fmt(e.base, e.unit)}) · ${e.why}${e.reaction ? ` · 반응: ${[e.reaction, ...(e.also || [])].map(rxName).join(', ')}` : ''}`;
      p.append(tt); eg.append(p);
      if (ch) this.paths.push({ el: p, len: p.getTotalLength(), dir, col: a.col, n: 1 + Math.round(2 * Math.min(1, Math.abs(e.value - e.base) / (e.unit === 'kg' ? 30 : 15))), hidden: reach && !reach.edges.has(e) });
    }
    svg.append(eg);

    this.dots = document.createElementNS(NS, 'g');
    svg.append(this.dots);

    const ng = document.createElementNS(NS, 'g');
    for (const n of nodes) {
      const p = pos[n.id], col = n.kind === 'element' ? COLOR[n.id] : COLOR[n.kind], ch = changed(n.value, n.base);
      const r = n.kind === 'output' ? 15 : n.kind === 'element' || n.kind === 'heat' ? 13 : 11;
      const g = document.createElementNS(NS, 'g');
      g.classList.add('node'); g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${n.label} ${fmt(n.value, n.unit)}, ${arrow(n.value, n.base, n.unit)}`);
      if (reach && !reach.nodes.has(n.id)) g.classList.add('dim');
      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('cx', p.x); halo.setAttribute('cy', p.y); halo.setAttribute('r', r + 7);
      halo.setAttribute('fill', ch ? (n.value > n.base ? UP : DOWN) : col); halo.setAttribute('opacity', ch ? '0.28' : '0.08'); halo.setAttribute('filter', 'url(#glow)');
      const core = document.createElementNS(NS, 'circle');
      core.classList.add('core'); core.setAttribute('cx', p.x); core.setAttribute('cy', p.y); core.setAttribute('r', r);
      core.setAttribute('fill', n.kind === 'output' ? '#1b1f27' : col); core.setAttribute('stroke', n.kind === 'output' ? col : '#12141a'); core.setAttribute('stroke-width', n.kind === 'output' ? 2.5 : 2);
      if (this.sel === n.id) { core.setAttribute('stroke', '#ffffff'); core.setAttribute('stroke-width', 3); }
      g.append(halo, core);
      // 이름표: 조건은 왼쪽, 결과는 오른쪽, 성분은 아래
      const lab = document.createElementNS(NS, 'text'), sub = document.createElementNS(NS, 'text');
      const side = p.col === 0 ? 'end' : p.col === 2 ? 'start' : 'middle';
      const lx = p.col === 0 ? p.x - r - 10 : p.col === 2 ? p.x + r + 10 : p.x, ly = p.col === 1 ? p.y + r + 15 : p.y - 2, sy = p.col === 1 ? p.y + r + 29 : p.y + 14;
      for (const [t, y, size, fill, weight] of [[lab, ly, 14, '#e9eef5', 700], [sub, sy, 12, ch ? (n.value > n.base ? '#ff8a8a' : '#8cbcff') : '#8b95a1', 500]]) {
        t.setAttribute('x', lx); t.setAttribute('y', y); t.setAttribute('text-anchor', side); t.setAttribute('font-size', size); t.setAttribute('fill', fill); t.setAttribute('font-weight', weight);
      }
      lab.textContent = n.label;
      sub.textContent = `${fmt(n.value, n.unit)}${ch ? ` ${n.value > n.base ? '▲' : '▼'}${fmt(Math.abs(n.value - n.base), n.unit)}` : ''}`;
      g.append(lab, sub);
      const pick = () => { this.sel = this.sel === n.id ? null : n.id; this.rx = null; this.drawRx(); this.drawGraph(); this.explain(); };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      ng.append(g);
    }
    svg.append(ng);
    if (reduceMotion) this.frame(performance.now());
  }

  // 고른 노드와 이어진 노드·선(앞쪽 원인과 뒤쪽 결과를 끝까지 따라감)
  connected(id, edges) {
    const nodes = new Set([id]), es = new Set();
    const walk = (cur, dirKey) => {
      for (const e of edges) {
        const [here, there] = dirKey === 'down' ? [e.from, e.to] : [e.to, e.from];
        if (here === cur && !es.has(e)) { es.add(e); nodes.add(there); walk(there, dirKey); }
      }
    };
    walk(id, 'down'); walk(id, 'up');
    return { nodes, edges: es };
  }

  // 바뀐 선 위를 흐르는 빛. 조건을 바꾼 직후에는 조건 → 성분 → 결과 순서로 0.45초씩 늦게 켜진다
  frame(t) {
    if (!this.dots || !this.paths) return;
    this.dots.replaceChildren();
    for (const p of this.paths) {
      if (p.hidden) continue;
      const since = (t - this.fireAt) / 1000 - p.col * 0.45;
      if (since < 0 && !reduceMotion) continue;
      const boost = reduceMotion ? 0 : Math.max(0, 1 - since / 1.5);
      for (let i = 0; i < p.n; i++) {
        const f = reduceMotion ? (i + 0.5) / p.n : ((t / 1000) * (90 / p.len) + i / p.n) % 1;
        const pt = p.el.getPointAtLength(f * p.len);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); c.setAttribute('r', 2.6 + boost * 2.4);
        c.setAttribute('fill', p.dir === 'up' ? '#ffb0b0' : '#b9d6ff'); c.setAttribute('filter', 'url(#glow)');
        this.dots.append(c);
      }
    }
  }

  // 반응 버튼: 누르면 그 반응이 일어나는 선만 밝힌다(다시 누르면 끔)
  drawRx() {
    const box = this.$('rx');
    box.querySelectorAll('button').forEach((b) => b.remove());
    for (const r of this.data?.synapse.reactions || []) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = r.name; b.setAttribute('aria-pressed', String(this.rx === r.id));
      b.addEventListener('click', () => { this.rx = this.rx === r.id ? null : r.id; this.sel = null; this.drawRx(); this.drawGraph(); this.explain(); });
      box.append(b);
    }
  }
  byReaction(id, edges) {
    const es = new Set(edges.filter((e) => e.reaction === id || (e.also || []).includes(id))), nodes = new Set();
    for (const e of es) { nodes.add(e.from); nodes.add(e.to); }
    return { nodes, edges: es };
  }

  // 결과의 근거 수준: 질량 수지(문헌 성분으로 계산) · 문헌 계수 · 가정(방향만). 보통 범위와 출처도 같이
  evidenceHtml(id) {
    const ev = this.data.synapse.evidence?.[id]; if (!ev) return '';
    const name = { balance: '질량 수지', literature: '문헌 계수', assumption: '가정(방향만)' }[ev.level];
    return `<div class="ex-d"><span class="ev ev-${ev.level}">${name}</span> ${esc(ev.basis)}${ev.range ? ` · 실제 ${esc(ev.range)}` : ''}<br>출처: ${ev.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(' · ')}</div>`;
  }

  // 학습 미션: 칩을 누르면 출발 조건으로 바꾸고, 목표를 바꿀 때마다 ✓/✗로 보여 준다. 다 맞추면 배울 점·출처(이 브라우저에 달성 표시)
  drawMissions() {
    const list = this.data.synapse.missions || [], box = this.$('ms'), done = doneMissions();
    box.querySelectorAll('button').forEach((b) => b.remove());
    for (const m of list) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = m.title; b.setAttribute('aria-pressed', String(this.mission === m.id));
      if (done.has(m.id)) b.classList.add('done');
      b.addEventListener('click', () => { if (this.mission === m.id) { this.mission = null; this.render(); return; } this.mission = m.id; this.hint = false; this.apply(m.start, `미션 시작: ${m.title}`); });
      box.append(b);
    }
    const sec = this.$('mission'), m = list.find((x) => x.id === this.mission);
    if (!m) { sec.hidden = true; sec.innerHTML = ''; return; }
    const all = m.status.every((g) => g.ok);
    if (all) markMissionDone(m.id);
    const unit = (g, v) => (g.unit === '개' ? `${v}개` : fmt(v, g.unit));
    const goal = (g) => [g.min != null ? `${unit(g, g.min)} 이상` : '', g.max != null ? `${unit(g, g.max)} 이하` : ''].filter(Boolean).join(' · ');
    sec.hidden = false;
    sec.innerHTML = `<h4>🎯 ${esc(m.title)} ${all ? '<span class="ev ev-balance">달성</span>' : ''}</h4>
      <p class="sit">${esc(m.situation)}</p>
      <ul>${m.goals.map((g, i) => { const st = m.status[i]; return `<li><span class="${st.ok ? 'ok' : 'no'}">${st.ok ? '✓' : '✗'}</span><span>${esc(g.label)} ${goal(g)}</span><b>지금 ${unit(g, st.value)}</b></li>`; }).join('')}</ul>
      ${all ? `<p class="learn"><b>왜 그럴까요?</b> ${esc(m.learn)}<br><small>출처: ${m.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(' · ')}</small></p>`
        : this.hint ? `<p class="hint">💡 ${esc(m.hint)}</p>` : ''}
      <div class="acts">${all || this.hint ? '' : '<button type="button" data-hint>힌트 보기</button>'}<button type="button" data-restart>처음 조건으로</button><button type="button" data-close>미션 닫기</button></div>`;
    sec.querySelector('[data-hint]')?.addEventListener('click', () => { this.hint = true; this.drawMissions(); });
    sec.querySelector('[data-restart]').addEventListener('click', () => { this.hint = false; this.apply(m.start, `미션 다시: ${m.title}`); });
    sec.querySelector('[data-close]').addEventListener('click', () => { this.mission = null; this.render(); });
  }

  explain() {
    const ex = this.$('ex');
    if (!this.data) return;
    const { nodes, edges } = this.data.synapse, byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    if (this.rx) {
      const r = this.data.synapse.reactions.find((x) => x.id === this.rx), es = [...this.byReaction(this.rx, edges).edges];
      ex.innerHTML = `<div class="ex-t">${esc(r.name)} <span class="tag">고로 반응</span></div><div class="eq">${esc(r.eq)}</div><div class="ex-d">${esc(r.note)}</div>
        <div class="ex-d">이 반응이 걸린 선 ${es.length}개: ${es.map((e) => `${esc(byId[e.from].label)} → ${esc(byId[e.to].label)}`).join(' · ') || '없음(설명만)'}</div>
        <div class="ex-d">출처: ${r.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(' · ')}</div>`;
      return;
    }
    if (!this.sel) {
      const moved = edges.filter((e) => changed(e.value, e.base)).length;
      ex.innerHTML = `<div class="ex-t">노드를 눌러 보세요</div><div class="ex-d">조건(왼쪽)을 누르면 그 조건이 어떤 성분을 거쳐 어떤 결과까지 이어지는지, 결과(오른쪽)를 누르면 어떤 조건에서 왔는지 길만 밝혀요. 지금 기준과 달라진 선 ${moved}개.</div>`;
      return;
    }
    const n = byId[this.sel], cls = (v, b) => (changed(v, b) ? (v > b ? 'up' : 'down') : 'same');
    const line = (e, other, dirSym) => `<div class="row"><span>${dirSym} ${esc(byId[other].label)}</span><b>${fmt(e.value, e.unit)}</b><span class="tag">기준 ${fmt(e.base, e.unit)}</span><span class="${cls(e.value, e.base)}">${arrow(e.value, e.base, e.unit)}</span><span class="tag">[${e.unit === 'kg' ? '질량 수지' : '문헌 계수'}${e.sign < 0 ? ' · 억제' : ''}] ${esc(e.why)}</span></div>`;
    const ins = edges.filter((e) => e.to === n.id), outs = edges.filter((e) => e.from === n.id);
    ex.innerHTML = `<div class="ex-t">${esc(n.label)} <span class="tag">${KIND_LABEL[n.kind]}</span> · ${fmt(n.value, n.unit)} <span class="${cls(n.value, n.base)}">${arrow(n.value, n.base, n.unit)}</span></div>
      <div class="ex-d">${esc(n.desc)}</div>${this.evidenceHtml(n.id)}
      ${ins.map((e) => line(e, e.from, '←')).join('')}${outs.map((e) => line(e, e.to, '→')).join('')}`;
  }
}

if (!customElements.get('whatif-synapse')) customElements.define('whatif-synapse', WhatIfSynapse);
