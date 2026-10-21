// 학습 기록 허브 시안 5가지: A 카드 넘기기 · B 포석호 아이템 도감 · C 궤도 라인 · D 폴더 탭 · E 검색 런처.
// 같은 기능 10개(features.js)를 각 방식으로 보여 준다. 시안 전용이라 서버 API를 부르지 않는다. [열기]는 새 탭으로 실제 화면을 연다.
import { FEATURES, POSEOKHO } from './features.js';

// 새 탭으로 연 실제 화면(live.html)이 로그인 정보를 물으면 답한다(같은 사이트 탭끼리만, learn.js와 같음)
try {
  const bc = new BroadcastChannel('st-rookie-auth');
  bc.onmessage = (e) => { if (e.data?.type !== 'need-token') return; let t = ''; try { t = localStorage.getItem('st-rookie-token') || sessionStorage.getItem('st-rookie-token') || ''; } catch (err) {} if (t) bc.postMessage({ type: 'token', token: t }); };
} catch (e) {}
const $stage = document.getElementById('stage'), $switch = document.getElementById('switch');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = FEATURES.length, wrap = (i) => ((i % N) + N) % N;
// 카드·그림 바탕: 주황 계열 단계 + 차콜(브랜드 안에서만 색을 바꾼다)
const TONES = ['linear-gradient(160deg,#ff9e64,#c4521a)', 'linear-gradient(160deg,#3a3f4b,#1d2027)', 'linear-gradient(160deg,#f3c492,#b8692f)', 'linear-gradient(160deg,#ff7a59,#9b3320)',
  'linear-gradient(160deg,#ffb074,#d9682a)', 'linear-gradient(160deg,#2f343e,#15171c)', 'linear-gradient(160deg,#ffd2a8,#c98446)', 'linear-gradient(160deg,#e98a5a,#7c2f17)',
  'linear-gradient(160deg,#ff9e64,#5a2410)', 'linear-gradient(160deg,#4a4f5c,#1d2027)'];
// 실제 화면 창: 학습 기록·평가 시험을 띄워 그 기능 탭을 열어 둔다(live.html). 파일로 열면(바탕화면 내보내기) 시안 서버(3500)의 창을 쓴다
const LIVE = location.protocol === 'file:' ? 'http://localhost:3500/login_ui/concepts/live.html' : new URL('./live.html', import.meta.url).href;
const liveUrl = (f) => `${LIVE}#${f.id}`;
const openBtn = (f, label = '열기') => `<a class="btn" href="${liveUrl(f)}" target="_blank" rel="opener">${label} ↗</a>`;
const char = (motion = 'idle') => `<cp-character model="${POSEOKHO.model}" motion="${motion}" aria-label="튜터 ${POSEOKHO.name}"></cp-character>`;
function typeInto(el, text) {
  clearInterval(el._t); if (reduce) { el.textContent = text; return; }
  let i = 0; el.textContent = ''; el._t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(el._t); }, 22);
}

// ── A. 카드 넘기기: 가운데 카드를 누르거나 Space면 뒤집혀 사용법이 보인다 ──
function cards(ac) {
  let cur = 0;
  $stage.innerHTML = `<section class="cf"><div class="cf-deck" id="deck"></div>
    <div class="cf-text"><span class="num" id="cfNum"></span><h2 id="cfName"></h2><p id="cfLine"></p>
      <div class="cf-nav"><button type="button" id="prev" aria-label="이전">←</button><div class="dots" id="dots"></div><button type="button" id="next" aria-label="다음">→</button></div>
      <p class="hint" style="margin-top:14px">가운데 카드를 누르거나 <kbd>Space</kbd>를 누르면 사용법으로 뒤집혀요 · <kbd>←</kbd><kbd>→</kbd> 넘기기</p></div></section>`;
  const deck = $stage.querySelector('#deck'), dots = $stage.querySelector('#dots');
  deck.innerHTML = FEATURES.map((f, i) => `<div class="cf-card" data-i="${i}" role="button" tabindex="-1" aria-label="${esc(f.name)}" style="--tone:${TONES[i]}">
    <div class="cf-in"><div class="cf-face cf-front"><div class="art">${f.art()}</div><div class="cap"><span class="num">${f.num} · ${f.en}</span><h3>${esc(f.name)}</h3></div></div>
    <div class="cf-face cf-back"><span class="num">${f.num} · 사용법</span><h3>${esc(f.name)}</h3><ol class="how">${f.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol><div style="margin-top:auto">${openBtn(f)}</div></div></div></div>`).join('');
  dots.innerHTML = FEATURES.map((f, i) => `<button type="button" data-i="${i}" aria-label="${esc(f.name)}"></button>`).join('');
  const els = [...deck.children];
  function show(i) {
    cur = wrap(i);
    els.forEach((el, k) => {
      let d = k - cur; if (d > N / 2) d -= N; if (d < -N / 2) d += N;
      const a = Math.abs(d);
      el.style.transform = `translateX(${d * 210}px) translateZ(${-a * 120}px) rotateY(${d * -10}deg) scale(${1 - Math.min(a, 3) * 0.08})`;
      el.style.opacity = a > 2 ? 0 : 1 - a * 0.18; el.style.zIndex = 10 - a; el.style.filter = a ? 'brightness(.6) saturate(.8)' : 'none';
      el.style.pointerEvents = a > 2 ? 'none' : 'auto'; el.tabIndex = a ? -1 : 0;
      if (a) el.classList.remove('flip');
    });
    const f = FEATURES[cur];
    $stage.querySelector('#cfNum').textContent = `${f.num} · ${f.group}`; $stage.querySelector('#cfName').textContent = f.name; $stage.querySelector('#cfLine').textContent = f.line;
    [...dots.children].forEach((b, k) => b.setAttribute('aria-current', String(k === cur)));
  }
  deck.addEventListener('click', (e) => { if (e.target.closest('a')) return; const c = e.target.closest('.cf-card'); if (!c) return; const i = +c.dataset.i; if (i === cur) c.classList.toggle('flip'); else show(i); }, { signal: ac.signal });
  dots.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); }, { signal: ac.signal });
  $stage.querySelector('#prev').addEventListener('click', () => show(cur - 1), { signal: ac.signal });
  $stage.querySelector('#next').addEventListener('click', () => show(cur + 1), { signal: ac.signal });
  addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(cur - 1); else if (e.key === 'ArrowRight') show(cur + 1); else if (e.key === ' ') { e.preventDefault(); els[cur].classList.toggle('flip'); } }, { signal: ac.signal });
  // 끌어서 넘기기
  let x0 = null; deck.addEventListener('pointerdown', (e) => { x0 = e.clientX; }, { signal: ac.signal });
  addEventListener('pointerup', (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 60) show(cur + (dx < 0 ? 1 : -1)); }, { signal: ac.signal });
  show(0);
}

// ── B. 포석호 아이템 도감: 칸을 고르면 오른쪽에 효과·사용법, 포석호가 직접 말해 준다.
//    [사용하기]를 누르면 그 기능의 실제 화면(학습 기록·평가 시험)이 도감 판 위에 뜬다. [← 도감으로] · Esc면 돌아온다 ──
function dex(ac) {
  $stage.innerHTML = `<section class="dex">
    <div class="dex-box"><h2>ITEM BOX · 10</h2><div class="dex-grid" id="grid" role="group" aria-label="기능 목록">${FEATURES.map((f, i) => `<button type="button" class="slot" data-i="${i}" aria-label="${esc(f.name)}"><span class="num">${f.num}</span><div class="art">${f.art()}</div></button>`).join('')}</div>
      <div class="dex-groups">${[...new Set(FEATURES.map((f) => f.group))].map((g) => `<span>${g} ${FEATURES.filter((f) => f.group === g).length}</span>`).join('')}</div>
      <p class="hint">칸을 누르거나 <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> · <kbd>Enter</kbd> 사용하기 · <kbd>Esc</kbd> 도감으로</p></div>
    <div class="dex-detail" id="detail">
      <div class="dex-head"><span class="num" id="dNum"></span><h2 id="dName"></h2><span class="en" id="dEn"></span></div>
      <div class="dex-art art" id="dArt"></div>
      <div class="dex-info"><h4>효과</h4><p id="dLine"></p><h4>사용법</h4><ol class="how" id="dHow"></ol><div class="dex-actions"><button type="button" class="btn" id="use">사용하기 ↗</button></div></div>
      <div class="dex-guide">${char('greet')}<div class="bubble"><b>${POSEOKHO.name}</b><span id="dSay"></span></div></div>
      <div class="dex-live" id="live" hidden><div class="dex-live-bar"><button type="button" class="btn ghost sm" id="back">← 도감으로</button><span class="num" id="lNum"></span><span class="dex-live-t" id="lName"></span>
        <a class="btn ghost sm" id="pop" target="_blank" rel="opener">새 창으로 ↗</a></div><iframe id="frame" title="실제 화면"></iframe></div>
    </div></section>`;
  const grid = $stage.querySelector('#grid'), detail = $stage.querySelector('#detail'), live = detail.querySelector('#live'), frame = detail.querySelector('#frame');
  const ch = detail.querySelector('cp-character'), say = detail.querySelector('#dSay'); let cur = 0;
  const talk = (text, motion = 'explain', back = 2600) => { typeInto(say, text); ch.setAttribute('motion', motion); clearTimeout(ch._t); ch._t = setTimeout(() => ch.setAttribute('motion', 'idle'), back); };
  function pick(i, speak = true) {
    cur = wrap(i); const f = FEATURES[cur];
    [...grid.children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === cur)));
    detail.querySelector('#dNum').textContent = f.num; detail.querySelector('#dName').textContent = f.name; detail.querySelector('#dEn').textContent = f.en;
    detail.querySelector('#dArt').innerHTML = f.art(); detail.querySelector('#dLine').textContent = f.line;
    detail.querySelector('#dHow').innerHTML = f.how.map((h) => `<li>${esc(h)}</li>`).join('');
    if (!live.hidden) use(false); // 실제 화면을 보는 중에 다른 칸을 고르면 그 기능 화면으로 바로 바꾼다
    if (speak) talk(f.say);
  }
  // 실제 화면 창은 처음 [사용하기] 때 한 번만 띄우고, 그다음부터는 주소 뒤 #기능만 바꾼다(학습 기록을 매번 새로 불러오지 않는다)
  function use(speak = true) {
    const f = FEATURES[cur], url = liveUrl(f);
    detail.querySelector('#lNum').textContent = f.num; detail.querySelector('#lName').textContent = f.name; detail.querySelector('#pop').href = url;
    if (!frame.getAttribute('src')) frame.src = url; else frame.contentWindow.location.replace(url);
    live.hidden = false;
    if (speak) talk(`좋아, ${f.name}! "${f.how[0]}"부터 해 봐.`, 'praise', 1600);
  }
  const back = () => { live.hidden = true; detail.querySelector('#use').focus(); };
  grid.addEventListener('click', (e) => { const b = e.target.closest('.slot'); if (b) pick(+b.dataset.i); }, { signal: ac.signal });
  detail.querySelector('#use').addEventListener('click', () => use(), { signal: ac.signal });
  detail.querySelector('#back').addEventListener('click', back, { signal: ac.signal });
  detail.addEventListener('pointerover', (e) => { if (e.target.closest('#use')) ch.setAttribute('motion', 'praise'); }, { signal: ac.signal });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !live.hidden) { back(); return; }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
    if (step && live.hidden) { e.preventDefault(); pick(cur + step); grid.children[cur].focus(); }
    else if (e.key === 'Enter' && document.activeElement?.classList.contains('slot')) { e.preventDefault(); use(); }
  }, { signal: ac.signal });
  pick(0, false); talk('어서 와! 칸을 하나 골라 봐. 무엇에 쓰는지, 어떻게 쓰는지 내가 알려 줄게. [사용하기]를 누르면 그 화면을 바로 열어 줄게.', 'greet');
}

// ── C. 궤도 라인: 큰 제목 뒤로 반원이 지나가고, 점을 누르면 그 점에서 거미줄처럼 선이 퍼지며 카드가 뜬다 ──
function orbit(ac) {
  $stage.innerHTML = `<section class="orb"><h1 class="orb-title"><small>[ LEARN &amp; ASK ]</small>STEEL<br>ROOKIE</h1>
    <svg class="arc" id="arc"></svg><div id="nodes"></div><div class="orb-char">${char('idle')}</div>
    <button type="button" class="orb-start" id="start">START<br>NOW</button><svg class="arc orb-web" id="web" style="z-index:4"></svg></section>`;
  const root = $stage.querySelector('.orb'), arc = root.querySelector('#arc'), web = root.querySelector('#web'), nodes = root.querySelector('#nodes');
  let pop = null, open = -1, geo = null;
  function layout() {
    const w = root.clientWidth, h = root.clientHeight, cx = w / 2, cy = h * 0.92, r = Math.min(w * 0.40, h * 0.74);
    geo = { cx, cy, r };
    arc.setAttribute('viewBox', `0 0 ${w} ${h}`); web.setAttribute('viewBox', `0 0 ${w} ${h}`);
    arc.innerHTML = `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#ff9e64" stop-opacity=".1"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#ff9e64" stop-opacity=".1"/></linearGradient></defs>
      <path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="url(#g)" stroke-width="1.5"/>
      <path d="M${cx - r * 0.62} ${cy} A${r * 0.62} ${r * 0.62} 0 0 1 ${cx + r * 0.62} ${cy}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="1"/>`;
    nodes.innerHTML = FEATURES.map((f, i) => {
      const t = Math.PI * (0.9 - 0.8 * (i / (N - 1))), x = cx + r * Math.cos(t), y = cy - r * Math.sin(t);
      return `<button type="button" class="orb-node ${x < cx ? 'l' : 'r'}" data-i="${i}" style="left:${x}px;top:${y}px" aria-expanded="${i === open}"><i></i><span><em>${f.num} · ${f.en}</em><b>${esc(f.name)}</b></span></button>`;
    }).join('');
    if (open >= 0) show(open);
  }
  function close() { pop?.remove(); pop = null; open = -1; web.innerHTML = ''; nodes.querySelectorAll('.orb-node').forEach((n) => n.setAttribute('aria-expanded', 'false')); }
  function show(i) {
    pop?.remove(); open = i; const f = FEATURES[i], n = nodes.children[i], nx = parseFloat(n.style.left), ny = parseFloat(n.style.top);
    nodes.querySelectorAll('.orb-node').forEach((m, k) => m.setAttribute('aria-expanded', String(k === i)));
    const W = 300, H = 330, w = root.clientWidth, left = Math.min(Math.max(16, nx < geo.cx ? nx + 40 : nx - W - 40), w - W - 16), top = Math.min(Math.max(80, ny - H / 2), root.clientHeight - H - 16);
    pop = document.createElement('div'); pop.className = 'orb-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', f.name);
    pop.style.cssText = `left:${left}px;top:${top}px;--ox:${nx - left}px;--oy:${ny - top}px`;
    pop.innerHTML = `<button type="button" class="x" aria-label="닫기">✕</button><span class="num">${f.num} · ${f.group}</span><div class="art">${f.art()}</div><h3>${esc(f.name)}</h3><p>${esc(f.line)}</p>${openBtn(f)}`;
    root.append(pop); pop.querySelector('.x').addEventListener('click', close);
    // 점에서 카드 네 모서리 + 이웃 점으로 퍼지는 선
    const corners = [[left, top], [left + W, top], [left, top + H], [left + W, top + H]];
    const near = [i - 1, i + 1].filter((k) => k >= 0 && k < N).map((k) => [parseFloat(nodes.children[k].style.left), parseFloat(nodes.children[k].style.top)]);
    web.innerHTML = [...corners, ...near].map(([x, y], k) => `<line x1="${nx}" y1="${ny}" x2="${x}" y2="${y}" style="animation-delay:${k * 40}ms"/>`).join('');
    root.querySelector('cp-character').setAttribute('motion', 'explain');
  }
  nodes.addEventListener('click', (e) => { const b = e.target.closest('.orb-node'); if (!b) return; const i = +b.dataset.i; if (i === open) close(); else show(i); }, { signal: ac.signal });
  root.querySelector('#start').addEventListener('click', () => show(1), { signal: ac.signal }); // 시작: 안 해 본 실습부터
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { signal: ac.signal });
  const ro = new ResizeObserver(layout); ro.observe(root); ac.signal.addEventListener('abort', () => ro.disconnect());
}

// ── D. 폴더 탭: 탭마다 작은 그림, 고르면 큰 그림 페이지가 펼쳐진다 ──
function folders(ac) {
  $stage.innerHTML = `<section class="fold"><div class="fold-tabs" role="tablist" aria-label="기능">${FEATURES.map((f, i) => `<button type="button" role="tab" class="fold-tab" data-i="${i}" aria-selected="false"><div class="art" style="background:${TONES[i]}">${f.art()}</div><span class="num">${f.num}</span>${esc(f.name)}</button>`).join('')}</div><div class="fold-body" id="body" role="tabpanel"></div></section>`;
  const tabs = $stage.querySelector('.fold-tabs'), body = $stage.querySelector('#body'); let cur = 0;
  function show(i) {
    cur = wrap(i); const f = FEATURES[cur];
    [...tabs.children].forEach((t, k) => { t.setAttribute('aria-selected', String(k === cur)); t.tabIndex = k === cur ? 0 : -1; });
    tabs.children[cur].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    const [a, ...rest] = f.name.split(' ');
    body.innerHTML = `<article class="fold-page"><div class="txt"><span class="en">${f.num} · ${f.en}</span><h2><em>${esc(a)}</em>${rest.length ? ` ${esc(rest.join(' '))}` : ''}</h2><p>${esc(f.line)}</p><ol class="how" style="margin-top:10px">${f.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol><div style="margin-top:auto;display:flex;gap:10px">${openBtn(f)}<button type="button" class="btn ghost" id="nx">다음 탭 →</button></div></div>
      <div class="pic" style="--tone:${TONES[cur]}"><span class="big">${f.num}</span><div class="art">${f.art()}</div><div class="chip"><b>${POSEOKHO.name}의 한마디</b>${esc(f.say)}</div></div></article>`;
    body.querySelector('#nx').addEventListener('click', () => show(cur + 1));
  }
  tabs.addEventListener('click', (e) => { const t = e.target.closest('.fold-tab'); if (t) show(+t.dataset.i); }, { signal: ac.signal });
  tabs.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur + (e.key === 'ArrowRight' ? 1 : -1)); tabs.children[cur].focus(); } }, { signal: ac.signal });
  show(0);
}

// ── E. 검색 런처: 검색어로 기능을 찾고, 아이콘에 올리면 설명. Enter면 첫 결과를 연다 ──
function launcher(ac) {
  const today = new Date();
  $stage.innerHTML = `<section class="ln"><div class="ln-col">
      <label class="ln-search"><span class="mark" aria-hidden="true"></span><input id="q" type="search" placeholder="무엇을 해 볼까요?  예: pdf, 안전, 시험, 오답" aria-label="기능 찾기" autocomplete="off"><button type="button" class="ai" id="ask">✦ 포석호</button></label>
      <div class="ln-grid" id="apps">${FEATURES.map((f, i) => `<a class="app" data-i="${i}" href="${liveUrl(f)}" target="_blank" rel="opener"><div class="ic art">${f.art()}</div><span>${esc(f.name)}</span><div class="tip" role="tooltip"><b>${esc(f.name)}</b>${esc(f.line)}</div></a>`).join('')}</div>
      <div class="ln-empty" id="empty" hidden>맞는 기능이 없어요. 포석호에게 물어보세요.</div></div>
    <div class="ln-foot"><div class="ln-me">${char('idle')}<div><b>${POSEOKHO.name}</b><small id="say">오늘의 길잡이 · 검색하거나 아이콘을 골라 봐</small></div></div>
      <div class="ln-widgets"><span>${today.getMonth() + 1}월 ${today.getDate()}일</span><button type="button" class="pill" id="rec">오늘의 추천 · 안 해 본 실습</button><span id="clock"></span></div></div></section>`;
  const q = $stage.querySelector('#q'), apps = [...$stage.querySelectorAll('.app')], empty = $stage.querySelector('#empty'), ch = $stage.querySelector('cp-character'), say = $stage.querySelector('#say');
  const match = (f, s) => !s || [f.name, f.en, f.line, ...f.keys].join(' ').toLowerCase().includes(s);
  function filter() {
    const s = q.value.trim().toLowerCase(); let first = -1;
    apps.forEach((a, i) => { const ok = match(FEATURES[i], s); a.classList.toggle('off', !ok); a.classList.toggle('hit', ok && !!s && first < 0); if (ok && first < 0) first = i; });
    empty.hidden = first >= 0;
    if (s && first >= 0) { say.textContent = `"${q.value.trim()}"라면 ${FEATURES[first].name}! Enter를 눌러 봐.`; ch.setAttribute('motion', 'explain'); }
    else if (s) { say.textContent = '음… 그건 아직 없어. 다른 말로 찾아볼래?'; ch.setAttribute('motion', 'thinking'); }
    else { say.textContent = '오늘의 길잡이 · 검색하거나 아이콘을 골라 봐'; ch.setAttribute('motion', 'idle'); }
    return first;
  }
  q.addEventListener('input', filter, { signal: ac.signal });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const i = filter(); if (i >= 0) window.open(liveUrl(FEATURES[i]), '_blank'); } }, { signal: ac.signal });
  $stage.querySelector('#rec').addEventListener('click', () => { q.value = '실습'; filter(); q.focus(); }, { signal: ac.signal });
  $stage.querySelector('#ask').addEventListener('click', () => { q.focus(); say.textContent = '찾고 싶은 걸 그냥 말로 써 봐. 예: "보고서 뽑기", "위험한 상황"'; ch.setAttribute('motion', 'greet'); }, { signal: ac.signal });
  $stage.querySelector('#apps').addEventListener('pointerover', (e) => { const a = e.target.closest('.app'); if (a && !q.value) say.textContent = FEATURES[+a.dataset.i].say; }, { signal: ac.signal });
  const clock = $stage.querySelector('#clock'), tick = () => { const d = new Date(); clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  tick(); const t = setInterval(tick, 10000); ac.signal.addEventListener('abort', () => clearInterval(t));
  setTimeout(() => q.focus(), 50);
}

const CONCEPTS = [['A', '카드 넘기기', cards], ['B', '포석호 도감', dex], ['C', '궤도 라인', orbit], ['D', '폴더 탭', folders], ['E', '검색 런처', launcher]];
let ac = null;
function go(key) {
  const c = CONCEPTS.find(([k]) => k === key) || CONCEPTS[0];
  ac?.abort(); ac = new AbortController();
  $switch.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === c[0])));
  try { history.replaceState(null, '', `#${c[0]}`); } catch (e) {}
  c[2](ac);
}
$switch.innerHTML = CONCEPTS.map(([k, label]) => `<button type="button" data-k="${k}" aria-pressed="false"><b>${k}</b>${label}</button>`).join('');
$switch.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.k); });
go((location.hash || '#A').slice(1));
