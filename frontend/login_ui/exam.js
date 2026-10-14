// 평가 시험 페이지(/exam). 흐름·API는 docs/exam-page.md. 학습 기록(Trainee Dashboard.dc.html)과 같은 디자인 체계를 쓴다.
// - 요청 형식은 바꾸지 않는다: 작업 조회·취소·재연결, 답안 초안·Idempotency-Key(사용자별 sessionStorage), 일시 정지, 로그아웃 그대로.
// - 포석호(cp-character): 시험 패널의 '튜터 무대'에 한 개만 만들어 두고 motion 속성만 바꾼다(그릴 때마다 새로 만들면 WebGL 컨텍스트가 쌓인다).
//   동작은 checkpoint-chat.js의 motionFor(이번 차례 마지막 발화 type), 반응 발화(정답·거의·아쉬움·핵심 정리)는 잠깐 그 동작을 먼저 보여 준다.
//   효과음은 tutor-sfx.js(sfxFor)로 새 발화가 보일 때 한 번만 낸다(발화 키를 기억해 같은 발화를 다시 그릴 때는 내지 않는다).
import { createApiClient } from '../3d-demo/api-client.js';
import { motionFor } from '../3d-demo/checkpoint-chat.js';
import { playSfx, setSfxOn, sfxFor, sfxOn, sfxSupported } from '../3d-demo/tutor-sfx.js';

const api = createApiClient();
const $ = (id) => document.getElementById(id);
const el = (tag, className = '', text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (text, action, style = 'btn') => { const node = el('button', style, text); node.type = 'button'; node.addEventListener('click', action); return node; };
const chip = (text, tone) => { const node = el('span', 'chip', text); node.dataset.tone = tone; return node; };
const PHASES = { queued: '요청을 접수했어요. 앞선 평가가 끝나면 시작해요.', preparing: '평가 시험을 준비하고 있어요.', question: '개념을 확인할 문제를 준비하고 있어요.', grading: '답안의 핵심 개념을 평가하고 있어요.', explanation: '다시 살펴볼 개념을 정리하고 있어요.', recheck: '추가 확인 문제를 준비하고 있어요.' };
/** 망치 화면의 단계 칸 이름. 작업 상태의 phase(backend/src/education/jobs.ts)가 바뀔 때마다 한 칸씩 늘어 처리가 움직이고 있음을 보여 준다. */
const STEP_LABEL = { queued: '접수', preparing: '준비', question: '문제 준비', grading: '답안 채점', explanation: '설명 정리', recheck: '추가 확인 문제' };
const ANSWERING = ['awaiting_ready', 'awaiting_answer', 'awaiting_recheck', 'error'];
/** 공정 카드 상태 → 칩 문구와 색(통과 ok · 응시 중/응시 가능 mid · 준비 중/잠금 dim) */
const SECTION_CHIP = { pass: ['통과', 'ok'], progress: ['응시 중', 'mid'], open: ['응시 가능', 'mid'], locked: ['잠금', 'dim'], prep: ['준비 중', 'dim'] };
/** 말풍선에 넣는 발화: 반응(정답·거의·아쉬움)과 질문·시작·오류. 설명(explanation)은 아래 설명 블록에 둔다. */
const REACTIONS = ['feedback', 'almost', 'miss'];
const PROMPTS = ['intro', 'question', 'recheck_question', 'error'];
/** 반응 동작을 먼저 보여 주는 시간(ms). 지나면 마지막 발화의 동작으로 돌아간다. */
const REACTION_MS = 2200;
const IDLE_BUBBLE = '응시할 공정을 고르면 제가 질문할게요.';
const pct = (value) => `${Math.round(value * 100)}%`;
const scoreTone = (value) => (value >= 0.8 ? 'ok' : value >= 0.6 ? 'mid' : 'bad');
/** trail: 지금 작업이 지나온 단계(망치 화면의 단계 칸). 작업이 바뀌면 비운다 */
const state = { user: null, sections: [], view: null, activeJob: null, submission: null, draft: '', watching: false, pending: false, trail: { job: null, phases: [] } };
/** 포석호 무대: 엘리먼트 한 개, 지금 동작, 마지막으로 보여 준 발화 키, 반응 동작 타이머, 타자 효과(typer·typing) */
const stage = { el: null, motion: 'idle', key: null, timer: 0, typer: 0, typing: null, mobile: matchMedia('(max-width: 740px)'), reduced: matchMedia('(prefers-reduced-motion: reduce)') };
const key = (suffix) => `st-rookie:exam:${state.user?.id}:${suffix}`;
const save = (suffix, value) => { try { if (value === null) sessionStorage.removeItem(key(suffix)); else sessionStorage.setItem(key(suffix), JSON.stringify(value)); } catch {} };
const read = (suffix) => { try { return JSON.parse(sessionStorage.getItem(key(suffix)) || 'null'); } catch { return null; } };
const copyError = (error) => (error?.message || '요청을 처리하지 못했어요.').replaceAll('이해도 확인', '평가 시험');
function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function loading(on, job) {
  state.pending = on;
  if (job) state.activeJob = job;
  $('cancel-job').disabled = !state.activeJob;
  $('forge-phase').textContent = on ? (PHASES[state.activeJob?.phase] || '요청을 접수하고 있어요.') : '';
  if (on && !$('forge').open) $('forge').showModal();
  if (!on && $('forge').open) $('forge').close();
  if (!on) { state.activeJob = null; $('reconnect').hidden = true; }
  renderTrail(on ? job : null);
  // 처리 중에는 포석호가 생각하는 동작(적던 글은 다 적어 둔다), 끝나면 지금 발화의 동작으로 돌아간다.
  if (on) { clearTimeout(stage.timer); stage.timer = 0; finishTyping(); setMotion('thinking'); } else renderStage(speechFor(state.view));
}
/** 망치 화면의 단계 칸: 작업의 phase가 바뀔 때마다 한 칸 늘린다(끝난 칸은 체크, 지금 칸은 깜빡이는 점). 작업이 끝나면 비운다. */
function renderTrail(job) {
  const trail = state.trail;
  if (!job) { trail.job = null; trail.phases = []; }
  else {
    if (trail.job !== job.id) { trail.job = job.id; trail.phases = []; }
    if (STEP_LABEL[job.phase] && trail.phases.at(-1) !== job.phase) trail.phases.push(job.phase);
  }
  $('forge-steps').replaceChildren(...trail.phases.map((phase, i) => {
    const last = i === trail.phases.length - 1, item = el('li', last ? 'now' : 'done');
    if (last) { item.setAttribute('aria-current', 'step'); item.append(el('i')); } else item.append(document.createTextNode('✓ '));
    item.append(document.createTextNode(STEP_LABEL[phase]));
    return item;
  }));
}
setInterval(() => {
  const start = state.activeJob ? Date.parse(state.activeJob.created_at) : state.submission?.started;
  const seconds = start ? Math.max(0, Math.floor((Date.now() - start) / 1000)) : 0;
  $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}, 1000);
async function refreshSections() { state.sections = (await api.request('GET', '/api/exams/sections')).sections; renderSections(); }
function renderSections() {
  const sections = state.sections;
  const passed = sections.filter((s) => s.progress?.unlocked).length;
  const open = sections.filter((s) => s.checkpoint && s.progress?.open && !s.progress?.unlocked).length;
  $('kpi-passed').textContent = String(passed); $('kpi-passed-unit').textContent = `/ ${sections.length || 4}`;
  $('kpi-passed-card').dataset.tone = passed ? 'ok' : '';
  $('kpi-open').textContent = String(open);
  $('sections').replaceChildren(...sections.map((s, i) => {
    const p = s.progress, active = state.view?.section === s.section;
    const kind = !s.checkpoint ? 'prep' : p?.unlocked ? 'pass' : p?.in_progress_attempt_id ? 'progress' : p?.open ? 'open' : 'locked';
    const card = el('article', `process-card${active ? ' active' : ''}${kind === 'prep' || kind === 'locked' ? ' unavailable' : ''}`);
    const top = el('div', 'process-top');
    top.append(el('span', 'process-num', `0${i + 1}`), el('span', 'process-name', s.name), chip(...SECTION_CHIP[kind]));
    // 이해도: 마지막 결과가 있으면 점수 색으로, 없으면 —. 응시 중이면 확정한 개념 수를 막대로 보여 준다.
    const understanding = p?.understanding ?? null;
    const mid = el('div', 'process-mid'), score = el('span', 'process-score', understanding == null ? '—' : pct(understanding));
    score.style.color = understanding == null ? 'var(--dim)' : `var(--${scoreTone(understanding)})`;
    mid.append(score, el('span', 'process-sub', s.checkpoint ? `${s.concept_count}개 개념 · 자신의 말로 답하기` : '평가 기준을 준비하고 있어요'));
    const bar = el('div', 'bar'), fill = el('span');
    if (understanding != null) { fill.style.width = pct(understanding); fill.style.background = `var(--${scoreTone(understanding)})`; }
    else if (kind === 'progress' && p.in_progress?.total) { fill.style.width = pct(p.in_progress.done / p.in_progress.total); fill.style.background = 'var(--send)'; }
    bar.append(fill);
    const meta = kind === 'prep' ? '시험이 열리면 바로 응시할 수 있어요'
      : kind === 'pass' ? '통과 · 결과를 다시 볼 수 있어요'
      : kind === 'progress' ? `${p.in_progress?.done ?? 0} / ${p.in_progress?.total ?? s.concept_count} 개념 확정 · 이어서 응시해요`
      : kind === 'locked' ? '앞 공정을 통과하면 열려요'
      : p?.retry_concept_ids?.length ? `${p.retry_concept_ids.length}개 개념만 다시 물어봐요` : '아직 응시 전이에요';
    const label = !s.checkpoint ? '시험 준비 중' : p?.unlocked ? '결과 보기' : p?.in_progress_attempt_id ? '이어서 응시' : '시험 응시';
    const action = button(label, async () => {
      notice();
      try {
        if (p?.in_progress_attempt_id) {
          await openAttempt(p.in_progress_attempt_id);
          if (state.view.state === 'paused') await send('resume');
        } else if (p?.unlocked) {
          if (s.last_attempt_id) return await openAttempt(s.last_attempt_id);
          const events = (await api.request('GET', '/api/me/exam-history')).events;
          const event = events.find((e) => e.view.section === s.section && e.view.state === 'completed');
          if (event) await openAttempt(event.attempt_id); else notice('이전에 통과한 시험이에요. 자세한 기록은 학습 기록에서 확인해 주세요.');
        } else await dispatch('/api/exams', { section: s.section });
      } catch (error) { notice(copyError(error)); }
    }, kind === 'open' || kind === 'progress' ? 'btn' : 'btn secondary');
    action.disabled = !s.checkpoint || (!p?.open && !p?.unlocked) || state.pending;
    card.append(top, mid, bar, el('p', 'micro', meta), action);
    return card;
  }));
}
async function openAttempt(id) {
  state.view = await api.request('GET', `/api/exams/${id}`);
  state.draft = read(`draft:${id}`) || '';
  save('attempt', id);
  renderExam(); renderSections();
}
/** 이번 차례의 튜터 발화: 마지막 사용자 메시지 뒤의 발화. 대화 기록이 없으면 이번 응답의 발화(tutor). */
function currentTurn(view) {
  const history = view.history || [];
  const lastUser = history.findLastIndex((m) => m.role === 'user');
  return history.length ? history.slice(lastUser + 1).filter((m) => m.role === 'tutor') : view.tutor || [];
}
/**
 * 말풍선과 포석호 동작을 정한다. lines는 말풍선 줄(반응 · 핵심 정리 · 질문), motion은 마지막 발화의 동작,
 * reaction은 먼저 잠깐 보여 줄 반응 동작, sfx는 새 발화일 때 한 번 낼 효과음, key는 같은 발화를 다시 그렸는지 알기 위한 키.
 */
function speechFor(view) {
  if (!view) return { lines: [{ text: IDLE_BUBBLE, cls: 'main' }], motion: 'idle', key: 'idle' };
  const turn = currentTurn(view);
  const last = (types) => turn.findLast((m) => types.includes(m.type)) ?? null;
  const unlocked = !!view.result?.unlocked;
  const stamp = (lines) => [view.attempt_id, view.state, (view.history || view.tutor || []).length, ...lines.map((l) => l.text)].join('\u0001');
  if (view.state === 'completed') {
    const lines = [{ text: last(['result'])?.text || (unlocked ? '통과했어요! 다음 공정으로 나아가세요.' : '아직 기준에 못 미쳤어요. 복습한 뒤 다시 도전해요.'), cls: 'main' }];
    return { lines, motion: motionFor('result', { unlocked }), sfx: sfxFor('result', { unlocked }), key: stamp(lines), tone: unlocked ? 'ok' : null, tag: unlocked ? '통과' : '다시 도전' };
  }
  if (view.state === 'paused') { const lines = [{ text: '잠시 멈춘 시험이에요. 준비되면 이어서 진행해요.', cls: 'main' }]; return { lines, motion: 'idle', key: stamp(lines) }; }
  const reaction = last(REACTIONS), keyPoints = last(['key_points']), prompt = last(PROMPTS);
  const lines = [];
  if (reaction) lines.push({ text: reaction.text, cls: 'react' });
  if (keyPoints) lines.push({ text: keyPoints.text, cls: 'react' });
  lines.push({ text: prompt?.text || (view.state === 'error' ? '채점을 완료하지 못했어요. 입력한 답안을 다시 평가해 주세요.' : view.state === 'awaiting_ready' ? '준비됐으면 시작해 볼까요?' : '문제에 답해 주세요.'), cls: 'main' });
  const lastType = turn.at(-1)?.type ?? (view.state === 'error' ? 'error' : null);
  const motion = lastType ? motionFor(lastType, { unlocked }) : 'idle';
  const reactionType = reaction?.type ?? keyPoints?.type ?? null;
  const reactionMotion = reactionType ? motionFor(reactionType, { unlocked }) : null;
  const isError = prompt?.type === 'error' || view.state === 'error', isRecheck = prompt?.type === 'recheck_question';
  return { lines, motion, reaction: reactionMotion && reactionMotion !== motion ? reactionMotion : null, sfx: reactionType ? sfxFor(reactionType, { unlocked }) : null, key: stamp(lines),
    tone: isError ? 'bad' : isRecheck ? 'mid' : null, tag: isError ? '채점 오류' : isRecheck ? '추가 확인 질문' : null };
}
function setMotion(motion) { stage.motion = motion; stage.el?.setAttribute('motion', motion); }
/**
 * 말풍선을 채우고 포석호 동작을 바꾼다. 새 발화면 말풍선을 다시 채우고(마지막 줄은 한 글자씩) 효과음 한 번 + 반응 동작을 먼저 보여 준다.
 * 같은 발화를 다시 그리면(다른 부분의 재렌더) 말풍선은 그대로 두고 동작만 맞춘다.
 */
function renderStage(speech) {
  if (speech.key !== stage.key) {
    // 페이지를 막 열어 복원한 발화는 이미 본 것이라 효과음·반응·타자 효과를 되풀이하지 않는다.
    const restored = stage.key === null;
    stage.key = speech.key; clearTimeout(stage.timer); stage.timer = 0;
    $('bubble-label').dataset.tone = speech.tone || '';
    const tag = $('bubble-tag'); tag.hidden = !speech.tag; tag.textContent = speech.tag || '';
    finishTyping();
    $('bubble-lines').replaceChildren(...speech.lines.map((line) => el('p', line.cls, line.text)));
    $('bubble-live').textContent = speech.lines.map((line) => line.text).join(' ');
    if (!restored && !stage.reduced.matches) typeLastLine();
    if (!restored && speech.sfx) playSfx(speech.sfx);
    if (!restored && speech.reaction) {
      setMotion(speech.reaction);
      stage.timer = setTimeout(() => { stage.timer = 0; setMotion(speech.motion); }, REACTION_MS);
      return;
    }
  }
  if (!stage.timer) setMotion(speech.motion);
}
/** 말풍선 마지막 줄(질문)을 한 글자씩 적는다. 30ms마다 한 글자, 긴 글은 여러 글자씩 적어 2.4초 안에 끝난다. 다음 발화가 오면 finishTyping으로 멈춘다. */
function typeLastLine() {
  const node = $('bubble-lines').lastElementChild;
  if (!node || !node.textContent) return;
  const full = node.textContent, step = Math.max(1, Math.ceil(full.length / 80));
  let shown = 0;
  node.textContent = ''; node.classList.add('typing');
  stage.typing = { node, full };
  stage.typer = setInterval(() => {
    shown = Math.min(full.length, shown + step); node.textContent = full.slice(0, shown);
    if (shown >= full.length) finishTyping();
  }, 30);
}
/** 적던 글을 끝까지 채우고 타자 효과를 멈춘다. */
function finishTyping() {
  clearInterval(stage.typer); stage.typer = 0;
  if (stage.typing) { stage.typing.node.textContent = stage.typing.full; stage.typing.node.classList.remove('typing'); stage.typing = null; }
}
function sizeCharacter() { if (!stage.el) return; const small = stage.mobile.matches; stage.el.style.width = small ? '150px' : '200px'; stage.el.style.height = small ? '170px' : '230px'; }
/** cp-character 모듈을 한 번 불러와 포석호를 한 개 만든다. 못 불러오면 말풍선만 쓴다. */
async function mountCharacter() {
  try { await import('/3d-demo/cp-character.js'); } catch (error) { console.warn('포석호 모듈을 불러오지 못했어요.', error); return; }
  if (stage.el) return;
  const node = document.createElement('cp-character');
  node.setAttribute('model', '/3d-demo/models/character/tutor.glb');
  node.setAttribute('motion', stage.motion);
  node.setAttribute('aria-label', '튜터 포석호');
  stage.el = node; sizeCharacter();
  $('stage-char').append(node);
}
function renderSfx() { const node = $('sfx'); node.hidden = !sfxSupported(); node.textContent = sfxOn() ? '🔊 효과음 켜짐' : '🔈 효과음 꺼짐'; node.setAttribute('aria-pressed', String(sfxOn())); }
function renderExam() {
  const view = state.view;
  const name = view ? (state.sections.find((s) => s.section === view.section)?.name || '제선') : '';
  $('exam-title').textContent = view ? `${name} 평가 시험` : '응시할 공정을 고르세요';
  $('exam-sub').textContent = !view ? '문제 준비부터 답안 평가, 결과 확인까지 이 화면에서 이어서 진행해요.'
    : view.state === 'completed' ? '개념별 결과와 전체 이해도를 확인해요.'
    : view.state === 'awaiting_recheck' ? '다른 각도의 질문으로 한 번 더 확인해요.'
    : view.state === 'paused' ? '잠시 멈춘 시험이에요. 이어서 진행할 수 있어요.'
    : view.state === 'error' ? '채점을 완료하지 못했어요. 같은 답안을 다시 평가해요.'
    : view.state === 'awaiting_ready' ? '준비됐으면 시작 버튼을 눌러요.' : '포석호의 질문에 자신의 말로 답해요.';
  const dots = $('exam-dots'); dots.hidden = !view?.progress?.length;
  dots.replaceChildren(...(view?.progress || []).map((p) => el('span', p.status)));
  const phase = !view ? null : view.state === 'completed' ? ['평가 완료', 'ok'] : view.state === 'awaiting_recheck' ? ['추가 확인', 'mid'] : view.state === 'paused' ? ['일시 중지', 'dim']
    : view.state === 'error' ? ['재평가 필요', 'bad'] : view.state === 'awaiting_ready' ? ['응시 준비', 'text'] : [`${view.concept?.index || 1} / ${view.concept?.total || 1} 개념`, 'text'];
  const stageChip = $('exam-stage'); stageChip.hidden = !phase;
  if (phase) { stageChip.textContent = phase[0]; stageChip.dataset.tone = phase[1]; }
  renderStage(speechFor(view));
  const root = $('exam-body'); root.replaceChildren();
  if (!view) return;
  if (view.state === 'completed') {
    renderResult(root, view.result);
  } else {
    for (const message of currentTurn(view).filter((m) => m.type === 'explanation')) {
      const block = el('div', 'explanation'); block.append(el('span', 'label', '포석호의 설명'), document.createTextNode(message.text)); root.append(block);
    }
    const actions = el('div', 'actions');
    if (view.state === 'awaiting_ready') actions.append(button('시험 시작하기 →', () => send('answer', '준비됐어요.')));
    else if (view.state === 'paused') actions.append(button('시험 이어서 진행 →', () => send('resume')));
    else if (view.state === 'error') actions.append(button('같은 답안 다시 평가', () => send('retry-evaluation')));
    else if (['awaiting_answer', 'awaiting_recheck'].includes(view.state)) {
      const form = el('form', 'answer-form'), label = el('label', '', '나의 답안'); label.htmlFor = 'answer';
      const area = el('textarea'); area.id = 'answer'; area.maxLength = 1000; area.rows = 5; area.value = state.draft;
      area.placeholder = '공정과 물질의 역할을 생각하며 자신의 말로 설명해 주세요.';
      const bottom = el('div', 'form-bottom'), counter = el('span', 'micro', `${area.value.length} / 1000`), submit = button('답안 제출 →', () => {});
      submit.type = 'submit'; submit.disabled = !area.value.trim();
      area.addEventListener('input', () => { state.draft = area.value; save(`draft:${view.attempt_id}`, area.value); counter.textContent = `${area.value.length} / 1000`; submit.disabled = !area.value.trim(); });
      form.addEventListener('submit', (event) => { event.preventDefault(); if (area.value.trim()) void send('answer', area.value.trim()); });
      bottom.append(counter, submit); form.append(label, area, bottom); root.append(form);
    }
    if (actions.childElementCount) root.append(actions);
    if (ANSWERING.includes(view.state)) {
      const tools = el('div', 'exam-tools'); tools.append(button('잠시 멈추고 학습하기', () => leave('/login'), 'btn ghost')); root.append(tools);
    }
  }
  if (view.history?.length) {
    const details = el('details', 'transcript'); details.append(el('summary', '', '이번 시험의 전체 대화 보기'));
    for (const m of view.history) { const line = el('p', 'transcript-line'); line.append(el('b', '', m.role === 'user' ? '나의 답안' : '포석호'), document.createTextNode(m.text)); details.append(line); }
    root.append(details);
  }
}
/** 결과: 전체 이해도 게이지(통과 기준선) + 개념별 가로 막대(맞음 ok · 부분 mid · 틀림 bad). 숫자는 서버가 코드로 계산한 값이다. */
function renderResult(root, result) {
  const score = Math.round(result.understanding * 100), threshold = Math.round((result.threshold ?? 0.8) * 100);
  const tone = result.unlocked ? 'ok' : scoreTone(result.understanding);
  const wrap = el('div', 'result');
  const top = el('div', 'gauge-top'), number = el('span', 'gauge-num score-number', String(score)); number.append(el('small', '', '%')); number.style.color = `var(--${tone})`;
  top.append(number, chip(result.unlocked ? '통과' : '다시 도전', result.unlocked ? 'ok' : 'mid'), el('span', 'gauge-sub', `전체 이해도 · 통과 기준 ${threshold}%`));
  const gauge = el('div', 'gauge'); gauge.setAttribute('role', 'img'); gauge.setAttribute('aria-label', `전체 이해도 ${score}%, 통과 기준 ${threshold}%`);
  const fill = el('span', 'gauge-fill'); fill.style.width = `${score}%`; fill.style.background = `var(--${tone})`;
  const mark = el('span', 'gauge-mark'); mark.style.left = `${threshold}%`; mark.append(el('b', '', `기준 ${threshold}%`));
  gauge.append(fill, mark);
  const title = el('div', 'result-title');
  title.append(el('p', 'h2', result.unlocked ? '평가를 통과했어요' : '아직 통과 기준에 못 미쳤어요'), el('p', 'muted', result.unlocked ? '개념을 확인했어요. 다음 공정으로 나아가세요.' : '아직 어려운 개념을 복습한 뒤 다시 도전해 보세요.'));
  const list = el('ul', 'concepts');
  for (const concept of result.concepts) {
    const [verdict, color] = concept.score === 1 ? ['맞음', 'ok'] : concept.score === 0.5 ? ['부분', 'mid'] : ['틀림', 'bad'];
    const row = el('li', 'concept-result'), bar = el('span', 'cbar'), barFill = el('span');
    bar.style.background = `color-mix(in srgb, var(--${color}) 18%, transparent)`; barFill.style.width = `${concept.score * 100}%`; barFill.style.background = `var(--${color})`; bar.append(barFill);
    const label = el('span', 'verdict', verdict); label.style.color = `var(--${color})`;
    row.append(el('span', 'concept-name', concept.name), bar, label); list.append(row);
  }
  const legend = el('div', 'legend');
  for (const [text, color] of [['맞음', 'ok'], ['부분', 'mid'], ['틀림', 'bad']]) { const item = el('span'), dot = el('i'); dot.style.background = `var(--${color})`; item.append(dot, text); legend.append(item); }
  const tools = el('div', 'exam-tools'); tools.append(button('학습 기록으로 돌아가기', () => leave('/login')));
  if (!result.unlocked) tools.append(button('부족한 개념 다시 응시', () => dispatch('/api/exams', { section: state.view.section }), 'btn secondary'));
  wrap.append(top, gauge, title, list, legend, tools); root.append(wrap);
}
async function dispatch(path, body, existing) {
  if (state.pending && !existing) return;
  notice();
  const submission = existing || { path, body, key: crypto.randomUUID(), started: Date.now() };
  state.submission = submission; save('submission', submission); loading(true); renderSections();
  try {
    const job = await api.request('POST', path, body, { idempotencyKey: submission.key });
    save('job', job.id); save('submission', null); loading(true, job);
    await watch(job.id);
  } catch (error) {
    if (error.status === 0) {
      $('forge-phase').textContent = '네트워크 연결이 끊겼어요. 같은 요청을 안전하게 다시 확인할 수 있어요.';
      $('reconnect').hidden = false;
    } else { save('submission', null); loading(false); notice(copyError(error)); renderSections(); }
  }
}
async function send(action, text) {
  if (state.pending || !state.view) return;
  await dispatch(`/api/exams/${state.view.attempt_id}/commands`, { action, ...(text === undefined ? {} : { text }) });
}
async function watch(id) {
  if (state.watching) return;
  state.watching = true;
  loading(true);
  try {
    for (;;) {
      const job = await api.request('GET', `/api/exam-jobs/${id}`); loading(true, job);
      if (job.state === 'succeeded') {
        save('job', null); loading(false); state.draft = ''; save(`draft:${job.result.attempt_id}`, null);
        await openAttempt(job.result.attempt_id); await refreshSections(); await refreshAside(); break;
      }
      if (job.state === 'failed' || job.state === 'cancelled') {
        save('job', null); loading(false); notice(job.state === 'cancelled' ? '요청을 취소했어요. 입력한 답안은 그대로 남아 있어요.' : copyError(job.error));
        if (state.view?.attempt_id) await openAttempt(state.view.attempt_id);
        await refreshSections(); break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    if (error.status === 401) { loading(false); notice('로그인이 만료됐어요. 다시 로그인해 주세요.'); }
    else { $('forge-phase').textContent = '서버 연결을 확인해 주세요. 처리 기록은 남아 있어요.'; $('reconnect').hidden = false; }
  } finally { state.watching = false; }
}
async function cancel() {
  if (!state.activeJob) return;
  try { await api.request('DELETE', `/api/exam-jobs/${state.activeJob.id}`); }
  catch (error) { $('forge-phase').textContent = copyError(error); $('reconnect').hidden = false; }
}
async function refreshAside() {
  const results = await Promise.allSettled([api.request('GET', '/api/me/reviews'), api.request('GET', '/api/me/assignments'), api.request('GET', '/api/me/exam-history')]);
  const [reviews, assignments, history] = results.map((r) => r.status === 'fulfilled' ? r.value : null);
  if (reviews) {
    const tasks = reviews.tasks.filter((t) => !t.completed), count = $('review-count');
    count.hidden = false; count.textContent = String(tasks.length); count.dataset.tone = tasks.length ? 'mid' : '';
    $('reviews').replaceChildren(...(tasks.length ? tasks.slice(0, 5).map((task) => {
      const item = el('div', 'item');
      item.append(el('strong', '', task.concept_name), el('span', 'micro', `${task.due ? '오늘 복습' : task.due_date} · ${task.reason}`), button('복습 완료', async () => {
        try { await api.request('POST', `/api/me/reviews/${task.id}/complete`, {}); await refreshAside(); } catch (error) { notice(copyError(error)); }
      }, 'btn pill'));
      return item;
    }) : [el('p', 'muted', '평가를 마치면 1·3·7일 기준으로 복습 일정을 정해요.')]));
  }
  if (assignments) $('assignments').replaceChildren(...(assignments.assignments.length ? assignments.assignments.slice(0, 5).map((a) => {
    const item = el('div', 'item'), row = el('div', 'item-row');
    row.append(el('strong', '', a.title), a.status === 'completed' ? chip('완료', 'ok') : a.status === 'overdue' ? chip('마감 지남', 'bad') : chip('응시 대기', 'mid'));
    item.append(row, el('span', 'micro', `${a.group_name} · ${a.due_date}까지`)); return item;
  }) : [el('p', 'muted', '아직 배정된 시험이 없어요.')]));
  if (history) {
    const seen = new Set(), completed = history.events.filter((e) => { if (e.view.state !== 'completed' || seen.has(e.attempt_id)) return false; seen.add(e.attempt_id); return true; });
    $('history').replaceChildren(...(completed.length ? completed.slice(0, 4).map((event) => {
      const item = el('div', 'item'), row = el('div', 'item-row'), name = state.sections.find((s) => s.section === event.view.section)?.name || event.view.section;
      const understanding = event.view.result.understanding;
      const score = el('span', '', pct(understanding)); score.style.cssText = `font-family:var(--font-en);font-weight:800;color:var(--${event.view.result.unlocked ? 'ok' : scoreTone(understanding)})`;
      row.append(el('strong', '', name), score);
      item.append(row, el('span', 'micro', `${new Date(event.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} · ${event.view.result.unlocked ? '통과' : '다시 도전'}`), button('결과 보기', () => openAttempt(event.attempt_id), 'btn pill'));
      return item;
    }) : [el('p', 'muted', '완료한 시험의 기준과 결과를 함께 기록해요.')]));
  }
}
async function leave(url) {
  if (state.pending) return notice('처리 중인 요청을 먼저 취소해 주세요.');
  if (state.view && ANSWERING.includes(state.view.state)) {
    try { await api.request('POST', `/api/exams/${state.view.attempt_id}/pause`, {}); } catch (error) { return notice(copyError(error)); }
  }
  location.assign(url);
}
// 테마: 사용자가 고른 값(st-rookie-theme) → 시스템 설정. 학습 기록과 같은 규칙이다.
const THEME_KEY = 'st-rookie-theme';
const savedTheme = () => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; } };
const lightQuery = matchMedia('(prefers-color-scheme: light)');
const systemTheme = () => (lightQuery.matches ? 'light' : 'dark');
function theme(value, persist = false) {
  document.body.dataset.theme = value; $('theme').textContent = value === 'dark' ? '☀' : '☾';
  if (persist) { try { localStorage.setItem(THEME_KEY, value); } catch {} }
}
$('theme').addEventListener('click', () => theme(document.body.dataset.theme === 'dark' ? 'light' : 'dark', true));
lightQuery.addEventListener('change', () => { if (!savedTheme()) theme(systemTheme()); });
stage.mobile.addEventListener('change', sizeCharacter);
$('sfx').addEventListener('click', () => { setSfxOn(!sfxOn()); renderSfx(); });
document.querySelectorAll('[data-leave]').forEach((node) => node.addEventListener('click', (event) => { event.preventDefault(); void leave(node.getAttribute('href')); }));
$('cancel-job').addEventListener('click', cancel);
$('forge').addEventListener('cancel', (event) => { event.preventDefault(); void cancel(); });
$('reconnect').addEventListener('click', () => {
  $('reconnect').hidden = true;
  const id = read('job'), submission = read('submission');
  if (id) void watch(id); else if (submission) void dispatch(submission.path, submission.body, submission); else loading(false);
});
$('logout').addEventListener('click', async () => {
  if (state.pending) return notice('처리 중인 요청을 먼저 취소해 주세요.');
  if (state.view && ANSWERING.includes(state.view.state)) {
    try { await api.request('POST', `/api/exams/${state.view.attempt_id}/pause`, {}); } catch (error) { return notice(copyError(error)); }
  }
  localStorage.removeItem('st-rookie-token'); sessionStorage.removeItem('st-rookie-token'); location.assign('/login_ui/home-sleek.html');
});
async function boot() {
  // 공정 선택 화면(포석호 idle · 안내 말풍선)은 HTML에 그대로 있어 처음에는 다시 그리지 않는다. 복원한 시도는 renderStage가 첫 발화로 보고 효과음을 내지 않는다.
  theme(savedTheme() || systemTheme()); renderSfx();
  if (!api.hasToken()) return location.replace('/login_ui/home-sleek.html?next=exam');
  void mountCharacter();
  try {
    state.user = (await api.request('GET', '/api/auth/me')).user; $('profile').textContent = `${state.user.name} · ${state.user.employee_no}`;
    await refreshSections(); $('where').dataset.tone = 'ok'; await refreshAside();
    const jobId = read('job'), submission = read('submission'), attempt = read('attempt');
    if (attempt) { try { await openAttempt(attempt); } catch { save('attempt', null); } }
    if (jobId) await watch(jobId); else if (submission) await dispatch(submission.path, submission.body, submission);
  } catch (error) {
    $('where').dataset.tone = 'bad';
    if (error.status === 401) location.replace('/login_ui/home-sleek.html?next=exam'); else notice(copyError(error));
  }
}
void boot();
