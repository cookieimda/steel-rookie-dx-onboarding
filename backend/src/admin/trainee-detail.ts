// 관리자 화면의 신입사원 한 명 상세(GET /api/admin/trainees/:id). 표에서 사람을 누르면 보여 준다.
// - 섹션 이해도·통과·오개념 개수는 목록과 같은 traineeStats로 계산한다(같은 숫자가 나오게).
// - 개념별 점수는 엔진과 같은 규칙(mergeAttemptResults → conceptScore)이다. 지금 루브릭(없으면 시연 목록) 개념만 본다.
// - 오개념은 목록과 같이 개수만 낸다. 내용·답변 원문은 본인만 본다(CLAUDE.md '오개념 기록').
import type { DatabaseSync } from "node:sqlite";
import { mergeAttemptResults, type ResultInput } from "../checkpoint/section-summary.js";
import { SECTION_NAMES, SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { statSections } from "../demo-sections.js";
import type { Rubric } from "../rubrics.js";
import { conceptScore } from "../scoring.js";
import { defaultDemoSections, defaultRubrics, hasTable, traineeStats, type SectionStat, type StatOptions, type TraineeStat } from "./trainee-stats.js";

export interface ConceptDetail {
  concept_id: string;
  name: string;
  /** 지금 점수(1·0.5·0). 이 개념을 아직 묻지 않았으면 null. */
  score: number | null;
  /** 확정 판정. 재확인 전이면 null. */
  final_verdict: "correct" | "partial" | "wrong" | null;
}

export interface SectionDetail {
  section: Section;
  name: string;
  /** 시연 목록 개념으로 계산한 섹션(final 루브릭 없음). */
  demo: boolean;
  /** 목록과 같은 섹션 통계. 끝낸 시도가 없으면 null. */
  stat: SectionStat | null;
  /** 끝나지 않은 시도(진행 중·멈춤). done/total은 확정한 개념 수. */
  in_progress: { state: string; done: number; total: number } | null;
  concepts: ConceptDetail[];
  /** 끝낸 시도(오래된 순서). */
  attempts: { kind: "first" | "retry"; completed_at: string; understanding: number | null; unlocked: boolean }[];
}

export interface TraineeDetail {
  trainee: TraineeStat;
  sections: SectionDetail[];
}

/** 신입사원 한 명의 상세. 없는 사람이거나 신입사원이 아니면 null. */
export function traineeDetail(db: DatabaseSync, userId: string, rubrics: readonly Rubric[] = defaultRubrics(), options: Pick<StatOptions, "demo"> = {}): TraineeDetail | null {
  const demo = options.demo ?? defaultDemoSections();
  const trainee = traineeStats(db, rubrics, { includeDemo: true, demo }).trainees.find((t) => t.id === userId);
  if (!trainee) return null;
  const sets = new Map(statSections(rubrics, demo).map((s) => [s.section, s]));
  const checkpointData = hasTable(db, "attempts");

  const sections = SECTION_ORDER.map((section): SectionDetail => {
    const set = sets.get(section);
    const base = { section, name: SECTION_NAMES[section], demo: set?.demo ?? false, stat: trainee.sections[section] };
    if (!set || !checkpointData) return { ...base, in_progress: null, concepts: (set?.concepts ?? []).map((c) => ({ ...c, score: null, final_verdict: null })), attempts: [] };

    // 시연 목록 섹션은 목록 통계와 같이 시연 기록(seed)만 본다.
    const originFilter = set.demo ? " AND origin = 'seed'" : "";
    const completed = db
      .prepare(`SELECT id, kind, completed_at, understanding, unlocked FROM attempts
                 WHERE user_id = ? AND section = ? AND state = 'completed'${originFilter} ORDER BY completed_at, created_at`)
      .all(userId, section);
    const resultsOf = db.prepare("SELECT concept_id, verdict, recheck_verdict FROM concept_results WHERE attempt_id = ?");
    const merged = mergeAttemptResults(set, completed.map((a) => resultsOf.all(String(a.id)).map((r): ResultInput => ({
      concept_id: String(r.concept_id),
      verdict: String(r.verdict) as ResultInput["verdict"],
      recheck_verdict: r.recheck_verdict == null ? null : (String(r.recheck_verdict) as ResultInput["recheck_verdict"]),
    }))));

    const open = db
      .prepare(`SELECT state, current_index, concept_ids FROM attempts WHERE user_id = ? AND section = ? AND state <> 'completed'${originFilter} ORDER BY created_at DESC LIMIT 1`)
      .get(userId, section);

    return {
      ...base,
      in_progress: open ? { state: String(open.state), done: Number(open.current_index), total: (JSON.parse(String(open.concept_ids)) as string[]).length } : null,
      concepts: set.concepts.map((c) => {
        const r = merged.get(c.concept_id);
        return {
          concept_id: c.concept_id,
          name: c.name,
          score: r ? conceptScore(r) : null,
          final_verdict: r ? r.recheckVerdict ?? (r.verdict === "correct" ? "correct" : null) : null,
        };
      }),
      attempts: completed.map((a) => ({
        kind: String(a.kind) as "first" | "retry",
        completed_at: String(a.completed_at),
        understanding: a.understanding == null ? null : Number(a.understanding),
        unlocked: Number(a.unlocked) === 1,
      })),
    };
  });
  return { trainee, sections };
}
