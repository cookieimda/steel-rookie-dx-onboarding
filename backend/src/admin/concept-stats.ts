import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { Section } from "../checkpoint/types.js";
import { statSections } from "../demo-sections.js";
import type { Rubric } from "../rubrics.js";
import { defaultDemoSections, defaultRubrics, hasTable, type StatOptions } from "./trainee-stats.js";

export interface ConceptStat {
  section: string;
  concept_id: string;
  /** 지금 final 루브릭(없는 섹션은 시연 목록)의 개념 이름. 어디에도 없는 id(바뀐 개념 등)는 없다. */
  name?: string;
  asked: number;
  partial: number;
  wrong: number;
  assisted: number;
  final_wrong: number;
  open: number;
}

/**
 * Aggregate first-question verdicts from completed trainee checkpoints, retries included.
 * Returns an empty list until the checkpoint tables exist.
 * concept_id는 루브릭 개념 id라 설비 id가 아니므로, 화면에 쓸 이름은 루브릭 `name`(루브릭이 없는 섹션은 시연 목록 이름)으로 붙인다.
 * includeDemo: false면 시연 계정(users.is_demo = 1)의 답변과 오개념을 뺀다.
 */
export function conceptStats(
  db: DatabaseSync, section?: Section, rubrics: readonly Rubric[] = defaultRubrics(), options: StatOptions = {},
): { concepts: ConceptStat[] } {
  const realOnly = options.includeDemo === false;
  if (!hasTable(db, "attempts") || !hasTable(db, "concept_results")) return { concepts: [] };
  const open = hasTable(db, "misconceptions")
    ? `(SELECT COUNT(*) FROM misconceptions m
              JOIN users mu ON mu.id = m.user_id
             WHERE mu.role = 'trainee'${realOnly ? " AND mu.is_demo = 0" : ""} AND m.section = a.section
               AND m.concept_id = c.concept_id AND m.resolved = 0)`
    : "0";
  const params: SQLInputValue[] = section ? [section] : [];
  const rows = db.prepare(`
    SELECT a.section, c.concept_id,
           COUNT(*) AS asked,
           SUM(CASE WHEN c.verdict = 'partial' THEN 1 ELSE 0 END) AS partial,
           SUM(CASE WHEN c.verdict = 'wrong' THEN 1 ELSE 0 END) AS wrong,
           SUM(CASE WHEN c.verdict = 'assisted' THEN 1 ELSE 0 END) AS assisted,
           SUM(CASE WHEN c.recheck_verdict = 'wrong' THEN 1 ELSE 0 END) AS final_wrong,
           ${open} AS open
      FROM concept_results c
      JOIN attempts a ON a.id = c.attempt_id
      JOIN users u ON u.id = a.user_id
     WHERE u.role = 'trainee'${realOnly ? " AND u.is_demo = 0" : ""} AND a.state = 'completed'${section ? " AND a.section = ?" : ""}
     GROUP BY a.section, c.concept_id
     ORDER BY a.section, c.concept_id
  `).all(...params);
  const sections = statSections(rubrics, options.demo ?? defaultDemoSections());
  const names = new Map(sections.flatMap((s) => s.concepts.map((c) => [`${s.section}/${c.concept_id}`, c.name])));
  return { concepts: rows.map((row) => ({
    section: String(row.section), concept_id: String(row.concept_id),
    ...(names.has(`${row.section}/${row.concept_id}`) ? { name: names.get(`${row.section}/${row.concept_id}`) } : {}),
    asked: Number(row.asked), partial: Number(row.partial), wrong: Number(row.wrong),
    assisted: Number(row.assisted), final_wrong: Number(row.final_wrong), open: Number(row.open),
  })) };
}
