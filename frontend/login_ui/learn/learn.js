// 새 학습 기록(LEARN & ASK): 캐비닛 랙(5×2 칸)에서 기능을 고르면 그 칸의 카드가 커지며 왼쪽 도감(HUD) 자리로 날아가 설명이 된다(2026-10-24 시안 C, 2026-10-26 빛줄기 → 날아가는 카드).
// 고른 칸을 한 번 더 누르거나 [사용하기 ↗]·Enter면 그 기능의 실제 화면(live.html#기능)이 화면 전체로 바로 뜬다(오른쪽 아래 [← 캐비닛으로 돌아가기]·Esc로 돌아옴).
// [▶ 포석호 설명 듣고 열기]를 누를 때만 포석호가 목소리(동물의 숲 같은 포석호 말투, animalese.js)와 자막으로 사용법을 먼저 설명한다:
// 도감의 사용법 단계가 차례로 켜지고 오른쪽 아래 포석호 말풍선에 자막이 찍힌다. 다 들으면 실제 화면이 뜬다. ✕ · Esc면 돌아온다.
import { FEATURES, POSEOKHO } from './features.js';
import { createVoice } from './animalese.js';

const TOKEN = 'st-rookie-token';
const MUTE_KEY = 'st-rookie:brief-voice';
const $stage = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = FEATURES.length, wrap = (i) => ((i % N) + N) % N;
const LIVE = new URL('./live.html', import.meta.url).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function typeInto(el, text, ms = 22, done) {
  clearInterval(el._t); if (reduce) { el.textContent = text; done?.(); return; }
  let i = 0; el.textContent = ''; el._t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) { clearInterval(el._t); done?.(); } }, ms);
}
const char = (motion = 'idle') => `<cp-character model="${POSEOKHO.model}" motion="${motion}" aria-label="튜터 ${POSEOKHO.name}"></cp-character>`;

// 로그아웃: 로그아웃 API는 없다(JWT). 이 브라우저의 토큰과 이어 보던 학습 대화 id를 지우고 홈으로(3D 화면과 같음)
const hasToken = () => { try { return !!(localStorage.getItem(TOKEN) || sessionStorage.getItem(TOKEN)); } catch (e) { return false; } };
// [새 창으로]로 연 실제 화면 탭이 로그인 정보를 물으면 답한다(로그인 상태 유지를 끄면 탭 전용 sessionStorage에만 있어 새 탭이 못 읽는다).
// BroadcastChannel은 같은 사이트의 탭끼리만 통한다(live.html의 adopt)
try {
  const bc = new BroadcastChannel('st-rookie-auth');
  bc.onmessage = (e) => { if (e.data?.type !== 'need-token') return; let t = ''; try { t = localStorage.getItem(TOKEN) || sessionStorage.getItem(TOKEN) || ''; } catch (err) {} if (t) bc.postMessage({ type: 'token', token: t }); };
} catch (e) {}
const logoutBtn = document.getElementById('logout');
logoutBtn.hidden = !hasToken();
logoutBtn.addEventListener('click', () => {
  for (const s of [localStorage, sessionStorage]) { try { s.removeItem(TOKEN); } catch (e) {} }
  try { sessionStorage.removeItem('st-rookie:learning-session'); } catch (e) {}
  window.top.location.href = '/';
});

$stage.innerHTML = `<section class="cab" id="cab">
    <aside class="hud" id="hud" aria-live="polite">
      <div class="hud-title"><span class="n" id="hNum"></span><h2 id="hName"></h2><span class="en" id="hEn"></span></div>
      <div class="hud-body">
        <div class="hud-art"><span id="hArt" style="display:contents"></span><span class="chip" id="hTag"></span></div>
        <div><div class="sec">효과</div><p class="eff" id="hEff"></p><div class="sec">사용법</div><ol class="steps" id="hHow"></ol></div>
      </div>
      <div class="hud-prog" aria-hidden="true"><i id="bProg"></i></div>
      <div class="hud-foot"><button type="button" class="hn" id="prev" aria-label="이전 칸">←</button><button type="button" class="hn" id="next" aria-label="다음 칸">→</button>
        <button type="button" class="btn ghost" id="open">▶ 포석호 설명 듣고 열기</button><button type="button" class="btn" id="use">사용하기 ↗</button></div>
    </aside>
    <div class="right">
      <div class="rack"><div class="rack-body" id="rack">
        <div class="rack-top"><span>ST-ROOKIE · LEARNING CABINET</span><span class="meter" id="meter"></span><span class="rack-led"></span></div>
        <div class="rack-grid" id="grid">${FEATURES.map((f, i) => `<button type="button" class="slot" data-i="${i}" aria-label="${esc(f.name)}">
          <span class="slot-face"><span class="slot-plate"><b>${f.num}</b><span class="slot-g">${f.group}</span><i></i></span><span class="slot-art">${f.art()}</span>
          <span class="slot-name">${esc(f.name)}</span><span class="slot-grip"></span></span></button>`).join('')}</div>
        <div class="rack-foot"></div>
      </div></div>
      <div class="guide">${char('greet')}<div class="bubble"><b>${POSEOKHO.name}<button type="button" class="voice" id="bMute" hidden></button></b><span id="say"></span>
        <button type="button" class="ask" id="ask">💬 포석호에게 묻기</button>
        <div class="keys" aria-label="단축키"><span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>Enter</kbd> 사용하기</span><span><kbd>Esc</kbd> 닫기</span></div></div></div>
    </div>
  </section>
  <div class="live" id="live" hidden><div class="live-bar"><span class="num" id="lNum"></span><span class="live-t" id="lName"></span>
    <button type="button" class="btn ghost sm" id="askBar">💬 포석호에게 묻기</button></div><iframe id="frame" title="실제 화면"></iframe>
    <button type="button" class="live-back" id="back" title="캐비닛으로 돌아가기 (Esc)">← 캐비닛으로 돌아가기</button></div>`;

const $ = (id) => $stage.querySelector(`#${id}`);
const cab = $('cab'), hud = $('hud'), grid = $('grid'), slots = [...grid.children];
const guide = $stage.querySelector('.guide cp-character'), say = $('say');
const live = $('live'), frame = $('frame');
let cur = 0;
// [포석호에게 묻기]는 말이 다 찍힌 뒤에 나타난다(타이핑하는 동안 글자를 따라 밀려가지 않게)
const talk = (text, motion = 'explain', back = 2600) => { const btn = $('ask'); btn.hidden = true; typeInto(say, text, 22, () => { btn.hidden = false; }); guide.setAttribute('motion', motion); clearTimeout(guide._t); guide._t = setTimeout(() => guide.setAttribute('motion', 'idle'), back); };

// ── 고른 칸의 카드가 그 자리에서 커지며 왼쪽 도감(HUD) 자리로 날아가 도감이 된다(FLIP: 처음·끝 위치를 재고 transform으로 옮긴다) ──
// 카드 복제본만 움직이고 진짜 도감은 복제본이 닿을 때 채운다. 동작 줄이기 설정이면 바로 바꾼다
let flyer = null;
const tailTo = () => { // 도감 꼬리를 고른 칸 높이에 맞춘다(좁은 화면에서는 CSS로 감춘다)
  const s = slots[cur].getBoundingClientRect(), h = hud.getBoundingClientRect();
  hud.style.setProperty('--tail', `${Math.min(h.height - 40, Math.max(22, s.top + s.height / 2 - h.top)) - 9}px`);
};
function flyCard(onLand) {
  flyer?.remove(); flyer = null;
  const face = slots[cur].querySelector('.slot-face'), from = face.getBoundingClientRect(), to = hud.getBoundingClientRect();
  if (reduce || !from.width || !to.width || matchMedia('(max-width: 1100px), (max-height: 560px)').matches) { // 위아래로 쌓인 좁은 화면은 날리지 않는다
    onLand(); tailTo(); return; }
  const c = face.cloneNode(true); c.className = 'slot-face flyer'; c.setAttribute('aria-hidden', 'true');
  Object.assign(c.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  document.body.append(c); flyer = c;
  const dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = to.height / from.height;
  hud.classList.add('waiting'); // 날아오는 동안 도감은 비워 둔다
  const anim = c.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.12}px, ${dy * 0.12 - 18}px) scale(1.18)`, opacity: 1, offset: 0.22 }, // 칸에서 툭 튀어나와 커지고
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.9, offset: 0.86 },          // 왼쪽 도감 자리로 날아가
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0, offset: 1 },               // 도감과 겹치며 사라진다
  ], { duration: 640, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
  setTimeout(() => { hud.classList.remove('waiting'); onLand(); tailTo(); }, 520);
  anim.onfinish = () => { if (flyer === c) { c.remove(); flyer = null; } };
}
addEventListener('resize', () => tailTo());

// ── 캐비닛 칸 고르기: 칸이 앞으로 나오고 → 빔 → 왼쪽 도감(HUD)이 바뀐다 ──
function fillHud(f) {
  $('hNum').textContent = f.num; $('hName').textContent = f.name; $('hEn').textContent = f.en;
  $('hArt').innerHTML = f.art(); $('hTag').textContent = f.group; $('hEff').textContent = f.line;
  $('hHow').innerHTML = f.how.map((h, k) => `<li><b>${k + 1}</b><span>${esc(h)}</span></li>`).join('');
  hud.classList.remove('pop'); void hud.offsetWidth; hud.classList.add('pop');
}
function show(i, { speak = true, focus = false, anim = true } = {}) {
  if (briefing) stopBrief();
  cur = wrap(i); const f = FEATURES[cur];
  slots.forEach((s, k) => { s.classList.toggle('on', k === cur); s.setAttribute('aria-pressed', String(k === cur)); });
  $('meter').innerHTML = `<b>${f.num}</b> / ${String(N).padStart(2, '0')}`;
  if (focus) slots[cur].focus({ preventScroll: true });
  if (anim) flyCard(() => fillHud(f)); else { fillHud(f); tailTo(); }
  if (speak) talk(f.say);
}
grid.addEventListener('click', (e) => { const s = e.target.closest('.slot'); if (!s) return; const i = +s.dataset.i; if (i === cur && !briefing) go(); else show(i); }); // 고른 칸을 한 번 더 누르면 바로 연다
$('prev').addEventListener('click', () => show(cur - 1));
$('next').addEventListener('click', () => show(cur + 1));
$('open').addEventListener('click', () => (briefing ? stopBrief() : openBrief()));
$('use').addEventListener('click', () => go());

// ── 브리핑 영상: 포석호가 말하고 자막·단계 강조가 따라간다. 목소리 3가지: 포석호 말투(동물어, 기본)·사람 목소리(브라우저 TTS)·끔 ──
const VOICE_MODES = [['bear', '🐻 포석호 말투'], ['tts', '🗣 사람 목소리'], ['off', '🔇 소리 끔']];
let voiceMode = 'bear'; try { const m = localStorage.getItem(MUTE_KEY); if (VOICE_MODES.some(([k]) => k === m)) voiceMode = m; } catch (e) {}
const bear = createVoice({ pitch: 580, speed: 1 });
const tts = 'speechSynthesis' in window ? speechSynthesis : null;
let koVoice = null;
function pickVoice() { if (!tts) return; const vs = tts.getVoices(); koVoice = vs.find((v) => /ko/i.test(v.lang) && /female|여|Heami|SunHi|Yuna/i.test(v.name)) || vs.find((v) => /ko/i.test(v.lang)) || null; }
if (tts) { pickVoice(); tts.addEventListener?.('voiceschanged', pickVoice); }
const muteLabel = () => { $('bMute').textContent = VOICE_MODES.find(([k]) => k === voiceMode)[1]; };
muteLabel();
/** 한 줄을 말하며 자막을 맞춘다. 포석호 말투·소리 끔은 글자마다(소리 끔은 소리만 없이), 사람 목소리는 TTS와 자막 타이핑을 함께 */
function speakLine(text, sub) {
  if (voiceMode !== 'tts' || !tts || !(koVoice || tts.getVoices().length)) return bear.say(text, (t) => { sub.textContent = t; }, { muted: voiceMode === 'off' });
  typeInto(sub, text, 38);
  return new Promise((res) => {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; if (koVoice) u.voice = koVoice; u.rate = 1.05; u.pitch = 1.15;
    let done = false; const end = () => { if (!done) { done = true; res(); } };
    u.onend = end; u.onerror = end; setTimeout(end, text.length * 160 + 3000); // 음성이 멈춰도 다음으로
    tts.speak(u);
  });
}
const hush = () => { tts?.cancel(); bear.stop(); };
// 포석호 설명: 따로 창을 띄우지 않고 왼쪽 도감(HUD) 안에서 한다. 사용법 단계가 차례로 켜지고, 아래 포석호가 커지며 말풍선에 자막이 찍힌다.
// 끝나면(또는 [사용하기 ↗]) 실제 화면이 뜬다. 다른 칸을 고르거나 [■ 그만 듣기]·Esc면 멈춘다
let run = 0, briefing = false;
async function openBrief() {
  const f = FEATURES[cur], my = ++run;
  hush(); briefing = true; cab.classList.add('briefing'); $('open').textContent = '■ 그만 듣기'; $('bMute').hidden = false; $('ask').hidden = true;
  const steps = [...$('hHow').children];
  const lines = [
    { text: `${f.name}! ${f.line}`, motion: 'greet' },
    ...f.how.map((h, k) => ({ text: `${k + 1}. ${h}.`, motion: 'explain', step: k })),
    { text: f.say, motion: 'encourage' },
    { text: '자, 이제 직접 해 보자!', motion: 'praise' },
  ];
  const bar = $('bProg'); bar.style.transition = 'none'; bar.style.width = '0%';
  for (let k = 0; k < lines.length; k++) {
    if (my !== run) return;
    const l = lines[k];
    clearTimeout(guide._t); guide.setAttribute('motion', l.motion);
    steps.forEach((s, j) => { s.classList.toggle('on', j === l.step); s.classList.toggle('done', l.step != null ? j < l.step : k > f.how.length); });
    requestAnimationFrame(() => { bar.style.transition = 'width .5s'; bar.style.width = `${((k + 1) / lines.length) * 100}%`; });
    await speakLine(l.text, say);
    await sleep(250);
  }
  if (my === run) { await sleep(400); if (my === run) go(); }
}
function stopBrief() {
  run++; hush(); briefing = false; cab.classList.remove('briefing');
  $('open').textContent = '▶ 포석호 설명 듣고 열기'; $('bMute').hidden = true; $('bProg').style.width = '0%';
  $('hHow').querySelectorAll('li').forEach((s) => s.classList.remove('on', 'done'));
  guide.setAttribute('motion', 'idle'); $('ask').hidden = false;
}
function go() { const f = FEATURES[cur]; stopBrief(); openLive(f); talk(`좋아, ${f.name}! "${f.how[0]}"부터 해 봐.`, 'praise', 1600); }
$('bMute').addEventListener('click', () => { const k = VOICE_MODES.findIndex(([m]) => m === voiceMode); voiceMode = VOICE_MODES[(k + 1) % VOICE_MODES.length][0]; try { localStorage.setItem(MUTE_KEY, voiceMode); } catch (e) {} muteLabel(); openBrief(); }); // 바꾸면 그 목소리로 처음부터

// ── 실제 화면: 처음 열 때 한 번만 띄우고, 그다음부터는 주소 뒤 #기능만 바꾼다(학습 기록을 매번 새로 불러오지 않는다) ──
// route 'ask'는 작동 단계 + 포석호 채팅(입력창에 커서)
function openLive(f, route = f.id) {
  const url = `${LIVE}#${route}`;
  $('lNum').textContent = f.num; $('lName').textContent = route === 'ask' ? `${f.name} · 포석호 채팅` : f.name;
  $('askBar').hidden = f.id === 'steps'; // 포석호 채팅은 작동 단계 옆에만 있다
  if (!frame.getAttribute('src')) frame.src = url;
  else if (frame.contentWindow.location.hash === `#${route}` && typeof frame.contentWindow.show === 'function') frame.contentWindow.show(route);
  else frame.contentWindow.location.replace(url);
  live.hidden = false;
}
function ask() { stopBrief(); show(FEATURES.findIndex((f) => f.id === 'steps'), { speak: false }); openLive(FEATURES[cur], 'ask'); talk('궁금한 걸 채팅에 물어봐! 도면에서 설비를 먼저 고르면 그 설비를 보고 답해 줄게.', 'greet', 1800); }
// [전체 화면으로 보기]: 실제 화면 창이 위 메뉴까지 덮어 페이지 전체를 쓴다. 닫으면 원래 크기로 돌아간다
// 실제 화면은 늘 화면 전체로 연다(2026-10-26 요청: 창 크기 전환 없이). 돌아가기는 오른쪽 아래 버튼·Esc
const back = () => { live.hidden = true; slots[cur].focus({ preventScroll: true }); tailTo(); };
$('ask').addEventListener('click', ask); $('askBar').addEventListener('click', ask); $('back').addEventListener('click', back);

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!live.hidden) back(); else if (briefing) stopBrief(); return; }
  if (!live.hidden || document.querySelector('.tt:not([hidden])')) return; // 실제 화면·포석호 첫 안내 중에는 칸을 옮기지 않는다
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (move) { e.preventDefault(); show(cur + move, { focus: true }); }
  else if (e.key === 'Enter' && !document.activeElement?.matches('button:not(.slot), a')) { e.preventDefault(); go(); }
});
// ?f=기능 id로 들어오면 그 칸을 고른 채 시작한다(예: /login_ui/learn/learn.html?f=report)
const f0 = FEATURES.findIndex((f) => f.id === new URLSearchParams(location.search).get('f'));
show(f0 >= 0 ? f0 : 0, { speak: false, anim: false });
talk('어서 와! 캐비닛에서 칸을 고르면 왼쪽에 설명이 떠. 고른 칸을 한 번 더 누르면 바로 열리고, [포석호 설명 듣고 열기]를 누르면 내가 먼저 쓰는 법을 말로 알려 줄게.', 'greet');
