// 체크포인트(이해도 확인) 채팅(최종 페이지 Steel Academy v3.dc.html). 설계: docs/checkpoint-integration.md, docs/checkpoint-overlay.md
// - checkpoint-test.html의 진행 로직(진입 상태, 시작, 답변, 재채점, 새로고침 복원, 결과)을 화면 코드 없이 옮겼다.
// - learning-chat.js와 같은 방식: 페이지 컴포넌트(c)의 state·setState를 쓰고, 화면 값은 vals()로 돌려준다.
//   DOM은 쓰지 않는다. 상태 키와 vals() 키는 학습 모드와 겹치지 않게 cp로 시작한다.
// - 섹션은 현재 공정(c.state.processId)이다. 전체 보기('site')에서는 시작할 수 없다.
//   시작한 시도는 끝날 때까지 공정을 옮겨도 그대로 보여 준다(3D는 계속 볼 수 있다).
// - 답하는 중(준비·답변·재확인·채점 오류)에는 학습 입력을 막는다: lockLearning()이 학습 모드 값(learning-chat.js의 vals)에서
//   보내기·추천 질문을 끄고, runLearning()이 페이지의 ask()(설비 패널 '튜터에게 묻기', 학습 전송)를 막는다. learning-chat.js는 고치지 않는다.
//   막힌 질문은 "잠깐 멈추고 질문할까요? [멈추고 질문하기]"로 안내하고, 누르면 멈춘(pause) 뒤 그 질문을 보낸다.
// - 나중에 이어 풀기(paused): 멈춘 동안에는 학습 채팅을 쓸 수 있다. 튜터 패널에 "풀던 이해도 확인이 있어요 [이어 풀기]" 안내를 띄운다.
//   로그인·새로고침으로 시도를 다시 열 때는 오버레이를 열지 않는다(docs/checkpoint-api.md '나중에 이어 풀기').
// - 튜터 패널은 학습 전용이다(모드 탭 없음). 이해도 확인은 오버레이에서만 한다.
// - 이해도 확인 오버레이(docs/checkpoint-overlay.md): 공정 목록의 섹션별 [담금질 시작하기](sectionBadge의 cpSection* 값)로 열고,
//   3D 화면 위에 캐릭터 + 말풍선 + 입력을 보여 준다(vals()의 오버레이 값). 말풍선은 이번 응답의 튜터 발화(cpTurn)를 차례로 보여 주고,
//   캐릭터 동작은 지금 보이는 발화의 type으로 정한다(motionFor).
// - API: docs/checkpoint-api.md. 요청은 api-client.js(로그인 토큰·접속 비밀번호·오류 문장).

import { createApiClient } from './api-client.js';
import { TEXT } from './tutor-text.js';

/** 섹션 순서(backend/src/checkpoint/types.ts의 SECTION_ORDER와 같다). */
export const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];

/** true면 앞 공정을 통과하지 못한 공정 탭을 잠근다(tabLocked). 기본은 꺼짐: 체크포인트만 잠그고 탭은 배지만 보인다. */
export const LOCK_PROCESS_TABS = false;

/** 체크포인트 상태 키와 초기값. 페이지 state에 없으면 이 값으로 본다(페이지가 미리 적지 않아도 된다). */
export const CHECKPOINT_STATE = {
  cpView: null,      // 서버 CheckpointView(진행 중이거나 막 끝난 시도). null이면 진입 화면
  cpMessages: [],    // { role: 'tutor' | 'user', type, text }
  cpInput: '',
  cpPending: false,
  cpNotice: '',
  cpProgress: {},    // 섹션 → SectionProgressView | { unavailable: true, status }
  cpConfirmPause: false, // [나중에 이어 풀기]를 누른 뒤 확인창
  cpPauseOffer: false,   // 답하는 중 학습 질문을 하려 할 때 "멈추고 질문하기" 안내
  cpOverlayOpen: false,  // 이해도 확인 오버레이 표시. 로그인·새로고침 복원 때는 열지 않는다
  cpTurn: [],            // 이번 응답의 튜터 발화 { role: 'tutor', type, text }. 말풍선이 차례로 보여 준다
  cpBubbleIndex: 0,      // 말풍선이 보여 주는 cpTurn 번호
  cpShowHistory: false,  // 오버레이의 대화 기록 펼침
};

/**
 * 튜터 발화 type → 캐릭터 동작 이름표. 체크포인트 로직은 이름표만 내고 모델·클립·이미지는 모른다(cp-character.js가 해석).
 * 판정은 진행 중에 오지 않지만 엔진이 판정에 따라 내는 발화가 정해져 있다: feedback은 맞혔을 때만(backend/test/checkpoint.test.ts로 고정),
 * explanation은 첫 판정이 correct가 아닐 때, key_points는 재확인에서도 맞히지 못했을 때.
 */
export const MOTION_BY_TYPE = {
  intro: 'greet',
  question: 'ask',
  recheck_question: 'ask_again',
  feedback: 'praise',
  explanation: 'explain',
  key_points: 'encourage',
  error: 'sorry',
};

/** 발화 type의 캐릭터 동작. result는 통과(unlocked)면 celebrate, 아니면 cheer_retry. 모르는 type·발화 없음은 idle. */
export function motionFor(type, { unlocked = false } = {}) {
  if (type === 'result') return unlocked ? 'celebrate' : 'cheer_retry';
  return MOTION_BY_TYPE[type] ?? 'idle';
}

const ANSWERING = ['awaiting_ready', 'awaiting_answer', 'awaiting_recheck'];
/** 학습 채팅을 잠그는 상태(답하는 중). paused·completed는 잠그지 않는다. */
const LOCKING = [...ANSWERING, 'error'];
const VERDICT_TONE = { correct: 'ok', partial: 'warn', wrong: 'danger' };
// 페이지(v2·v3)에 --ok 변수가 없어서 기본색을 함께 준다.
const TONE_COLOR = { ok: 'var(--ok, #2f9e44)', warn: 'var(--warn, #e8590c)', danger: 'var(--danger)' };
const ACCENT = 'var(--accent)';

const percent = (ratio) => Math.round((ratio ?? 0) * 100);
const asMessages = (utterances) => utterances.map((u) => ({ role: 'tutor', type: u.type, text: u.text }));
/** 대화 기록 끝의 튜터 발화(마지막 사용자 메시지 뒤). 시도를 다시 열 때 말풍선에 보여 줄 이번 응답이다. */
function lastTurn(messages) {
  const i = messages.findLastIndex((m) => m.role === 'user');
  return messages.slice(i + 1).filter((m) => m.role !== 'user');
}

/**
 * 페이지 컴포넌트에 붙일 체크포인트 채팅을 만든다. componentDidMount에서 한 번 부르고, refreshAll()로 진입 상태를 읽는다.
 * @param c 페이지 컴포넌트: state(processId), setState, data(findProcess). 선택: scrollCheckpoint()(없으면 scrollChat()), goProcess(id), openTutor()
 * @param {{ api?: ReturnType<typeof createApiClient> }} [options]
 */
export function createCheckpointChat(c, { api = createApiClient() } = {}) {
  // 페이지 state는 이 모듈을 불러오기 전에 만들어지므로 체크포인트 키가 없을 수 있다.
  const withDefaults = (s) => ({ ...CHECKPOINT_STATE, ...s });
  const S = () => withDefaults(c.state);
  const sectionName = (id) => c.data?.findProcess?.(id)?.name ?? id;
  const scroll = () => (c.scrollCheckpoint ?? c.scrollChat)?.call(c);
  // 요청 중복을 막는 표시. setState는 바로 반영되지 않을 수 있어서 state(cpPending)와 따로 둔다.
  let busy = false;
  // 답하는 중이라 막힌 학습 질문. [멈추고 질문하기]로 멈춘 뒤 보낸다.
  let heldLearning = null;

  /** 섹션 진입 상태. 루브릭이 없는 섹션은 404(unavailable)다. */
  async function loadProgress(section) {
    let p;
    try {
      p = await api.request('GET', `/api/sections/${section}/progress`);
    } catch (e) {
      p = { unavailable: true, status: e.status ?? 0 };
    }
    c.setState((s) => ({ cpProgress: { ...withDefaults(s).cpProgress, [section]: p } }));
    return p;
  }

  /**
   * 끝나지 않은 시도가 있으면 불러 둔다(로그인·새로고침 복원). 이미 보고 있는 시도가 있으면 그대로 둔다. progresses는 loadProgress 결과.
   * 이해도 확인 탭으로 옮기지 않는다. 학습 탭에 "풀던 이해도 확인이 있어요 [이어 풀기]" 안내가 뜬다.
   */
  async function resumeOpenAttempt(progresses) {
    const open = progresses.find((p) => p?.in_progress_attempt_id);
    if (!open || busy || S().cpView) return;
    busy = true;
    c.setState({ cpPending: true });
    try {
      const view = await api.request('GET', `/api/checkpoints/${open.in_progress_attempt_id}`);
      enter(view, view.history || []);
    } catch (e) {
      c.setState({ cpNotice: e.message });
    } finally {
      busy = false;
      c.setState({ cpPending: false });
    }
  }

  function enter(view, history) {
    const messages = history.map((m) => ({ role: m.role, type: m.type, text: m.text }));
    c.setState({ cpView: view, cpMessages: messages, cpTurn: lastTurn(messages), cpBubbleIndex: 0, cpNotice: '', cpInput: '', cpConfirmPause: false });
    scroll();
  }

  /** 진입 화면에 보여 줄 섹션 상태와 시작 버튼. */
  function entryFor(section) {
    if (!SECTIONS.includes(section)) return { status: TEXT.entry.site, canStart: false };
    if (!api.hasToken()) return { status: TEXT.entry.login, canStart: false };
    const p = S().cpProgress[section];
    if (!p) return { status: TEXT.entry.checking, canStart: false };
    if (p.unavailable) return { status: p.status === 404 ? TEXT.entry.notReady : TEXT.entry.offline, canStart: false };
    if (!p.open) return { status: TEXT.entry.locked, canStart: false };
    if (p.unlocked) return { status: TEXT.entry.passed(percent(p.understanding)), canStart: false, passed: true };
    if (p.in_progress?.state === 'paused') return { status: TEXT.entry.paused(p.in_progress.done, p.in_progress.total), canStart: true, kind: 'resume' };
    if (p.in_progress_attempt_id) return { status: TEXT.entry.inProgress, canStart: true, kind: 'resume' };
    if (p.retry_concept_ids?.length) return { status: TEXT.entry.retry(p.retry_concept_ids.length), canStart: true, kind: 'retry' };
    return { status: TEXT.entry.notStarted, canStart: true, kind: 'start' };
  }

  /** 시도 진행(답변, 재채점). 서버가 저장한 뒤에만 사용자 메시지를 붙인다. 실패하면 입력이 남아 다시 보낼 수 있다. */
  async function call(action, text) {
    const cp = S().cpView;
    if (!cp || busy) return;
    busy = true;
    c.setState({ cpPending: true, cpNotice: '' });
    try {
      const view = await api.request('POST', `/api/checkpoints/${cp.attempt_id}/${action}`, text === undefined ? {} : { text });
      const user = text === undefined ? [] : [{ role: 'user', type: null, text }];
      // 멈추거나 끝나면 "멈추고 질문하기" 안내는 필요 없다.
      const settled = view.state === 'paused' || view.state === 'completed';
      c.setState((s) => ({
        cpView: view,
        cpMessages: [...withDefaults(s).cpMessages, ...user, ...asMessages(view.tutor)],
        cpTurn: asMessages(view.tutor),
        cpBubbleIndex: 0,
        ...(text === undefined ? {} : { cpInput: '' }),
        ...(settled ? { cpPauseOffer: false, cpConfirmPause: false } : {}),
      }));
      scroll();
      if (view.state === 'completed') {
        // 통과 문구에 다음 섹션이 열렸는지(루브릭이 있는지) 반영하려고 다음 섹션도 다시 읽는다.
        const next = SECTIONS[SECTIONS.indexOf(view.section) + 1];
        await Promise.all([loadProgress(view.section), next && loadProgress(next)]);
      }
      return view;
    } catch (e) {
      c.setState({ cpNotice: e.message });
      return null;
    } finally {
      busy = false;
      c.setState({ cpPending: false });
    }
  }

  /** 확정한 개념 수와 전체(이번 시도). 멈춘 시도는 풀던 개념이 current라 done만 센다. */
  function doneOf(cp) {
    const list = cp?.progress ?? [];
    return { done: list.filter((d) => d.status === 'done').length, total: list.length };
  }

  function stageLabel(cp) {
    if (cp.state === 'awaiting_ready') return cp.kind === 'retry' ? TEXT.stage.retryReady : TEXT.stage.ready;
    if (cp.state === 'completed') return TEXT.stage.done;
    if (cp.state === 'paused') { const { done, total } = doneOf(cp); return TEXT.stage.paused(done, total); }
    if (!cp.concept) return '';
    const concept = TEXT.stage.concept(cp.concept.index, cp.concept.total);
    if (cp.state === 'awaiting_recheck') return `${concept} · ${TEXT.stage.recheck}`;
    if (cp.state === 'error') return `${concept} · ${TEXT.stage.error}`;
    return concept;
  }

  function resultVals(cp) {
    const r = cp.result;
    if (!r) return null;
    const threshold = percent(r.threshold ?? 0.8);
    const next = SECTIONS[SECTIONS.indexOf(cp.section) + 1];
    const nextProgress = next ? S().cpProgress[next] : null;
    const nextReady = !!next && !(nextProgress?.unavailable && nextProgress.status === 404);
    return {
      understandingLabel: TEXT.result.understanding,
      percent: percent(r.understanding),
      thresholdPercent: threshold,
      thresholdLabel: TEXT.result.threshold(threshold),
      passed: r.unlocked,
      tone: r.unlocked ? 'ok' : 'warn',
      color: TONE_COLOR[r.unlocked ? 'ok' : 'warn'],
      passLabel: !r.unlocked ? TEXT.result.failed(threshold)
        : !next ? TEXT.result.allDone
        : nextReady ? TEXT.result.nextOpened(sectionName(next)) : TEXT.result.nextNotReady,
      bars: r.concepts.map((k) => {
        const verdict = k.final_verdict ?? 'wrong';
        const tone = VERDICT_TONE[verdict] ?? 'danger';
        const verdictLabel = TEXT.verdicts[verdict] ?? TEXT.verdicts.wrong;
        return {
          conceptId: k.concept_id, name: k.name, verdict, verdictLabel, score: k.score,
          label: TEXT.result.score(verdictLabel, k.score),
          // 0점도 막대가 보이게 최소 3%.
          widthPercent: Math.max(k.score * 100, 3),
          tone, color: TONE_COLOR[tone],
        };
      }),
    };
  }

  /** 캐릭터 동작: 요청 중이면 thinking, 멈춘 시도·발화 없음은 idle, 그 밖에는 말풍선 발화의 type(motionFor). */
  function characterMotion(st, bubble) {
    if (st.cpPending) return 'thinking';
    if (!bubble || st.cpView?.state === 'paused') return 'idle';
    return motionFor(bubble.type, { unlocked: !!st.cpView?.result?.unlocked });
  }

  const chat = {
    /** 한 섹션의 진입 상태를 다시 읽고, 진행 중인 시도가 있으면 연다. 공정을 옮길 때 부른다. */
    async refresh(section = S().processId) {
      if (!SECTIONS.includes(section) || !api.hasToken()) return;
      await resumeOpenAttempt([await loadProgress(section)]);
    },

    /** 모든 섹션의 진입 상태(공정 탭 배지)를 읽고, 진행 중인 시도가 있으면 연다. 페이지를 열 때 부른다. */
    async refreshAll() {
      if (!api.hasToken()) return;
      await resumeOpenAttempt(await Promise.all(SECTIONS.map(loadProgress)));
    },

    /**
     * 섹션(기본은 현재 공정)의 이해도 확인을 시작하고 오버레이를 연다(진행 중인 시도가 있으면 서버가 이어서 준다).
     * 오버레이는 요청 전에 열어 채점 중 동작을 보여 주고, 실패하면 닫는다. 다른 공정이면 페이지 goProcess로 옮긴다.
     */
    async start(section = S().processId) {
      if (busy || S().cpView || !entryFor(section).canStart) return;
      if (section !== S().processId) c.goProcess?.(section);
      busy = true;
      c.setState({ cpPending: true, cpNotice: '', cpOverlayOpen: true, cpShowHistory: false });
      try {
        const view = await api.request('POST', '/api/checkpoints', { section });
        enter(view, view.history || asMessages(view.tutor));
      } catch (e) {
        c.setState({ cpNotice: e.message, cpOverlayOpen: false });
        await loadProgress(section);
      } finally {
        busy = false;
        c.setState({ cpPending: false });
      }
    },

    /**
     * 공정 목록의 섹션 버튼([담금질 시작하기]·[이어 풀기]·[재도전]).
     * 그 섹션의 풀던 시도가 열려 있으면 이어 풀고, 끝난 시도(결과)가 열려 있으면 닫고 시작한다. 시작했는데 멈춘 시도를 받으면 이어 푼다.
     */
    async openSection(section) {
      const cp = S().cpView;
      if (cp && cp.section === section && cp.state !== 'completed') return chat.resume();
      if (cp?.state === 'completed') chat.close();
      await chat.start(section);
      if (S().cpView?.state === 'paused') await chat.resume();
    },

    /** 답변을 보낸다. 준비·답변·재확인 단계에서만 보낸다. */
    send(text) {
      text = (text || '').trim();
      if (text && ANSWERING.includes(S().cpView?.state)) return call('messages', text);
    },

    /** '준비됐어요' 버튼. */
    ready() { return chat.send(TEXT.buttons.ready); },

    /** 채점 오류(state=error) 뒤 같은 답변을 다시 채점한다. */
    retry() { if (S().cpView?.state === 'error') return call('retry-evaluation'); },

    /** 결과 화면을 닫고 진입 화면으로 돌아간다. 끝난 시도만 닫을 수 있다(진행 중에는 학습 입력을 막아 둔다). */
    close() {
      if (S().cpView?.state !== 'completed') return;
      c.setState({ cpView: null, cpMessages: [], cpNotice: '', cpInput: '', cpOverlayOpen: false, cpTurn: [], cpBubbleIndex: 0, cpShowHistory: false });
    },

    /** 오버레이 [나가기]. 답하는 중이면 멈춤 확인창을 열고(멈추면 닫힌다), 끝난 시도는 결과를 닫고, 그 밖에는 오버레이만 닫는다. */
    exit() {
      const state = S().cpView?.state;
      if (LOCKING.includes(state)) return chat.askPause();
      if (state === 'completed') return chat.close();
      c.setState({ cpOverlayOpen: false, cpConfirmPause: false });
    },

    /** 말풍선 [다음]: 이번 응답의 다음 발화를 보여 준다. */
    nextBubble() {
      const st = S();
      if (st.cpBubbleIndex < st.cpTurn.length - 1) c.setState({ cpBubbleIndex: st.cpBubbleIndex + 1 });
    },

    /** 오버레이 대화 기록 펼치기·접기. */
    toggleHistory() { c.setState({ cpShowHistory: !S().cpShowHistory }); },

    /** [나중에 이어 풀기] 버튼: 확인창을 연다. 답하는 중에만. */
    askPause() { if (LOCKING.includes(S().cpView?.state)) c.setState({ cpConfirmPause: true }); },

    /** 확인창의 [계속 풀기]. */
    cancelPause() { c.setState({ cpConfirmPause: false }); },

    /** 멈춘다(POST /pause). 맞힌 개념은 저장되고, 풀던 개념은 이어 풀 때 다른 질문으로 다시 묻는다. 멈추면 오버레이를 닫는다. 멈춘 뒤의 view, 실패하면 null. */
    async pause() {
      if (!LOCKING.includes(S().cpView?.state)) return null;
      c.setState({ cpConfirmPause: false });
      const view = await call('pause');
      if (view?.state === 'paused') c.setState({ cpOverlayOpen: false, cpShowHistory: false });
      return view;
    },

    /**
     * [이어 풀기](튜터 패널 안내·공정 목록 섹션 버튼). 오버레이를 열고,
     * 멈춘 시도면 POST /resume으로 새 질문을 받는다. 멈추지 않은 시도(새로고침으로 다시 연 경우)는 요청 없이 열기만 한다.
     */
    async resume() {
      const cp = S().cpView;
      if (!cp || cp.state === 'completed') return;
      c.setState({ cpPauseOffer: false, cpOverlayOpen: true, cpShowHistory: false });
      heldLearning = null;
      if (cp.state === 'paused') await call('resume');
      scroll();
    },

    /** [멈추고 질문하기]: 멈춘 뒤(오버레이가 닫힌다) 튜터 패널을 열고(페이지 openTutor), 막혀 있던 학습 질문이 있으면 보낸다. */
    async pauseForLearning() {
      const view = await chat.pause();
      if (view?.state !== 'paused') return;
      c.setState({ cpPauseOffer: false });
      c.openTutor?.();
      const held = heldLearning;
      heldLearning = null;
      return held?.();
    },

    /** 답하는 중인 시도가 있는지. 있으면 학습 입력을 막는다(멈춘 시도·끝난 시도는 막지 않는다). */
    isActive() { return LOCKING.includes(S().cpView?.state); },

    /** LOCK_PROCESS_TABS가 켜져 있고 앞 공정을 통과하지 못해 열리지 않은 공정인지. */
    tabLocked(section) {
      const p = S().cpProgress[section];
      return LOCK_PROCESS_TABS && !!p && !p.unavailable && !p.open;
    },

    /**
     * 페이지의 학습 질문(ask)을 감싼다.
     * 답하는 중이면 보내지 않고 질문을 들고 있다가 "잠깐 멈추고 질문할까요? [멈추고 질문하기]"를 보여 준다.
     */
    runLearning(send) {
      if (chat.isActive()) {
        heldLearning = send;
        c.setState({ cpPauseOffer: true });
        return;
      }
      return send();
    },

    /** 학습 모드 템플릿 값(learning-chat.js의 vals)에 잠금을 씌운다. 진행 중이면 보내기·추천 질문·'생각해 보기'를 끈다. */
    lockLearning(learning) {
      if (!chat.isActive()) return learning;
      return {
        ...learning,
        chips: [],
        send: (e) => { e?.preventDefault?.(); c.setState({ cpPauseOffer: true }); },
        messages: (learning.messages ?? []).map((m) => ({ ...m, hasFollowUp: false })),
      };
    },

    /**
     * 공정 목록 항목 값(페이지 steps 항목에 펼친다). 배지는 루브릭이 없거나 아직 못 읽은 공정이면 없음.
     * cpSection*: 섹션 끝의 상태 문구와 [담금질 시작하기]·[이어 풀기]·[재도전] 버튼. 다른 섹션의 풀던 시도가 열려 있으면 시작할 수 없다.
     */
    sectionBadge(section) {
      const st = S();
      const p = st.cpProgress[section];
      const known = !!p && !p.unavailable;
      const passed = known && !!p.unlocked;
      const cp = st.cpView;
      const unfinished = !!cp && cp.state !== 'completed';
      // 이 섹션의 풀던 시도가 열려 있으면 진입 상태(cpProgress)보다 그 시도를 따른다. 시작한 뒤에는 진입 상태를 다시 읽지 않기 때문이다.
      const here = unfinished && cp.section === section;
      const entry = !here ? entryFor(section)
        : { status: cp.state === 'paused' ? TEXT.entry.paused(doneOf(cp).done, doneOf(cp).total) : TEXT.entry.inProgress, canStart: true, kind: 'resume' };
      const otherOpen = unfinished && !here;
      // 앞 공정을 통과하지 못해 열리지 않은 섹션. 버튼은 비활성으로 보이고 상태 문구는 '이전 공정 통과 필요'.
      const locked = !here && !!p && !p.unavailable && !p.open && api.hasToken();
      const canStart = entry.canStart && !otherOpen && !st.cpPending;
      const resumeHere = entry.kind === 'resume';
      return {
        cpHasBadge: known,
        cpBadge: !known ? '' : passed ? TEXT.badges.passed : TEXT.badges.notPassed,
        cpBadgeColor: passed ? TONE_COLOR.ok : 'var(--muted)',
        cpTabLocked: chat.tabLocked(section),
        cpSectionStatus: locked ? TEXT.sectionLocked : entry.status,
        cpSectionLocked: locked,
        cpSectionStatusColor: passed ? TONE_COLOR.ok : locked ? TONE_COLOR.warn : 'var(--muted)',
        cpSectionPassed: !!entry.passed,
        // 통과한 공정, 로그인 전, 준비 중·확인 중에는 버튼을 숨기고 상태 문구만 보인다. 잠긴 공정은 비활성 버튼으로 보인다.
        cpSectionShowStart: (entry.canStart || locked) && api.hasToken(),
        cpSectionCanStart: canStart,
        cpSectionStartOpacity: canStart ? '1' : '.45',
        cpSectionCursor: canStart ? 'pointer' : 'not-allowed',
        cpSectionStartLabel: entry.kind === 'resume' ? TEXT.buttons.resumeShort : entry.kind === 'retry' ? TEXT.buttons.retryAttempt : TEXT.buttons.startQuench,
        onCpSectionStart: () => chat.openSection(section),
        // 이어 풀기 안내(튜터 패널 배너를 공정 목록으로 옮긴 것). 열려 있는 시도면 그 진행, 아니면 진입 상태의 진행 수.
        // 오버레이가 열려 있는 동안은 안내를 숨긴다.
        cpSectionHasResume: resumeHere && !(here && st.cpOverlayOpen),
        cpSectionResumeText: !resumeHere ? ''
          : here ? TEXT.resumeBanner(sectionName(section), doneOf(cp).done, doneOf(cp).total)
          : TEXT.resumeBanner(sectionName(section), p.in_progress?.done ?? 0, p.in_progress?.total ?? 0),
      };
    },

    /** 튜터 패널(이해도 확인 탭)과 공정 탭 배지 템플릿 값. 키 설명은 docs/checkpoint-integration.md. */
    vals() {
      const st = S();
      const cp = st.cpView;
      const state = cp?.state ?? null;
      const answering = ANSWERING.includes(state);
      const result = cp && state === 'completed' ? resultVals(cp) : null;
      const progress = doneOf(cp);
      const bubble = st.cpTurn[st.cpBubbleIndex] ?? null;
      const bubbleHasNext = st.cpBubbleIndex < st.cpTurn.length - 1;
      const overlayShown = !!st.cpOverlayOpen && (!!cp || st.cpPending);
      return {
        // 튜터 패널 머리글('학습 모드')
        cpHeaderMode: TEXT.header.learning,

        // 시도 상태
        cpShowResult: !!result,

        // 진행(오버레이 머리글·진행 점·대화 기록)
        cpTitle: cp ? TEXT.title(sectionName(cp.section), cp.kind === 'retry') : '',
        cpSection: cp?.section ?? null,
        cpState: state,
        cpStageLabel: cp ? stageLabel(cp) : '',
        cpStageColor: state === 'awaiting_recheck' ? TONE_COLOR.warn : state === 'error' ? TONE_COLOR.danger : state === 'completed' ? TONE_COLOR.ok : state === 'paused' ? 'var(--muted)' : ACCENT,
        cpDots: (cp?.progress ?? []).map((d, i) => ({ conceptId: d.concept_id, index: i + 1, status: d.status, isDone: d.status === 'done', isCurrent: d.status === 'current', color: d.status === 'done' ? ACCENT : d.status === 'current' ? 'var(--text)' : 'var(--line)' })),
        cpMessages: st.cpMessages.map((m, i) => ({
          key: i, text: m.text, type: m.type,
          isUser: m.role === 'user', isTutor: m.role !== 'user',
          label: m.role === 'user' ? '' : TEXT.messageLabels[m.type] ?? TEXT.defaultMessageLabel,
          isRecheck: m.type === 'recheck_question', isError: m.type === 'error',
          // 머리말·왼쪽 선 색: 재확인 질문은 주황, 채점 오류는 빨강.
          color: m.type === 'recheck_question' ? TONE_COLOR.warn : m.type === 'error' ? TONE_COLOR.danger : ACCENT,
        })),
        cpPending: st.cpPending,
        cpReadyLabel: TEXT.buttons.ready,
        onCpReady: () => chat.ready(),
        cpShowRetryButton: state === 'error' && !st.cpPending,
        cpRetryLabel: TEXT.buttons.retryEvaluation,
        onCpRetry: () => chat.retry(),
        // 나중에 이어 풀기: [나가기](onCpExit)가 답하는 중이면 이 확인창을 연다
        cpConfirmPause: LOCKING.includes(state) && !!st.cpConfirmPause,
        cpConfirmPauseText: TEXT.pauseConfirm(state === 'awaiting_recheck', progress.done, progress.total),
        cpConfirmPauseYes: TEXT.buttons.confirmPause,
        cpConfirmPauseNo: TEXT.buttons.keepGoing,
        onCpConfirmPause: () => chat.pause(),
        onCpCancelPause: () => chat.cancelPause(),
        onCpResume: () => chat.resume(),
        cpShowComposer: !!cp && state !== 'completed' && state !== 'paused',
        cpInput: st.cpInput,
        cpSendLabel: TEXT.buttons.send,
        onCpInput: (e) => c.setState({ cpInput: e.target.value }),
        onCpSend: (e) => { e?.preventDefault?.(); return chat.send(S().cpInput); },

        // 결과 화면(state=completed)
        cpResult: result,

        // 안내·오류
        cpNotice: st.cpNotice,
        cpHasNotice: !!st.cpNotice,

        // 학습 잠금(답하는 중에만)
        cpLearningLocked: chat.isActive(),

        // 튜터 패널 안내: 풀던 이해도 확인(멈춤·답하는 중)이 있으면 [이어 풀기], 답하는 중 학습 질문을 하려 하면 [멈추고 질문하기]
        cpShowPauseOffer: chat.isActive() && !!st.cpPauseOffer,
        cpPauseOfferText: TEXT.pauseOffer,
        cpPauseOfferLabel: TEXT.buttons.pauseForLearning,
        onCpPauseForLearning: () => chat.pauseForLearning(),
        // 오버레이에서 풀고 있는 동안은 숨긴다.
        cpShowResumeBanner: !!cp && state !== 'completed' && !(chat.isActive() && st.cpPauseOffer) && !overlayShown,
        cpResumeBannerText: cp ? TEXT.resumeBanner(sectionName(cp.section), progress.done, progress.total) : '',
        cpResumeBannerLabel: TEXT.buttons.resumeShort,

        // 이해도 확인 오버레이(3D 화면 위). 시작 요청 중에도 열어 채점 중 동작을 보여 준다.
        cpShowOverlay: overlayShown,
        // 결과(게이지·막대)는 마지막 말풍선(결과 발화)까지 본 뒤에 보여 준다. 그때 동작이 celebrate·cheer_retry다.
        cpOverlayShowResult: !!result && !bubbleHasNext,
        // 오버레이가 떠 있는 동안 페이지의 공정 이동(공정 메뉴)·하단 재생 바를 막는 값. 흐리게·흑백으로 보이고 누를 수 없다.
        cpOverlayLockPointer: overlayShown ? 'none' : 'auto',
        cpOverlayLockOpacity: overlayShown ? '.4' : '1',
        cpOverlayLockFilter: overlayShown ? 'grayscale(1)' : 'none',
        cpOverlayLockNotice: TEXT.overlayLocked,
        cpCharacterMotion: characterMotion(st, bubble),
        cpBubbleText: bubble?.text ?? '',
        cpBubbleType: bubble?.type ?? null,
        cpBubbleLabel: bubble ? TEXT.messageLabels[bubble.type] ?? TEXT.defaultMessageLabel : '',
        cpBubbleColor: bubble?.type === 'recheck_question' ? TONE_COLOR.warn : bubble?.type === 'error' ? TONE_COLOR.danger : ACCENT,
        cpBubbleHasNext: bubbleHasNext,
        cpBubbleNextLabel: TEXT.buttons.next,
        onCpBubbleNext: () => chat.nextBubble(),
        // 답변은 이번 응답의 마지막 발화(질문)를 보고 있을 때만 받는다.
        cpCanAnswer: answering && !st.cpPending && !bubbleHasNext,
        cpOverlayInputDisabled: !answering || st.cpPending || bubbleHasNext,
        cpOverlayInputOpacity: answering && !st.cpPending && !bubbleHasNext ? '1' : '.5',
        cpOverlayPlaceholder: bubbleHasNext ? TEXT.placeholder.readNext : state === 'awaiting_ready' ? TEXT.placeholder.ready : state === 'error' ? TEXT.placeholder.error : TEXT.placeholder.answer,
        // '준비됐어요'는 시작 인사를 다 본 뒤에.
        cpOverlayShowReady: state === 'awaiting_ready' && !st.cpPending && !bubbleHasNext,
        cpShowHistory: !!st.cpShowHistory,
        cpHistoryLabel: st.cpShowHistory ? TEXT.buttons.hideHistory : TEXT.buttons.history,
        onCpToggleHistory: () => chat.toggleHistory(),
        cpExitLabel: TEXT.buttons.exit,
        onCpExit: () => chat.exit(),
      };
    },
  };
  return chat;
}
