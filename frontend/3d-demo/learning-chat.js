// 학습 모드 채팅(최종 페이지 Steel Academy v2.dc.html 전용).
// 페이지 컴포넌트에서 코드만 옮겼다. 동작은 옮기기 전과 같다.
// - 페이지 컴포넌트(c)의 state·setState와 data, chatRef, scene(), goProcess(), scrollChat()을 그대로 쓴다.
// - 상태(messages, input, pending, lastReq, lastRes, lastResults)는 페이지 컴포넌트 state에 그대로 둔다.
// - 튜터는 학습 모드 API(POST /api/chat, docs/learning-mode.md)다. 응답은 템플릿이 그리는 메시지 형식(mode, evidence, citations, followUp)으로 바꿔 넣는다.
// - 사용자 구분: 로그인 화면(/login)이 저장한 토큰(st-rookie-token)이 있으면 Authorization: Bearer로 보낸다.
//   [임시] 토큰이 없으면 체크포인트 테스트 페이지와 같이 주소의 ?user=이름 → X-User-Id를 보낸다.
// - 접속 비밀번호(TEST_PASSCODE)는 이 페이지에 입력 화면이 없어서 체크포인트 테스트 페이지가 저장한 값을 쓴다. 없거나 틀리면 401 안내를 보여 준다.
// - 추천 질문은 learning-suggestions.js에서 화면(공정·설비)에 맞게 고르고, 정해 둔 것이 없으면 data_v2.js의 SUGGESTED를 쓴다.
// - 보충학습(docs/supplementary-learning.md): 오개념이 있는 개념을 추천 질문 앞에 '보충학습 · 개념' 칩으로 보여 준다.
//   누르면 설명과 확인 문제가 같은 채팅에 나오고, 진행 중에는 입력창에 쓴 말을 확인 문제의 답으로 보낸다(칩은 '보충학습 그만하기').
//   페이지 템플릿은 고치지 않는다(메시지·칩·입력창 값만 바꾼다). 상태는 컴포넌트 state의 supplement·supplementCandidates.
// - 포석호(튜터 캐릭터, cp-character.js): vals()의 tutorMotion이 동작 이름표다(tutorMotionFor). 답을 기다리면 thinking, 글자가 오는 중이면 explain,
//   보충학습 반응·결과는 checkpoint-chat.js의 motionFor(발화 type → 동작)로 고르고 다음 질문·답을 보낼 때까지 유지한다(state.tutorReaction).
//   효과음은 tutor-sfx.js. 반응·결과가 올 때 한 번만 낸다(그리는 중에는 내지 않는다). 상태 키는 tutor로 시작한다.

import { suggestionsFor } from './learning-suggestions.js';
import { motionFor } from './checkpoint-chat.js';
import * as tutorSfx from './tutor-sfx.js';

const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
const PASS_KEY = 'st-rookie:passcode';
const TOKEN_KEY = 'st-rookie-token';

// 로그인 상태 유지면 localStorage, 아니면 sessionStorage에 있다(frontend/login_ui).
const tokenStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} },
};

/** 답을 기다리는 동안 보여 줄 문구. 경과 시간을 초로 보여 주고, 오래 걸리면 기다려 달라고 덧붙인다. */
export function pendingText(since, now = Date.now()) {
  const sec = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  if (sec < 3) return '튜터가 답을 쓰고 있어요…';
  if (sec < 20) return `튜터가 답을 쓰고 있어요… ${sec}초`;
  return `튜터가 답을 쓰고 있어요… ${sec}초 · 자료를 살펴보는 중이라 조금 더 걸려요`;
}

/**
 * 튜터가 보낸 화면 조작(scene_actions)을 차례로 실행하고 결과를 돌려준다. c는 페이지 컴포넌트(state, data, goProcess, setState, scene).
 * - 공정을 옮기면 3D(steel-scene)가 그 공정을 띄울 때까지 기다린다. 전체 화면에서 바로 설비로 가면 아직 설비를 못 찾아 실패했다.
 *   3D 장면(<steel-scene>)만 기다린다. 2D 화면(마이페이지의 2D 공정도)은 기다리지 않는다.
 * - focus는 설비를 찾을 때까지 잠깐 다시 시도한다.
 */
export async function runSceneActions(c, actions, { wait = (ms) => new Promise(r => setTimeout(r, ms)), timeoutMs = 4000, stepMs = 100 } = {}) {
  const until = async (ok) => { for (let t = 0; ; t += stepMs) { if (ok()) return true; if (t >= timeoutMs) return false; await wait(stepMs); } };
  const results = [];
  for (const a of actions || []) {
    let ok = false;
    try {
      if (a.type === 'goto_process') {
        ok = !!c.data.findProcess(a.target_id);
        if (ok) {
          c.goProcess(a.target_id);
          await wait(150);
          await until(() => { const sc = c.scene?.(); return sc?.localName !== 'steel-scene' || sc.process?.id === a.target_id; });
        }
      }
      else if (a.type === 'highlight') { ok = !!c.data.findEquipment(c.state.processId, a.target_id); if (ok) c.setState({ selectedId: a.target_id }); }
      else if (a.type === 'focus') { ok = await until(() => !!c.scene?.()?.focus(a.target_id)); }
      else if (a.type === 'play_animation') { ok = !!c.scene?.()?.play(c.state.speed); }
      // 설비 작동 보기(3D walk). walk는 투어가 끝날 때 끝나는 Promise를 돌려주므로 기다리지 않고 시작됐는지만 본다. 2D 화면에는 walk가 없어 실패.
      else if (a.type === 'show_operation') {
        if (typeof c.scene?.()?.walk === 'function') ok = await until(() => c.scene()?.walk(a.target_id, c.state.speed) !== false);
      }
    } catch (e) { ok = false; }
    results.push({ type: a.type, target_id: a.target_id, status: ok ? 'succeeded' : 'failed' });
  }
  return results;
}

/** 401 응답을 학습자가 할 일로 바꿔 말한다. */
function unauthorizedMessage(data) {
  if (data.code === 'PASSCODE_REQUIRED') return '접속 비밀번호가 필요해요. 체크포인트 테스트 페이지(/checkpoint-test.html)에서 비밀번호를 입력한 뒤 다시 질문해 주세요.';
  if (data.code === 'TOKEN_INVALID') { tokenStore.clear(); return '로그인이 만료됐어요. /login 에서 다시 로그인한 뒤 질문해 주세요.'; }
  return data.error || '로그인이 필요해요. /login 에서 로그인해 주세요.';
}

/**
 * JSON 요청. 성공하면 응답 본문, 실패하면 서버가 준 문장(없으면 기본 문장)을 담은 Error(err.status, err.data).
 * api-client.js의 request(method, path, body)와 같은 모양이라, 그쪽으로 바꿀 때 이 함수만 바꾸면 된다.
 * onPartial: 서버가 스트리밍(NDJSON)으로 답하면 받는 대로 부른다(postChat).
 */
async function request(method, path, body, onPartial) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const user = (new URLSearchParams(location.search).get('user') || '').trim();
  if (!token && user) headers['X-User-Id'] = encodeURIComponent(user);
  let passcode = '';
  try { passcode = localStorage.getItem(PASS_KEY) || ''; } catch (e) {}
  if (passcode) headers['X-Test-Passcode'] = encodeURIComponent(passcode);
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new Error(OFFLINE);
  }
  if (onPartial && res.body && (res.headers.get('content-type') || '').includes('ndjson')) {
    const done = await readChatStream(res, onPartial);
    return finish(done.status, done.body);
  }
  return finish(res.status, await res.json().catch(() => ({})));
}

/**
 * 화면 표시 결과를 같은 trace id로 서버에 보낸다(POST /api/chat/trace/:id/ui). 기다리지 않고, 실패해도 화면에는 알리지 않는다.
 * trace id가 없으면(서버에 닿지 못함) 보내지 않는다.
 */
export function reportUi(traceId, report, send = request) {
  if (!traceId) return;
  const actions = (report.actions || []).slice(0, 10).map(({ type, target_id, status }) => ({ type, target_id, status }));
  send('POST', `/api/chat/trace/${encodeURIComponent(traceId)}/ui`, { ...report, actions }).catch(() => {});
}

const OFFLINE = '서버에 연결하지 못했어요. npm start로 서버를 켠 뒤 http://localhost:3000 에서 열어 주세요.';
const NO_ANSWER = '답변을 받지 못했어요. 다시 질문해 주세요.';

/** 응답 상태와 본문 → 본문 또는 Error(err.status, err.data). */
function finish(status, data) {
  if (status >= 200 && status < 300) return data;
  const err = new Error(status === 401 ? unauthorizedMessage(data) : data.error || NO_ANSWER);
  err.status = status; err.data = data; throw err;
}

/**
 * 스트리밍 응답(NDJSON, backend/src/learning/routes.ts의 stream)을 읽는다. answer 줄마다 onPartial(지금까지의 답)을 부르고,
 * 마지막 done 줄({status, body})을 돌려준다. done 없이 끊기면 Error.
 */
async function readChatStream(res, onPartial) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', done = null;
  const onLine = (line) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.type === 'answer') onPartial(msg.text);
    else if (msg.type === 'done') done = msg;
  };
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
    }
    onLine(buffer + decoder.decode());
  } catch (e) {
    throw new Error(NO_ANSWER);
  }
  if (!done) throw new Error(NO_ANSWER);
  return done;
}

/**
 * POST /api/chat. 404면 err.status = 404(서버에 없는 대화).
 * onPartial이 있으면 스트리밍으로 받아 답을 받는 대로 onPartial(지금까지의 답)을 부른다. 돌려주는 값은 같다.
 */
const postChat = (body, onPartial) => request('POST', '/api/chat', onPartial ? { ...body, stream: true } : body, onPartial);

// 새로고침해도 같은 대화를 이어 보이도록 대화 id를 탭(sessionStorage)에 둔다. 대화 내용은 서버 DB에 있다.
const SESSION_KEY = 'st-rookie:learning-session';
const sessionStore = {
  get() { try { return sessionStorage.getItem(SESSION_KEY) || null; } catch (e) { return null; } },
  set(id) { try { if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY); } catch (e) {} },
};

/** 서버 응답 → 템플릿 메시지. 출처는 자료 제목과 id로 보여 준다. */
function toMessage(res) {
  return {
    role: 'assistant', text: res.answer,
    mode: res.status === 'safety_redirect' ? 'safety_redirect' : 'free_question',
    evidence: res.status,
    citations: (res.sources || []).map(s => ({ title: s.title, document_id: s.id, url: s.url })),
    followUp: res.follow_up || null,
    keywordCard: toKeywordCard(res.keyword_card),
  };
}

/**
 * 서버의 키워드 카드(keyword_card) → 템플릿 값. 없으면 null. 용어집의 같은 말은 괄호로 붙인다(예: 일산화탄소 (CO)).
 * 카드 내용은 서버가 루브릭에서 꺼낸 것이다(backend/src/learning/keywords.ts). 새로고침으로 다시 불러온 대화에는 없다.
 */
function toKeywordCard(card) {
  if (!card || !Array.isArray(card.keywords) || !card.keywords.length) return null;
  return {
    title: card.name,
    keywords: card.keywords.map(k => ({ text: k.aliases?.length ? `${k.term} (${k.aliases.join(', ')})` : k.term })),
    hasSource: !!card.source?.title, sourceTitle: card.source?.title || '',
  };
}
// 카드가 없는 메시지에도 같은 모양을 둔다(템플릿이 m.keywordCard.title 등을 읽어도 오류가 나지 않게).
const NO_CARD = { title: '', keywords: [], hasSource: false, sourceTitle: '' };

/** 보충학습 칩은 추천 질문 앞에 이만큼만 보여 준다. */
export const MAX_SUPPLEMENT_CHIPS = 2;
export const SUPPLEMENT_STOP_CHIP = '보충학습 그만하기';

/** 보충학습 API의 말 → 채팅 메시지. 학습자의 답은 화면이 이미 넣었으므로 튜터의 말만 바꾼다. */
export function supplementMessages(view) {
  return (view?.messages || []).filter(m => m.role === 'tutor').map(m => ({
    role: 'assistant', text: m.text, mode: 'free_question', evidence: 'supplement',
    citations: (m.sources || []).map(s => ({ title: s.title, document_id: s.id, url: s.url })),
    followUp: null, keywordCard: null,
  }));
}

/** 보충학습이 답을 기다리는 중인지. */
export const supplementWaiting = (s) => !!s && (s.state === 'awaiting_answer' || s.state === 'awaiting_recheck');

/** 포석호(튜터 캐릭터) 이름. 패널 머리의 이름표에 쓴다. */
export const TUTOR_NAME = '포석호';
/** 일반 답이 끝난 뒤 explain 동작을 유지하는 시간(ms). 보충학습 시작의 greet → ask 전환에도 쓴다. */
export const TUTOR_HOLD_MS = 2500;
/** 보충학습 반응 tone → 체크포인트 발화 type. 동작(checkpoint-chat.js의 MOTION_BY_TYPE)과 효과음(tutor-sfx.js의 sfxFor)이 이 이름을 같이 쓴다. */
export const TONE_TYPE = { correct: 'feedback', almost: 'almost', miss: 'miss' };

/**
 * 포석호 반응(페이지 state의 tutorReaction) → 체크포인트 발화 type. 동작은 motionFor(type), 효과음은 sfxFor(type)로 고른다.
 * 반응 모양: { kind: 'reaction', tone } | { kind: 'result', outcome } | { kind: 'intro' } | { kind: 'question', recheck } | { kind: 'explanation' } | { kind: 'error' }.
 * then 키가 있으면(다음 반응 또는 null) TUTOR_HOLD_MS 뒤에 그 반응으로 바뀐다(explain → idle, greet → ask).
 */
export function reactionType(reaction) {
  if (!reaction) return null;
  switch (reaction.kind) {
    case 'result': return reaction.outcome ? 'result' : null;
    case 'reaction': return TONE_TYPE[reaction.tone] ?? null;
    case 'question': return reaction.recheck ? 'recheck_question' : 'question';
    case 'intro': case 'explanation': case 'error': return reaction.kind;
    default: return null;
  }
}
/** 결과 반응이 통과(해결)인지. motionFor·sfxFor의 unlocked에 넘긴다. */
const reactionUnlocked = (reaction) => reaction?.kind === 'result' && reaction.outcome === 'resolved';

/**
 * 포석호 동작 이름표(cp-character.js의 MOTIONS). 순수 함수.
 * - 답을 기다리는 중(pending)이고 글자가 아직 안 왔으면 thinking, 스트리밍으로 글자가 오는 중(partial)이면 explain.
 * - 그다음은 마지막 반응(reaction, 다음 질문·답을 보낼 때까지 유지): 보충학습 반응 tone correct → praise, almost → encourage, miss → sorry,
 *   끝난 결과 outcome resolved → celebrate, not_resolved → cheer_retry, 보충학습 시작(intro) → greet, 확인 문제 → ask(다시 묻기면 ask_again),
 *   일반 답이 끝남(explanation) → explain, 오류 → sorry.
 * - 그 밖에는 idle.
 */
export function tutorMotionFor({ pending = false, partial = '', reaction = null } = {}) {
  if (pending) return partial ? 'explain' : 'thinking';
  const type = reactionType(reaction);
  return type ? motionFor(type, { unlocked: reactionUnlocked(reaction) }) : 'idle';
}

/** 반응의 효과음 이름(tutor-sfx.js). 보충학습 반응(tone)·끝(outcome)에만 있고, 나머지는 null. */
export function reactionSfx(reaction) {
  if (!reaction || (reaction.kind !== 'reaction' && reaction.kind !== 'result')) return null;
  return tutorSfx.sfxFor(reactionType(reaction), { unlocked: reactionUnlocked(reaction) });
}

/**
 * 보충학습 응답(view) → 포석호 반응. 끝났으면 결과(outcome), 반응 말(reaction의 tone)이 있으면 그 반응,
 * 시작(intro)이면 greet 뒤 확인 문제(ask)로 넘어가고, 확인 문제만 있으면 question. 그만두기처럼 해당 없는 응답은 null(idle).
 */
export function supplementReaction(view) {
  if (!view) return null;
  if (view.state === 'completed' && view.outcome) return { kind: 'result', outcome: view.outcome };
  const tutor = (view.messages || []).filter(m => m.role === 'tutor');
  const reaction = tutor.find(m => m.type === 'reaction' && TONE_TYPE[m.tone]);
  if (reaction) return { kind: 'reaction', tone: reaction.tone };
  const question = supplementWaiting(view) ? { kind: 'question', recheck: view.state === 'awaiting_recheck' } : null;
  if (tutor.some(m => m.type === 'intro')) return { kind: 'intro', then: question };
  return question;
}

/**
 * 페이지 컴포넌트에 붙일 학습 채팅을 만든다. componentDidMount에서 한 번 부른다.
 * options(테스트용): sfx(tutor-sfx.js 모양: playSfx·sfxOn·setSfxOn·sfxSupported), timers(setTimeout·clearTimeout), holdMs(explain·greet 유지 시간).
 */
export async function createLearningChat(c, { sfx = tutorSfx, timers = globalThis, holdMs = TUTOR_HOLD_MS } = {}) {
  // 이어지는 대화. 서버가 대화를 DB에 저장하고 이 id로 이어 준다. 새로고침해도 탭에 남은 id로 이어 간다.
  let sessionId = sessionStore.get();
  const useSession = (id) => { sessionId = id || null; sessionStore.set(sessionId); };
  // 보충학습 후보를 마지막으로 읽은 공정. 공정이 바뀌면 다시 읽는다.
  let supplementSection = null;
  let restoredSupplement = false;
  const sectionNow = () => (SECTIONS.includes(c.state.processId) ? c.state.processId : 'ironmaking');

  // 포석호 반응(state.tutorReaction)은 질문·답을 보내는 setState에서 지우고, 답이 온 setState에서 넣는다(한 번에 그리게).
  // then이 있는 반응은 holdMs 뒤 then(없으면 idle)으로 넘어간다. 새 질문·답을 보내면 예약을 지운다.
  let reactionTimer = null;
  const clearReaction = () => { timers.clearTimeout(reactionTimer); reactionTimer = null; };
  /** 반응을 state에 넣은 뒤 부른다: then 예약, 그리고 반응·결과면 효과음을 한 번(그릴 때가 아니라 바뀌는 순간에 내서 다시 그려도 겹치지 않는다). */
  const afterReaction = (reaction) => {
    clearReaction();
    if (reaction && 'then' in reaction) reactionTimer = timers.setTimeout(() => { reactionTimer = null; c.setState({ tutorReaction: reaction.then ?? null }); }, holdMs);
    const name = reactionSfx(reaction);
    if (name) sfx.playSfx(name);
  };

  /** 보충학습 요청 공통: 기다림 표시 → 요청 → 튜터 말 추가 → 화면 조작 실행·결과 보고. 실패하면 오류 말풍선. */
  const supplementTurn = async (userText, send) => {
    if (c.state.pending) return;
    clearReaction();
    c.setState(s => ({ messages: [...s.messages, { role: 'user', text: userText }], input: '', pending: true, pendingSince: Date.now(), partial: '', tutorOpen: true, devOpen: false, tutorReaction: null })); c.scrollChat();
    const tick = setInterval(() => c.setState({ pendingTick: Date.now() }), 1000);
    let view = null, error = null;
    try { view = await send(); } catch (e) { error = e; }
    let results = [];
    if (view?.scene_actions?.length) {
      results = await runSceneActions(c, view.scene_actions);
      // 도구가 만든 조작과 화면에서 실제로 됐는지를 따로 남긴다(실패해도 보충학습은 이어 간다).
      request('POST', `/api/learning/supplements/${encodeURIComponent(view.id)}/scene-results`, { results }).catch(() => {});
    }
    clearInterval(tick);
    const added = error
      ? [{ role: 'assistant', text: error.message, mode: 'free_question', evidence: 'error', citations: [], followUp: null }]
      : supplementMessages(view);
    // 끝났거나(완료·그만둠) 서버에서 이미 끝난 보충학습이면 진행 상태를 지운다.
    const gone = error && [404, 409].includes(error.status) && error.data?.code !== 'BUSY' && error.data?.code !== 'CHECKPOINT_IN_PROGRESS';
    // 포석호: 반응(tone)·결과(outcome)·시작·확인 문제에 맞는 동작과 효과음. 오류면 아쉬운 표정.
    const reaction = error ? { kind: 'error' } : supplementReaction(view);
    c.setState(s => ({
      pending: false, pendingSince: null, partial: '', lastResults: results.length ? results : s.lastResults,
      supplement: view ? (supplementWaiting(view) ? view : null) : gone ? null : s.supplement,
      messages: [...s.messages, ...added], tutorReaction: reaction,
    })); c.scrollChat();
    afterReaction(reaction);
    if (!view || !supplementWaiting(view)) chat.refreshSupplements(true);
  };

  const chat = {
    // 현재 공정·설비를 튜터 요청용으로 만든다.
    screenContext() { return { process_id: c.state.processId, equipment_id: c.state.selectedId, learning_mode: 'free_question', learning_step: null, last_scene_action_results: c.state.lastResults }; },

    // 튜터가 보낸 화면 조작(scene_actions)을 실행하고 결과를 돌려준다.
    runActions(actions) { return runSceneActions(c, actions); },

    // 질문 → 학습 모드 API → (화면 조작) → 답변 메시지 추가.
    async ask(text) {
      text = (text || '').trim(); if (!text || c.state.pending) return;
      // 보충학습 확인 문제의 답을 기다리는 중이면 입력을 답으로 보낸다(자유 질문은 '보충학습 그만하기' 뒤에).
      if (supplementWaiting(c.state.supplement)) return chat.answerSupplement(text);
      const section = SECTIONS.includes(c.state.processId) ? c.state.processId : null; // 전체 보기('site')면 서버 기본(제선)
      const screen = { process_id: section, equipment_id: section ? c.state.selectedId : null };
      const req = { question: text, session_id: sessionId || undefined, screen };
      clearReaction();
      c.setState(s => ({ messages: [...s.messages, { role: 'user', text }], input: '', pending: true, pendingSince: Date.now(), partial: '', lastReq: req, tutorOpen: true, devOpen: false, tutorReaction: null })); c.scrollChat();
      // 답을 기다리는 동안 1초마다 다시 그려 경과 시간을 보여 준다(Gemini가 느리거나 로컬 모델이면 30초 넘게 걸릴 수 있다).
      const tick = setInterval(() => c.setState({ pendingTick: Date.now() }), 1000);
      // 답을 받는 대로 말풍선에 보여 준다(스트리밍). 끝나면 최종 답으로 바꾼다.
      // 화면 표시 시각(보낸 때부터 첫 글자·최종 답까지)은 trace로 서버에 보낸다(reportUi, docs/agent-observability.md).
      const sentAt = performance.now();
      let firstPartialMs = null;
      const onPartial = (text) => { if (firstPartialMs === null) firstPartialMs = Math.round(performance.now() - sentAt); c.setState({ partial: text }); c.scrollChat(); };
      let message, res;
      try {
        try {
          res = await postChat(req, onPartial);
        } catch (e) {
          // 서버에 없는 대화(예: DB를 지움)면 새 대화로 한 번 다시 묻는다.
          if (e.status !== 404 || !sessionId) throw e;
          useSession(null);
          res = await postChat({ ...req, session_id: undefined }, onPartial);
        }
        useSession(res.session_id);
        message = toMessage(res);
      } catch (e) {
        res = { error: e.message, status: e.status ?? null, trace_id: e.data?.trace_id ?? null };
        message = { role: 'assistant', text: e.message, mode: 'free_question', evidence: 'error', citations: [], followUp: null };
      }
      // 튜터가 보낸 화면 조작(scene_actions)을 실행한다.
      const results = await chat.runActions(res.scene_actions);
      clearInterval(tick);
      // 포석호: 답을 다 쓰면 잠깐(holdMs) 설명하는 동작 뒤 대기로, 답을 못 받았으면 아쉬운 표정.
      const reaction = message.evidence === 'error' ? { kind: 'error' } : { kind: 'explanation', then: null };
      c.setState(s => ({ pending: false, pendingSince: null, partial: '', lastRes: res, lastResults: results, messages: [...s.messages, message], tutorReaction: reaction })); c.scrollChat();
      reportUi(res.trace_id, { client_ms: Math.round(performance.now() - sentAt), first_partial_ms: firstPartialMs, error: message.evidence === 'error', actions: results });
      afterReaction(reaction);
      // 이번 질문에서 오개념이 기록됐을 수 있어 보충학습 후보를 다시 읽는다.
      chat.refreshSupplements(true);
    },

    /**
     * 보충학습 후보와 진행 중인 보충학습을 읽는다(GET /api/learning/supplements). 공정이 바뀌었거나 force면 다시 읽는다.
     * 새로고침 전에 풀던 보충학습이 있으면 그 개념과 지금 확인 문제를 한 번 다시 보여 준다.
     */
    async refreshSupplements(force = false) {
      const section = sectionNow();
      if (!force && supplementSection === section) return;
      supplementSection = section;
      let data;
      try { data = await request('GET', `/api/learning/supplements?section=${encodeURIComponent(section)}`); } catch (e) { return; }
      if (supplementSection !== section) return;
      const active = data.active || null;
      const announce = active && !restoredSupplement && !c.state.supplement;
      if (active) restoredSupplement = true;
      // 풀던 확인 문제를 다시 보여 줄 때 포석호는 묻는 동작(다시 묻기면 갸웃).
      if (announce) clearReaction();
      c.setState(s => ({
        supplementCandidates: data.candidates || [],
        supplement: active,
        messages: announce
          ? [...s.messages, { role: 'assistant', text: `풀던 보충학습이 있어요 · ${active.concept_name}\n확인 문제예요. ${active.question}`, mode: 'free_question', evidence: 'supplement', citations: [], followUp: null }]
          : s.messages,
        ...(announce ? { tutorReaction: { kind: 'question', recheck: active.state === 'awaiting_recheck' } } : {}),
      }));
      if (announce) c.scrollChat();
    },

    /** 보충학습 시작(칩). 설명·확인 문제를 받고 관련 설비를 화면에 보여 준다. */
    startSupplement(candidate) {
      const section = sectionNow();
      return supplementTurn(`'${candidate.name}' 보충학습을 할게요.`, () => request('POST', '/api/learning/supplements', {
        section, concept_id: candidate.concept_id, screen: { process_id: SECTIONS.includes(c.state.processId) ? c.state.processId : null },
      }));
    },

    /** 확인 문제에 답한다. */
    answerSupplement(text) {
      const id = c.state.supplement.id;
      return supplementTurn(text, () => request('POST', `/api/learning/supplements/${encodeURIComponent(id)}/answer`, { answer: text }));
    },

    /** 보충학습 그만하기. */
    stopSupplement() {
      const id = c.state.supplement?.id;
      if (!id) return;
      return supplementTurn(SUPPLEMENT_STOP_CHIP, () => request('POST', `/api/learning/supplements/${encodeURIComponent(id)}/stop`));
    },

    // 새로고침 전 대화를 서버에서 다시 불러와 메시지 앞에 붙인다. 화면 조작은 다시 하지 않는다.
    // 서버에 없거나 다른 사람의 대화(로그인 사용자가 바뀜 등)면 id를 지우고 새 대화로 시작한다.
    async restore() {
      if (!sessionId) return;
      const id = sessionId;
      try {
        const { turns } = await request('GET', `/api/chat/sessions/${encodeURIComponent(id)}`);
        if (sessionId !== id || !turns?.length) return;
        const restored = turns.flatMap(t => [{ role: 'user', text: t.question }, toMessage(t)]);
        c.setState(s => ({ messages: [...restored, ...s.messages] })); c.scrollChat();
      } catch (e) {
        if (e.status === 404 && sessionId === id) useSession(null);
      }
    },

    // 튜터 패널 템플릿 값: 메시지, 추천 질문(chips), 입력창, 포석호(tutor*).
    // 메시지의 키워드 카드는 hasKeywordCard·keywordCard다. 체크포인트 진행 중에는 checkpoint-chat.js의 lockLearning()이 숨긴다(정답 용어가 모여 있어서).
    vals(D) {
      const S = c.state;
      // 받는 중인 답은 마지막 말풍선으로 보여 주고, 그동안 '답을 쓰고 있어요' 표시는 숨긴다.
      const streaming = S.pending && !!S.partial;
      const shown = streaming ? [...S.messages, { role: 'assistant', text: S.partial, mode: 'free_question', evidence: 'streaming', citations: [], followUp: null }] : S.messages;
      // 공정이 바뀌면 보충학습 후보를 다시 읽는다(그리는 중에 state를 바꾸지 않게 다음 차례에).
      if (supplementSection !== sectionNow()) setTimeout(() => chat.refreshSupplements(), 0);
      const suggested = (suggestionsFor(S.processId, S.selectedId) || D.SUGGESTED.filter(t => S.selectedId || !t.startsWith('이 설비'))).map(text => ({ text, onClick: () => chat.ask(text) }));
      // 보충학습 중에는 '그만하기' 칩만, 아니면 보충학습 후보 칩을 추천 질문 앞에 둔다.
      const chips = supplementWaiting(S.supplement)
        ? [{ text: SUPPLEMENT_STOP_CHIP, onClick: () => chat.stopSupplement() }]
        : [...(S.supplementCandidates || []).slice(0, MAX_SUPPLEMENT_CHIPS).map(cand => ({ text: `보충학습 · ${cand.name}`, onClick: () => chat.startSupplement(cand) })), ...suggested];
      return {
        messages: shown.map(m => ({ ...m, isUser: m.role === 'user', isSafety: m.role === 'assistant' && m.mode === 'safety_redirect', isAssistant: m.role === 'assistant' && m.mode !== 'safety_redirect', hasFollowUp: !!m.followUp, askFollowUp: () => chat.ask(m.followUp), hasKeywordCard: !!m.keywordCard, keywordCard: m.keywordCard || NO_CARD })),
        chatRef: c.chatRef, pending: S.pending && !streaming, pendingText: pendingText(S.pendingSince), chips,
        input: S.input, onInput: e => c.setState({ input: e.target.value }), send: e => { e.preventDefault(); chat.ask(S.input); },
        // 포석호(튜터 캐릭터): 이름, 동작 이름표(<cp-character>의 motion 속성), 효과음 켜기·끄기(tutor-sfx.js). 켜면 한 번 들려준다.
        tutorName: TUTOR_NAME,
        tutorMotion: tutorMotionFor({ pending: S.pending, partial: S.partial, reaction: S.tutorReaction }),
        tutorSfxSupported: sfx.sfxSupported(), tutorSfxLabel: sfx.sfxOn() ? '🔊 효과음 켜짐' : '🔈 효과음 꺼짐',
        onToggleTutorSfx: () => { const on = !sfx.sfxOn(); sfx.setSfxOn(on); if (on) sfx.playSfx('correct', { force: true }); c.setState({ tutorSfxTick: Date.now() }); },
      };
    },
  };
  // 페이지가 뜨는 것을 막지 않도록 기다리지 않는다.
  chat.restore();
  return chat;
}
