// 학습 상태 HUD의 순수 계산. 브라우저 없이 테스트한다(backend/test/learn-hud-state.test.ts).
// - 개념 → 설비 연결은 루브릭에 `equipment_ids`(선택)가 생기기 전까지 여기 임시 표로 둔다(CLAUDE.md '다음 단계', docs/equipment-ids.md).
//   루브릭에 생기면 서버가 progress 응답에 담고 이 표는 지운다.
// - 설비 상태 우선순위: review(미해결 오개념·재도전 개념) > passed(통과) > unconfirmed(통과 뒤 새로 생긴 개념) > open(기록 없음).
// - 오개념은 체크포인트(source = checkpoint) 미해결만 센다. 학습 모드 메모는 참고용이라 핀에 올리지 않는다(CLAUDE.md '오개념 기록').

/** 섹션 → 개념 id → 설비 id 목록(data_v2.js의 24개 설비 기준). */
export const CONCEPT_EQUIPMENT = {
  ironmaking: {
    sinter_purpose: ['sinter_plant'],
    coke_reduction: ['coke_oven', 'blast_furnace'],
    blast_furnace_hot_metal: ['blast_furnace', 'taphole_casthouse'],
  },
  steelmaking: {},
  continuous_casting: {},
  rolling: {},
};

/** 낮은 순. 설비에 개념이 여럿이면 가장 높은 상태를 쓴다. */
export const STATUS_ORDER = ['open', 'unconfirmed', 'passed', 'review'];

/** 핀 문구·색. 색은 v4 화면의 --warn(호박색)·3D 강조색(시안)·--muted와 같다. */
export const PIN = {
  review: { text: '다시 보기', color: '#f5b13d', pulse: true },
  passed: { text: '통과', color: '#22c7f0', pulse: false },
  unconfirmed: { text: '미확인', color: '#a1a1a6', pulse: false },
  open: { text: '', color: '', pulse: false },
};

/**
 * 개념별 상태.
 * @param {string} section
 * @param {{ unlocked?: boolean, retry_concept_ids?: string[], unconfirmed_concept_ids?: string[] } | null} progress GET /api/sections/:section/progress 응답(없으면 null)
 * @param {{ concept_id: string, source: string, resolved: boolean }[]} misconceptions GET /api/me/misconceptions 항목 중 그 섹션 것
 * @returns {Record<string, 'open' | 'unconfirmed' | 'passed' | 'review'>}
 */
export function conceptStatuses(section, progress, misconceptions = [], map = CONCEPT_EQUIPMENT) {
  const review = new Set();
  for (const m of misconceptions) if (m && m.source === 'checkpoint' && !m.resolved && m.concept_id) review.add(m.concept_id);
  for (const id of progress?.retry_concept_ids ?? []) review.add(id);
  const unconfirmed = new Set(progress?.unconfirmed_concept_ids ?? []);
  const out = {};
  for (const id of Object.keys(map[section] ?? {})) {
    out[id] = review.has(id) ? 'review' : !progress?.unlocked ? 'open' : unconfirmed.has(id) ? 'unconfirmed' : 'passed';
  }
  for (const id of review) if (!(id in out)) out[id] = 'review'; // 표에 없는 개념의 오개념도 잃지 않는다(설비에는 못 붙는다)
  return out;
}

/**
 * 설비별 상태. 개념이 여럿 걸린 설비는 가장 높은 상태(STATUS_ORDER)를 쓴다.
 * @returns {Record<string, { status: string, concepts: { concept_id: string, status: string }[] }>}
 */
export function equipmentStatuses(section, conceptStatus, map = CONCEPT_EQUIPMENT) {
  const out = {};
  for (const [cid, eqIds] of Object.entries(map[section] ?? {})) {
    const st = conceptStatus[cid] ?? 'open';
    for (const eq of eqIds) {
      const cur = out[eq] ?? (out[eq] = { status: 'open', concepts: [] });
      cur.concepts.push({ concept_id: cid, status: st });
      if (STATUS_ORDER.indexOf(st) > STATUS_ORDER.indexOf(cur.status)) cur.status = st;
    }
  }
  return out;
}

/** GET /api/me/misconceptions 목록을 섹션별로 나눈다. */
export function groupBySection(misconceptions) {
  const out = {};
  for (const m of misconceptions ?? []) { if (!m?.section) continue; (out[m.section] ??= []).push(m); }
  return out;
}

/** 숫자 칩: data_v2.js 설비의 facts[0](출처 있는 값). 없으면 null. */
export function factChip(eq) {
  const f = eq?.facts?.[0];
  return f && f.v ? { value: String(f.v), label: String(f.k ?? ''), src: String(f.src ?? '') } : null;
}

/** 핀 보임 규칙: 상태 칩은 open이 아닐 때, 숫자 칩은 선택·호버 중이고 값이 있을 때. */
export function pinVisibility(status, { selected = false, hovered = false, fact = null } = {}) {
  return { statusChip: !!status && status !== 'open', factChip: !!fact && (selected || hovered) };
}
