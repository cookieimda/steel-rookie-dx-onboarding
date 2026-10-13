// 관리자 화면의 신입사원 통계. 오개념은 개수만 내보내고 내용·답변 원문은 내보내지 않는다(본인만 봄).
// 체크포인트 기록(attempts, misconceptions 테이블)은 001_checkpoint.sql이 만든다. 그 테이블이 아직 없으면 checkpoint_data: false와 빈 기록을 돌려준다.
// - 섹션 이해도·통과는 체크포인트 엔진과 같은 summarizeSection으로 계산한다(CLAUDE.md '점수 규칙'). 지금 final 루브릭 개념만 보고,
//   final 루브릭이 없는 섹션은 시연 목록(content/demo/sections.json) 개념으로 계산한다. 둘 다 없으면 미시작(null)이다.
//   시연 목록 섹션은 시연 기록(origin = 'seed')만 센다. 실제 계정은 그 섹션 체크포인트를 볼 수 없고(404), 루브릭이 없던 때의 옛 기록은 시연 개념과 맞지 않기 때문이다.
// - 오개념 개수는 체크포인트 기록(source = 'checkpoint')만, 개념 수로 센다(CLAUDE.md '오개념 기록').
// - 관리자 화면은 시연을 위해 시연 기록(origin = 'seed')도 센다. 실제 계정과 섞어 보여 주고 시연 계정은 is_demo로 표시한다.
//   includeDemo: false면 시연 계정(users.is_demo = 1)을 뺀다(?include_demo=false).
import type { DatabaseSync } from "node:sqlite";
import { summarizeSection, type CompletedAttemptInput, type ResultInput } from "../checkpoint/section-summary.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { loadDemoSections, statSections, type DemoSections } from "../demo-sections.js";
import { loadFinalRubrics, type Rubric } from "../rubrics.js";

export interface SectionStat {
  /** 지금 루브릭 개념 기준 이해도(0~1). 재도전 결과를 합친 값이다. */
  understanding: number;
  /** 통과했는지. 한 번 통과하면 루브릭이 바뀌어도 통과로 둔다. */
  passed: boolean;
  /** 끝낸 체크포인트 횟수(첫 시도 + 재도전). */
  attempts: number;
  /** 통과한 섹션에서 아직 확인하지 않은 개념(통과 뒤 루브릭에 새로 생긴 개념). */
  unconfirmed_concept_ids: string[];
}

export interface TraineeStat {
  id: string;
  username: string;
  name: string;
  employee_no: string;
  /** 시연 계정(trainee11~20). 관리자 화면에서 'demo' 배지를 붙인다. */
  is_demo: boolean;
  created_at: string;
  last_activity: string | null;
  sections: Record<Section, SectionStat | null>;
  passed_sections: number;
  /** 끝나지 않은 체크포인트(진행 중·'나중에 이어 풀기'로 멈춤)가 있는 섹션. 실패로 세지 않고 '진행 중'으로 보여 준다. */
  in_progress_sections: Section[];
  /** 체크포인트 오개념이 있었던 개념 수. open: 미해결 행이 있는 개념, resolved: 미해결 행이 하나도 없는 개념. */
  misconceptions: { open: number; resolved: number };
}

export interface TraineeStats {
  checkpoint_data: boolean;
  sections: readonly Section[];
  /** final 루브릭이 없어 시연 목록 개념으로 계산한 섹션. */
  demo_sections: Section[];
  /** 시연 계정을 포함했는지(?include_demo=false면 false). */
  include_demo: boolean;
  trainees: TraineeStat[];
}

export interface StatOptions {
  /** false면 시연 계정(users.is_demo = 1)을 뺀다. 기본 true(섞어서 보여 줌). */
  includeDemo?: boolean;
  /** 시연 개념 목록. 기본은 content/demo/sections.json. */
  demo?: DemoSections;
}

let finalRubrics: Rubric[] | null = null;
/** 서버가 시작할 때 검증한 것과 같은 final 루브릭. 처음 부를 때 한 번 읽는다. */
export const defaultRubrics = (): Rubric[] => (finalRubrics ??= loadFinalRubrics());

let demoSections: DemoSections | null = null;
/** 시연 개념 목록. 처음 부를 때 한 번 읽는다. */
export const defaultDemoSections = (): DemoSections => (demoSections ??= loadDemoSections());

export function traineeStats(db: DatabaseSync, rubrics: readonly Rubric[] = defaultRubrics(), options: StatOptions = {}): TraineeStats {
  const includeDemo = options.includeDemo ?? true;
  const sections = statSections(rubrics, options.demo ?? defaultDemoSections());
  const demo_sections = sections.filter((s) => s.demo).map((s) => s.section);
  const demoSet = new Set<string>(demo_sections);
  // 006_demo_accounts.sql 전의 DB에는 is_demo가 없다. 그때는 모두 실제 계정으로 본다.
  const demoColumn = hasColumn(db, "users", "is_demo");
  const users = db
    .prepare(`SELECT id, username, name, employee_no, ${demoColumn ? "is_demo" : "0 AS is_demo"}, created_at FROM users
               WHERE role = 'trainee'${includeDemo || !demoColumn ? "" : " AND is_demo = 0"} ORDER BY username`)
    .all();
  const checkpointData = hasTable(db, "attempts") && hasTable(db, "misconceptions");

  const trainees = users.map((u): TraineeStat => ({
    id: String(u.id),
    username: String(u.username),
    name: String(u.name),
    employee_no: String(u.employee_no),
    is_demo: Number(u.is_demo) === 1,
    created_at: String(u.created_at),
    last_activity: null,
    sections: Object.fromEntries(SECTION_ORDER.map((s) => [s, null])) as Record<Section, SectionStat | null>,
    passed_sections: 0,
    in_progress_sections: [],
    misconceptions: { open: 0, resolved: 0 },
  }));
  const base = { sections: SECTION_ORDER, demo_sections, include_demo: includeDemo };
  if (!checkpointData) return { checkpoint_data: false, ...base, trainees };

  const byId = new Map(trainees.map((t) => [t.id, t]));
  const rubricOf = new Map(sections.map((s) => [s.section, s]));
  const currentConcepts = new Map(sections.map((s) => [s.section, new Set(s.concepts.map((c) => c.concept_id))]));

  // 사람×섹션별 완료 시도(오래된 순서)와 그 개념 결과를 모아 엔진과 같은 함수로 계산한다.
  const results = new Map<string, ResultInput[]>();
  for (const row of db
    .prepare(`SELECT r.attempt_id, r.concept_id, r.verdict, r.recheck_verdict
                FROM concept_results r JOIN attempts a ON a.id = r.attempt_id
               WHERE a.state = 'completed'`)
    .all()) {
    const id = String(row.attempt_id);
    if (!results.has(id)) results.set(id, []);
    results.get(id)!.push({
      concept_id: String(row.concept_id),
      verdict: String(row.verdict) as ResultInput["verdict"],
      recheck_verdict: row.recheck_verdict == null ? null : (String(row.recheck_verdict) as ResultInput["recheck_verdict"]),
    });
  }
  const completed = new Map<string, CompletedAttemptInput[]>();
  for (const row of db
    .prepare("SELECT id, user_id, section, unlocked, origin FROM attempts WHERE state = 'completed' ORDER BY completed_at, created_at")
    .all()) {
    if (demoSet.has(String(row.section)) && String(row.origin) !== "seed") continue;
    const key = `${String(row.user_id)}\u0000${String(row.section)}`;
    if (!completed.has(key)) completed.set(key, []);
    completed.get(key)!.push({ unlocked: row.unlocked == null ? null : Number(row.unlocked) === 1, results: results.get(String(row.id)) ?? [] });
  }
  for (const t of trainees) {
    for (const section of SECTION_ORDER) {
      const rubric = rubricOf.get(section);
      const attempts = completed.get(`${t.id}\u0000${section}`);
      if (!rubric || !attempts) continue;
      const summary = summarizeSection(rubric, attempts);
      t.sections[section] = {
        understanding: summary.understanding ?? 0,
        passed: summary.passed,
        attempts: attempts.length,
        unconfirmed_concept_ids: summary.unconfirmed_concept_ids,
      };
    }
  }

  // 끝나지 않은 시도는 통계(이해도·통과·시도 수)에 넣지 않고 섹션만 표시한다.
  for (const row of db.prepare("SELECT DISTINCT user_id, section FROM attempts WHERE state <> 'completed'").all()) {
    const t = byId.get(String(row.user_id));
    const section = String(row.section) as Section;
    if (t && SECTION_ORDER.includes(section)) t.in_progress_sections.push(section);
  }
  for (const t of trainees) t.in_progress_sections.sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));

  const activity = db.prepare("SELECT user_id, MAX(updated_at) AS last FROM attempts GROUP BY user_id").all();
  for (const row of activity) {
    const t = byId.get(String(row.user_id));
    if (t) t.last_activity = row.last == null ? null : String(row.last);
  }

  // 개념마다 미해결 행이 하나라도 있으면 미해결, 없으면 해결로 센다. 지금 루브릭에 없는 개념은 뺀다.
  const conceptOpen = new Map<string, Map<string, boolean>>();
  for (const row of db.prepare("SELECT user_id, section, concept_id, resolved, origin FROM misconceptions WHERE source = 'checkpoint'").all()) {
    const userId = String(row.user_id);
    const conceptId = String(row.concept_id);
    if (demoSet.has(String(row.section)) && String(row.origin) !== "seed") continue;
    if (!byId.has(userId) || !currentConcepts.get(String(row.section) as Section)?.has(conceptId)) continue;
    if (!conceptOpen.has(userId)) conceptOpen.set(userId, new Map());
    const concepts = conceptOpen.get(userId)!;
    concepts.set(conceptId, (concepts.get(conceptId) ?? false) || Number(row.resolved) !== 1);
  }
  for (const [userId, concepts] of conceptOpen) {
    const open = [...concepts.values()].filter(Boolean).length;
    byId.get(userId)!.misconceptions = { open, resolved: concepts.size - open };
  }

  for (const t of trainees) t.passed_sections = SECTION_ORDER.filter((s) => t.sections[s]?.passed).length;
  return { checkpoint_data: true, ...base, trainees };
}

/** 열이 있는지. hasTable과 같은 방식(빈 조회)이다. */
export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  try {
    db.prepare(`SELECT ${column} FROM ${table} WHERE 1 = 0`).all();
    return true;
  } catch {
    return false;
  }
}

// PostgreSQL로 옮겨도 쓸 수 있게 시스템 테이블 대신 빈 조회로 테이블 존재를 확인한다.
export function hasTable(db: DatabaseSync, name: string): boolean {
  try {
    db.prepare(`SELECT 1 FROM ${name} WHERE 1 = 0`).all();
    return true;
  } catch {
    return false;
  }
}
