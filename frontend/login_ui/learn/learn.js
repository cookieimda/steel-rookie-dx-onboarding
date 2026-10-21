// 새 학습 기록(LEARN & ASK): 기능 10개를 카드로 넘겨 보고, 카드를 열면 그 기능 화면으로 가기 전에
// 포석호가 목소리(동물의 숲 같은 포석호 말투, animalese.js)와 자막으로 사용법을 설명하는 짧은 브리핑 영상이 나온다(2026-10-21 팀 회의).
// 브리핑이 끝나거나 [바로 사용하기]를 누르면 실제 화면(live.html#기능)이 뜬다. [← 카드로] · Esc면 돌아온다.
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
// 카드 바탕: 주황 계열 단계 + 차콜(브랜드 안에서만 색을 바꾼다)
const TONES = ['linear-gradient(160deg,#ff9e64,#c4521a)', 'linear-gradient(160deg,#3a3f4b,#1d2027)', 'linear-gradient(160deg,#f3c492,#b8692f)', 'linear-gradient(160deg,#ff7a59,#9b3320)',
  'linear-gradient(160deg,#ffb074,#d9682a)', 'linear-gradient(160deg,#2f343e,#15171c)', 'linear-gradient(160deg,#ffd2a8,#c98446)', 'linear-gradient(160deg,#e98a5a,#7c2f17)',
  'linear-gradient(160deg,#ff9e64,#5a2410)', 'linear-gradient(160deg,#4a4f5c,#1d2027)'];
function typeInto(el, text, ms = 22) {
  clearInterval(el._t); if (reduce) { el.textContent = text; return; }
  let i = 0; el.textContent = ''; el._t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(el._t); }, ms);
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

$stage.innerHTML = `<section class="cf">
    <div class="cf-deck" id="deck">${FEATURES.map((f, i) => `<button type="button" class="cf-card" data-i="${i}" aria-label="${esc(f.name)} 열기" style="--tone:${TONES[i]}">
      <div class="cf-face"><div class="art">${f.art()}</div><div class="cap"><span class="num">${f.num} · ${f.en}</span><h3>${esc(f.name)}</h3></div>
      <span class="cf-play" aria-hidden="true">▶</span></div></button>`).join('')}</div>
    <div class="cf-text"><span class="num" id="cNum"></span><h2 id="cName"></h2><p id="cLine"></p>
      <div class="cf-nav"><button type="button" id="prev" aria-label="이전">←</button><div class="dots" id="dots">${FEATURES.map((f, i) => `<button type="button" data-i="${i}" aria-label="${esc(f.name)}"></button>`).join('')}</div><button type="button" id="next" aria-label="다음">→</button></div>
      <button type="button" class="btn" id="open">▶ 포석호 설명 듣고 열기</button></div>
  </section>
  <div class="guide">${char('greet')}<div class="bubble"><b>${POSEOKHO.name}</b><span id="say"></span>
    <button type="button" class="ask" id="ask">💬 포석호에게 묻기</button>
    <div class="keys" aria-label="단축키"><span><kbd>←</kbd><kbd>→</kbd> 넘기기</span><span><kbd>Enter</kbd> 열기</span><span><kbd>Esc</kbd> 카드로</span></div></div></div>
  <div class="brief" id="brief" hidden role="dialog" aria-label="포석호 설명">
    <div class="brief-stage"><div class="brief-glow"></div>${char('explain')}</div>
    <div class="brief-side"><span class="num" id="bNum"></span><h2 id="bName"></h2>
      <ol class="brief-steps" id="bSteps"></ol>
      <div class="brief-sub" aria-live="polite"><b>${POSEOKHO.name}</b><span id="bSub"></span></div>
      <div class="brief-bar"><i id="bProg"></i></div>
      <div class="brief-ctl"><button type="button" class="btn ghost sm" id="bMute"></button><button type="button" class="btn ghost sm" id="bAgain">↺ 다시 듣기</button>
        <button type="button" class="btn ghost sm" id="bClose">← 카드로</button><button type="button" class="btn" id="bGo">바로 사용하기 →</button></div></div>
  </div>
  <div class="live" id="live" hidden><div class="live-bar"><button type="button" class="btn ghost sm" id="full" aria-pressed="false">⛶ 전체 화면으로 보기</button><span class="num" id="lNum"></span><span class="live-t" id="lName"></span>
    <button type="button" class="btn ghost sm" id="askBar">💬 포석호에게 묻기</button><button type="button" class="live-x" id="back" aria-label="닫기" title="닫기 (Esc)">✕</button></div><iframe id="frame" title="실제 화면"></iframe></div>`;

const $ = (id) => $stage.querySelector(`#${id}`);
const deck = $('deck'), cards = [...deck.children], dots = [...$('dots').children];
const guide = $stage.querySelector('.guide cp-character'), say = $('say');
const brief = $('brief'), bChar = brief.querySelector('cp-character'), live = $('live'), frame = $('frame');
let cur = 0;
const talk = (text, motion = 'explain', back = 2600) => { typeInto(say, text); guide.setAttribute('motion', motion); clearTimeout(guide._t); guide._t = setTimeout(() => guide.setAttribute('motion', 'idle'), back); };

// ── 카드 넘기기 ──
function show(i, speak = true) {
  cur = wrap(i);
  cards.forEach((el, k) => {
    let d = k - cur; if (d > N / 2) d -= N; if (d < -N / 2) d += N;
    const a = Math.abs(d);
    el.style.transform = `translateX(${d * 210}px) translateZ(${-a * 120}px) rotateY(${d * -10}deg) scale(${1 - Math.min(a, 3) * 0.08})`;
    el.style.opacity = a > 2 ? 0 : 1 - a * 0.18; el.style.zIndex = 10 - a; el.style.filter = a ? 'brightness(.6) saturate(.8)' : 'none';
    el.style.pointerEvents = a > 2 ? 'none' : 'auto'; el.tabIndex = a ? -1 : 0; el.classList.toggle('on', !a);
  });
  const f = FEATURES[cur];
  $('cNum').textContent = `${f.num} · ${f.group}`; $('cName').textContent = f.name; $('cLine').textContent = f.line;
  dots.forEach((b, k) => b.setAttribute('aria-current', String(k === cur)));
  if (speak) talk(f.say);
}
deck.addEventListener('click', (e) => { const c = e.target.closest('.cf-card'); if (!c) return; const i = +c.dataset.i; if (i === cur) openBrief(); else show(i); });
$('dots').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); });
$('prev').addEventListener('click', () => show(cur - 1));
$('next').addEventListener('click', () => show(cur + 1));
$('open').addEventListener('click', () => openBrief());
let x0 = null; deck.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 60 && brief.hidden && live.hidden) show(cur + (dx < 0 ? 1 : -1)); });

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
let run = 0;
async function openBrief() {
  const f = FEATURES[cur], my = ++run;
  $('bNum').textContent = `${f.num} · ${f.en}`; $('bName').textContent = f.name;
  $('bSteps').innerHTML = f.how.map((h) => `<li>${esc(h)}</li>`).join('');
  const steps = [...$('bSteps').children];
  brief.hidden = false; hush();
  // 대사: 인사 → 무엇인지 → 사용법 1·2·3 → 한마디 → 마무리
  const lines = [
    { text: `${f.name}! ${f.line}`, motion: 'greet' },
    ...f.how.map((h, k) => ({ text: `${k + 1}. ${h}.`, motion: 'explain', step: k })),
    { text: f.say, motion: 'encourage' },
    { text: '자, 이제 직접 해 보자!', motion: 'praise' },
  ];
  const bar = $('bProg'); bar.style.transition = 'none'; bar.style.width = '0%';
  for (let k = 0; k < lines.length; k++) {
    if (my !== run || brief.hidden) return;
    const l = lines[k];
    bChar.setAttribute('motion', l.motion);
    steps.forEach((s, j) => { s.classList.toggle('on', j === l.step); s.classList.toggle('done', l.step != null ? j < l.step : k > f.how.length); });
    requestAnimationFrame(() => { bar.style.transition = 'width .5s'; bar.style.width = `${((k + 1) / lines.length) * 100}%`; });
    await speakLine(l.text, $('bSub'));
    await sleep(250);
  }
  if (my === run && !brief.hidden) { await sleep(400); if (my === run && !brief.hidden) go(); }
}
function closeBrief() { run++; hush(); brief.hidden = true; bChar.setAttribute('motion', 'idle'); }
function go() { const f = FEATURES[cur]; closeBrief(); openLive(f); talk(`좋아, ${f.name}! "${f.how[0]}"부터 해 봐.`, 'praise', 1600); }
$('bGo').addEventListener('click', go);
$('bClose').addEventListener('click', () => { closeBrief(); cards[cur].focus(); });
$('bAgain').addEventListener('click', () => openBrief());
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
function ask() { closeBrief(); show(FEATURES.findIndex((f) => f.id === 'steps'), false); openLive(FEATURES[cur], 'ask'); talk('궁금한 걸 채팅에 물어봐! 도면에서 설비를 먼저 고르면 그 설비를 보고 답해 줄게.', 'greet', 1800); }
// [전체 화면으로 보기]: 실제 화면 창이 위 메뉴까지 덮어 페이지 전체를 쓴다. 닫으면 원래 크기로 돌아간다
const full = (on) => { live.classList.toggle('full', on); $('full').setAttribute('aria-pressed', on); $('full').textContent = on ? '↙ 원래 크기로' : '⛶ 전체 화면으로 보기'; };
const back = () => { full(false); live.hidden = true; cards[cur].focus(); };
$('ask').addEventListener('click', ask); $('askBar').addEventListener('click', ask); $('back').addEventListener('click', back);
$('full').addEventListener('click', () => full(!live.classList.contains('full')));

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!brief.hidden) closeBrief(); else if (!live.hidden) back(); return; }
  if (!brief.hidden || !live.hidden) return;
  if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1);
  else if (e.key === 'Enter' && document.activeElement?.closest('.cf-card, #open') == null) { e.preventDefault(); openBrief(); }
});
// ?f=기능 id로 들어오면 그 카드를 고른 채 시작한다(예: /login_ui/learn/learn.html?f=report)
const f0 = FEATURES.findIndex((f) => f.id === new URLSearchParams(location.search).get('f'));
show(f0 >= 0 ? f0 : 0, false);
talk('어서 와! 카드를 넘겨서 하나 골라 봐. 카드를 열면 내가 먼저 쓰는 법을 말로 알려 주고, 그다음 그 화면으로 데려다줄게.', 'greet');
