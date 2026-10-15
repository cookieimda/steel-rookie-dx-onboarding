// 운영 콘솔(관리자, /login_ui/admin-ops.html): 자료 검수 워크플로 · 작업 대기열 · 알림 발송 · 오답 패턴 · 3D 실습 통계 · 신고된 설비 메모.
// 서버는 backend/src/education/workflow-routes.ts·job-routes.ts, notify/routes.ts, ops/routes.ts, lab/extras-routes.ts. 관리자 토큰이 필요하다.
// 사용자 입력·서버 글은 모두 textContent로 넣는다.

const $ = (id) => document.getElementById(id);
const el = (tag, cls = '', text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
const btn = (text, onClick, cls = 'btn') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
const chip = (text, tone) => { const c = el('span', 'chip', text); if (tone) c.dataset.tone = tone; return c; };
const token = () => { try { return localStorage.getItem('st-rookie-token') || sessionStorage.getItem('st-rookie-token') || ''; } catch { return ''; } };
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요(${res.status}).`);
  return data;
}
const notice = (text = '') => { $('notice').textContent = text; $('notice').hidden = !text; };
const guard = (fn) => async (...args) => { notice(); try { await fn(...args); } catch (e) { notice(e.message); } };
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const SECTIONS = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const STAGE_TONE = { draft: 'dim', in_review: 'mid', changes_requested: 'bad', approved: 'ok', rejected: 'bad' };
const ACTION_LABEL = { created: '등록', submitted: '검수 요청', commented: '의견', changes_requested: '수정 요청', revised: '수정본 만듦', approved: '승인', rejected: '반려', checked: '검수 도우미' };
const JOB_TONE = { queued: 'dim', running: 'mid', succeeded: 'ok', failed: 'bad', cancelled: 'dim' };
const JOB_LABEL = { queued: '대기', running: '처리 중', succeeded: '완료', failed: '실패', cancelled: '취소' };

const TABS = [['materials', '자료 검수'], ['jobs', '작업 대기열'], ['notify', '알림 발송'], ['patterns', '오답 패턴'], ['practice', '3D 실습'], ['notes', '신고된 메모']];
const state = { tab: (location.hash.match(/^#(\w+)/)?.[1]) || 'materials', stage: '', material: (location.hash.match(/material=([\w-]+)/)?.[1]) || null, timer: 0 };

function renderTabs() {
  $('tabs').replaceChildren(...TABS.map(([k, label]) => { const b = btn(label, () => { state.tab = k; history.replaceState(null, '', `#${k}`); renderTabs(); void show(); }, ''); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(state.tab === k)); return b; }));
}
async function show() {
  clearInterval(state.timer);
  notice();
  const pane = $('pane'); pane.replaceChildren(el('p', 'muted', '불러오는 중이에요…'));
  try { await ({ materials: showMaterials, jobs: showJobs, notify: showNotify, patterns: showPatterns, practice: showPractice, notes: showNotes })[state.tab](pane); }
  catch (e) { pane.replaceChildren(); notice(e.message); }
}

// ── 자료 검수 ──
async function showMaterials(pane) {
  const data = await api('GET', `/api/admin/education/materials/workflow${state.stage ? `?stage=${state.stage}` : ''}`);
  const left = el('div', 'card ops-card'), right = el('div', 'card ops-card');
  const filters = el('div', 'ops-row');
  filters.append(btn(`전체`, () => { state.stage = ''; void show(); }, state.stage ? 'btn pill' : 'btn sm'));
  for (const [k, label] of Object.entries(data.labels)) filters.append(btn(`${label} ${data.counts[k] ?? 0}`, () => { state.stage = k; void show(); }, state.stage === k ? 'btn sm' : 'btn pill'));
  const list = el('div', 'ops-list');
  for (const m of data.materials) {
    const item = el('button', 'ops-item'); item.type = 'button'; item.setAttribute('aria-pressed', String(state.material === m.id));
    item.append(el('strong', '', m.title), chip(data.labels[m.stage], STAGE_TONE[m.stage]), el('small', '', `${SECTIONS[m.section] || m.section} · ${m.chars}자 · ${m.parent_id ? '수정본 · ' : ''}${m.last_event ? `${ACTION_LABEL[m.last_event.action]} ${when(m.last_event.created_at)}` : ''}`));
    item.addEventListener('click', () => { state.material = m.id; history.replaceState(null, '', `#materials&material=${m.id}`); void show(); });
    list.append(item);
  }
  if (!data.materials.length) list.append(el('p', 'muted', '자료가 없어요.'));
  left.append(el('strong', '', '자료 목록'), filters, list, newMaterialForm());
  pane.replaceChildren(Object.assign(el('div', 'ops-grid'), {}));
  pane.firstChild.append(left, right);
  if (state.material) await materialDetail(right, state.material); else right.append(el('p', 'muted', '왼쪽에서 자료를 고르면 단계·기록·차이와 할 일이 보여요.'));
}
function newMaterialForm() {
  const box = el('details'); box.append(el('summary', '', '새 초안 등록'));
  const form = el('form', 'ops-list');
  const field = (label, node) => { const f = el('label', 'ops-field'); f.append(el('span', '', label), node); return f; };
  const section = el('select'); for (const [k, v] of Object.entries(SECTIONS)) section.append(Object.assign(el('option', '', v), { value: k }));
  const title = el('input'), body = el('textarea'), url = el('input'), pub = el('input');
  body.rows = 6; url.placeholder = 'https://…'; title.maxLength = 100;
  form.append(field('공정', section), field('제목', title), field('본문', body), field('출처 주소', url), field('출처 기관', pub), Object.assign(btn('초안 등록', () => {}), { type: 'submit' }));
  form.addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    const m = await api('POST', '/api/admin/education/materials', { section: section.value, title: title.value, body: body.value, source_url: url.value, publisher: pub.value });
    state.material = m.id; await show();
  }));
  box.append(form);
  return box;
}
async function materialDetail(root, id) {
  const d = await api('GET', `/api/admin/education/materials/${id}/workflow`), m = d.material, stage = d.stage;
  const head = el('div', 'ops-row'); head.append(el('strong', '', m.title), chip({ draft: '초안', in_review: '검수 중', changes_requested: '수정 요청', approved: '승인', rejected: '반려' }[stage], STAGE_TONE[stage]));
  const meta = el('span', 'micro', `${SECTIONS[m.section]} · ${m.publisher} · 버전 ${String(m.version).slice(0, 8)}${d.parent_id ? ` · 원본 ${d.parent_id.slice(0, 8)}` : ''}`);
  const link = el('a', 'micro', m.source_url); link.href = m.source_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  root.append(head, meta, link);
  // 할 일(단계마다)
  const comment = el('textarea'); comment.rows = 2; comment.placeholder = '의견(수정 요청에는 꼭 적어요)';
  const actions = el('div', 'ops-row');
  const act = (label, path, needComment, cls = 'btn sm') => actions.append(btn(label, guard(async () => {
    if (needComment && !comment.value.trim()) throw new Error('의견을 적어 주세요.');
    await api('POST', `/api/admin/education/materials/${id}/${path}`, comment.value.trim() ? { comment: comment.value.trim() } : {});
    await show();
  }), cls));
  if (stage === 'draft' || stage === 'changes_requested') act('검수 요청', 'submit', false);
  if (stage === 'in_review') act('수정 요청', 'request-changes', true, 'btn secondary sm');
  if (stage === 'draft' || stage === 'in_review') {
    actions.append(btn('승인', guard(async () => { await api('POST', `/api/admin/education/materials/${id}/review`, { decision: 'approved', ...(comment.value.trim() ? { comment: comment.value.trim() } : {}) }); await show(); }), 'btn sm'));
    actions.append(btn('반려', guard(async () => { await api('POST', `/api/admin/education/materials/${id}/review`, { decision: 'rejected', ...(comment.value.trim() ? { comment: comment.value.trim() } : {}) }); await show(); }), 'btn secondary sm'));
  }
  if (['draft', 'in_review', 'changes_requested'].includes(stage)) act('의견만 남기기', 'comment', true, 'btn ghost sm');
  actions.append(btn('검수 도우미 실행', guard(async () => { const job = await api('POST', `/api/admin/education/materials/${id}/check`); notice(`검수 도우미를 작업 대기열에 넣었어요(${job.id.slice(0, 8)}). 잠시 뒤 기록에 결과가 남아요.`); setTimeout(() => void show(), 1500); }), 'btn ghost sm'));
  root.append(comment, actions);
  if (['changes_requested', 'rejected', 'approved'].includes(stage)) {
    const rev = el('details'); rev.append(el('summary', '', '수정본 만들기(원본은 그대로 남아요)'));
    const body = el('textarea'); body.rows = 8; body.value = m.body;
    rev.append(body, btn('수정본 등록', guard(async () => { const r = await api('POST', `/api/admin/education/materials/${id}/revise`, { body: body.value, ...(comment.value.trim() ? { comment: comment.value.trim() } : {}) }); state.material = r.material.id; await show(); }), 'btn sm'));
    root.append(rev);
  }
  if (d.diff) {
    const diff = el('div', 'diff'); diff.append(...d.diff.map((x) => el('div', x.op, `${x.op === 'add' ? '+ ' : x.op === 'del' ? '- ' : '  '}${x.text}`)));
    root.append(el('strong', '', '원본과 달라진 곳'), diff);
  } else root.append(el('strong', '', '본문'), el('div', 'ops-body', m.body));
  const events = el('ol', 'ops-events');
  for (const e of d.events) { const li = el('li'); li.append(el('b', '', ACTION_LABEL[e.action] || e.action), el('span', '', ` · ${when(e.created_at)}`)); if (e.comment) li.append(el('p', '', e.comment)); events.append(li); }
  root.append(el('strong', '', '기록'), events);
}

// ── 작업 대기열 ──
async function showJobs(pane) {
  const render = async () => {
    const data = await api('GET', '/api/admin/jobs');
    const tiles = el('div', 'stat-tiles');
    for (const k of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) { const t = el('div'); t.append(el('span', 'micro', JOB_LABEL[k]), el('b', '', data.stats.by_state[k] ?? 0)); tiles.append(t); }
    const kinds = el('div', 'ops-row');
    kinds.append(el('span', 'muted', '작업 넣기:'));
    for (const k of data.kinds) kinds.append(btn(k.label, guard(async () => { if (k.kind === 'material-check') throw new Error('검수 도우미는 자료 검수 화면에서 자료를 골라 실행해요.'); await api('POST', '/api/jobs', { kind: k.kind }); await render(); }), 'btn pill'));
    const table = el('table', 'ops'), head = el('tr');
    for (const h of ['작업', '상태', '진행', '시도', '넣은 때', '']) head.append(el('th', '', h));
    table.append(head);
    for (const j of data.jobs.slice(0, 60)) {
      const tr = el('tr'), pbar = el('div', 'pbar'), fill = el('i'); fill.style.width = `${Math.round((j.progress ?? (j.state === 'succeeded' ? 1 : 0)) * 100)}%`; pbar.append(fill);
      const tools = el('td');
      if (j.state === 'queued' || j.state === 'running') tools.append(btn('취소', guard(async () => { await api('DELETE', `/api/jobs/${j.id}`); await render(); }), 'btn ghost sm'));
      if (j.state === 'succeeded' && j.result?.csv) tools.append(btn('CSV 받기', () => { const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + j.result.csv], { type: 'text/csv' })); a.download = j.result.filename || 'report.csv'; a.click(); }, 'btn pill'));
      if (j.state === 'failed' && j.error) tools.append(el('span', 'micro', j.error.message));
      const name = el('td'); name.append(el('strong', '', j.metadata?.label || j.kind), el('div', 'micro', j.kind));
      const st = el('td'); st.append(chip(JOB_LABEL[j.state] || j.state, JOB_TONE[j.state]), el('div', 'micro', j.phase));
      const pr = el('td'); pr.append(pbar);
      tr.append(name, st, pr, el('td', '', `${j.attempts}/${j.max_attempts}`), el('td', '', when(j.created_at)), tools);
      table.append(tr);
    }
    const card = el('div', 'card ops-card');
    card.append(el('strong', '', '작업 대기열'), el('span', 'micro', `메모리 대기 ${data.stats.queued_in_memory}개 · 최근 24시간 평균 처리 ${data.stats.avg_seconds_24h ?? '—'}초 · 3초마다 새로 고침`), tiles, kinds, table);
    pane.replaceChildren(card);
  };
  await render();
  state.timer = setInterval(() => void render().catch(() => {}), 3000);
}

// ── 알림 발송 ──
async function showNotify(pane) {
  const data = await api('GET', '/api/admin/notifications/outbox');
  const card = el('div', 'card ops-card');
  const run = btn('지금 정기 알림 만들기·발송', guard(async () => { const r = await api('POST', '/api/admin/notifications/run'); notice(`알림 ${r.made}개를 만들고 보냈어요(보냄 ${r.delivery.sent} · 연결 없음 ${r.delivery.skipped} · 실패 ${r.delivery.failed}).`); await showNotify(pane); }));
  card.append(el('strong', '', '알림 발송 기록'), el('span', 'micro', '복습 일정·시험 마감·연속 학습일 알림은 15분마다 자동으로 만들어요. 메신저·메일은 학습자가 켠 경우에만, 서버에 연결 주소(NOTIFY_MESSENGER_WEBHOOK·NOTIFY_EMAIL_WEBHOOK)가 있을 때 보내요.'), run);
  const table = el('table', 'ops'), head = el('tr');
  for (const h of ['받는 사람', '채널', '알림', '상태', '때']) head.append(el('th', '', h));
  table.append(head);
  for (const d of data.deliveries) {
    const tr = el('tr'), st = el('td'); st.append(chip({ pending: '대기', sent: '보냄', skipped: '건너뜀', failed: '실패' }[d.state] || d.state, { sent: 'ok', failed: 'bad', pending: 'mid' }[d.state]), el('div', 'micro', d.detail || ''));
    tr.append(el('td', '', d.username || ''), el('td', '', d.channel === 'email' ? '메일' : '메신저'), el('td', '', d.title), st, el('td', '', when(d.updated_at)));
    table.append(tr);
  }
  if (!data.deliveries.length) card.append(el('p', 'muted', '아직 외부 발송 기록이 없어요(학습자가 메신저·메일을 켜야 생겨요).'));
  card.append(table);
  pane.replaceChildren(card);
}

// ── 오답 패턴 ──
async function showPatterns(pane) {
  const data = await api('GET', '/api/admin/misconception-patterns');
  const wrap = el('div', 'ops-list');
  wrap.append(el('span', 'micro', '이해도 확인에서 나온 오개념을 설명이 비슷한 것끼리 묶었어요. 설명·답변 원문은 학습자 본인만 보고, 여기에는 자주 나온 낱말과 개수만 보여요.'));
  for (const c of data.concepts) {
    const card = el('div', 'card ops-card'), head = el('div', 'ops-row');
    head.append(el('strong', '', c.name), chip(SECTIONS[c.section] || c.section), el('span', 'micro', `오개념 ${c.total}건 · ${c.learners}명 · 미해결 ${c.open}`));
    card.append(head);
    const max = Math.max(1, ...c.patterns.map((p) => p.count));
    for (const p of c.patterns) {
      const row = el('div', 'pat-row'), kw = el('span');
      for (const k of p.keywords) kw.append(el('span', 'kw', `#${k}`));
      const bar = el('div', 'pat-bar'); bar.style.width = `${(p.count / max) * 100}%`;
      row.append(kw, bar, el('span', 'micro', `${p.count}건 · ${p.learners}명 · 미해결 ${p.open}`));
      card.append(row);
    }
    wrap.append(card);
  }
  if (!data.concepts.length) wrap.append(el('p', 'muted', '아직 오개념 기록이 없어요.'));
  pane.replaceChildren(wrap);
}

// ── 3D 실습 통계: 이상 상황 훈련·사고 사례·인과 퀴즈에서 어디서 막히는지(문항·단계 단위, 사람별 내용 없음) ──
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const rateBar = (x) => { const b = el('div', 'pbar'); const i = el('i'); i.style.width = `${Math.round((x ?? 0) * 100)}%`; b.append(i); return b; };
async function showPractice(pane) {
  const demo = state.practiceDemo !== false;
  const data = await api('GET', `/api/admin/practice-stats${demo ? '' : '?include_demo=false'}`);
  const wrap = el('div', 'ops-pane'), top = el('div', 'ops-row');
  top.append(el('span', 'micro', '3D 화면의 자가 훈련 기록이에요. 이해도·통과와는 상관없고, 사람별 내용 없이 문항·단계 단위로만 모았어요.'),
    btn(demo ? '시연 계정 빼고 보기' : '시연 계정 포함', guard(async () => { state.practiceDemo = !demo; await showPractice(pane); }), 'btn pill'));
  // 인과 퀴즈
  const c = data.causal, quiz = el('div', 'card ops-card'), tiles = el('div', 'stat-tiles');
  for (const [k, v] of [['전체 정답률', pct(c.rate)], ['한 칸(바로 다음 값)', pct(c.one_hop)], ['두 칸(이어진 값)', pct(c.two_hop)], ['같은 공정 안', pct(c.same_process)], ['공정 넘어서', pct(c.cross_process)]]) {
    const t = el('div'); t.append(el('span', 'micro', k), el('b', '', v)); tiles.append(t);
  }
  quiz.append(el('strong', '', '🧩 인과 퀴즈'), el('span', 'micro', `답 ${c.answers}칸 · ${c.learners}명. 두 칸·공정을 넘는 정답률이 낮으면 "같은/반대 방향을 곱한다"는 규칙을 수업에서 다시 짚어 주세요.`), tiles);
  if (c.confusing.length) {
    quiz.append(el('b', '', `가장 헷갈리는 연결 (답 ${data.min_link_answers}칸 이상)`));
    for (const l of c.confusing) {
      const row = el('div', 'pat-row');
      row.append(el('span', '', `${l.path}${l.cross ? ' · 공정 넘음' : ''}`), rateBar(l.rate), el('span', 'micro', `정답 ${pct(l.rate)} · ${l.answers}칸`));
      quiz.append(row);
    }
  } else quiz.append(el('p', 'muted', '헷갈린 연결이 아직 없어요.'));
  // 이상 상황 훈련
  const ft = el('div', 'card ops-card'), table = el('table', 'ops'), head = el('tr');
  for (const h of ['이상 상황', '공정', '시도 · 사람', '평균 점수', '한 번에 끝냄', '가장 오래 걸린 단계']) head.append(el('th', '', h));
  table.append(head);
  for (const f of data.faults) {
    const tr = el('tr'), score = el('td'), hard = f.steps.find((s) => s.step === f.hardest_step);
    score.append(el('span', '', pct(f.avg_score)), rateBar(f.avg_score));
    tr.append(el('td', '', f.title), el('td', '', SECTIONS[f.section] || f.section), el('td', '', `${f.attempts}회 · ${f.learners}명`), score, el('td', '', pct(f.first_try_rate)),
      el('td', '', hard ? `${hard.label} (평균 ${hard.avg_tries}번)` : f.attempts ? '막힌 단계 없음' : '—'));
    table.append(tr);
  }
  ft.append(el('strong', '', '🚨 이상 상황 훈련'), el('span', 'micro', '점수는 단계마다 몇 번 만에 맞혔는지로 내요(한 번에 맞히면 1).'), table);
  // 사고 사례
  const it = el('div', 'card ops-card'), t2 = el('table', 'ops'), h2 = el('tr');
  for (const h of ['사고 사례', '공정', '시도 · 사람', '평균 점수', '가장 많이 틀린 문항']) h2.append(el('th', '', h));
  t2.append(h2);
  for (const s of data.incidents) {
    const tr = el('tr'), score = el('td');
    score.append(el('span', '', pct(s.avg_score)), rateBar(s.avg_score));
    tr.append(el('td', '', s.title), el('td', '', SECTIONS[s.section] || s.section), el('td', '', `${s.attempts}회 · ${s.learners}명`), score,
      el('td', '', s.weakest ? `${s.weakest.prompt} (정답 ${pct(s.weakest.rate)})` : s.attempts ? '모두 잘 맞힘' : '—'));
    t2.append(tr);
  }
  it.append(el('strong', '', '📰 사고 사례'), t2);
  // 수업 모드: 3D 화면에서 수업 막대와 함께 연다(교육 담당자가 화면 공유로 진행)
  const lessons = await api('GET', '/api/lab/lessons').catch(() => ({ lessons: [] }));
  const lc = el('div', 'card ops-card');
  lc.append(el('strong', '', '🎓 수업 모드'), el('span', 'micro', '3D 화면 위쪽 막대로 단계를 넘기며 진행해요. 단계마다 진행자 안내가 있어요.'));
  for (const l of lessons.lessons) {
    const row = el('div', 'ops-item'), a = el('a', 'btn sm', '3D에서 수업 열기');
    a.href = `/3d-demo/Steel%20Academy%20v4.dc.html?p=ironmaking&lab=lesson&lesson=${encodeURIComponent(l.id)}&step=1`; a.target = '_blank'; a.rel = 'noopener';
    const st = (data.lessons || []).find((x) => x.id === l.id);
    row.append(el('span', '', `${l.title} · ${l.steps}단계 · ${l.minutes}분`), a, el('small', '', l.goal));
    if (st) row.append(el('small', '', `연 사람 ${st.learners}명 · 끝 단계까지 ${st.finished}명 · 단계별 ${st.by_step.map((x, k) => `${k + 1}:${x.learners}`).join(' ')}`));
    lc.append(row);
  }
  if (!lessons.lessons.length) lc.append(el('p', 'muted', '수업이 없어요.'));
  wrap.append(top, lc, quiz, ft, it);
  pane.replaceChildren(wrap);
}

// ── 신고된 메모 ──
async function showNotes(pane) {
  const data = await api('GET', '/api/admin/notes/reported');
  const card = el('div', 'card ops-card');
  card.append(el('strong', '', '신고된 설비 메모'), el('span', 'micro', '신고가 3번 쌓이면 자동으로 숨겨져요. 확인한 뒤 다시 보이게 하거나 숨김을 유지하세요.'));
  for (const n of data.notes) {
    const row = el('div', 'ops-item');
    row.append(el('span', '', n.text), chip(n.hidden ? '숨김' : '보임', n.hidden ? 'bad' : 'ok'),
      el('small', '', `${n.author} · ${n.equipment_id} · 신고 ${n.reports}번 · ${n.reasons}`));
    row.append(btn(n.hidden ? '다시 보이기' : '숨기기', guard(async () => { await api('POST', `/api/admin/notes/${n.id}/hide`, { hidden: !n.hidden }); await showNotes(pane); }), 'btn pill'));
    card.append(row);
  }
  if (!data.notes.length) card.append(el('p', 'muted', '신고된 메모가 없어요.'));
  pane.replaceChildren(card);
}

// ── 시작 ──
const THEME_KEY = 'st-rookie-theme';
const theme = (v, save) => { document.body.dataset.theme = v; $('theme').textContent = v === 'dark' ? '☀' : '☾'; if (save) try { localStorage.setItem(THEME_KEY, v); } catch {} };
$('theme').addEventListener('click', () => theme(document.body.dataset.theme === 'dark' ? 'light' : 'dark', true));
(async () => {
  let saved = null; try { saved = localStorage.getItem(THEME_KEY); } catch {}
  theme(saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (!token()) return location.replace('/login_ui/home-sleek.html');
  try {
    const { user } = await api('GET', '/api/auth/me');
    if (user.role !== 'admin') { notice('관리자 계정만 볼 수 있어요.'); return; }
    $('who').textContent = `${user.name} · 자료 검수 · 작업 대기열 · 알림 · 오답 패턴 · 3D 실습`;
    renderTabs(); await show();
  } catch (e) { notice(e.message); }
})();
