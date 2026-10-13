// 학습 모드 채팅(최종 페이지 Steel Academy v2.dc.html 전용).
// 페이지 컴포넌트에서 코드만 옮겼다. 동작은 옮기기 전과 같다.
// - 페이지 컴포넌트(c)의 state·setState와 data, chatRef, scene(), goProcess(), scrollChat()을 그대로 쓴다.
// - 상태(messages, input, pending, lastReq, lastRes, lastResults)는 페이지 컴포넌트 state에 그대로 둔다.
// - 튜터는 학습 모드 API(POST /api/chat, docs/learning-mode.md)다. 응답은 템플릿이 그리는 메시지 형식(mode, evidence, citations, followUp)으로 바꿔 넣는다.
// - 사용자 구분: 로그인 화면(/login)이 저장한 토큰(st-rookie-token)이 있으면 Authorization: Bearer로 보낸다.
//   [임시] 토큰이 없으면 체크포인트 테스트 페이지와 같이 주소의 ?user=이름 → X-User-Id를 보낸다.
// - 접속 비밀번호(TEST_PASSCODE)는 이 페이지에 입력 화면이 없어서 체크포인트 테스트 페이지가 저장한 값을 쓴다. 없거나 틀리면 401 안내를 보여 준다.
// - 추천 질문은 learning-suggestions.js에서 화면(공정·설비)에 맞게 고르고, 정해 둔 것이 없으면 data_v2.js의 SUGGESTED를 쓴다.

import { suggestionsFor } from './learning-suggestions.js';

const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
const PASS_KEY = 'st-rookie:passcode';
const TOKEN_KEY = 'st-rookie-token';

// 로그인 상태 유지면 localStorage, 아니면 sessionStorage에 있다(frontend/login_ui).
const tokenStore = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} },
};

/** 401 응답을 학습자가 할 일로 바꿔 말한다. */
function unauthorizedMessage(data) {
  if (data.code === 'PASSCODE_REQUIRED') return '접속 비밀번호가 필요해요. 체크포인트 테스트 페이지(/checkpoint-test.html)에서 비밀번호를 입력한 뒤 다시 질문해 주세요.';
  if (data.code === 'TOKEN_INVALID') { tokenStore.clear(); return '로그인이 만료됐어요. /login 에서 다시 로그인한 뒤 질문해 주세요.'; }
  return data.error || '로그인이 필요해요. /login 에서 로그인해 주세요.';
}

/**
 * JSON 요청. 성공하면 응답 본문, 실패하면 서버가 준 문장(없으면 기본 문장)을 담은 Error(err.status, err.data).
 * api-client.js의 request(method, path, body)와 같은 모양이라, 그쪽으로 바꿀 때 이 함수만 바꾸면 된다.
 */
async function request(method, path, body) {
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
    throw new Error('서버에 연결하지 못했어요. npm start로 서버를 켠 뒤 http://localhost:3000 에서 열어 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(res.status === 401 ? unauthorizedMessage(data) : data.error || '답변을 받지 못했어요. 다시 질문해 주세요.');
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

/** POST /api/chat. 404면 err.status = 404(서버에 없는 대화). */
const postChat = (body) => request('POST', '/api/chat', body);

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

/** 페이지 컴포넌트에 붙일 학습 채팅을 만든다. componentDidMount에서 한 번 부른다. */
export async function createLearningChat(c) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // 이어지는 대화. 서버가 대화를 DB에 저장하고 이 id로 이어 준다. 새로고침해도 탭에 남은 id로 이어 간다.
  let sessionId = sessionStore.get();
  const useSession = (id) => { sessionId = id || null; sessionStore.set(sessionId); };

  const chat = {
    // 현재 공정·설비를 튜터 요청용으로 만든다.
    screenContext() { return { process_id: c.state.processId, equipment_id: c.state.selectedId, learning_mode: 'free_question', learning_step: null, last_scene_action_results: c.state.lastResults }; },

    // 튜터가 보낸 화면 조작(scene_actions)을 실행하고 결과를 돌려준다.
    async runActions(actions) {
      const results = [];
      for (const a of actions || []) {
        let ok = false;
        try {
          if (a.type === 'goto_process') { ok = !!c.data.findProcess(a.target_id); if (ok) { c.goProcess(a.target_id); await wait(150); } }
          else if (a.type === 'highlight') { ok = !!c.data.findEquipment(c.state.processId, a.target_id); if (ok) c.setState({ selectedId: a.target_id }); }
          else if (a.type === 'focus') { ok = !!c.scene()?.focus(a.target_id); }
          else if (a.type === 'play_animation') { ok = !!c.scene()?.play(c.state.speed); }
        } catch (e) { ok = false; }
        results.push({ type: a.type, target_id: a.target_id, status: ok ? 'succeeded' : 'failed' });
      }
      return results;
    },

    // 질문 → 학습 모드 API → (화면 조작) → 답변 메시지 추가.
    async ask(text) {
      text = (text || '').trim(); if (!text || c.state.pending) return;
      const section = SECTIONS.includes(c.state.processId) ? c.state.processId : null; // 전체 보기('site')면 서버 기본(제선)
      const screen = { process_id: section, equipment_id: section ? c.state.selectedId : null };
      const req = { question: text, session_id: sessionId || undefined, screen };
      c.setState(s => ({ messages: [...s.messages, { role: 'user', text }], input: '', pending: true, lastReq: req, tutorOpen: true, devOpen: false })); c.scrollChat();
      let message, res;
      try {
        try {
          res = await postChat(req);
        } catch (e) {
          // 서버에 없는 대화(예: DB를 지움)면 새 대화로 한 번 다시 묻는다.
          if (e.status !== 404 || !sessionId) throw e;
          useSession(null);
          res = await postChat({ ...req, session_id: undefined });
        }
        useSession(res.session_id);
        message = toMessage(res);
      } catch (e) {
        res = { error: e.message, status: e.status ?? null };
        message = { role: 'assistant', text: e.message, mode: 'free_question', evidence: 'error', citations: [], followUp: null };
      }
      // 학습 모드 API는 아직 화면 조작(scene_actions)을 보내지 않는다(다음 단계).
      const results = await chat.runActions(res.scene_actions);
      c.setState(s => ({ pending: false, lastRes: res, lastResults: results, messages: [...s.messages, message] })); c.scrollChat();
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

    // 튜터 패널 템플릿 값: 메시지, 추천 질문(chips), 입력창.
    // 메시지의 키워드 카드는 hasKeywordCard·keywordCard다. 체크포인트 진행 중에는 checkpoint-chat.js의 lockLearning()이 숨긴다(정답 용어가 모여 있어서).
    vals(D) {
      const S = c.state;
      return {
        messages: S.messages.map(m => ({ ...m, isUser: m.role === 'user', isSafety: m.role === 'assistant' && m.mode === 'safety_redirect', isAssistant: m.role === 'assistant' && m.mode !== 'safety_redirect', hasFollowUp: !!m.followUp, askFollowUp: () => chat.ask(m.followUp), hasKeywordCard: !!m.keywordCard, keywordCard: m.keywordCard || NO_CARD })),
        chatRef: c.chatRef, pending: S.pending, chips: (suggestionsFor(S.processId, S.selectedId) || D.SUGGESTED).map(text => ({ text, onClick: () => chat.ask(text) })),
        input: S.input, onInput: e => c.setState({ input: e.target.value }), send: e => { e.preventDefault(); chat.ask(S.input); },
      };
    },
  };
  // 페이지가 뜨는 것을 막지 않도록 기다리지 않는다.
  chat.restore();
  return chat;
}
