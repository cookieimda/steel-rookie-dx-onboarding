// 학습 랩(학습 기록 화면 Trainee Dashboard.dc.html의 '학습 랩' 탭). 서버는 backend/src/lab/(API는 routes.ts 맨 위 주석).
// - 간격 반복: 설비 카드(앞면 질문 → 답 보기 → 기억 정도 4단계). 다음 복습일은 서버가 SM-2로 정한다.
// - 주간 리그: 이번 주 XP로 같은 리그끼리 순위. 다른 사람 이름은 서버가 가려서 준다.
// - 보고서: 공정 하나의 내 학습 기록을 A4 보고서로 미리 보고 PDF로 저장한다(learner-report.html을 iframe으로). xAPI 문장은 화면에 보이지 않아도 계속 남긴다.
// - 세션 리플레이: 이 화면에서 한 조작(탭·공정·설비·질문)을 기록해 두었다가 다시 재생한다. 본인만 보고, [기록 끄기]로 멈출 수 있다.
// 상태는 페이지 컴포넌트(c) state의 lab… 키에 둔다. vals()가 템플릿 값을 돌려준다.

import { createLabExtras } from './lab-extras.js';

const TOKEN_KEY = 'st-rookie-token';
const REC_KEY = 'st-rookie-replay-off';
const token = () => { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const recordingOff = () => { try { return localStorage.getItem(REC_KEY) === '1'; } catch (e) { return false; } };

async function api(method, path, body) {
  const t = token();
  if (!t) throw new Error('로그인한 뒤 쓸 수 있어요.');
  const res = await fetch(path, { method, headers: { authorization: `Bearer ${t}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청이 실패했어요(${res.status}).`);
  return data;
}

export const SUBTABS = [['review', '간격 반복'], ['league', '주간 리그'], ['report', '보고서'], ['replay', '세션 리플레이'],
  ['incident', '사고 사례'], ['whatif', 'What-if'], ['notes', '설비 메모'], ['patterns', '내 오답 유형']];
const GRADE_LABEL = { 0: '다시', 3: '어려움', 4: '보통', 5: '쉬움' };
const GRADE_TONE = { 0: 'bad', 3: 'mid', 4: 'ok', 5: 'easy' };
const TAB_LABEL = { steps: '작동 단계', blueprint: '설계도·필기', review: '복습', mis: '내 오개념', card: '사원증', lab: '학습 랩' };
const PROCESS_LABEL = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const SPEEDS = [1, 2, 4, 8];

const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clock = iso => { const d = new Date(iso); return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const short = (s, n = 60) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** 리플레이 이벤트 한 줄 설명. */
export function describeEvent(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'start': return `학습 기록 화면을 열었어요 · ${TAB_LABEL[d.tab] || d.tab || ''}`;
    case 'tab': return `탭 이동 → ${TAB_LABEL[d.tab] || d.tab}`;
    case 'lab': return `학습 랩 → ${(SUBTABS.find(([k]) => k === d.sub) || [, d.sub])[1]}`;
    case 'select': return `${PROCESS_LABEL[d.process] || d.process || ''}${d.name ? ` · ${d.name}` : ''} 선택`;
    case 'ask': return `튜터에게 질문: ${short(d.text)}`;
    case 'answer': return `튜터 답: ${short(d.text)}`;
    case 'theme': return `테마 → ${d.theme === 'dark' ? '어둡게' : '밝게'}`;
    case 'card': return '사원증을 봤어요';
    case 'hidden': return '다른 창으로 이동';
    case 'visible': return '화면으로 돌아옴';
    default: return e.type;
  }
}

/** 재생 위치(ms)까지의 화면 상태(탭·공정·설비·마지막 질문/답). */
export function replayStateAt(events, pos) {
  const s = { tab: 'steps', process: null, equipment: null, ask: null, answer: null, current: -1 };
  events.forEach((e, i) => {
    if (e.t_ms > pos) return;
    const d = e.data || {};
    s.current = i;
    if (e.type === 'start') { s.tab = d.tab || s.tab; s.process = d.process || s.process; s.equipment = d.name || s.equipment; }
    if (e.type === 'tab') s.tab = d.tab;
    if (e.type === 'select') { s.process = d.process || s.process; s.equipment = d.name || null; }
    if (e.type === 'ask') { s.ask = d.text; s.answer = null; }
    if (e.type === 'answer') s.answer = d.text;
  });
  return s;
}

export function createLearningLab(c) {
  // ── 세션 리플레이 기록 ──
  const rec = { id: null, t0: 0, buf: [], timer: null, starting: null, seenEq: new Map() };
  const flush = async (keepalive = false) => {
    if (!rec.id || !rec.buf.length) return;
    const events = rec.buf.splice(0, 200);
    try {
      await fetch(`/api/me/lab/replays/${rec.id}/events`, { method: 'POST', keepalive, headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
    } catch (e) { /* 기록은 보조 기능이라 실패해도 화면은 그대로 둔다 */ }
  };
  const ensureSession = () => {
    if (rec.id || rec.starting || !token() || recordingOff()) return rec.starting;
    rec.t0 = performance.now();
    rec.starting = api('POST', '/api/me/lab/replays').then(r => { rec.id = r.id; rec.timer = setInterval(() => flush(), 4000); }, () => { rec.starting = null; });
    addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { track(document.hidden ? 'hidden' : 'visible'); if (document.hidden) flush(true); });
    return rec.starting;
  };
  function track(type, data) {
    if (recordingOff() || !token()) return;
    ensureSession();
    const clean = {};
    for (const [k, v] of Object.entries(data || {})) clean[k] = typeof v === 'string' ? v.slice(0, 300) : v;
    rec.buf.push({ t: Math.max(0, Math.round(performance.now() - rec.t0)), type, data: clean });
  }
  // 설비를 고르면 xAPI '살펴봄' 문장도 남긴다(같은 설비는 1분에 한 번).
  function experienced(id) {
    if (!id || !token()) return;
    const last = rec.seenEq.get(id) || 0;
    if (Date.now() - last < 60_000) return;
    rec.seenEq.set(id, Date.now());
    api('POST', '/api/me/lab/xapi', { verb: 'experienced', object_id: id }).catch(() => {});
  }

  const set = patch => c.setState(patch);
  const S = () => c.state;
  const fail = e => set({ labBusy: false, labError: e.message });

  // ── 불러오기 ──
  const loaders = {
    review: () => api('GET', '/api/me/lab/review').then(r => set({ labReview: r, labRevealed: false })),
    league: () => api('GET', '/api/me/lab/league').then(r => set({ labLeague: r })),
    replay: () => api('GET', '/api/me/lab/replays').then(r => set({ labReplays: r.sessions })),
  };
  // 추가 기능(lab-extras.js): 사고 사례·What-if·설비 메모·내 오답 유형과 알림 벨
  const extras = createLabExtras(c, { api, set, S, fail });
  Object.assign(loaders, extras.loaders);
  const load = sub => { set({ labError: null }); return (loaders[sub]?.() || Promise.resolve()).catch(fail); };
  // 오늘의 실습 경로는 학습 랩을 열 때 한 번 읽는다(실패하면 조용히 숨긴다).
  let pathLoaded = false;
  const open = sub => {
    set({ labTab: sub }); track('lab', { sub }); load(sub);
    if (!pathLoaded) { pathLoaded = true; api('GET', '/api/lab/practice-path').then(r => set({ labPath: r }), () => { pathLoaded = false; }); }
  };

  // ── 간격 반복 ──
  const grade = g => {
    const card = S().labReview?.queue?.[0];
    if (!card || S().labBusy) return;
    set({ labBusy: true });
    api('POST', `/api/me/lab/review/${encodeURIComponent(card.card_id)}`, { grade: g }).then(r => set({ labBusy: false, labReview: r.review, labRevealed: false, labLastGrade: { name: card.equipment_name, label: GRADE_LABEL[g], after: card.options.find(o => o.grade === g)?.after } }), fail);
  };

  // ── 리플레이 재생 ──
  let playTimer = null;
  const stopPlay = () => { clearInterval(playTimer); playTimer = null; set({ labPlaying: false }); };
  const openReplay = id => { stopPlay(); set({ labReplayId: id, labReplay: null, labPos: 0 }); api('GET', `/api/me/lab/replays/${id}`).then(r => set({ labReplay: r }), fail); };
  const duration = () => { const ev = S().labReplay?.events || []; return ev.length ? ev[ev.length - 1].t_ms : 0; };
  const play = () => {
    if (playTimer) return stopPlay();
    if (S().labPos >= duration()) set({ labPos: 0 });
    set({ labPlaying: true });
    playTimer = setInterval(() => {
      const next = (S().labPos || 0) + 100 * (S().labSpeed || 1);
      if (next >= duration()) { set({ labPos: duration() }); stopPlay(); } else set({ labPos: next });
    }, 100);
  };
  const removeReplay = id => api('DELETE', `/api/me/lab/replays/${id}`).then(() => { stopPlay(); set({ labReplayId: null, labReplay: null }); load('replay'); }, fail);

  function vals() {
    const s = S(), sub = s.labTab || 'review';
    const v = {
      labSubtabs: SUBTABS.map(([k, label]) => ({ label, on: sub === k, onClick: () => open(k) })),
      labError: s.labError || '', hasLabError: !!s.labError,
      labShowReview: sub === 'review' ? 'flex' : 'none', labShowLeague: sub === 'league' ? 'flex' : 'none', labShowReport: sub === 'report' ? 'flex' : 'none',
      labShowReplay: sub === 'replay' ? 'flex' : 'none',
      labShowIncident: sub === 'incident' ? 'flex' : 'none', labShowWhatif: sub === 'whatif' ? 'flex' : 'none',
      labShowNotes: sub === 'notes' ? 'flex' : 'none', labShowPatterns: sub === 'patterns' ? 'flex' : 'none',
      ...extras.vals(sub),
    };

    // 오늘의 실습 경로
    const P = s.labPath, ICON = { map: '🗺', quiz: '🧩', fault: '🚨' };
    Object.assign(v, {
      ppHas: !!P?.steps?.length, ppName: P?.name || '', ppReason: P?.reason || '',
      // 내 3D 실습 요약: 숫자 칩 + 공정별(퀴즈 정답률·훈련 최고 점수) 막대
      ppStats: P?.summary ? [
        ['인과 퀴즈', P.summary.quiz_answers ? `${Math.round(P.summary.quiz_rate * 100)}% · ${P.summary.quiz_answers}칸` : '아직 없음'],
        ['이상 상황 훈련', `${P.summary.faults_done} / ${P.summary.faults_total}종${P.summary.faults_perfect ? ` · 만점 ${P.summary.faults_perfect}` : ''}`],
        ['갈림길 탐험', `${P.summary.branches_explored} / ${P.summary.branches_total}`],
        ['거꾸로 추론', P.summary.diagnose_answers ? `${Math.round(P.summary.diagnose_rate * 100)}% · ${P.summary.diagnose_answers}문제` : '아직 없음'],
        ['되돌리기 퍼즐', `부작용 없이 ${P.summary.rebalance_clean ?? 0}개`],
      ].map(([k, val]) => ({ k, v: val })) : [],
      ppProcs: (P?.processes || []).map(x => ({ name: x.name, quiz: x.quiz_rate == null ? '퀴즈 —' : `퀴즈 ${Math.round(x.quiz_rate * 100)}%`, fault: x.fault_best == null ? '훈련 —' : `훈련 ${Math.round(x.fault_best * 100)}점`,
        w: `${Math.round((1 - x.weakness) * 100)}%`, weak: x.process === P.process ? 'weak' : '' })),
      ppSteps: (P?.steps || []).map((x, i) => ({ n: `${i + 1}단계 ${ICON[x.kind] || ''}${x.done ? ' · 완료' : ''}`, title: x.title, why: x.why, href: x.href })),
    });

    // 간격 반복
    const R = s.labReview, card = R?.queue?.[0];
    Object.assign(v, {
      srLoaded: !!R, srHasCard: !!card, srDone: !!R && !card,
      srStats: R ? [['오늘 복습', `${R.stats.due_today}장`], ['새 카드', `${R.stats.new_left}장`], ['오늘 한 복습', `${R.stats.reviewed_today}번`],
        ['30일 기억률', R.stats.retention_30d == null ? '—' : `${Math.round(R.stats.retention_30d * 100)}%`], ['장기 기억', `${R.stats.mature} / ${R.stats.total}`]].map(([k, val]) => ({ k, v: val })) : [],
      srForecast: R ? (() => { const max = Math.max(1, ...R.stats.forecast.map(f => f.count)); return R.stats.forecast.map((f, i) => ({ label: i === 0 ? '오늘' : `${Number(f.date.slice(8))}일`, count: f.count, h: Math.round((f.count / max) * 100) })); })() : [],
      srLeft: R ? `남은 카드 ${R.queue.length}장` : '',
      srSection: card?.section_name || '', srFront: card?.front || '', srTag: card ? (card.is_new ? '새 카드' : `${card.state.reps}번째 복습 · 실수 ${card.state.lapses}번`) : '',
      srRevealed: !!s.labRevealed, srHidden: !s.labRevealed,
      srRole: card?.back.role || '', srHasMemo: !!card?.back.memo, srMemoTitle: card?.back.memo?.title || '', srMemoText: card?.back.memo?.text || '',
      srReveal: () => { set({ labRevealed: true }); },
      srOptions: (card?.options || []).map(o => ({ label: GRADE_LABEL[o.grade], after: o.after, tone: GRADE_TONE[o.grade], onClick: () => grade(o.grade) })),
      srLast: s.labLastGrade ? `${s.labLastGrade.name} · ${s.labLastGrade.label} → ${s.labLastGrade.after}` : '', srHasLast: !!s.labLastGrade,
      srDoneText: R ? (R.stats.forecast[1]?.count ? `오늘 복습 끝! 내일 ${R.stats.forecast[1].count}장이 기다려요.` : '오늘 복습 끝! 새 카드는 내일 또 열려요.') : '',
    });

    // 주간 리그
    const L = s.labLeague;
    const daysLeft = L ? Math.max(0, Math.ceil((Date.parse(L.week.ends_at) - Date.now()) / 86_400_000)) : 0;
    Object.assign(v, {
      lgLoaded: !!L, lgName: L ? `${L.league.name} 리그` : '', lgKey: L?.league.key || 'bronze',
      lgWeek: L ? `${L.week.start.slice(5).replace('-', '.')} ~ ${L.week.end.slice(5).replace('-', '.')} · ${daysLeft}일 남음` : '',
      lgMe: L?.me ? `${L.me.rank}위 · ${L.me.xp} XP` : '리그에 없어요(신입사원 계정만 참가)',
      lgHint: !L?.me ? '' : L.me.zone === 'promote' ? '승급 구역이에요! 이대로 주말까지 지키면 다음 리그로 올라가요.' : L.me.zone === 'demote' ? `강등 구역이에요. ${L.me.to_promote ?? ''} XP 더 모으면 승급 구역이에요.` : `${L.me.to_promote} XP 더 모으면 승급 구역이에요.`,
      lgBoard: (L?.board || []).map((r, i, all) => ({ rank: r.rank, name: r.name, xp: `${r.xp} XP`, cls: `${r.zone} ${r.me ? 'me' : ''}`,
        line: i === 0 ? (r.zone === 'promote' ? '승급 구역' : '') : all[i - 1].zone !== r.zone ? (r.zone === 'demote' ? '강등 구역' : '유지 구역') : '',
        hasLine: (i === 0 && r.zone === 'promote') || (i > 0 && all[i - 1].zone !== r.zone) })),
      lgHistory: (L?.history || []).map(h => ({ text: `${h.week_start.slice(5).replace('-', '.')} 주 · ${h.league} ${h.rank}/${h.size}위 · ${h.xp} XP`, mark: h.result === 'up' ? '▲' : h.result === 'down' ? '▼' : '–', cls: h.result })),
      lgNoHistory: !!L && !(L.history || []).length,
    });

    // 보고서: 고른 공정(처음에는 학습 화면에서 보고 있는 공정)의 learner-report.html. 탭이 닫혀 있으면 불러오지 않는다
    const reSec = PROCESS_LABEL[s.labReportSection] ? s.labReportSection : PROCESS_LABEL[s.processId] ? s.processId : 'ironmaking';
    const reHref = `/login_ui/learner-report.html?section=${reSec}`;
    Object.assign(v, {
      reSections: Object.entries(PROCESS_LABEL).map(([k, label]) => ({ label, on: reSec === k, onClick: () => set({ labReportSection: k }) })),
      reSrc: sub === 'report' ? reHref : 'about:blank', reOpenHref: reHref, rePrintHref: `${reHref}&print=1`,
    });

    // 리플레이
    const list = s.labReplays || [], RP = s.labReplay, ev = RP?.events || [];
    const total = ev.length ? ev[ev.length - 1].t_ms : 0, pos = Math.min(s.labPos || 0, total), st = replayStateAt(ev, pos);
    Object.assign(v, {
      rpRecording: !recordingOff(), rpRecLabel: recordingOff() ? '기록 꺼짐 · 켜기' : '● 기록 중 · 끄기',
      rpToggleRec: () => { try { recordingOff() ? localStorage.removeItem(REC_KEY) : localStorage.setItem(REC_KEY, '1'); } catch (e) {} c.forceUpdate(); },
      rpSessions: list.map(x => ({ label: clock(x.started_at), sub: `${mmss(Date.parse(x.ended_at) - Date.parse(x.started_at))} · 조작 ${x.event_count}개`, on: x.id === s.labReplayId, onClick: () => openReplay(x.id) })),
      rpEmpty: !!s.labReplays && !list.length, rpHasReplay: !!RP, rpNoReplay: !RP,
      rpPlayLabel: s.labPlaying ? '❚❚ 멈춤' : '▶ 재생', rpPlay: play,
      rpSpeeds: SPEEDS.map(x => ({ label: `${x}×`, on: (s.labSpeed || 1) === x, onClick: () => set({ labSpeed: x }) })),
      rpPos: pos, rpTotal: total, rpTime: `${mmss(pos)} / ${mmss(total)}`,
      rpSeek: e => { stopPlay(); set({ labPos: Number(e.target.value) }); },
      rpTabs: Object.entries(TAB_LABEL).map(([k, label]) => ({ label, cls: st.tab === k ? 'on' : '' })),
      rpProcs: Object.entries(PROCESS_LABEL).map(([k, label]) => ({ label, cls: st.process === k ? 'on' : '' })),
      rpEquipment: st.equipment || '설비를 고르지 않았어요', rpAsk: st.ask || '', rpHasAsk: !!st.ask, rpAnswer: st.answer || '', rpHasAnswer: !!st.answer,
      rpEvents: ev.map((e, i) => ({ t: mmss(e.t_ms), text: describeEvent(e), cls: i === st.current ? 'now' : e.t_ms <= pos ? 'past' : '', onClick: () => { stopPlay(); set({ labPos: e.t_ms }); } })),
      rpDelete: () => RP && removeReplay(RP.session.id),
    });
    return v;
  }

  return { track, experienced, open, load, vals, ensureSession, startBell: extras.startBell };
}
