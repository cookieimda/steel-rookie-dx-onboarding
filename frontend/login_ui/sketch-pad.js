// 설계도 위 펜 필기 <sketch-pad process="ironmaking" mode="plan">. 마이페이지 '설계도·필기' 탭에서 도면(iframe) 위에 겹친다.
// - 도구: 펜(검정·빨강·파랑), 형광펜, 지우개(닿은 획을 통째로 지움), 되돌리기, 모두 지우기.
// - 좌표는 이 영역 크기에 대한 비율(0~1)로 둔다. 부모가 도면 영역 비율을 고정하므로 화면 크기가 바뀌어도 같은 자리에 그려진다.
// - 공정·도면(top·plan·front)마다 내 계정에 저장한다: GET /api/me/sketches/:process, PUT /api/me/sketches/:process/:mode(그린 뒤 0.8초).
//   로그인하지 않았으면 그릴 수는 있지만 저장하지 않는다고 알린다.

const TOKEN_KEY = 'st-rookie-token';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const MODES = ['top', 'plan', 'front'];
const SAVE_DELAY_MS = 800;

/** 도구: 펜 색 3개, 형광펜, 지우개. width는 영역 너비에 대한 비율. */
export const TOOLS = [
  { id: 'black', label: '검정 펜', tool: 'pen', color: '#111827', width: 0.0035, swatch: '#111827' },
  { id: 'red', label: '빨강 펜', tool: 'pen', color: '#e03131', width: 0.0035, swatch: '#e03131' },
  { id: 'blue', label: '파랑 펜', tool: 'pen', color: '#1971c2', width: 0.0035, swatch: '#1971c2' },
  { id: 'marker', label: '형광펜', tool: 'marker', color: '#ffd43b', width: 0.018, swatch: '#ffd43b' },
  { id: 'eraser', label: '지우개', tool: 'eraser' },
];

const round = (v) => Math.round(v * 10000) / 10000;

/** 점(px)과 선분 사이 거리. 지우개가 닿았는지 볼 때 쓴다. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

class SketchPad extends HTMLElement {
  static observedAttributes = ['process', 'mode'];

  constructor() {
    super();
    this.data = {};          // process → { top: [], plan: [], front: [] }
    this.toolId = 'red';
    this.drawing = null;     // 그리는 중인 획
    this.saveTimer = null;
    this.history = [];       // 되돌리기: { process, mode, strokes(이전 상태) }
  }

  connectedCallback() {
    if (this.canvas) return;
    this.style.cssText += ';position:absolute;inset:0;display:block;touch-action:none;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
    this.bar = document.createElement('div');
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', '필기 도구');
    this.bar.style.cssText = 'position:absolute;left:12px;top:12px;display:flex;align-items:center;gap:4px;padding:5px;border-radius:12px;background:rgba(18,22,28,.86);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(8px);font-family:inherit;';
    this.statusEl = document.createElement('span');
    this.statusEl.style.cssText = 'margin-left:6px;padding:0 6px;font-size:11px;color:#c3ccd7;white-space:nowrap;';
    this.append(this.canvas, this.bar);
    this.renderBar();
    new ResizeObserver(() => this.resize()).observe(this);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.resize();
    this.load();
  }

  attributeChangedCallback(name) {
    if (!this.canvas) return;
    if (name === 'process') this.load(); else this.redraw();
  }

  get process() { return this.getAttribute('process') || 'ironmaking'; }
  get mode() { const m = this.getAttribute('mode'); return MODES.includes(m) ? m : 'plan'; }
  get strokes() {
    const p = (this.data[this.process] ??= { top: [], plan: [], front: [] });
    return (p[this.mode] ??= []);
  }
  set strokes(list) { (this.data[this.process] ??= { top: [], plan: [], front: [] })[this.mode] = list; }

  renderBar() {
    this.bar.replaceChildren();
    const btn = (label, content, onClick, on = false) => {
      const b = document.createElement('button');
      b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-pressed', String(on));
      b.style.cssText = `width:32px;height:32px;display:grid;place-items:center;border-radius:8px;border:1px solid ${on ? '#ffffff' : 'transparent'};background:${on ? 'rgba(255,255,255,.16)' : 'transparent'};color:#eef2f6;font-size:14px;cursor:pointer;padding:0;`;
      if (typeof content === 'string') b.textContent = content; else b.append(content);
      b.addEventListener('click', onClick);
      this.bar.append(b);
    };
    for (const t of TOOLS) {
      const on = this.toolId === t.id;
      if (t.tool === 'eraser') { btn(t.label, '⌫', () => this.pick(t.id), on); continue; }
      const dot = document.createElement('span');
      dot.style.cssText = `display:block;width:${t.tool === 'marker' ? 16 : 12}px;height:${t.tool === 'marker' ? 8 : 12}px;border-radius:${t.tool === 'marker' ? '3px' : '50%'};background:${t.swatch};${t.tool === 'marker' ? 'opacity:.8;' : ''}box-shadow:0 0 0 1px rgba(255,255,255,.35);`;
      btn(t.label, dot, () => this.pick(t.id), on);
    }
    const sep = document.createElement('span'); sep.style.cssText = 'width:1px;height:20px;margin:0 4px;background:rgba(255,255,255,.18);';
    this.bar.append(sep);
    btn('되돌리기', '↶', () => this.undo());
    btn('이 도면 필기 모두 지우기', '🗑', () => this.clearAll());
    this.bar.append(this.statusEl);
  }

  pick(id) { this.toolId = id; this.renderBar(); this.canvas.style.cursor = id === 'eraser' ? 'cell' : 'crosshair'; }

  setStatus(text, tone = 'muted') {
    this.statusEl.textContent = text;
    this.statusEl.style.color = tone === 'bad' ? '#ff8787' : tone === 'ok' ? '#8ce99a' : '#c3ccd7';
  }

  resize() {
    const r = this.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx = this.canvas.getContext('2d'); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  async load() {
    const process = this.process;
    if (this.data[process]) { this.redraw(); return; }
    this.data[process] = { top: [], plan: [], front: [] };
    this.redraw();
    if (!token()) { this.setStatus('로그인하면 필기가 저장돼요'); return; }
    this.setStatus('불러오는 중…');
    try {
      const res = await fetch(`/api/me/sketches/${encodeURIComponent(process)}`, { headers: { authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error(String(res.status));
      const { sketches } = await res.json();
      // 불러오는 동안 그린 획이 있으면 뒤에 붙인다.
      for (const m of MODES) this.data[process][m] = [...(sketches?.[m] || []), ...this.data[process][m]];
      this.setStatus('');
      this.redraw();
    } catch (e) {
      this.setStatus(e.message === '401' ? '로그인이 만료돼 저장할 수 없어요' : '필기를 불러오지 못했어요', 'bad');
    }
  }

  point(e) { const r = this.canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; }

  down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.point(e);
    if (this.toolId === 'eraser') { this.erasing = true; this.erase(p); return; }
    const t = TOOLS.find((x) => x.id === this.toolId);
    this.drawing = { tool: t.tool, color: t.color, width: t.width, points: [p] };
    this.redraw();
  }

  move(e) {
    if (this.erasing) { this.erase(this.point(e)); return; }
    if (!this.drawing) return;
    const p = this.point(e), last = this.drawing.points.at(-1);
    if (Math.hypot((p[0] - last[0]) * this.w, (p[1] - last[1]) * this.h) < 1.5) return;
    this.drawing.points.push(p);
    this.redraw();
  }

  up() {
    if (this.erasing) { this.erasing = false; return; }
    if (!this.drawing) return;
    const stroke = { ...this.drawing, points: this.drawing.points.map(([x, y]) => [round(x), round(y)]) };
    this.drawing = null;
    this.remember();
    this.strokes = [...this.strokes, stroke];
    this.redraw();
    this.scheduleSave();
  }

  /** 지우개: 닿은 획을 통째로 지운다. */
  erase([x, y]) {
    const px = x * this.w, py = y * this.h, radius = 10;
    const keep = this.strokes.filter((s) => {
      const pts = s.points.map(([a, b]) => [a * this.w, b * this.h]);
      if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) > radius;
      return !pts.some((q, i) => i > 0 && distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], q[0], q[1]) <= radius);
    });
    if (keep.length === this.strokes.length) return;
    this.remember();
    this.strokes = keep;
    this.redraw();
    this.scheduleSave();
  }

  remember() {
    this.history.push({ process: this.process, mode: this.mode, strokes: this.strokes });
    if (this.history.length > 50) this.history.shift();
  }

  undo() {
    const i = this.history.findLastIndex((h) => h.process === this.process && h.mode === this.mode);
    if (i < 0) return;
    this.strokes = this.history.splice(i, 1)[0].strokes;
    this.redraw();
    this.scheduleSave();
  }

  clearAll() {
    if (!this.strokes.length || !window.confirm('이 도면의 필기를 모두 지울까요?')) return;
    this.remember();
    this.strokes = [];
    this.redraw();
    this.scheduleSave();
  }

  scheduleSave() {
    if (!token()) { this.setStatus('로그인하면 필기가 저장돼요'); return; }
    const process = this.process, mode = this.mode;
    this.setStatus('저장 중…');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(process, mode), SAVE_DELAY_MS);
  }

  async save(process, mode) {
    try {
      const res = await fetch(`/api/me/sketches/${encodeURIComponent(process)}/${mode}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
        body: JSON.stringify({ strokes: this.data[process]?.[mode] || [] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(res.status === 401 ? '로그인이 만료돼 저장하지 못했어요' : data.error || '저장하지 못했어요');
      }
      this.setStatus('저장됨', 'ok');
    } catch (e) {
      this.setStatus(e.message || '저장하지 못했어요', 'bad');
    }
  }

  redraw() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    const list = this.drawing ? [...this.strokes, this.drawing] : this.strokes;
    for (const s of list) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color;
      ctx.lineWidth = Math.max(1, s.width * this.w);
      ctx.globalAlpha = s.tool === 'marker' ? 0.38 : 1;
      const pts = s.points.map(([x, y]) => [x * this.w, y * this.h]);
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y); ctx.stroke(); }
      ctx.restore();
    }
  }
}

if (!customElements.get('sketch-pad')) customElements.define('sketch-pad', SketchPad);
