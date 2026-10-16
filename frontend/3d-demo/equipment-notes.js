// 3D 화면(v4) 설비 메모 공유: 설비를 고르면(steel-select) 그 설비에 동기들이 남긴 질문·메모·팁을 떠 있는 카드로 보여 주고 바로 남길 수 있다.
// <steel-scene>(scene_v3.js)을 고치지 않고 바깥에서 붙는다(learn-hud.js와 같은 방식). 서버는 backend/src/lab/extras-routes.ts(/api/lab/notes).
// 로그인 토큰이 없으면 붙지 않는다. 카드는 접을 수 있고, 접은 상태는 이 브라우저에 기억한다.

const TOKEN_KEY = 'st-rookie-token', FOLD_KEY = 'st-rookie:notes-folded';
const KIND = { question: '질문', memo: '메모', tip: '팁' };
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const folded = () => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch (e) { return false; } };
const api = async (method, path, body) => {
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패(${res.status})`);
  return data;
};
const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

function injectStyle() {
  if (document.getElementById('en-style')) return;
  const s = document.createElement('style'); s.id = 'en-style';
  s.textContent = `
    .en { position: fixed; left: 16px; bottom: 96px; z-index: 60; width: min(340px, calc(100vw - 32px)); font: 15px/1.5 "Pretendard", sans-serif; color: #eef2f7; }
    .en-card { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 16px; background: rgba(14, 24, 40, .92); box-shadow: 0 14px 34px rgba(0,0,0,.35); backdrop-filter: blur(10px); }
    .en-head { display: flex; align-items: center; gap: 8px; }
    .en-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .en button { font: inherit; color: inherit; cursor: pointer; }
    .en-x { border: 0; background: rgba(255,255,255,.08); border-radius: 8px; height: 30px; padding: 0 10px; }
    .en-pill { border: 0; border-radius: 999px; height: 40px; padding: 0 16px; background: rgba(14, 24, 40, .92); box-shadow: 0 8px 20px rgba(0,0,0,.3); }
    .en-list { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
    .en-note { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.06); }
    .en-note small { display: block; color: #a9b6c8; }
    .en-kind { font-weight: 700; margin-right: 6px; color: #7fb2ff; }
    .en-kind.tip { color: #6fcf97; } .en-kind.memo { color: #c9d1dc; }
    .en form { display: flex; gap: 6px; }
    .en input { flex: 1; min-width: 0; height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #fff; font: inherit; }
    .en .en-send { border: 0; border-radius: 8px; padding: 0 12px; background: #ff9e64; color: #1a0b03; font-weight: 700; }
    .en a { color: #ffd9a8; }
    @media (max-width: 740px) { .en { bottom: 120px; } }`;
  document.head.appendChild(s);
}

export function attachEquipmentNotes() {
  if (!token()) return;
  injectStyle();
  const root = el('div', 'en'); root.setAttribute('aria-live', 'polite');
  document.body.appendChild(root);
  let current = null, notes = [], name = '', error = '';

  const render = () => {
    root.replaceChildren();
    if (!current) return;
    if (folded()) {
      const pill = el('button', 'en-pill', `💬 ${name} 메모 ${notes.length}`); pill.type = 'button';
      pill.addEventListener('click', () => { try { localStorage.removeItem(FOLD_KEY); } catch (e) {} render(); });
      root.append(pill); return;
    }
    const card = el('div', 'en-card');
    const head = el('div', 'en-head'); head.append(el('span', '', '💬'), el('strong', '', `${name} · 동기 메모 ${notes.length}`));
    const fold = el('button', 'en-x', '접기'); fold.type = 'button';
    fold.addEventListener('click', () => { try { localStorage.setItem(FOLD_KEY, '1'); } catch (e) {} render(); });
    head.append(fold);
    const list = el('div', 'en-list');
    if (!notes.length) list.append(el('small', '', '아직 메모가 없어요. 궁금한 점을 처음으로 남겨 보세요.'));
    for (const n of notes.slice(0, 6)) {
      const item = el('div', 'en-note'), kind = el('span', `en-kind ${n.kind}`, KIND[n.kind] || n.kind);
      item.append(kind, document.createTextNode(n.text), el('small', '', `${n.author} · ♥ ${n.votes} · 답글 ${n.replies.length}`));
      list.append(item);
    }
    const form = el('form'), input = el('input'); input.placeholder = '이 설비에 대한 질문 남기기'; input.maxLength = 500; input.setAttribute('aria-label', '설비 질문');
    const send = el('button', 'en-send', '남기기'); send.type = 'submit';
    form.append(input, send);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text.length < 2) return;
      try { await api('POST', '/api/lab/notes', { equipment_id: current, kind: 'question', text, visibility: 'public' }); await load(current); }
      catch (err) { error = err.message; render(); }
    });
    const more = el('small'); const a = el('a', '', '학습 기록에서 답글·공감 보기'); a.href = '/login'; more.append(a);
    card.append(head, list, form, more);
    if (error) card.append(el('small', '', error));
    root.append(card);
  };
  async function load(id) {
    try { const r = await api('GET', `/api/lab/notes?equipment_id=${encodeURIComponent(id)}`); notes = r.notes; name = r.equipment.name; error = ''; }
    catch (e) { notes = []; error = e.message; }
    render();
  }
  document.addEventListener('steel-select', (e) => {
    const id = e.detail?.id || null;
    current = id;
    if (!id) { render(); return; }
    void load(id);
  });
}
