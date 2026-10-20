// 새 학습 기록(LEARN & ASK) 포석호 도감. 왼쪽 아이템 박스에서 기능을 고르면 오른쪽에 효과·사용법과 포석호의 한마디,
// [사용하기]를 누르면 그 기능의 실제 화면(live.html#기능)이 도감 판 위에 뜬다. [← 도감으로] · Esc면 돌아온다.
import { FEATURES, POSEOKHO } from './features.js';

const TOKEN = 'st-rookie-token';
const $stage = document.getElementById('stage');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = FEATURES.length, wrap = (i) => ((i % N) + N) % N;
const LIVE = new URL('./live.html', import.meta.url).href;
function typeInto(el, text) {
  clearInterval(el._t); if (reduce) { el.textContent = text; return; }
  let i = 0; el.textContent = ''; el._t = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(el._t); }, 22);
}

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

$stage.innerHTML = `<section class="dex">
  <div class="dex-box"><h2>ITEM BOX · ${N}</h2><div class="dex-grid" id="grid" role="group" aria-label="기능 목록">${FEATURES.map((f, i) => `<button type="button" class="slot" data-i="${i}" aria-label="${esc(f.name)}"><span class="num">${f.num}</span><div class="art">${f.art()}</div></button>`).join('')}</div></div>
  <div class="dex-detail" id="detail">
    <div class="dex-head"><span class="num" id="dNum"></span><h2 id="dName"></h2><span class="en" id="dEn"></span></div>
    <div class="dex-art art" id="dArt"></div>
    <div class="dex-info"><h4>효과</h4><p id="dLine"></p><h4>사용법</h4><ol class="how" id="dHow"></ol><div class="dex-actions"><button type="button" class="btn" id="use">사용하기 ↗</button></div></div>
    <div class="dex-guide"><cp-character model="${POSEOKHO.model}" motion="greet" aria-label="튜터 ${POSEOKHO.name}"></cp-character>
      <div class="bubble"><b>${POSEOKHO.name}</b><span id="dSay"></span>
        <button type="button" class="ask" id="ask">💬 포석호에게 묻기</button>
        <div class="keys" aria-label="단축키"><span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>Enter</kbd> 사용하기</span><span><kbd>Esc</kbd> 도감으로</span></div></div></div>
    <div class="dex-live" id="live" hidden><div class="dex-live-bar"><button type="button" class="btn ghost sm" id="back">← 도감으로</button><span class="num" id="lNum"></span><span class="dex-live-t" id="lName"></span>
      <button type="button" class="btn ghost sm" id="askBar">💬 포석호에게 묻기</button><a class="btn ghost sm" id="pop" target="_blank" rel="opener">새 창으로 ↗</a></div><iframe id="frame" title="실제 화면"></iframe></div>
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
// route: live.html의 기능 id. 'ask'는 작동 단계 + 포석호 채팅(입력창에 커서)
function openLive(f, route = f.id) {
  const url = `${LIVE}#${route}`;
  detail.querySelector('#lNum').textContent = f.num; detail.querySelector('#lName').textContent = route === 'ask' ? `${f.name} · 포석호 채팅` : f.name;
  detail.querySelector('#pop').href = url;
  // 포석호 채팅은 작동 단계 옆에만 있다. 다른 기능 화면에서는 위 막대의 [포석호에게 묻기]로 넘어간다
  detail.querySelector('#askBar').hidden = f.id === 'steps';
  // 작동 단계(+채팅)는 도면과 채팅이 나란히 보이게 실제 화면 창을 도감 전체 폭으로 넓힌다(좁으면 학습 기록이 채팅을 도면 아래로 내린다)
  $stage.querySelector('.dex').classList.toggle('live-wide', f.id === 'steps');
  // 같은 #기능을 다시 열면 주소가 안 바뀌어 창이 반응하지 않으므로, 그때는 창의 show()를 직접 부른다(같은 사이트)
  if (!frame.getAttribute('src')) frame.src = url;
  else if (frame.contentWindow.location.hash === `#${route}` && typeof frame.contentWindow.show === 'function') frame.contentWindow.show(route);
  else frame.contentWindow.location.replace(url);
  live.hidden = false;
}
function use(speak = true) {
  const f = FEATURES[cur]; openLive(f);
  if (speak) talk(`좋아, ${f.name}! "${f.how[0]}"부터 해 봐.`, 'praise', 1600);
}
// [포석호에게 묻기]: 작동 단계 칸을 고르고 작동 단계 + 채팅을 연다(채팅은 2D에서 고른 공정·설비를 보고 답하고 도면을 움직인다)
function ask() {
  pick(FEATURES.findIndex((f) => f.id === 'steps'), false);
  openLive(FEATURES[cur], 'ask');
  talk('궁금한 걸 아래 채팅에 물어봐! 도면에서 설비를 먼저 고르면 그 설비를 보고 답해 줄게.', 'greet', 1800);
}
const back = () => { live.hidden = true; detail.querySelector('#use').focus(); };
detail.querySelector('#ask').addEventListener('click', ask);
detail.querySelector('#askBar').addEventListener('click', ask);
grid.addEventListener('click', (e) => { const b = e.target.closest('.slot'); if (b) pick(+b.dataset.i); });
detail.querySelector('#use').addEventListener('click', () => use());
detail.querySelector('#back').addEventListener('click', back);
detail.addEventListener('pointerover', (e) => { if (e.target.closest('#use')) ch.setAttribute('motion', 'praise'); });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !live.hidden) { back(); return; }
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
  if (step && live.hidden) { e.preventDefault(); pick(cur + step); grid.children[cur].focus(); }
  else if (e.key === 'Enter' && document.activeElement?.classList.contains('slot')) { e.preventDefault(); use(); }
});
// ?f=기능 id로 들어오면 그 칸을 고른 채 시작한다(예: /login_ui/learn/learn.html?f=report)
const f0 = FEATURES.findIndex((f) => f.id === new URLSearchParams(location.search).get('f'));
pick(f0 >= 0 ? f0 : 0, false);
talk('어서 와! 칸을 하나 골라 봐. 무엇에 쓰는지, 어떻게 쓰는지 내가 알려 줄게. [사용하기]를 누르면 그 화면을 바로 열어 줄게.', 'greet');
