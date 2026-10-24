// 학습 랩 추가 기능(012) + 알림 벨. learning-lab.js가 불러 같은 상태(c.state의 lab… 키)에 붙인다. 서버는 backend/src/lab/extras-routes.ts·notify/·ops/.
// - 사고 사례: 교육용 가상 사례를 시간순으로 한 단계씩 보고(설비를 2D 모듈에서 바로 볼 수 있다) 원인 분석 문제를 푼다.
// - What-if: 고로 원료 배합·연료·송풍 조건 슬라이더 → 슬래그량·염기도·CO2·용선 온도(교육용 간이 모델, 가정을 함께 보여 준다).
// - 설비 메모: 설비에 남긴 질문·메모·팁을 다른 학습자와 공유(공감·답글·신고). 2D 모듈에서 고른 설비가 기본이다.
// - 내 오답 유형: 내 오개념 설명을 비슷한 것끼리 묶어 보여 준다.
// - 알림 벨: 헤더의 🔔. 1분마다 알림함을 읽고, 브라우저 알림을 켰으면 새 알림을 띄운다(이 화면이 열려 있을 때).

const KIND_LABEL = { question: '질문', memo: '메모', tip: '팁' };
const SECTION_LABEL = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const NOTIFY_KINDS = [['review_due', '복습 일정'], ['assignment_due', '시험 마감'], ['assignment_overdue', '마감 지난 시험'], ['streak_risk', '연속 학습일'], ['note_reply', '메모 답글'], ['job_done', '작업 완료']];
/** What-if 슬라이더: [키, 이름, 단위, 최소, 최대, 간격] */
export const WI_SLIDERS = [
  ['sinter_pct', '소결광 비율', '%', 0, 100, 5], ['pellet_pct', '펠릿 비율', '%', 0, 100, 5], ['lump_pct', '괴광 비율', '%', 0, 100, 5],
  ['coke_kg', '코크스', 'kg/t', 250, 550, 10], ['pci_kg', '미분탄(PCI)', 'kg/t', 0, 250, 10],
  ['blast_temp_c', '송풍 온도', '℃', 900, 1300, 10], ['oxygen_pct', '산소 부화', '%p', 0, 10, 0.5], ['limestone_kg', '석회석', 'kg/t', 0, 150, 5],
];
const WI_OUT = [['hot_metal_temp_c', '용선 온도', '℃', 0], ['slag_kg', '슬래그량', 'kg/t', 1], ['basicity', '염기도 CaO/SiO2', '', 2], ['fuel_rate_kg', '연료비', 'kg/t', 0], ['co2_kg', 'CO2(상한)', 'kg/t', 0], ['ore_kg', '철 원료', 'kg/t', 0]];

export function createLabExtras(c, { api, set, S, fail }) {
  // ── 알림 벨 ──
  const seen = new Set();
  let firstPoll = true;
  const poll = async () => {
    try {
      const r = await api('GET', '/api/me/notifications');
      const prefs = S().ntPrefs;
      // 브라우저 알림: 처음 읽을 때는 이미 있던 알림이라 띄우지 않는다
      for (const n of r.notifications) {
        if (!n.read && !seen.has(n.id) && !firstPoll && prefs?.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification(n.title, { body: n.body, tag: n.id }); } catch (e) {}
        }
        seen.add(n.id);
      }
      firstPoll = false;
      set({ ntList: r.notifications, ntUnread: r.unread });
    } catch (e) { /* 알림은 보조 기능 */ }
  };
  const startBell = () => {
    if (startBell.started) return;
    startBell.started = true;
    api('GET', '/api/me/notification-prefs').then(p => set({ ntPrefs: p }), () => {});
    poll();
    setInterval(poll, 60_000);
  };
  const savePrefs = patch => {
    const next = { ...S().ntPrefs, ...patch };
    set({ ntPrefs: next, ntPrefErr: '' });
    api('PUT', '/api/me/notification-prefs', next).then(p => set({ ntPrefs: p }), e => set({ ntPrefErr: e.message }));
  };

  // ── 불러오기 ──
  const loaders = {
    incident: () => api('GET', '/api/lab/incidents').then(r => set({ labInc: r })),
    whatif: () => runWhatIf(S().labWiIn || {}),
    notes: () => { const eq = S().labNoteEq || c.state.selectedId || 'blast_furnace'; set({ labNoteEq: eq }); return Promise.all([loadNotes(eq), api('GET', '/api/lab/notes/summary').then(r => set({ labNoteCounts: r.counts }))]); },
    patterns: () => api('GET', '/api/me/misconception-patterns').then(r => set({ labPat: r.patterns })),
  };

  // 사고 사례
  const openIncident = id => api('GET', `/api/lab/incidents/${id}`).then(r => set({ labIncCur: r.scenario, labIncDisc: r.disclaimer, labIncStep: 1, labIncAns: {}, labIncRes: null, labIncRefl: '', labIncBr: {} }), fail);
  const submitIncident = () => {
    const cur = S().labIncCur;
    if (!cur) return;
    api('POST', `/api/lab/incidents/${cur.id}/submit`, { answers: S().labIncAns || {}, reflection: S().labIncRefl || '' })
      .then(r => { set({ labIncRes: r }); loaders.incident(); }, fail);
  };
  // 2D 모듈에서 그 설비 보기(작동 단계 탭으로 옮긴다)
  const showOn2d = (section, equipmentId) => { c.goProcess?.(section); c.setState({ moduleTab: 'steps' }); setTimeout(() => { c.module?.()?.select?.(equipmentId); }, 300); };

  // What-if(입력이 바뀌면 0.25초 뒤 계산)
  let wiTimer = 0;
  function runWhatIf(input) { return api('POST', '/api/lab/whatif', input).then(r => set({ labWi: r }), fail); }
  const setWi = (key, value) => { const input = { ...(S().labWi?.input || {}), ...(S().labWiIn || {}), [key]: Number(value) }; set({ labWiIn: input }); clearTimeout(wiTimer); wiTimer = setTimeout(() => runWhatIf(input), 250); };

  // 설비 메모
  function loadNotes(eq) { return api('GET', `/api/lab/notes?equipment_id=${encodeURIComponent(eq)}`).then(r => set({ labNotes: r }), fail); }
  const notePost = e => {
    e?.preventDefault?.();
    const text = (S().labNoteText || '').trim();
    if (!text) return;
    api('POST', '/api/lab/notes', { equipment_id: S().labNoteEq, kind: S().labNoteKind || 'question', text, visibility: S().labNotePrivate ? 'private' : 'public' })
      .then(() => { set({ labNoteText: '' }); loaders.notes(); }, fail);
  };
  const noteAct = (id, path, body, method = 'POST') => api(method, `/api/lab/notes/${id}${path}`, body).then(() => loadNotes(S().labNoteEq), fail);

  function vals(sub) {
    const s = S(), v = {};
    // 알림 벨
    const prefs = s.ntPrefs || { browser: true, email: false, email_address: '', messenger: false, kinds: {} };
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    Object.assign(v, {
      ntCount: s.ntUnread || 0, ntHasCount: (s.ntUnread || 0) > 0, ntOpen: !!s.ntOpen,
      ntToggle: () => { const open = !S().ntOpen; set({ ntOpen: open }); if (open) poll(); },
      ntClose: () => set({ ntOpen: false }),
      ntItems: (s.ntList || []).slice(0, 20).map(n => ({ title: n.title, body: n.body, kind: n.kind_label, when: new Date(n.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), cls: n.read ? 'read' : '',
        onClick: () => { api('POST', `/api/me/notifications/${n.id}/read`).then(poll, () => {}); if (n.link && n.link !== '/login') location.assign(n.link); } })),
      ntEmpty: !(s.ntList || []).length,
      ntReadAll: () => api('POST', '/api/me/notifications/read-all').then(poll, () => {}),
      ntShowPrefs: !!s.ntPrefsOpen, ntTogglePrefs: () => set({ ntPrefsOpen: !S().ntPrefsOpen }),
      ntBrowser: !!prefs.browser, ntMessenger: !!prefs.messenger, ntEmail: !!prefs.email, ntEmailAddr: prefs.email_address || '',
      ntPermText: perm === 'granted' ? '허용됨' : perm === 'denied' ? '브라우저에서 막힘' : perm === 'unsupported' ? '이 브라우저는 지원하지 않아요' : '허용 필요',
      ntAskPerm: () => { if (typeof Notification !== 'undefined') Notification.requestPermission().then(() => c.forceUpdate()); },
      ntNeedPerm: perm === 'default',
      ntSetBrowser: e => savePrefs({ browser: e.target.checked }), ntSetMessenger: e => savePrefs({ messenger: e.target.checked }),
      ntSetEmail: e => savePrefs({ email: e.target.checked }), ntSetEmailAddr: e => set({ ntPrefs: { ...(S().ntPrefs || prefs), email_address: e.target.value } }),
      ntSaveEmail: () => savePrefs({}), ntPrefErr: s.ntPrefErr || '', ntHasPrefErr: !!s.ntPrefErr,
      ntKinds: NOTIFY_KINDS.map(([k, label]) => ({ label, on: prefs.kinds?.[k] !== false, onChange: e => savePrefs({ kinds: { ...(S().ntPrefs?.kinds || {}), [k]: e.target.checked } }) })),
    });

    // 사고 사례
    const list = s.labInc, cur = s.labIncCur, res = s.labIncRes, step = s.labIncStep || 1;
    Object.assign(v, {
      icList: (list?.scenarios || []).map(x => ({ title: x.title, hazard: x.hazard, section: SECTION_LABEL[x.section], best: x.best == null ? '아직 안 풀었어요' : `최고 ${Math.round(x.best * 100)}점 · ${x.attempts}번`, on: cur?.id === x.id, onClick: () => openIncident(x.id) })),
      icDisclaimer: list?.disclaimer || '', icHas: !!cur, icNone: !cur,
      icTitle: cur?.title || '', icHazard: cur?.hazard || '', icSummary: cur?.summary || '',
      // 실제 공개 재해사례의 출처(사례집·사례 번호·쪽)
      icHasSource: !!cur?.source, icSource: cur?.source ? `${cur.source.publisher} 「${cur.source.title}」 ${cur.source.case}${cur.source.page ? ` (${cur.source.page}쪽)` : ''}` : '', icSourceUrl: cur?.source?.url || '',
      // 사고 상황판(incident-board.js): 지금 장면까지의 시계·역할 줄·관문 상태·현황. x-import가 속성을 문자열로 넘기므로 JSON으로 준다
      icBoard: cur ? JSON.stringify({
        id: cur.id, section: SECTION_LABEL[cur.section], hazard: cur.hazard, step,
        roles: cur.roles || [], gates: cur.gates || [], reviewed: !!cur.gates_reviewed,
        steps: cur.timeline.map((t, i) => {
          const pick = (s.labIncBr || {})[i], opt = t.branch && pick != null ? t.branch.options[pick] : null;
          const eq = (c.state.processes || []).flatMap(p => p.equipment).find(e => e.id === t.equipment_id);
          return { time: t.time, text: t.text, equipment: eq?.name || t.equipment_id, actor: t.actor || '', branch: !!t.branch, pickIndex: pick ?? null, pick: opt ? (opt.actual ? 'actual' : 'safe') : null };
        }),
      }) : '',
      icSteps: (cur?.timeline || []).slice(0, step).map((t, i, all) => {
        // 갈림길: "여기서 다르게 했다면?" 고른 선택의 결과(안전한 결과는 초록, 실제로 일어난 일은 빨강)
        const pick = (s.labIncBr || {})[i], opt = t.branch && pick != null ? t.branch.options[pick] : null;
        // 줄 앞 이름표: 이 장면에서 움직인 역할(없으면 설비 이름)
        const who = (cur.roles || []).find(r => r.id === t.actor)?.name || (c.state.processes || []).flatMap(p => p.equipment).find(e => e.id === t.equipment_id)?.name || t.equipment_id;
        return { time: t.time, text: t.text, eq: who, cls: i === all.length - 1 ? 'now' : '', onShow: () => showOn2d(cur.section, t.equipment_id),
          hasBranch: !!t.branch, brPrompt: t.branch?.prompt || '',
          brOpts: (t.branch?.options || []).map((o, k) => ({ text: o.text, on: pick === k, cls: pick === k ? (o.actual ? 'actual' : 'safe') : '',
            onClick: () => { c.setState(prev => ({ labIncBr: { ...(prev.labIncBr || {}), [i]: k } })); api('POST', `/api/lab/incidents/${cur.id}/branch`, { at: i, pick: k }).catch(() => {}); } })),
          // 새 3D 화면(steel-index)의 사고 사례 재현: 갈림길 설비에 고른 선택의 결과를 표시(incident-replay.js).
          brHref: opt ? `/3d-demo/steel-index.html?p=${cur.section}&lab=incident&scenario=${cur.id}&at=${i}&pick=${pick}` : '',
          brHasOutcome: !!opt, brOutcome: opt ? `${opt.actual ? '그대로 가면 → ' : '다르게 했다면 → '}${opt.outcome}` : '', brOutCls: opt ? (opt.actual ? 'actual' : 'safe') : '' };
      }),
      icMoreSteps: !!cur && step < cur.timeline.length, icNext: () => set({ labIncStep: step + 1 }), icAllSteps: () => set({ labIncStep: cur.timeline.length }),
      icShowQs: !!cur && step >= cur.timeline.length,
      icQs: (cur?.questions || []).map((q, qi) => {
        const r = res?.results?.find(x => x.id === q.id);
        return { n: qi + 1, prompt: q.prompt, explain: r ? `${r.correct ? '맞아요' : `정답: ${r.answer_text}`} — ${r.explain}` : '', hasExplain: !!r, cls: r ? (r.correct ? 'ok' : 'bad') : '',
          options: q.options.map(o => ({ text: o.text, on: (s.labIncAns || {})[q.id] === o.key, cls: r ? (o.key === r.answer ? 'right' : (s.labIncAns || {})[q.id] === o.key ? 'wrong' : '') : '',
            onClick: () => { if (!S().labIncRes) c.setState(prev => ({ labIncAns: { ...(prev.labIncAns || {}), [q.id]: o.key } })); } })) };
      }),
      icReflection: cur?.reflection || '', icRefl: s.labIncRefl || '', icOnRefl: e => set({ labIncRefl: e.target.value }),
      icSubmit: submitIncident, icCantSubmit: !!res || !cur || Object.keys(s.labIncAns || {}).length < (cur?.questions.length || 1),
      icScore: res ? `${Math.round(res.score * 100)}점 · ${res.results.filter(x => x.correct).length}/${res.results.length} 맞힘` : '', icHasScore: !!res,
      icRetry: () => cur && openIncident(cur.id),
    });

    // What-if
    const W = s.labWi, input = { ...(W?.input || {}), ...(s.labWiIn || {}) };
    Object.assign(v, {
      wiLoaded: !!W,
      wiSliders: WI_SLIDERS.map(([k, label, unit, min, max, step]) => ({ label, unit, min, max, step, value: input[k] ?? min, shown: `${Math.round((input[k] ?? 0) * 10) / 10}${unit}`, onChange: e => setWi(k, e.target.value) })),
      wiShare: W ? `철 원료 비율은 합이 100%가 되게 맞춰 계산해요(지금 소결 ${Math.round(W.input.sinter_pct)} · 펠릿 ${Math.round(W.input.pellet_pct)} · 괴광 ${Math.round(W.input.lump_pct)})` : '',
      wiOut: W ? WI_OUT.map(([k, label, unit, digits]) => {
        const now = W.result[k], base = W.baseline[k], d = now - base;
        return { label, value: `${Number(now).toFixed(digits)}${unit ? ` ${unit}` : ''}`, delta: Math.abs(d) < 10 ** -digits / 2 ? '기준과 같음' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}`, cls: Math.abs(d) < 10 ** -digits / 2 ? '' : d > 0 ? 'up' : 'down' };
      }) : [],
      wiSlag: W ? (() => { const b = W.result.slag_breakdown, tot = Math.max(1, b.sio2 + b.al2o3 + b.cao + b.mgo);
        return [['SiO2', b.sio2, '#c9a227'], ['Al2O3', b.al2o3, '#8f6bd1'], ['CaO', b.cao, '#4fb3a0'], ['MgO', b.mgo, '#e07a5f']].map(([n, x, col]) => ({ label: `${n} ${Math.round(x)}`, w: `${(x / tot) * 100}%`, col })); })() : [],
      wiTempPct: W ? Math.round(((W.result.hot_metal_temp_c - 1380) / 180) * 100) : 0,
      wiWarnings: (W?.result.warnings || []).map(text => ({ text })), wiNoWarn: !!W && !W.result.warnings.length,
      wiAssumptions: (W?.assumptions || []).map(text => ({ text })),
      wiReset: () => { set({ labWiIn: {} }); runWhatIf({}); },
    });

    // 설비 메모
    const N = s.labNotes, counts = s.labNoteCounts || {};
    Object.assign(v, {
      noEquipment: (c.state.processes || []).flatMap(p => p.equipment.map(e => ({ value: e.id, label: `${SECTION_LABEL[p.id] || p.name} · ${e.name}${counts[e.id] ? ` (${counts[e.id]})` : ''}` }))),
      noEq: s.labNoteEq || '', noPick: e => { set({ labNoteEq: e.target.value }); loadNotes(e.target.value); },
      noUseSelected: () => { const id = c.state.selectedId; if (id) { set({ labNoteEq: id }); loadNotes(id); } },
      noHasSelected: !!c.state.selectedId,
      noKinds: Object.entries(KIND_LABEL).map(([k, label]) => ({ label, on: (s.labNoteKind || 'question') === k, onClick: () => set({ labNoteKind: k }) })),
      noText: s.labNoteText || '', noOnText: e => set({ labNoteText: e.target.value }), noPost: notePost, noCantPost: (s.labNoteText || '').trim().length < 2,
      noPrivate: !!s.labNotePrivate, noOnPrivate: e => set({ labNotePrivate: e.target.checked }),
      noTitle: N ? `${N.equipment.name} · 메모 ${N.notes.length}개` : '',
      noList: (N?.notes || []).map(n => ({
        kind: KIND_LABEL[n.kind], kindCls: n.kind, author: n.author, text: n.text, when: new Date(n.created_at).toLocaleDateString('ko-KR'), priv: n.visibility === 'private', hidden: n.hidden,
        votes: `♥ ${n.votes}`, voteCls: n.voted ? 'on' : '', onVote: () => noteAct(n.id, '/vote'),
        mine: n.mine, onDelete: () => noteAct(n.id, '', undefined, 'DELETE'), notMine: !n.mine,
        onReport: () => { const reason = prompt('신고 이유를 적어 주세요(예: 광고, 틀린 내용).'); if (reason) noteAct(n.id, '/report', { reason }); },
        replies: n.replies.map(r => ({ author: r.author, text: r.text })),
        reply: (s.labNoteReply || {})[n.id] || '', onReply: e => set({ labNoteReply: { ...(S().labNoteReply || {}), [n.id]: e.target.value } }),
        sendReply: e => { e?.preventDefault?.(); const t = ((S().labNoteReply || {})[n.id] || '').trim(); if (t) noteAct(n.id, '/replies', { text: t }).then(() => set({ labNoteReply: { ...(S().labNoteReply || {}), [n.id]: '' } })); },
      })),
      noEmpty: !!N && !N.notes.length,
    });

    // 내 오답 유형
    const P = s.labPat;
    Object.assign(v, {
      paList: (P || []).map(p => ({ keywords: p.keywords.map(k => ({ k })), count: `${p.count}번`, open: p.open ? `미해결 ${p.open}` : '모두 해결', openCls: p.open ? 'bad' : 'ok',
        items: p.items.map(i => ({ summary: i.summary, concept: i.concept, status: i.resolved ? '해결됨' : '미해결', cls: i.resolved ? 'ok' : 'bad' })) })),
      paEmpty: !!P && !P.length,
    });
    return v;
  }
  return { loaders, vals, startBell };
}
