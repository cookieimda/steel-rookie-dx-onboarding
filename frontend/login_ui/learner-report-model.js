// 학습자 보고서(learner-report.html)의 데이터 모양. 화면·서버와 보고서 그리기를 떼어 두는 층이다.
// - API 응답(sources)을 받아 아래 '보고서 모델'로 바꾼다. 어떤 응답이 없거나(null) 모양이 달라도 그 부분만 비우고 멈추지 않는다.
// - 서버 API가 바뀌면 이 파일의 읽기 함수(read*)만 고치면 되고, 보고서 그리기(learner-report.js)는 그대로 둔다.
// - DOM·fetch를 쓰지 않는 순수 함수라 node 테스트로 확인한다(backend/test/learner-report-model.test.ts).
//
// 보고서 모델(schema 1)
// { schema, generatedAt, learner: { name },
//   section: { id, num, name, io },
//   equipment: [{ id, name, input, output, state: 'fog'|'seen'|'ok'|'bad' }],
//   checkpoint: { available, status: 'none'|'todo'|'retry'|'passed', understanding },
//   confused: [{ conceptId, name, why: 'misconception'|'retry', summary, answer, sourceLabel, equipmentId }],
//   understood: [{ conceptId, name }],
//   reviews: [{ conceptId, name, due, reason }],
//   next: [{ key, title, detail, done }],
//   sources: { <소스 이름>: 'ok'|'missing' } }

export const REPORT_SCHEMA = 1;
export const SECTION_NAMES = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const SECTION_ORDER = Object.keys(SECTION_NAMES);

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 설비 이름의 첫 낱말(예: '고로·장입 장치' → '고로', '코크스 오븐' → '코크스'). */
const shortName = (name) => String(name ?? '').split(/[·\s(]/)[0];

/**
 * 개념에 맞는 설비: 개념 이름에서 가장 앞에 나오는 설비 이름의 설비(예: '고로에서 코크스의 역할' → 고로).
 * 서버가 개념의 설비 id를 주면(equipmentIds) 그 안에서 고르고, 없으면 그 공정 설비 전체에서 고른다.
 */
export function equipmentForConcept(conceptName, equipment, equipmentIds = null) {
  const pool = equipmentIds?.length ? equipment.filter((e) => equipmentIds.includes(e.id)) : equipment;
  let best = null, at = Infinity;
  for (const e of pool) {
    // 설비 이름 첫 낱말, 또는 그 앞 두 글자(예: '소결기' → '소결의 목적'의 '소결')
    const s = shortName(e.name), keys = s.length > 2 ? [s, s.slice(0, 2)] : [s];
    for (const key of keys) {
      const i = key ? String(conceptName ?? '').indexOf(key) : -1;
      if (i >= 0 && i < at) { best = e.id; at = i; }
    }
  }
  return best ?? (equipmentIds?.length ? pool[0]?.id ?? null : null);
}

// ---- 읽기 함수: API 응답 하나씩. 모양이 다르면 빈 값 ----
function readEquipment(processes, sectionId) {
  const p = arr(processes).find((x) => x?.id === sectionId);
  return arr(p?.equipment).filter((e) => str(e?.id)).map((e) => ({ id: e.id, name: str(e.name) ?? e.id, input: str(e.input) ?? '', output: str(e.output) ?? '' }));
}
function readLearner(dashboard, me) {
  return { name: str(dashboard?.trainee?.name) ?? str(me?.user?.name) ?? str(me?.name) ?? null };
}
function readCheckpoint(dashboard, examSections, sectionId) {
  const listed = arr(examSections?.sections).find((s) => s?.section === sectionId);
  const stat = dashboard?.trainee?.sections?.[sectionId];
  const available = listed ? !!listed.checkpoint : stat !== undefined && stat !== null ? true : null;
  if (available === false) return { available: false, status: 'none', understanding: null };
  if (stat?.passed) return { available: true, status: 'passed', understanding: num(stat.understanding) };
  if (stat) return { available: true, status: 'retry', understanding: num(stat.understanding) };
  return { available: available ?? false, status: available ? 'todo' : 'none', understanding: null };
}
/** 헷갈린 개념: 보충학습 후보(이름·이유·요약)를 기준으로, 내 오개념 기록(답변 원문)을 붙인다. 후보 API가 없으면 오개념 기록만으로 만든다. */
function readConfused(supplements, misconceptions, sectionId) {
  const mis = arr(misconceptions?.misconceptions).filter((m) => m && !m.resolved && (!m.section || m.section === sectionId));
  const latest = new Map();
  for (const m of mis) if (str(m.concept_id) && !latest.has(m.concept_id)) latest.set(m.concept_id, m);
  const out = [];
  const cands = arr(supplements?.candidates);
  for (const c of cands) {
    if (!str(c?.concept_id)) continue;
    const m = latest.get(c.concept_id);
    out.push({ conceptId: c.concept_id, name: str(c.name) ?? c.concept_id, why: c.reason === 'retry' ? 'retry' : 'misconception',
      summary: str(c.summary) ?? str(m?.summary), answer: str(m?.answer_text), sourceLabel: str(m?.label), equipmentId: null });
  }
  if (!cands.length) for (const [id, m] of latest) out.push({ conceptId: id, name: str(m.concept_name) ?? id, why: 'misconception', summary: str(m.summary), answer: str(m.answer_text), sourceLabel: str(m.label), equipmentId: null });
  return out;
}
function readReviews(reviews, sectionId) {
  return arr(reviews?.tasks).filter((t) => t && (!t.section || t.section === sectionId))
    .map((t) => ({ conceptId: str(t.concept_id), name: str(t.concept_name) ?? str(t.concept_id) ?? '개념', due: str(t.due_date), reason: str(t.reason), completed: !!t.completed_at }));
}

/**
 * @param {object} sources  API 응답 모음. 없는 것은 null/undefined.
 *   processes(data_v2.js PROCESSES), dashboard(/api/me/dashboard), me(/api/auth/me), examSections(/api/exams/sections),
 *   supplements(/api/learning/supplements?section=), misconceptions(/api/me/misconceptions), reviews(/api/me/reviews),
 *   conceptEquipment({ concept_id: [설비 id] }, 선택), visits({ 설비 id: {...} }, 이 브라우저에서 본 설비)
 * @param {{ section: string, today?: string }} options
 */
export function buildReportModel(sources = {}, { section, today } = {}) {
  const sectionId = SECTION_ORDER.includes(section) ? section : SECTION_ORDER[0];
  const proc = arr(sources.processes).find((x) => x?.id === sectionId);
  const equipment = readEquipment(sources.processes, sectionId);
  const confused = readConfused(sources.supplements, sources.misconceptions, sectionId);
  for (const c of confused) c.equipmentId = equipmentForConcept(c.name, equipment, sources.conceptEquipment?.[c.conceptId]);
  const allReviews = readReviews(sources.reviews, sectionId);
  const reviews = allReviews.filter((r) => !r.completed).map(({ completed, ...r }) => r);
  const confusedIds = new Set(confused.map((c) => c.conceptId));
  // 이해한 개념: 이해도 확인 결과가 있는(복습 일정이 잡힌) 개념 중 헷갈린 개념이 아닌 것
  const understood = allReviews.filter((r) => r.conceptId && !confusedIds.has(r.conceptId)).map((r) => ({ conceptId: r.conceptId, name: r.name }));
  const visits = sources.visits && typeof sources.visits === 'object' ? sources.visits : {};
  const okEq = new Set(understood.map((u) => equipmentForConcept(u.name, equipment, sources.conceptEquipment?.[u.conceptId])).filter(Boolean));
  const badEq = new Set(confused.map((c) => c.equipmentId).filter(Boolean));
  for (const e of equipment) e.state = badEq.has(e.id) ? 'bad' : okEq.has(e.id) ? 'ok' : visits[e.id] ? 'seen' : 'fog';
  const checkpoint = readCheckpoint(sources.dashboard, sources.examSections, sectionId);
  const unseen = equipment.find((e) => e.state === 'fog');
  const next = [
    { key: 'confused', title: '헷갈린 개념 다시 보기', done: !confused.length, detail: confused.length ? confused.map((c) => c.name).join(', ') : '헷갈린 개념이 없어요' },
    { key: 'equipment', title: '안 본 설비 보기', done: !unseen, detail: unseen ? unseen.name : equipment.length ? '설비를 다 봤어요' : '설비 정보를 불러오지 못했어요' },
    { key: 'checkpoint', title: '이해도 확인', done: checkpoint.status === 'passed', na: checkpoint.status === 'none',
      detail: { none: '이 공정은 이해도 확인이 없어요', todo: '80% 이상이면 통과예요', retry: '만점이 아닌 개념만 다시 풀어요', passed: '통과했어요' }[checkpoint.status] },
  ];
  const sourceNames = ['processes', 'dashboard', 'examSections', 'supplements', 'misconceptions', 'reviews', 'conceptEquipment'];
  return {
    schema: REPORT_SCHEMA,
    generatedAt: today ?? null,
    learner: readLearner(sources.dashboard, sources.me),
    section: { id: sectionId, num: `0${SECTION_ORDER.indexOf(sectionId) + 1}`, name: str(proc?.name) ?? SECTION_NAMES[sectionId], io: str(proc?.io) ?? '' },
    equipment, checkpoint, confused, understood, reviews, next,
    sources: Object.fromEntries(sourceNames.map((k) => [k, sources[k] ? 'ok' : 'missing'])),
  };
}

/** 보고서 파일 이름: 이름_공정_학습보고서_날짜 */
export function reportFileName(model) {
  return [model.learner?.name || '학습자', model.section?.name || '공정', '학습보고서', model.generatedAt || ''].filter(Boolean).join('_').replace(/[\\/:*?"<>|]/g, '');
}
