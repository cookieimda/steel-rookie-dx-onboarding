// 체크포인트 DB의 첫 판정(initial) 답변을 평가 세트 형식으로 꺼낸다. 실행은 export-human.ts.
// 사람 판정을 블라인드로 하기 위해 expected_verdict는 비우고, 당시 모델 판정은 별도로 돌려준다.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ExportedCase {
  case_id: string;
  respondent: string;
  concept_id: string;
  phase: "initial";
  question: string;
  answer: string;
  expected_verdict: "";
  source: "human";
}

export interface ModelVerdict {
  case_id: string;
  model_verdict: string;
  evidence: string | null;
  explain_from: number | null;
  misconception: string | null;
}

/**
 * 실제 기록(origin = 'live')만 고르는 조건. 시연 기록(db:seed-demo)은 사람 답변이 아니므로 뺀다.
 * 005_record_origin.sql 전의 DB(읽기 전용이라 마이그레이션하지 않음)는 같은 기준으로 고른다: 엔진이 만든 시도에만 대화 기록이 있다.
 */
function liveAttempts(db: DatabaseSync): string {
  try {
    db.prepare("SELECT origin FROM attempts WHERE 1 = 0").all();
    return "a.origin = 'live'";
  } catch {
    return "EXISTS (SELECT 1 FROM attempt_messages am WHERE am.attempt_id = a.id)";
  }
}

/**
 * 여러 DB를 함께 내보낸다. 실제 기록(origin = 'live')만 내보낸다.
 * 사용자 id는 DB와 사용자 조합별로 p01, p02…로 바꾸고, case_id는 원래 id를 알 수 없게 해시로 만든다.
 */
export function exportHumanAnswers(sources: { label: string; db: DatabaseSync }[], section: string): { cases: ExportedCase[]; verdicts: ModelVerdict[] } {
  const respondents = new Map<string, string>();
  const cases: ExportedCase[] = [];
  const verdicts: ModelVerdict[] = [];

  for (const { label, db } of sources) {
    const rows = db.prepare(
      `SELECT r.attempt_id, r.concept_id, r.question, r.answer, r.verdict, r.evidence, r.explain_from, a.user_id,
              (SELECT m.summary FROM misconceptions m
                WHERE m.attempt_id = r.attempt_id AND m.concept_id = r.concept_id AND m.phase = 'initial' LIMIT 1) AS misconception
         FROM concept_results r JOIN attempts a ON a.id = r.attempt_id
        WHERE a.section = ? AND ${liveAttempts(db)}
        ORDER BY a.created_at, r.created_at`,
    ).all(section);

    for (const row of rows) {
      const userKey = `${label}\u0000${String(row.user_id)}`;
      if (!respondents.has(userKey)) respondents.set(userKey, `p${String(respondents.size + 1).padStart(2, "0")}`);
      const caseId = "h-" + createHash("sha256").update(`${label}\u0000${String(row.attempt_id)}\u0000${String(row.concept_id)}`).digest("hex").slice(0, 10);
      cases.push({
        case_id: caseId,
        respondent: respondents.get(userKey)!,
        concept_id: String(row.concept_id),
        phase: "initial",
        question: String(row.question),
        answer: String(row.answer),
        expected_verdict: "",
        source: "human",
      });
      verdicts.push({
        case_id: caseId,
        model_verdict: String(row.verdict),
        evidence: row.evidence === null ? null : String(row.evidence),
        explain_from: row.explain_from === null ? null : Number(row.explain_from),
        misconception: row.misconception === null ? null : String(row.misconception),
      });
    }
  }
  return { cases, verdicts };
}

export const toJsonl = (items: object[]) => items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
