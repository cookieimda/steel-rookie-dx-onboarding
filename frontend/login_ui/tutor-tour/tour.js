// 말하는 포석호 첫 안내: 신입사원이 학습 화면(LEARN & ASK, learn/learn.html)에 처음 들어오면 큰 포석호가 오른쪽에서 나와
// 화면을 차례로 짚으며 미리 만든 음성(audio/*.mp3, Supertonic M1 +7반음, scripts/tutor-tour-tts.py)과 자막으로 설명하고, 평가 시험 화면(/exam)으로 넘어가 시험 쓰는 법까지 설명한다.
// - 계정마다 한 번만 보인다(이 브라우저 localStorage, 키에 사용자 id). ?tour=1이면 다시 보고, ?tour=reset이면 본 기록을 지운다(테스트용).
// - 학습 화면 → 시험 화면은 페이지가 바뀌므로 sessionStorage로 이어 간다. 시험 화면만 볼 때는 /exam?tour=exam.
// - 브라우저가 소리 자동 재생을 막으면 [▶ 설명 듣기]를 누를 때 시작한다. 자막은 소리와 함께 한 글자씩 적는다.
// - 짚을 곳이 포석호와 겹치면 포석호를 왼쪽으로 옮긴다. 안내 중에는 페이지를 누르거나 키로 조작하지 못한다(Esc: 건너뛰기).
import '/3d-demo/cp-character.js';

const TOKEN = 'st-rookie-token';
const SEEN = (id) => `st-rookie:tutor-tour:${id}`;
const NEXT = 'st-rookie:tutor-tour:next';
const AUDIO = new URL('./audio/', import.meta.url).href;
const MODEL = '/3d-demo/models/character/tutor.glb';
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// target: 짚을 요소(선택자, 여러 개면 합친 영역). or: target이 안 보일 때 대신 짚을 곳(시험 문제 칸은 응시해야 보이고,
// [포석호에게 묻기]는 포석호 말이 다 찍힌 뒤에 나타난다). go: 다 들으면 그 화면으로 이어 간다. end: 마지막 줄
// motion: tutor.glb에 있는 동작 클립(idle·greet·explain·praise·encourage·celebrate·thinking·ask_again·cheer_retry·sorry), 없으면 explain
// text: 자막. *말*은 강조(버튼 이름·핵심 낱말). 음성은 audio/의 같은 id 파일(scripts/tutor-tour-lines.json의 발음용 문장 speak로 만들었다)
const LEARN = [
  { id: 'learn_01_hello', motion: 'greet', text: '잠깐만요! 여기부터는 제가 설명해 드릴게요! 저는 여러분의 튜터 *포석호*예요.' },
  { id: 'learn_02_cards', target: '#deck', text: '여기 *카드 열 장*이 학습 기능이에요. 작동 단계부터 사고 사례, What-if, 사원증까지 다 들어 있어요!' },
  { id: 'learn_03_flip', target: '.cf-nav', text: '*화살표 버튼*이나 키보드 *좌우 키*로 카드를 넘겨 보세요.' },
  { id: 'learn_04_open', target: '#open', text: '마음에 드는 카드에서 *포석호 설명 듣고 열기*를 누르면, 제가 쓰는 법을 먼저 알려 드리고 그 화면으로 바로 데려다 드려요!' },
  { id: 'learn_05_ask', target: '#ask', or: '.guide', text: '궁금한 게 생기면 *포석호에게 묻기*를 눌러 주세요. 작동 단계 도면을 보면서 저한테 바로 물어볼 수 있어요!' },
  { id: 'learn_06_3d', target: ['.nav a[href*="steel-intro"]', '.nav a[href*="steel-index"]'], text: '위쪽 메뉴에서는 *3D 공정 화면*으로 가서 제철소를 직접 둘러볼 수도 있어요.' },
  { id: 'learn_07_to_exam', target: '.nav a[href="/exam"]', motion: 'encourage', go: 'exam', text: '그리고 *평가 시험*! 시험 보는 법도 알려 드릴게요. 시험 화면으로 같이 가 볼까요?' },
];
const EXAM = [
  { id: 'exam_01_hello', target: '.hero', motion: 'greet', text: '여기가 평가 시험 화면이에요! 위쪽에서 공정별 내 이해도와 *통과 기준 80%*를 한눈에 볼 수 있어요. 통과하면 다음 공정이 열려요!' },
  { id: 'exam_02_pick', target: '.deck', text: '*시험지*에서 공정을 고르면 제가 질문을 드려요.' },
  { id: 'exam_03_answer', target: '#exam-content', or: '.deck', text: '답은 외운 문장 말고 *자기 말로* 설명해 주세요! 조금 부족하면 제가 설명을 보태 드리고, 다른 질문으로 한 번 더 확인해요.' },
  { id: 'exam_04_pause', target: '#exam-content', or: '.deck', text: '풀다가 막히면 *잠시 멈추고 학습하기*로 공부하고 와서 이어 풀어도 돼요.' },
  { id: 'exam_05_result', target: '.aside-stack', text: '다 풀면 *개념별 결과*와 *전체 이해도*를 보여 드려요. 오른쪽 *학습 캘린더*에는 복습 일정도 잡아 둘게요!' },
  { id: 'exam_06_bye', motion: 'celebrate', end: true, text: '설명은 여기까지예요. 그럼 같이 시작해 볼까요? *화이팅!*' },
];

const CSS = `
.tt { position: fixed; inset: 0; z-index: 2147483000; font-family: inherit; }
.tt-block { position: absolute; inset: 0; }
.tt-spot { position: fixed; left: 50%; top: 50%; width: 0; height: 0; border-radius: 18px; pointer-events: none; opacity: 0;
  box-shadow: 0 0 0 200vmax rgba(9, 10, 13, .62); outline: 3px solid #ff9e64; outline-offset: 2px;
  transition: left .45s ease, top .45s ease, width .45s ease, height .45s ease, opacity .35s ease, outline-color .3s; }
.tt.in .tt-spot { opacity: 1; }
.tt-spot.none { outline-color: transparent; }
.tt-spot:not(.none) { animation: tt-ring 1.6s ease-in-out infinite; }
@keyframes tt-ring { 50% { outline-offset: 7px; } }
.tt-guide { position: fixed; right: 2vw; bottom: 0; display: flex; align-items: flex-end; gap: 0; max-width: 96vw;
  transform: translateX(115%); transition: transform .8s cubic-bezier(.2, 1.25, .4, 1), right .6s ease, left .6s ease; }
.tt.in .tt-guide { transform: none; }
.tt.left .tt-guide { right: auto; left: 2vw; flex-direction: row-reverse; }
.tt.out .tt-guide { transform: translateX(115%); transition-timing-function: ease-in; }
.tt.left.out .tt-guide { transform: translateX(-115%); }
.tt-char { display: block; position: relative; flex: none; width: min(360px, 32vw); height: min(470px, 64vh); }
.tt-bubble { position: relative; width: min(520px, 46vw); margin-bottom: min(230px, 30vh); padding: 20px 24px 16px; border-radius: 22px;
  background: #fff; color: #1d1714; font-size: clamp(18px, 1.3vw, 22px); font-weight: 600; line-height: 1.55; letter-spacing: -.01em; box-shadow: 0 18px 44px rgba(0, 0, 0, .4); }
.tt-bubble::after { content: ""; position: absolute; right: -10px; bottom: 34px; border: 10px solid transparent; border-left-color: #fff; border-right: 0; }
.tt.left .tt-bubble::after { right: auto; left: -10px; border-left-color: transparent; border-right-color: #fff; border-left: 0; border-right-width: 10px; }
.tt-bubble > b { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 800; letter-spacing: .04em; color: #c4521a; }
.tt-sub { margin: 0; min-height: 3.1em; white-space: pre-wrap; word-break: keep-all; }
/* 자막: 문장 전체를 흐리게 깔아 두고(줄바꿈이 움직이지 않는다) 소리에 맞춰 진하게. 강조 낱말은 주황 굵게 + 형광펜 */
.tt-sub .c { opacity: .3; transition: opacity .15s; }
.tt-sub .c.on { opacity: 1; }
.tt-sub mark { padding: 0 1px; background: linear-gradient(transparent 58%, rgba(255, 158, 100, .45) 0); color: #b4521a; font-weight: 800; }
.tt-ctl { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.tt-step { margin-right: auto; font-size: 14px; font-weight: 500; color: #8a8079; font-variant-numeric: tabular-nums; }
.tt-ctl button { height: 38px; padding: 0 16px; border-radius: 999px; border: 0; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.tt-skip { background: #f1ece8; color: #5b524c; }
.tt-skip:hover { background: #e6dfd9; }
.tt-next { background: #e8742a; color: #fff; }
.tt-next:hover { background: #c4521a; }
.tt-next.pulse { animation: tt-pulse 1.2s ease-in-out infinite; }
@keyframes tt-pulse { 50% { box-shadow: 0 0 0 7px rgba(232, 116, 42, .3); } }
@media (max-width: 760px) {
  .tt-guide, .tt.left .tt-guide { left: 8px; right: 8px; flex-direction: column-reverse; align-items: stretch; }
  .tt-char { width: 150px; height: 180px; align-self: flex-end; }
  .tt-bubble { width: auto; margin: 0 0 -10px; font-size: 17px; }
  .tt-bubble::after { display: none; }
}
@media (prefers-reduced-motion: reduce) { .tt-guide, .tt-spot { transition: none; } .tt-spot:not(.none), .tt-next.pulse { animation: none; } }`;

/** 로그인 토큰의 사용자 id(sub)와 역할. 서명은 확인하지 않는다(누구에게 한 번 보였는지 기억하는 데만 쓴다) */
function user() {
  let t = null;
  try { t = localStorage.getItem(TOKEN) || sessionStorage.getItem(TOKEN); } catch (e) {}
  if (!t) return null;
  try {
    const b = atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
    return p.sub ? { id: p.sub, role: p.role } : null;
  } catch (e) { return null; }
}
const store = (s, fn) => { try { return fn(s); } catch (e) { return null; } };

/** 안내 한 번: steps를 차례로 말하고, 끝나거나 건너뛰면 사라진다 */
function run(steps) {
  if (document.querySelector('.tt')) return;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('div');
  root.className = 'tt'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '포석호 안내');
  root.innerHTML = `<div class="tt-block"></div><div class="tt-spot none"></div>
    <div class="tt-guide"><div class="tt-bubble"><b>포석호</b><p class="tt-sub" aria-live="polite"></p>
      <div class="tt-ctl"><span class="tt-step"></span><button type="button" class="tt-skip">건너뛰기</button><button type="button" class="tt-next">다음 ▶</button></div></div>
      <cp-character class="tt-char" model="${MODEL}" motion="greet" gaze="on" aria-hidden="true"></cp-character></div>`;
  document.body.append(root);
  const q = (s) => root.querySelector(s);
  const spotEl = q('.tt-spot'), bubble = q('.tt-bubble'), sub = q('.tt-sub'), stepEl = q('.tt-step'), next = q('.tt-next'), skip = q('.tt-skip'), char = q('.tt-char');
  const startLabel = steps === EXAM ? '▶ 계속 듣기' : '▶ 설명 듣기'; // 시험 화면은 학습 화면 안내를 이어 듣는다
  const audio = new Audio(); audio.preload = 'auto'; audio.volume = 0.9;
  let cur = -1, active = true, typing = 0, blocked = false;

  // ── 짚기: 대상 영역(여럿이면 합친 영역)에 구멍을 내고 테두리를 두른다. 포석호와 겹치면 포석호를 반대편으로 ──
  const els = (sel) => [sel].flat().filter(Boolean).map((s) => document.querySelector(s)).filter((el) => el && el.getClientRects().length);
  function area(list) {
    const rs = list.map((el) => el.getBoundingClientRect());
    const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), r = Math.max(...rs.map((x) => x.right)), b = Math.max(...rs.map((x) => x.bottom));
    return { left: l - 8, top: t - 8, width: r - l + 16, height: b - t + 16 };
  }
  function place(scroll) {
    let list = els(steps[cur]?.target);
    if (!list.length) list = els(steps[cur]?.or);
    if (!list.length) { spotEl.classList.add('none'); Object.assign(spotEl.style, { left: '50%', top: '50%', width: '0px', height: '0px' }); root.classList.remove('left'); return; }
    let a = area(list);
    if (scroll && (a.top < 0 || a.top + a.height > innerHeight)) { list[0].scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); setTimeout(() => place(false), reduce ? 0 : 450); }
    spotEl.classList.remove('none');
    Object.assign(spotEl.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
    // 짚은 곳을 말풍선·포석호가 덜 가리는 쪽에 선다(오른쪽이 기본, 왼쪽이 확실히 덜 가릴 때만 옮긴다). 좁은 화면은 아래에 쌓는다
    if (matchMedia('(max-width: 760px)').matches) root.classList.remove('left');
    else root.classList.toggle('left', cover(a, true) < cover(a, false) * 0.6);
  }
  // 오른쪽(left=false)·왼쪽에 섰을 때 포석호 몸통(가운데 60%)과 말풍선이 차지하는 칸. transform과 상관없이 크기로 계산한다
  function boxes(left) {
    const m = innerWidth * 0.02, cw = char.offsetWidth, ch = char.offsetHeight, bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    const mb = parseFloat(getComputedStyle(bubble).marginBottom) || 0;
    const cx = left ? m : innerWidth - m - cw, bx = left ? m + cw : innerWidth - m - cw - bw;
    return [{ left: cx + cw * 0.2, top: innerHeight - ch, width: cw * 0.6, height: ch }, { left: bx, top: innerHeight - mb - bh, width: bw, height: bh }];
  }
  const meet = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const cover = (a, left) => boxes(left).reduce((sum, b) => sum + meet(a, b), 0);
  const onMove = () => { if (cur >= 0) place(false); };
  addEventListener('resize', onMove); addEventListener('scroll', onMove, true);

  // ── 말하기: 소리를 틀고 자막을 소리 길이에 맞춰 한 글자씩 적는다 ──
  // 자막은 문장 전체를 글자 단위로 흐리게 깔고(lay) 소리에 맞춰 앞에서부터 진하게 한다(reveal). *말*은 <mark>로 강조
  let chars = [];
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function lay(text) {
    clearInterval(typing);
    sub.innerHTML = text.split(/(\*[^*]+\*)/).map((part) => {
      const em = part.length > 2 && part.startsWith('*') && part.endsWith('*');
      const cs = [...(em ? part.slice(1, -1) : part)].map((ch) => `<span class="c">${esc(ch)}</span>`).join('');
      return em ? `<mark>${cs}</mark>` : cs;
    }).join('');
    chars = [...sub.querySelectorAll('.c')];
  }
  /** ms마다 한 글자씩 진하게. ms가 없으면(또는 동작 줄이기) 한 번에 */
  function reveal(ms) {
    clearInterval(typing);
    if (reduce || !ms) { chars.forEach((c) => c.classList.add('on')); return; }
    let i = chars.findIndex((c) => !c.classList.contains('on'));
    if (i < 0) return;
    typing = setInterval(() => { chars[i++]?.classList.add('on'); if (i >= chars.length) clearInterval(typing); }, ms);
  }
  function setNext(label, pulse = false) { next.textContent = label; next.classList.toggle('pulse', pulse); }
  async function say(i) {
    cur = i; const s = steps[i];
    stepEl.textContent = `${i + 1} / ${steps.length}`;
    char.setAttribute('motion', s.motion || 'explain');
    place(true);
    setNext(s.go ? '시험 화면으로 ▶' : s.end ? '시작하기 ✓' : '다음 ▶', !!s.go);
    lay(s.text);
    audio.src = `${AUDIO}${s.id}.mp3`;
    if (steps[i + 1]) new Audio(`${AUDIO}${steps[i + 1].id}.mp3`).preload = 'auto';
    try {
      await audio.play();
      blocked = false;
    } catch (e) {
      if (!active || cur !== i) return;
      reveal();
      // 자동 재생이 막혔다: 글은 먼저 보여 주고 누르면 그 줄부터 말한다. 파일을 못 읽었으면 글만 보여 주고 [다음]을 기다린다
      if (e?.name === 'NotAllowedError') { blocked = true; setNext(startLabel, true); char.setAttribute('motion', 'greet'); }
    }
  }
  audio.addEventListener('playing', () => {
    const s = steps[cur]; if (!s) return;
    const dur = Number.isFinite(audio.duration) ? audio.duration : chars.length * 0.09;
    reveal(Math.max(22, Math.min(90, (dur * 1000 * 0.88) / chars.length)));
  });
  audio.addEventListener('ended', async () => {
    const s = steps[cur], i = cur; if (!s || !active) return;
    reveal();
    if (s.go || s.end) { char.setAttribute('motion', s.end ? 'celebrate' : 'encourage'); next.classList.add('pulse'); return; }
    char.setAttribute('motion', 'idle');
    await sleep(500);
    if (active && cur === i) say(i + 1);
  });

  function finish() {
    if (!active) return; active = false;
    audio.pause(); clearInterval(typing);
    removeEventListener('keydown', onKey, true); removeEventListener('resize', onMove); removeEventListener('scroll', onMove, true);
    char.setAttribute('motion', 'idle'); root.classList.add('out'); spotEl.style.opacity = '0';
    setTimeout(() => { root.remove(); style.remove(); }, reduce ? 0 : 800);
  }
  function primary() {
    const s = steps[cur]; if (!s) return;
    if (blocked) return say(cur);
    if (s.go === 'exam') { store(sessionStorage, (x) => x.setItem(NEXT, 'exam')); audio.pause(); (window.top || window).location.href = '/exam'; return; }
    if (s.end) return finish();
    audio.pause(); say(cur + 1);
  }
  next.addEventListener('click', primary);
  skip.addEventListener('click', finish);
  // 안내 중에는 페이지 단축키(← → Enter Esc)가 카드·시험을 움직이지 않게 먼저 받는다
  function onKey(e) {
    if (!active) return;
    e.stopImmediatePropagation();
    if (e.target?.closest?.('.tt button') && (e.key === 'Enter' || e.key === ' ')) return; // 버튼은 기본 동작으로 누른다
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); primary(); }
  }
  addEventListener('keydown', onKey, true);

  requestAnimationFrame(() => { root.classList.add('in'); next.focus({ preventScroll: true }); });
  setTimeout(() => say(0), reduce ? 0 : 650); // 포석호가 들어오는 동안 기다렸다 말한다
}

// ── 시작: 학습 화면은 처음 한 번, 시험 화면은 학습 화면 안내에서 넘어왔을 때만 ──
function flag() {
  for (const w of [window, window.top]) { const v = store(w, (x) => new URLSearchParams(x.location.search).get('tour')); if (v) return v; }
  return null;
}
// [안내 다시 보기]: 학습 화면 위 메뉴 맨 앞에 단다(메뉴 버튼 모양 .nb.plain). 누르면 본 기록과 상관없이 처음부터, 시험 화면까지 이어 간다.
// 버튼을 눌러 시작하므로 소리도 바로 난다. 메뉴를 못 찾으면 왼쪽 아래에 띄운다
function addReplay() {
  const nav = document.querySelector('.bar .nav');
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tt-replay'; b.title = '포석호 안내를 처음부터 다시 들어요';
  b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10.5 9.2v5.6l4.5-2.8z" fill="currentColor" stroke="none"/></svg>안내 다시 보기';
  b.style.fontFamily = 'inherit';
  if (nav) { b.classList.add('nb', 'plain'); nav.prepend(b); }
  else Object.assign(b.style, { position: 'fixed', left: '20px', bottom: '20px', zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: '8px', height: '40px', padding: '0 16px', border: '0', borderRadius: '999px', background: '#1d1714', color: '#fff', fontWeight: 700, cursor: 'pointer' }), document.body.append(b);
  b.addEventListener('click', () => run(LEARN));
}

const path = location.pathname, f = flag();
if (/\/learn\/learn\.html$/.test(path)) {
  addReplay();
  const u = user();
  if (f === 'reset' && u) store(localStorage, (s) => s.removeItem(SEEN(u.id)));
  const seen = u && store(localStorage, (s) => s.getItem(SEEN(u.id))) === '1';
  if (f === '1' || (u && u.role !== 'admin' && !seen)) {
    if (u) store(localStorage, (s) => s.setItem(SEEN(u.id), '1')); // 보이기 시작하면 본 것으로 한다(중간에 나가도 다시 띄우지 않는다)
    setTimeout(() => run(LEARN), 700);
  }
} else if (/^\/exam\/?$|\/exam\.html$/.test(path)) {
  const next = store(sessionStorage, (s) => s.getItem(NEXT));
  store(sessionStorage, (s) => s.removeItem(NEXT));
  if (next === 'exam' || f === 'exam') setTimeout(() => run(EXAM), 900);
}
