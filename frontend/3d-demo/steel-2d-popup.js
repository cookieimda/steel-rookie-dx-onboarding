// <steel-2d-popup> — 3D에서 설비를 고르면 그 설비의 2D 공정 애니메이션을 팝업으로 띄운다.
// 넣는 법: scene.js 옆에 <script type="module" src="./steel-2d-popup.js"></script> 한 줄이면 끝.
// 페이지 안의 <steel-scene> 의 selected 속성을 감시하므로 3D 메시/라벨 클릭, 하단 설비 버튼, 튜터 하이라이트 어느 경로로 골라도 뜬다.
// 장면·단계 데이터는 steel-2d.js 의 STAGES/SCENES 를 그대로 쓰고, 2D 장면이 없는 공정(제선·연주·압연)은 아무것도 띄우지 않는다.
import { STAGES, SCENES, SCENE_CSS, readGlbGroups } from './steel-2d.js';

const CSS = `
:host{position:fixed;z-index:60;right:22px;top:50%;transform:translateY(-50%);width:min(620px,50vw);display:none;font-family:"IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;font-size:13px;line-height:1.45;color:#e9eff8;
  --panel:#101720;--line:#23303d;--muted:#8b99a8;--soft:#17212d;--warn:#ffc857;--ok:#39d98a;--miss:#ff5d68;--accent:#7ca7ff}
:host([open]){display:block;animation:pop .22s ease-out}
:host([theme=light]){--panel:#ffffff;--line:#e1e7ef;--muted:#64748b;--soft:#edf2f7;--accent:#2260d8;color:#17263d}
*{box-sizing:border-box}button{font:inherit;cursor:pointer}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.45);overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 40px)}
.head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 6px}
.head .k{font-size:10px;letter-spacing:1.4px;color:var(--accent);font-weight:700}.head .t{font-weight:800;font-size:16px;line-height:1.3}.head .m{font-size:11px;color:var(--muted)}
.close{margin-left:auto;flex:none;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit;font-size:16px;display:grid;place-items:center}.close:hover{background:var(--soft)}
.tabs{display:flex;gap:6px;padding:4px 14px 8px;flex-wrap:wrap}.tab{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:3px 10px;font-size:11px}.tab.on{border-color:var(--warn);color:var(--warn);background:rgba(255,200,87,.08)}.tab i{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--miss);margin-left:6px;vertical-align:middle}.tab i.ok{background:var(--ok)}
.svgbox{margin:0 10px;border:1px solid;border-radius:11px;overflow:hidden}.svgbox svg{width:100%;height:auto;display:block}
.cap{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 14px 0;font-size:12px;color:var(--muted)}.cap b{color:var(--warn)}.cap .time{font-size:10px;white-space:nowrap}
.ctrl{display:flex;gap:6px;align-items:center;padding:8px 14px 10px}
.btn{border:1px solid var(--line);background:var(--soft);color:inherit;border-radius:8px;padding:6px 10px;font-size:11px}.btn.play.on{border-color:var(--accent);color:var(--accent)}
.dots{display:flex;gap:5px;margin-left:auto;flex-wrap:wrap;justify-content:flex-end}.dot{width:8px;height:8px;border-radius:50%;background:var(--line);border:0;padding:0}.dot.done{background:var(--muted)}.dot.on{background:var(--warn);transform:scale(1.25)}
.steps{max-height:132px;overflow:auto;padding:0 14px 12px;display:grid;gap:4px}
.step{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);background:transparent;border-radius:7px;padding:5px 8px;cursor:pointer;opacity:.6;font-size:11px;text-align:left;color:inherit}.step.on{opacity:1;border-color:var(--warn)}.step.done{opacity:.85}
.step .num{width:19px;height:19px;border-radius:5px;background:var(--soft);color:var(--muted);display:grid;place-items:center;font-size:10px}.step.on .num{background:var(--warn);color:#221700;font-weight:800}.step .time{font-size:9px;color:var(--muted)}
@keyframes pop{from{opacity:0;transform:translateY(-50%) scale(.97)}to{opacity:1;transform:translateY(-50%) scale(1)}}
@media(max-width:900px){:host{right:0;left:0;top:auto;bottom:0;transform:none;width:auto}:host([open]){animation:none}.panel{border-radius:16px 16px 0 0;max-height:72vh}}
${SCENE_CSS}
`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const groupCache = new Map();  // process id → Promise<string[]>
const glbGroups = (pid) => { if (!groupCache.has(pid)) groupCache.set(pid, readGlbGroups(new URL(`models/${pid}.glb`, document.baseURI).href).catch(() => [])); return groupCache.get(pid); };

class Steel2DPopup extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="panel" role="dialog" aria-label="2D 공정 애니메이션">
      <div class="head"><div><div class="k" id="k"></div><div class="t" id="t"></div><div class="m" id="m"></div></div><button class="close" id="close" aria-label="닫기">✕</button></div>
      <div class="tabs" id="tabs"></div>
      <div class="svgbox" id="svgbox"></div>
      <div class="cap"><span id="cap"></span><span class="time" id="time"></span></div>
      <div class="ctrl"><button class="btn prev">← 이전</button><button class="btn next">다음 →</button><button class="btn play">⏸ 자동</button><div class="dots" id="dots"></div></div>
      <div class="steps" id="steps"></div></div>`;
    this.$ = id => this.shadowRoot.getElementById(id);
    this.eq = null; this.process = null; this.stages = []; this.i = 0; this.step = 0; this.timer = null; this.dismissed = null;
    this.$('close').onclick = () => this.close(true);
    this.shadowRoot.querySelector('.prev').onclick = () => this.advance(-1);
    this.shadowRoot.querySelector('.next').onclick = () => this.advance(1);
    this.shadowRoot.querySelector('.play').onclick = () => this.timer ? this.stopAuto() : this.startAuto();
    this._key = e => { if (!this.hasAttribute('open')) return; if (e.key === 'Escape') this.close(true); else if (e.key === 'ArrowRight') this.advance(1); else if (e.key === 'ArrowLeft') this.advance(-1); };
  }
  connectedCallback() { document.addEventListener('keydown', this._key); }
  disconnectedCallback() { document.removeEventListener('keydown', this._key); this.stopAuto(); }

  // eq = 3D 설비 id (data.js). 같은 설비로 이미 열려 있으면 그대로 두고, 사용자가 닫은 설비는 force 일 때만 다시 연다.
  open(eq, process = 'steelmaking', force = false) {
    const stages = (STAGES[process] || []).filter(s => s.eq === eq);
    if (!stages.length) { this.close(); return; }
    if (this.hasAttribute('open') && this.eq === eq && this.process === process) return;
    if (!force && this.dismissed === `${process}/${eq}`) return;
    this.eq = eq; this.process = process; this.stages = stages; this.dismissed = null;
    this.setAttribute('open', '');
    this.show(0);
    glbGroups(process).then(names => { if (this.eq !== eq) return; this.stages.forEach(s => { s.found = names.some(n => s.match.test(n)); }); this.renderTabs(); this.$('svgbox').querySelector('svg')?.classList.toggle('found', !!this.stages[this.i].found); });
    this.startAuto();
  }
  close(byUser = false) {
    if (byUser && this.eq) this.dismissed = `${this.process}/${this.eq}`;
    this.stopAuto(); this.removeAttribute('open');
  }
  show(i) {
    this.i = i; this.step = 0;
    const s = this.stages[i], total = this.stages.length;
    this.$('k').textContent = `${(this.process || '').replace(/_/g, ' ').toUpperCase()} · 2D 공정 동작`;
    this.$('t').textContent = s.name; this.$('m').textContent = s.en;
    this.renderTabs();
    this.$('svgbox').innerHTML = SCENES[s.id] || '';
    const svg = this.$('svgbox').querySelector('svg'); if (svg) { svg.classList.add('hl'); svg.classList.toggle('found', !!s.found); }
    this.$('steps').innerHTML = s.steps.map((x, k) => `<button class="step" data-i="${k}"><span class="num">${k + 1}</span><span>${esc(x[0])}</span><span class="time">${esc(x[1] || '')}</span></button>`).join('');
    this.$('steps').querySelectorAll('.step').forEach(b => b.onclick = () => { this.step = +b.dataset.i; this.highlight(); });
    this.$('dots').innerHTML = s.steps.map((_, k) => `<button class="dot" data-i="${k}" aria-label="단계 ${k + 1}"></button>`).join('');
    this.$('dots').querySelectorAll('.dot').forEach(b => b.onclick = () => { this.step = +b.dataset.i; this.highlight(); });
    this.highlight();
  }
  renderTabs() {
    this.$('tabs').style.display = this.stages.length > 1 ? '' : 'none';
    this.$('tabs').innerHTML = this.stages.map((s, k) => `<button class="tab ${k === this.i ? 'on' : ''}" data-i="${k}">${esc(s.name)}<i class="${s.found ? 'ok' : ''}" title="${s.found ? 'GLB에 있음' : 'GLB에 없음'}"></i></button>`).join('');
    this.$('tabs').querySelectorAll('.tab').forEach(b => b.onclick = () => { const auto = !!this.timer; this.show(+b.dataset.i); if (auto) this.startAuto(); });
  }
  highlight() {
    const s = this.stages[this.i], svg = this.$('svgbox').querySelector('svg');
    if (svg) svg.querySelectorAll('[data-s]').forEach(g => g.classList.toggle('hit', g.dataset.s.split(' ').includes(String(this.step + 1))));
    this.$('cap').innerHTML = `<b>${this.step + 1}/${s.steps.length}</b> · ${esc(s.steps[this.step][0])}`;
    this.$('time').textContent = s.steps[this.step][1] || '';
    this.shadowRoot.querySelectorAll('.step').forEach((el, k) => { el.classList.toggle('on', k === this.step); el.classList.toggle('done', k < this.step); if (k === this.step) el.scrollIntoView({ block: 'nearest' }); });
    this.shadowRoot.querySelectorAll('.dot').forEach((el, k) => { el.classList.toggle('on', k === this.step); el.classList.toggle('done', k < this.step); });
  }
  advance(n) {
    const max = this.stages[this.i].steps.length;
    if (n > 0 && this.step === max - 1) {
      // 마지막 단계: 자동 재생 중이면 다음 탭(없으면 첫 단계)으로 이어 가고, 수동이면 멈춘다
      if (this.timer) { const auto = true; if (this.i < this.stages.length - 1) this.show(this.i + 1); else this.show(0); if (auto) this.startAuto(); }
      return;
    }
    if (n < 0 && this.step === 0) return;
    this.step += n; this.highlight();
  }
  startAuto() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.advance(1), 2600);
    const b = this.shadowRoot.querySelector('.play'); b.textContent = '⏸ 자동'; b.classList.add('on');
  }
  stopAuto() {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const b = this.shadowRoot.querySelector('.play'); b.textContent = '▶ 자동'; b.classList.remove('on');
  }
}
if (!customElements.get('steel-2d-popup')) customElements.define('steel-2d-popup', Steel2DPopup);

// ---- 자동 연결: 페이지의 <steel-scene> selected 속성을 따라 팝업을 열고 닫는다 ----
function ensurePopup() {
  let p = document.querySelector('steel-2d-popup');
  if (!p) { p = document.createElement('steel-2d-popup'); document.body.appendChild(p); }
  return p;
}
function syncFrom(sc, force = false, id = sc.getAttribute('selected') || '') {
  const p = ensurePopup();
  p.setAttribute('theme', sc.getAttribute('theme') || 'dark');
  if (id) p.open(id, sc.getAttribute('process') || 'steelmaking', force); else p.close();
}
const mo = new MutationObserver(list => {
  for (const m of list) {
    if (m.type === 'attributes' && m.target.tagName === 'STEEL-SCENE') syncFrom(m.target);
    else if (m.type === 'childList') m.addedNodes.forEach(n => { if (n.nodeType !== 1) return; (n.tagName === 'STEEL-SCENE' ? [n] : [...(n.querySelectorAll?.('steel-scene') || [])]).forEach(sc => { if (sc.getAttribute('selected')) syncFrom(sc); }); });
  }
});
mo.observe(document.documentElement, { attributes: true, attributeFilter: ['selected', 'theme'], subtree: true, childList: true });
// 3D에서 같은 설비를 다시 클릭하면(속성값은 그대로라 감시에 안 걸림) 닫았던 팝업도 다시 연다
document.addEventListener('steel-select', e => {
  const sc = e.target?.tagName === 'STEEL-SCENE' ? e.target : null;
  if (sc && e.detail?.id) syncFrom(sc, true, e.detail.id);
});
document.querySelectorAll('steel-scene').forEach(sc => { if (sc.getAttribute('selected')) syncFrom(sc); });

export { Steel2DPopup };
