// 섹션 결과 계산. 체크포인트 엔진과 관리자 통계·신입사원 대시보드가 같은 기준으로 이해도·통과를 내도록 이 함수만 쓴다.
// - 개념은 지금 final 루브릭의 개념만 본다. 바뀌거나 빠진 concept_id의 결과는 버린다(행은 DB에 남는다).
// - 한 번 통과(완료 시점에 해금)한 섹션은 루브릭이 바뀌어도 통과로 둔다. 새 개념은 다시 묻지 않고 미확인으로 남긴다.
// DB를 읽지 않는다. 어떤 시도를 넣을지(실제 기록만, 시연 포함 등)는 부르는 쪽이 정한다.
// 개념 목록만 쓰므로 Rubric 대신 ConceptSet을 받는다. 엔진은 final 루브릭을, 관리자 통계는 루브릭이 없는 섹션에 한해 시연 목록(demo-sections.ts)을 넘긴다.
import { allConfirmed, applyRetry, conceptResult, conceptsToRetry, isUnlocked, understanding, type ConceptResult, type RecheckVerdict, type Verdict } from "../scoring.js";

export interface ResultInput {
  concept_id: string;
  verdict: Verdict;
  recheck_verdict: RecheckVerdict | null;
}

export interface CompletedAttemptInput {
  /** 완료 시점의 해금 여부(attempts.unlocked). */
  unlocked: boolean | null;
  results: ResultInput[];
}

export interface SectionSummary {
  /** 완료한 시도가 없으면 false. */
  passed: boolean;
  /** 완료한 시도가 없으면 null. 지금 루브릭 개념 기준이라 통과 뒤 새 개념이 생기면 낮아질 수 있다. */
  understanding: number | null;
  retry_concept_ids: string[];
  /** 통과한 섹션에서 아직 확인하지 않은 개념. */
  unconfirmed_concept_ids: string[];
}

/** 섹션의 개념 목록. final 루브릭(Rubric)이나 관리자 통계의 시연 목록(StatSection)이 그대로 맞는다. */
export interface ConceptSet {
  concepts: readonly { concept_id: string }[];
}

export const rubricConceptIds = (rubric: ConceptSet): string[] => rubric.concepts.map((c) => c.concept_id);

/** 완료된 시도들의 결과를 오래된 순서로 합친다. 지금 루브릭에 없는 개념은 버린다. */
export function mergeAttemptResults(rubric: ConceptSet, attempts: ResultInput[][]): Map<string, ConceptResult> {
  const ids = rubricConceptIds(rubric);
  const current = new Set(ids);
  let merged = new Map<string, ConceptResult>();
  for (const results of attempts) {
    const kept = results.filter((r) => current.has(r.concept_id)).map((r) => [r.concept_id, conceptResult(r.concept_id, r.verdict, r.recheck_verdict)] as const);
    merged = applyRetry(ids, merged, new Map(kept));
  }
  return merged;
}

/** 한 번 통과했으면 통과. 아니면 지금 루브릭 기준으로 해금 조건을 본다. */
export function isSectionPassed(rubric: ConceptSet, completed: { unlocked: boolean | null }[], merged: Map<string, ConceptResult>): boolean {
  return completed.some((a) => a.unlocked === true) || (completed.length > 0 && isUnlocked(rubricConceptIds(rubric), merged));
}

/** 완료된 시도(오래된 순서)로 섹션 결과를 만든다. */
export function summarizeSection(rubric: ConceptSet, completed: CompletedAttemptInput[]): SectionSummary {
  const ids = rubricConceptIds(rubric);
  const merged = mergeAttemptResults(rubric, completed.map((a) => a.results));
  const passed = isSectionPassed(rubric, completed, merged);
  return {
    passed,
    understanding: completed.length ? understanding(ids, merged) : null,
    retry_concept_ids: completed.length && !passed ? conceptsToRetry(ids, merged) : [],
    unconfirmed_concept_ids: passed ? ids.filter((id) => !allConfirmed([id], merged)) : [],
  };
}
