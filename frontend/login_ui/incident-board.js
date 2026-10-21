// 사고 사례 머리 띠(학습 랩 → 사고 사례). <incident-board board="JSON">: lab-extras.js의 icBoard(JSON 문자열)를 속성으로 받는다.
// 역할·관문 구조로 보여 준다(사례 파일 content/scenarios/incidents.json의 roles·gates·timeline[].actor).
// - 역할 줄: 사람·장비·통제. 지금 장면에서 움직인 역할이 빛나고, 앞 장면의 역할에서 지금 역할로 빛이 넘어간다.
// - 관문: 지켰다면 사고를 막았을 절차. 장면이 그 관문에 닿으면 실제로는 건너뜀(빨강)·지킴(초록)으로 바뀌고,
//   그 장면 갈림길에서 관문을 지키는 선택을 고르면 '다르게 하면 지킴'(초록 테두리)으로 바뀐다.
// 아래 타임라인과 한 덩어리로 보이게 왼쪽 사례 목록과 같은 밝은 디자인(페이지 토큰 --orange, --line, --bad, --ok …)만 쓴다.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const KIND = { person: '사람', device: '장비', control: '통제' };

const CSS = `
:host { display: block; color: var(--text); }
* { box-sizing: border-box; }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.sub { font-size: 15px; color: var(--muted); }
.clock { font: 700 38px/1.05 var(--mono, ui-monospace, Consolas, monospace); font-variant-numeric: tabular-nums; }
.state { font-size: 15px; font-weight: 700; padding: 4px 12px; border-radius: var(--cut-s, 10px); border: 1px solid; white-space: nowrap; }
.roles { position: relative; display: grid; margin: 16px 0 4px; }
.line { position: absolute; top: 21px; height: 2px; background: var(--line); }
.dot { position: absolute; top: 17px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 10px 3px color-mix(in srgb, var(--orange) 60%, transparent); animation: hop 1.2s ease-in-out infinite; }
@keyframes hop { from { left: var(--a); opacity: .3; } 25% { opacity: 1; } to { left: var(--b); opacity: 1; } }
.role { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; padding: 0 4px; }
.ico { position: relative; z-index: 1; width: 44px; height: 44px; background: var(--panel, #fff); border: 1.5px solid var(--line); transition: transform .3s, box-shadow .3s, background .3s; display: grid; place-items: center; font-size: 18px; }
.person .ico { border-radius: 50%; }
.person .ico::before, .person .ico::after { content: ""; position: absolute; top: 16px; width: 4px; height: 8px; border-radius: 2px; background: var(--text); opacity: .7; }
.person .ico::before { left: 14px; } .person .ico::after { right: 14px; }
.device .ico { border-radius: 12px; }
.control .ico { border-radius: 50%; border-style: double; border-width: 4px; }
.acted .ico { background: color-mix(in srgb, var(--orange) 22%, var(--panel, #fff)); border-color: color-mix(in srgb, var(--orange) 45%, var(--line)); }
.on .ico { background: var(--orange); border-color: var(--orange); transform: scale(1.12); box-shadow: 0 0 0 4px color-mix(in srgb, var(--orange) 22%, transparent), 0 0 18px color-mix(in srgb, var(--orange) 45%, transparent); }
.on.end .ico { background: var(--bad); border-color: var(--bad); box-shadow: 0 0 0 4px color-mix(in srgb, var(--bad) 22%, transparent), 0 0 18px color-mix(in srgb, var(--bad) 40%, transparent); }
.on.end.person .ico::before, .on.end.person .ico::after { background: #fff; opacity: 1; }
.role b { font-size: 15px; margin-top: 4px; }
.role small { font-size: 15px; color: var(--muted); }
.miss { position: absolute; z-index: 2; top: -8px; left: calc(50% + 12px); min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--bad); color: #fff; font-size: 15px; font-weight: 800; line-height: 22px; }
.gh { display: flex; justify-content: space-between; align-items: baseline; margin: 14px 0 6px; font-size: 15px; font-weight: 700; }
.gh span { font-weight: 500; color: var(--muted); font-size: 15px; }
.gates { display: flex; flex-wrap: wrap; gap: 6px; }
.gate { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: var(--cut-s, 10px); border: 1px solid var(--line); font-size: 15px; transition: background .3s, border-color .3s; }
.gate i { font-style: normal; font-weight: 800; }
.gate small { font-size: 15px; color: var(--muted); }
.gate.wait { border-style: dashed; color: var(--dim); }
.gate.skipped { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 9%, transparent); }
.gate.skipped i { color: var(--bad); }
.gate.kept, .gate.alt { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 11%, transparent); }
.gate.kept i, .gate.alt i { color: var(--ok); }
.gate.alt { border-width: 2px; }
.gate.here { box-shadow: 0 0 0 3px color-mix(in srgb, var(--orange) 25%, transparent); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { font-size: 15px; padding: 3px 10px; border-radius: var(--cut-s, 10px); border: 1px solid var(--line); color: var(--muted); }
.chip b { color: var(--text); font-variant-numeric: tabular-nums; }
.draft { font-size: 15px; color: var(--dim); margin-top: 8px; }
@media (max-width: 700px) { .role small { display: none; } .ico { width: 36px; height: 36px; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; left: var(--b); } .ico, .gate { transition: none; } }
`;

class IncidentBoard extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${CSS}</style><div id="bd"></div>`;
    this._key = ''; this._s = null; this._shown = null; this._raf = 0;
  }
  static get observedAttributes() { return ['board']; }
  attributeChangedCallback(_name, _old, key) {
    key = key || '';
    if (key === this._key) return;
    let v = null;
    try { v = key ? JSON.parse(key) : null; } catch (e) { v = null; }
    const sameCase = this._s && v && this._s.id === v.id;
    this._key = key; this._s = v;
    this.render(sameCase);
  }

  // 관문 상태: 아직(장면이 안 닿음) · 건너뜀 · 지킴 · 다르게 하면 지킴(갈림길에서 관문을 지키는 선택을 고름)
  gateState(g, step) {
    if (g.at > step - 1) return 'wait';
    const s = this._s;
    if ((g.passed_by || []).some((p) => s.steps[p.at]?.pickIndex === p.option)) return 'alt';
    return g.actual === 'kept' ? 'kept' : 'skipped';
  }

  render(sameCase) {
    const s = this._s, bd = this.root.getElementById('bd');
    if (!s) { bd.innerHTML = ''; this._shown = null; return; }
    const total = s.steps.length, step = Math.min(Math.max(1, s.step), total), cur = s.steps[step - 1], end = step >= total;
    const roles = s.roles || [], gates = s.gates || [], n = Math.max(1, roles.length);
    const states = gates.map((g) => this.gateState(g, step));
    const count = (k) => states.filter((x) => x === k).length;
    const acted = new Set(s.steps.slice(0, step).map((x) => x.actor));
    // 사례 원문에 시각이 없으면(실제 공개 사례) 장면 이름을 그대로 보여 주고 경과 시간·시계 움직임은 뺀다
    const isClock = s.steps.every((x) => /^\d{1,2}:\d{2}$/.test(x.time));
    const first = toMin(s.steps[0].time), now = toMin(cur.time), elapsed = isClock ? (now >= first ? now - first : now + 1440 - first) : null;
    const [label, tone] = end ? ['사고 발생', 'var(--bad)'] : cur.branch && cur.pickIndex == null ? ['갈림길', 'var(--mid)'] : ['사고 전', 'var(--muted)'];

    // 역할 줄: 앞 장면의 역할 → 지금 역할로 빛이 넘어간다(같은 역할이면 그 자리에서 빛남)
    const at = (id) => { const i = roles.findIndex((r) => r.id === id); return i < 0 ? null : ((i + 0.5) / n) * 100; };
    const prev = step > 1 ? at(s.steps[step - 2].actor) : null, here = at(cur.actor);
    const hop = here == null ? '' : `<span class="dot" style="--a:${prev ?? here}%;--b:${here}%"></span>`;
    const missBy = (id) => gates.filter((g, i) => g.role === id && states[i] === 'skipped').length;
    const roleHtml = roles.map((r) => {
      const cls = [r.kind, acted.has(r.id) ? 'acted' : '', r.id === cur.actor ? `on${end ? ' end' : ''}` : ''].join(' ');
      const miss = missBy(r.id);
      return `<div class="role ${cls}"><div class="ico" aria-hidden="true"></div>${miss ? `<span class="miss" title="건너뛴 관문 ${miss}개">${miss}</span>` : ''}<b>${esc(r.name)}</b><small>${KIND[r.kind] || ''}</small></div>`;
    }).join('');
    const ICON = { wait: '·', skipped: '✕', kept: '✓', alt: '✓' }, WORD = { wait: '아직', skipped: '건너뜀', kept: '지킴', alt: '다르게 하면 지킴' };
    const gateHtml = gates.map((g, i) => {
      const st = states[i], who = roles.find((r) => r.id === g.role)?.name || '';
      return `<span class="gate ${st}${g.at === step - 1 ? ' here' : ''}" title="${esc(who)} · 장면 ${g.at + 1} · ${WORD[st]}"><i>${ICON[st]}</i>${esc(g.label)}<small>${WORD[st]}</small></span>`;
    }).join('');

    bd.innerHTML = `
      <div class="top"><div><div class="sub">${esc(s.section)} · 장면 ${step} / ${total}</div><div class="clock" id="clock">${esc(cur.time)}</div></div>
        <span class="state" style="color:${tone};border-color:${tone}">${label}</span></div>
      <div class="roles" style="grid-template-columns:repeat(${n},minmax(0,1fr))" role="img" aria-label="지금 장면에서 움직인 역할: ${esc(roles.find((r) => r.id === cur.actor)?.name || '')}">
        <span class="line" style="left:${50 / n}%;right:${50 / n}%"></span>${hop}${roleHtml}</div>
      <div class="gh">관문 <span>지켰다면 막을 수 있었던 절차</span></div>
      <div class="gates">${gateHtml}</div>
      <div class="chips">
        ${elapsed == null ? '' : `<span class="chip">경과 <b>${elapsed}분</b></span>`}
        <span class="chip">건너뜀 <b style="color:var(--bad)">${count('skipped')}</b></span>
        <span class="chip">지킴 <b style="color:var(--ok)">${count('kept')}</b></span>
        <span class="chip">다르게 하면 지킴 <b style="color:var(--ok)">${count('alt')}</b></span>
        <span class="chip">남은 관문 <b>${count('wait')}</b></span>
      </div>
      ${s.reviewed ? '' : '<div class="draft">관문은 사례집의 재해 예방 대책에서 뽑았어요. 역할 구분과 관문 묶음은 팀 검수 전이에요.</div>'}`;

    // 같은 사례에서 장면을 넘기면 시계가 이전 시각에서 지금 시각까지 흘러간다
    if (!isClock) { this._shown = null; cancelAnimationFrame(this._raf); return; }
    const from = sameCase && this._shown != null ? this._shown : now;
    this._shown = now;
    cancelAnimationFrame(this._raf);
    if (reduceMotion || from === now) return;
    const clock = this.root.getElementById('clock'), t0 = performance.now(), span = now >= from ? now - from : now + 1440 - from;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 900), e = 1 - (1 - k) ** 3;
      clock.textContent = hhmm(from + Math.round(span * e));
      if (k < 1) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

if (!customElements.get('incident-board')) customElements.define('incident-board', IncidentBoard);
