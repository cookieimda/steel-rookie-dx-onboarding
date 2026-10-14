// 설계도 위 펜 필기 <sketch-pad process="ironmaking" mode="plan">. 마이페이지 '설계도·필기' 탭에서 도면(iframe) 위에 겹친다.
// - 도구: 펜(검정·빨강·하양. 하양은 남색 도면 위에서 보이게 파랑 대신 둔 고정색, 2026-10-14 요청), 색 고르기(RGB 팔레트를 열어 고른 색의 펜), 형광펜, 텍스트(누른 자리에 글 입력, 마지막 펜 색),
//   스티커 메모(누른 자리에 종이 메모를 붙인다. 여러 줄, 메모를 끌면 옮기고 누르면 고친다), 지우개(닿은 획·글·메모를 통째로 지움), 되돌리기, 모두 지우기.
// - 스티커 메모의 종이 색은 노랑이 기본이고, 스티커 도구를 고른 채 색 고르기를 쓰면 그 색을 옅게 한 종이가 된다.
// - 좌표는 이 영역 크기에 대한 비율(0~1)로 둔다. 부모가 도면 영역 비율을 고정하므로 화면 크기가 바뀌어도 같은 자리에 그려진다.
// - 공정·도면(top·plan·front)마다 내 계정에 저장한다: GET /api/me/sketches/:process, PUT /api/me/sketches/:process/:mode(그린 뒤 0.8초).
//   로그인하지 않았으면 그릴 수는 있지만 저장하지 않는다고 알린다.

const TOKEN_KEY = 'st-rookie-token';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const MODES = ['top', 'plan', 'front'];
const SAVE_DELAY_MS = 800;

/** 도구: 펜 고정색 3개(검정·빨강·하양), 색 고르기, 형광펜, 텍스트, 스티커, 지우개. width는 영역 너비에 대한 비율. */
export const TOOLS = [
  { id: 'black', label: '검정 펜', tool: 'pen', color: '#111827', width: 0.0035, swatch: '#111827' },
  { id: 'red', label: '빨강 펜', tool: 'pen', color: '#e03131', width: 0.0035, swatch: '#e03131' },
  { id: 'white', label: '하양 펜', tool: 'pen', color: '#ffffff', width: 0.0035, swatch: '#ffffff' },
  { id: 'custom', label: '색 고르기 (RGB 팔레트)', tool: 'pen', width: 0.0035 }, // 색은 고른 값(customColor)
  { id: 'marker', label: '형광펜', tool: 'marker', color: '#ffd43b', width: 0.018, swatch: '#ffd43b' },
  { id: 'text', label: '텍스트', tool: 'text', width: 0.02 },
  { id: 'sticky', label: '스티커 메모', tool: 'sticky', width: 0.2 },
  { id: 'eraser', label: '지우개', tool: 'eraser' },
];
/** 텍스트 한 줄 최대 길이(서버 검증과 같다). */
export const MAX_TEXT = 200;
/** 스티커 메모 최대 길이(서버 검증과 같다). */
export const MAX_STICKY = 300;
const STICKY_INK = '#2b2b2b';
const STICKY_FONT = (px) => `500 ${px}px Pretendard, "Malgun Gothic", sans-serif`;
/** 고른 색을 흰색과 섞어 옅은 종이 색으로 만든다. */
const pastel = (hex, k = 0.72) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('');
const TEXT_FONT = (px) => `600 ${px}px Pretendard, "Malgun Gothic", sans-serif`;
/** 텍스트 뒤에 까는 바탕: 잉크가 밝으면(하양 펜) 어둡게, 아니면 밝게. 남색 도면 위에서도 읽히게 한다. */
const textBg = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? 'rgba(13,17,20,.85)' : 'rgba(255,255,255,.9)'; };

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
    this.penColor = '#e03131'; // 텍스트는 마지막으로 고른 펜 색으로 쓴다
    this.customColor = '#7048e8'; // 색 고르기(RGB 팔레트)로 고른 펜 색
    this.stickyColor = '#fff3bf'; // 스티커 메모 종이 색
    this.noteDrag = null;    // 스티커 메모를 끄는 중
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
    // 색 고르기: 브라우저의 RGB 팔레트(input type=color)를 연다
    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color'; this.colorInput.value = this.customColor; this.colorInput.setAttribute('aria-label', '필기 색 고르기');
    this.colorInput.style.cssText = 'position:absolute;left:12px;top:12px;width:1px;height:1px;opacity:0;pointer-events:none;';
    this.colorInput.addEventListener('input', () => this.pickColor(this.colorInput.value));
    this.append(this.colorInput);
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
      if (t.tool === 'text') { btn(`${t.label} (누른 자리에 입력, Enter로 확정)`, 'T', () => this.pick(t.id), on); continue; }
      if (t.id === 'custom') { // 무지개 고리 안에 지금 고른 색
        const ring = document.createElement('span');
        ring.style.cssText = `display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:conic-gradient(#ff3b3b,#ffd43b,#51cf66,#22b8cf,#4c6ef5,#cc5de8,#ff3b3b);`;
        const dot = document.createElement('span'); dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${this.customColor};box-shadow:0 0 0 2px rgba(18,22,28,.9);`;
        ring.append(dot);
        btn(`${t.label}${this.toolId === 'sticky' ? ' · 메모 종이 색' : ''}`, ring, () => this.colorInput.click(), on);
        continue;
      }
      if (t.tool === 'sticky') { // 접힌 귀퉁이가 있는 작은 종이(지금 종이 색)
        const note = document.createElement('span');
        note.style.cssText = `display:block;width:16px;height:16px;border-radius:2px;background:linear-gradient(225deg,rgba(0,0,0,.25) 0 4px,${this.stickyColor} 4px);box-shadow:0 1px 2px rgba(0,0,0,.4);`;
        btn(`${t.label} (누른 자리에 붙이기 · 메모를 끌면 옮기기 · 누르면 고치기)`, note, () => this.pick(t.id), on);
        continue;
      }
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

  pick(id) {
    this.commitText();
    this.toolId = id;
    const t = TOOLS.find((x) => x.id === id);
    if (t?.tool === 'pen') this.penColor = id === 'custom' ? this.customColor : t.color;
    this.renderBar();
    this.canvas.style.cursor = id === 'eraser' ? 'cell' : id === 'text' ? 'text' : id === 'sticky' ? 'copy' : 'crosshair';
  }

  /** RGB 팔레트에서 고른 색: 스티커 도구를 쓰는 중이면 종이 색(옅게), 아니면 그 색의 펜. */
  pickColor(hex) {
    this.customColor = hex;
    if (this.toolId === 'sticky') { this.stickyColor = pastel(hex); this.renderBar(); return; }
    this.pick('custom');
  }

  /** 스티커 메모: 누른 자리(at)에 여러 줄 입력칸을 띄운다. note가 있으면 그 메모를 고친다. Ctrl+Enter·바깥 누르기로 확정, Esc로 취소. */
  openSticky(at, note = null) {
    this.commitText();
    const width = note ? note.width : TOOLS.find((x) => x.id === 'sticky').width, color = note ? note.color : this.stickyColor, fs = this.stickyFont(width);
    const area = document.createElement('textarea');
    area.maxLength = MAX_STICKY; area.placeholder = '메모 (Ctrl+Enter로 붙이기)'; area.value = note ? note.text : '';
    area.setAttribute('aria-label', '스티커 메모');
    area.style.cssText = `position:absolute;left:${at[0] * this.w}px;top:${at[1] * this.h}px;width:${width * this.w}px;min-height:${fs * 5}px;padding:${fs * 0.8}px;box-sizing:border-box;font:${STICKY_FONT(fs)};line-height:1.4;color:${STICKY_INK};background:${color};border:0;border-radius:3px;box-shadow:0 6px 16px rgba(0,0,0,.35);outline:2px solid rgba(255,255,255,.7);resize:none;z-index:3;`;
    this.textInput = { el: area, at, color, sticky: true, note, width };
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.commitText(true); }
      e.stopPropagation();
    });
    area.addEventListener('blur', () => this.commitText());
    this.append(area);
    setTimeout(() => area.focus(), 0);
  }

  stickyFont(width) { return Math.max(15, Math.min(18, width * this.w * 0.085)); } // 글자는 15px 이상(프로젝트 글자 크기 규칙)

  /** 스티커 메모가 차지하는 상자(px)와 줄바꿈한 줄들. 지우개·끌기·그리기에 쓴다. */
  stickyBox(s) {
    const fs = this.stickyFont(s.width), w = s.width * this.w, pad = fs * 0.8, maxW = w - pad * 2;
    this.ctx.save(); this.ctx.font = STICKY_FONT(fs);
    const lines = [];
    for (const para of s.text.split('\n')) { // 글자 단위로 감싼다(한글은 띄어쓰기가 적어서)
      let line = '';
      for (const ch of para) { if (line && this.ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch.trimStart(); } else line += ch; }
      lines.push(line);
    }
    this.ctx.restore();
    return { x: s.points[0][0] * this.w, y: s.points[0][1] * this.h, w, h: pad * 2 + lines.length * fs * 1.4, pad, fs, lines };
  }

  /** 그 자리에 있는 맨 위 스티커 메모. */
  stickyAt([x, y]) {
    const px = x * this.w, py = y * this.h;
    return [...this.strokes].reverse().find((s) => { if (s.tool !== 'sticky') return false; const b = this.stickyBox(s); return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; }) || null;
  }

  /** 텍스트 도구: 누른 자리에 입력칸을 띄운다. Enter·바깥 누르기로 확정, Esc로 취소. */
  openText([x, y]) {
    this.commitText();
    const size = TOOLS.find((t) => t.id === 'text').width * this.w;
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = MAX_TEXT; input.placeholder = '메모 입력 후 Enter';
    input.setAttribute('aria-label', '필기 텍스트');
    input.style.cssText = `position:absolute;left:${x * this.w}px;top:${y * this.h}px;min-width:160px;max-width:60%;padding:2px 6px;font:${TEXT_FONT(size)};color:${this.penColor};background:${textBg(this.penColor)};border:1px dashed ${this.penColor};border-radius:4px;outline:none;z-index:2;`;
    this.textInput = { el: input, at: [x, y], color: this.penColor };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.commitText(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.commitText(true); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => this.commitText());
    this.append(input);
    setTimeout(() => input.focus(), 0);
  }

  commitText(cancel = false) {
    const t = this.textInput;
    if (!t) return;
    this.textInput = null;
    if (t.sticky) { // 스티커 메모: 새로 붙이거나, 고친 글로 바꾸거나, 글을 다 지우면 메모를 뗀다
      const text = t.el.value.replace(/\s+$/, '').slice(0, MAX_STICKY);
      t.el.remove();
      if (cancel) return;
      if (t.note) {
        if (text.trim() === t.note.text) return;
        this.remember();
        this.strokes = text.trim() ? this.strokes.map((s) => (s === t.note ? { ...s, text: text.trim() } : s)) : this.strokes.filter((s) => s !== t.note);
      } else {
        if (!text.trim()) return;
        this.remember();
        this.strokes = [...this.strokes, { tool: 'sticky', color: t.color, width: t.width, text: text.trim(), points: [[round(t.at[0]), round(t.at[1])]] }];
      }
      this.redraw(); this.scheduleSave(); return;
    }
    const text = t.el.value.trim().slice(0, MAX_TEXT);
    t.el.remove();
    if (cancel || !text) return;
    this.remember();
    this.strokes = [...this.strokes, { tool: 'text', color: t.color, width: TOOLS.find((x) => x.id === 'text').width, text, points: [[round(t.at[0]), round(t.at[1])]] }];
    this.redraw();
    this.scheduleSave();
  }

  /** 텍스트 획이 차지하는 상자(px). 지우개와 그리기에 쓴다. */
  textBox(s) {
    const px = s.width * this.w;
    this.ctx.save(); this.ctx.font = TEXT_FONT(px);
    const width = this.ctx.measureText(s.text).width;
    this.ctx.restore();
    const pad = px * 0.3;
    return { x: s.points[0][0] * this.w, y: s.points[0][1] * this.h, w: width + pad * 2, h: px * 1.4, pad, px };
  }

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
    if (this.toolId === 'text') { e.preventDefault(); this.openText(p); return; }
    if (this.toolId === 'sticky') { // 메모 위를 누르면 끌어서 옮기고(그냥 떼면 고치기), 빈 곳을 누르면 새 메모
      e.preventDefault(); const s = this.stickyAt(p);
      if (s) this.noteDrag = { s, from: p, at: s.points[0], moved: false }; else this.openSticky(p);
      return;
    }
    const t = TOOLS.find((x) => x.id === this.toolId);
    this.drawing = { tool: t.tool, color: t.id === 'custom' ? this.customColor : t.color, width: t.width, points: [p] };
    this.redraw();
  }

  move(e) {
    if (this.erasing) { this.erase(this.point(e)); return; }
    if (this.noteDrag) {
      const d = this.noteDrag, p = this.point(e), b = this.stickyBox(d.s);
      const nx = Math.min(1 - b.w / this.w, Math.max(0, d.at[0] + p[0] - d.from[0])), ny = Math.min(1 - b.h / this.h, Math.max(0, d.at[1] + p[1] - d.from[1]));
      if (!d.moved && Math.hypot((p[0] - d.from[0]) * this.w, (p[1] - d.from[1]) * this.h) < 4) return;
      d.moved = true; d.s.points = [[nx, ny]]; this.redraw(); return; // 끄는 동안은 그 메모 자리만 바꾼다(놓을 때 기록)
    }
    if (!this.drawing) return;
    const p = this.point(e), last = this.drawing.points.at(-1);
    if (Math.hypot((p[0] - last[0]) * this.w, (p[1] - last[1]) * this.h) < 1.5) return;
    this.drawing.points.push(p);
    this.redraw();
  }

  up() {
    if (this.erasing) { this.erasing = false; return; }
    if (this.noteDrag) {
      const d = this.noteDrag; this.noteDrag = null;
      if (!d.moved) { this.openSticky(d.at, d.s); return; }
      const moved = { ...d.s, points: [[round(d.s.points[0][0]), round(d.s.points[0][1])]] };
      d.s.points = [d.at]; // 되돌리기에 옮기기 전 자리가 남게
      this.remember();
      this.strokes = this.strokes.map((s) => (s === d.s ? moved : s));
      this.redraw(); this.scheduleSave(); return;
    }
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
      if (s.tool === 'sticky') { const b = this.stickyBox(s); return !(px >= b.x - radius && px <= b.x + b.w + radius && py >= b.y - radius && py <= b.y + b.h + radius); }
      if (s.tool === 'text') { const b = this.textBox(s); return !(px >= b.x - radius && px <= b.x + b.w + radius && py >= b.y - radius && py <= b.y + b.h + radius); }
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
      if (s.tool === 'sticky') { // 그림자 + 종이 + 접힌 귀퉁이 + 여러 줄 글
        if (this.textInput?.note === s) continue; // 고치는 중이면 입력칸이 대신 보인다
        const b = this.stickyBox(s), fold = Math.min(14, b.w * 0.12);
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h - fold); ctx.lineTo(b.x + b.w - fold, b.y + b.h); ctx.lineTo(b.x, b.y + b.h); ctx.closePath(); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.beginPath(); ctx.moveTo(b.x + b.w, b.y + b.h - fold); ctx.lineTo(b.x + b.w - fold, b.y + b.h - fold); ctx.lineTo(b.x + b.w - fold, b.y + b.h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = STICKY_INK; ctx.font = STICKY_FONT(b.fs); ctx.textBaseline = 'top';
        b.lines.forEach((ln, i) => ctx.fillText(ln, b.x + b.pad, b.y + b.pad + i * b.fs * 1.4));
        ctx.restore();
        continue;
      }
      if (s.tool === 'text') {
        // 남색 도면 위에서도 읽히게 바탕을 깐다(잉크가 밝으면 어두운 바탕).
        const b = this.textBox(s);
        ctx.save();
        ctx.fillStyle = textBg(s.color);
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(b.x, b.y, b.w, b.h, 4) : ctx.rect(b.x, b.y, b.w, b.h); ctx.fill();
        ctx.fillStyle = s.color; ctx.font = TEXT_FONT(b.px); ctx.textBaseline = 'middle';
        ctx.fillText(s.text, b.x + b.pad, b.y + b.h / 2);
        ctx.restore();
        continue;
      }
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
