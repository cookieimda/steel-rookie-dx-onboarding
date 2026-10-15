// 학습 랩(학습 기록 화면 Trainee Dashboard.dc.html의 '학습 랩' 탭). 서버는 backend/src/lab/(API는 routes.ts 맨 위 주석).
// - 간격 반복: 설비 카드(앞면 질문 → 답 보기 → 기억 정도 4단계). 다음 복습일은 서버가 SM-2로 정한다.
// - 주간 리그: 이번 주 XP로 같은 리그끼리 순위. 다른 사람 이름은 서버가 가려서 준다.
// - xAPI 기록: 내 학습 기록을 xAPI 문장으로 보고 동사로 거르고 JSON으로 내려받는다.
// - 세션 리플레이: 이 화면에서 한 조작(탭·공정·설비·질문)을 기록해 두었다가 다시 재생한다. 본인만 보고, [기록 끄기]로 멈출 수 있다.
// - 소크라테스 모드: 답 대신 질문으로 이끄는 대화. LLM이 없으면 서버의 오프라인 튜터가 이어 간다.
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

export const SUBTABS = [['review', '간격 반복'], ['league', '주간 리그'], ['xapi', 'xAPI 기록'], ['replay', '세션 리플레이'], ['socratic', '소크라테스'],
  ['incident', '사고 사례'], ['whatif', 'What-if'], ['notes', '설비 메모'], ['patterns', '내 오답 유형']];
const VERB_LABEL = { asked: '질문함', answered: '답함', completed: '끝냄', passed: '통과함', experienced: '살펴봄', resolved: '해결함', annotated: '필기함', reviewed: '복습함', mastered: '스스로 답함' };
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
    xapi: () => api('GET', `/api/me/lab/xapi?limit=100${S().labXapiVerb ? `&verb=${S().labXapiVerb}` : ''}`).then(r => set({ labXapi: r })),
    replay: () => api('GET', '/api/me/lab/replays').then(r => set({ labReplays: r.sessions })),
    socratic: () => api('GET', '/api/me/lab/socratic').then(r => set({ labSocList: r, labSocEq: S().labSocEq || r.equipment[0]?.id || '' })),
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

  // ── 소크라테스 ──
  const socStart = () => {
    const eq = S().labSocEq;
    if (!eq || S().labBusy) return;
    set({ labBusy: true, labSocBanner: null });
    api('POST', '/api/me/lab/socratic', { equipment_id: eq }).then(r => { set({ labBusy: false, labSoc: r, labSocInput: '' }); loaders.socratic(); }, fail);
  };
  const socOpen = id => api('GET', `/api/me/lab/socratic/${id}`).then(r => set({ labSoc: r, labSocBanner: null }), fail);
  const socSend = e => {
    e?.preventDefault?.();
    const text = (S().labSocInput || '').trim(), soc = S().labSoc;
    if (!text || !soc || S().labBusy) return;
    set({ labBusy: true, labSoc: { ...soc, turns: [...soc.turns, { role: 'user', text }] }, labSocInput: '' });
    api('POST', `/api/me/lab/socratic/${soc.session.id}/turns`, { text })
      .then(r => { set({ labBusy: false, labSoc: r, labSocBanner: r.just_reached ? '스스로 답에 닿았어요! +25 XP' : null }); loaders.socratic(); }, fail);
  };
  const socReveal = () => {
    const soc = S().labSoc;
    if (!soc || S().labBusy) return;
    set({ labBusy: true });
    api('POST', `/api/me/lab/socratic/${soc.session.id}/reveal`).then(r => { set({ labBusy: false, labSoc: r }); loaders.socratic(); }, fail);
  };

  // ── xAPI 내려받기(토큰이 필요해 링크 대신 fetch → 파일) ──
  const download = async () => {
    try {
      const res = await fetch('/api/me/lab/xapi/export', { headers: { authorization: `Bearer ${token()}` } });
      if (!res.ok) throw new Error('내려받지 못했어요.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'xapi.json';
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { fail(e); }
  };

  function vals() {
    const s = S(), sub = s.labTab || 'review';
    const v = {
      labSubtabs: SUBTABS.map(([k, label]) => ({ label, on: sub === k, onClick: () => open(k) })),
      labError: s.labError || '', hasLabError: !!s.labError,
      labShowReview: sub === 'review' ? 'flex' : 'none', labShowLeague: sub === 'league' ? 'flex' : 'none', labShowXapi: sub === 'xapi' ? 'flex' : 'none',
      labShowReplay: sub === 'replay' ? 'flex' : 'none', labShowSocratic: sub === 'socratic' ? 'flex' : 'none',
      labShowIncident: sub === 'incident' ? 'flex' : 'none', labShowWhatif: sub === 'whatif' ? 'flex' : 'none',
      labShowNotes: sub === 'notes' ? 'flex' : 'none', labShowPatterns: sub === 'patterns' ? 'flex' : 'none',
      ...extras.vals(sub),
    };

    // 오늘의 실습 경로
    const P = s.labPath, ICON = { map: '🗺', quiz: '🧩', fault: '🚨' };
    Object.assign(v, {
      ppHas: !!P?.steps?.length, ppName: P?.name || '', ppReason: P?.reason || '',
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

    // xAPI
    const X = s.labXapi;
    Object.assign(v, {
      xaLoaded: !!X, xaTotal: X ? `${X.total}개 문장` : '',
      xaVerbs: X ? [{ label: `전체`, on: !s.labXapiVerb, onClick: () => { set({ labXapiVerb: '' }); setTimeout(() => load('xapi')); } },
        ...Object.entries(X.counts).map(([k, n]) => ({ label: `${VERB_LABEL[k] || k} ${n}`, on: s.labXapiVerb === k, onClick: () => { set({ labXapiVerb: k }); setTimeout(() => load('xapi')); } }))] : [],
      xaRows: (X?.statements || []).map(st => ({ when: clock(st.timestamp), verb: st.verb.display['ko-KR'], obj: st.object.definition.name['ko-KR'],
        res: st.result?.score ? `${Math.round(st.result.score.scaled * 100)}%` : st.result?.success === true ? '성공' : st.result?.success === false ? '아직' : '',
        json: JSON.stringify({ id: st.id, actor: st.actor, verb: st.verb, object: st.object, ...(st.result ? { result: st.result } : {}), context: st.context, timestamp: st.timestamp, stored: st.stored, version: st.version }, null, 2) })),
      xaEmpty: !!X && !X.statements.length, xaDownload: download,
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

    // 소크라테스
    const SL = s.labSocList, SC = s.labSoc;
    const stateLabel = st2 => (st2 === 'reached' ? '스스로 답함' : st2 === 'revealed' ? '정답 봄' : '진행 중');
    Object.assign(v, {
      soLoaded: !!SL, soOfflineText: (SL && !SL.llm) || SC?.mode === 'offline' ? '지금은 AI 연결이 없어 정해 둔 질문으로 진행해요.' : '', soEquipment: (SL?.equipment || []).map(e => ({ value: e.id, label: `${e.section_name} · ${e.name}` })),
      soEq: s.labSocEq || '', soPick: e => set({ labSocEq: e.target.value }), soStart: socStart,
      soSessions: (SL?.sessions || []).slice(0, 8).map(x => ({ label: x.equipment_name, sub: `${stateLabel(x.state)} · 답 ${x.turns}번`, cls: x.state, on: SC?.session.id === x.id, onClick: () => socOpen(x.id) })),
      soHas: !!SC, soNone: !SC,
      soTitle: SC ? `${SC.session.section_name} · ${SC.session.equipment_name}` : '', soState: SC ? stateLabel(SC.session.state) : '', soStateCls: SC?.session.state || '',
      soHints: [1, 2, 3].map(i => ({ cls: (SC?.session.hint_level || 0) >= i ? 'on' : '' })),
      soTurns: (SC?.turns || []).map(t => ({ text: t.text, cls: t.role })),
      soInput: s.labSocInput || '', soOnInput: e => set({ labSocInput: e.target.value }), soSend: socSend,
      soCantSend: !!s.labBusy || !(s.labSocInput || '').trim() || SC?.session.state === 'revealed',
      soClosed: SC?.session.state === 'revealed', soReveal: socReveal, soSuggestReveal: !!SC?.suggest_reveal,
      soBanner: s.labSocBanner || '', soHasBanner: !!s.labSocBanner, soBusy: !!s.labBusy,
    });
    return v;
  }

  return { track, experienced, open, load, vals, ensureSession, startBell: extras.startBell };
}
