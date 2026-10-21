// 체크포인트 점수 계산.
// LLM은 판정(verdict)만 내고, 점수·해금·재도전 대상은 이 모듈이 계산한다.
// 규칙은 CLAUDE.md의 '점수 규칙'을 따른다.

export type Verdict = "correct" | "partial" | "wrong" | "assisted";
export type RecheckVerdict = "correct" | "partial" | "wrong";

// 0.79999… 같은 부동소수점 오차로 경계값이 뒤집히지 않도록 0.5점 단위 정수(half-point)로 계산한다.
const VERDICT_HALF_POINTS: Record<RecheckVerdict, number> = { correct: 2, partial: 1, wrong: 0 };
const MAX_HALF_POINTS = 2;
// 이해도 80% 이상: 획득 half-point / 최대 half-point >= 4 / 5
const PASS_NUMERATOR = 4;
const PASS_DENOMINATOR = 5;

// 부가 설명 후 다른 각도의 질문으로 한 번 재확인하는 판정. 최종 점수는 재확인 판정으로 정한다.
const RECHECK_VERDICTS: ReadonlySet<Verdict> = new Set(["partial", "wrong", "assisted"]);

// 재도전 때 만점이 아닌 개념(partial 포함)을 다시 묻는다.
export const RETRY_PARTIAL = true;

export interface ConceptResult {
  readonly conceptId: string;
  readonly verdict: Verdict;
  /** 재확인 판정. null이면 재확인을 아직 하지 않았다. */
  readonly recheckVerdict: RecheckVerdict | null;
}

export type Results = ReadonlyMap<string, ConceptResult>;

export interface SectionStatus {
  understanding: number;
  allConfirmed: boolean;
  unlocked: boolean;
  retryConceptIds: string[];
}

const isVerdict = (v: string): v is Verdict => v === "correct" || RECHECK_VERDICTS.has(v as Verdict);
const isRecheckVerdict = (v: string): v is RecheckVerdict => v in VERDICT_HALF_POINTS;

export function conceptResult(conceptId: string, verdict: Verdict, recheckVerdict: RecheckVerdict | null = null): ConceptResult {
  if (!isVerdict(verdict)) throw new Error(`알 수 없는 판정: ${verdict}`);
  if (recheckVerdict !== null) {
    if (!RECHECK_VERDICTS.has(verdict)) throw new Error(`${verdict} 판정은 재확인 대상이 아니다: ${conceptId}`);
    if (!isRecheckVerdict(recheckVerdict)) throw new Error(`재확인 판정은 correct·partial·wrong 중 하나다: ${recheckVerdict}`);
  }
  return Object.freeze({ conceptId, verdict, recheckVerdict });
}

/** 점수가 확정됐는지. correct가 아니면 재확인을 마쳐야 확정된다. */
export function isConfirmed(result: ConceptResult): boolean {
  return !RECHECK_VERDICTS.has(result.verdict) || result.recheckVerdict !== null;
}

/** 재확인 판정을 기록한다. 재확인은 개념당 한 번뿐이다. */
export function recordRecheck(result: ConceptResult, recheckVerdict: RecheckVerdict): ConceptResult {
  if (!RECHECK_VERDICTS.has(result.verdict)) throw new Error(`${result.verdict} 판정은 재확인 대상이 아니다: ${result.conceptId}`);
  if (result.recheckVerdict !== null) throw new Error(`이미 재확인한 개념이다: ${result.conceptId}`);
  return conceptResult(result.conceptId, result.verdict, recheckVerdict);
}

function conceptHalfPoints(result: ConceptResult): number {
  if (!isConfirmed(result)) return 0;
  return VERDICT_HALF_POINTS[result.recheckVerdict ?? (result.verdict as RecheckVerdict)];
}

/** 개념 점수(1, 0.5, 0). 확정되지 않은 개념은 0점으로 본다. */
export function conceptScore(result: ConceptResult): number {
  return conceptHalfPoints(result) / MAX_HALF_POINTS;
}

function sectionHalfPoints(conceptIds: readonly string[], results: Results): number {
  if (conceptIds.length === 0) throw new Error("섹션에 개념이 없다.");
  return conceptIds.reduce((sum, id) => sum + (results.has(id) ? conceptHalfPoints(results.get(id)!) : 0), 0);
}

/** 섹션 개념 점수의 평균(0~1). 아직 묻지 않은 개념은 0점으로 계산한다. */
export function understanding(conceptIds: readonly string[], results: Results): number {
  return sectionHalfPoints(conceptIds, results) / (conceptIds.length * MAX_HALF_POINTS);
}

export function allConfirmed(conceptIds: readonly string[], results: Results): boolean {
  return conceptIds.every((id) => results.has(id) && isConfirmed(results.get(id)!));
}

/** 모든 개념을 확인했고 이해도가 80% 이상이면 다음 섹션을 연다. */
export function isUnlocked(conceptIds: readonly string[], results: Results): boolean {
  if (!allConfirmed(conceptIds, results)) return false;
  const earned = sectionHalfPoints(conceptIds, results);
  return earned * PASS_DENOMINATOR >= conceptIds.length * MAX_HALF_POINTS * PASS_NUMERATOR;
}

/** 재도전 때 다시 물을 개념. 루브릭 순서를 유지하고, 맞힌 개념은 빼고 돌려준다. */
export function conceptsToRetry(conceptIds: readonly string[], results: Results): string[] {
  return conceptIds.filter((id) => {
    const result = results.get(id);
    if (!result || !isConfirmed(result)) return true;
    const points = conceptHalfPoints(result);
    return points === 0 || (RETRY_PARTIAL && points < MAX_HALF_POINTS);
  });
}

/** 재도전 결과로 덮어쓴다. 다시 묻지 않은 개념은 이전 결과를 그대로 둔다. */
export function applyRetry(conceptIds: readonly string[], previous: Results, retried: Results): Map<string, ConceptResult> {
  const allowed = new Set(conceptsToRetry(conceptIds, previous));
  const extra = [...retried.keys()].filter((id) => !allowed.has(id)).sort();
  if (extra.length) throw new Error(`재도전 대상이 아닌 개념: ${extra.join(", ")}`);
  return new Map([...previous, ...retried]);
}

export function sectionStatus(conceptIds: readonly string[], results: Results): SectionStatus {
  return {
    understanding: understanding(conceptIds, results),
    allConfirmed: allConfirmed(conceptIds, results),
    unlocked: isUnlocked(conceptIds, results),
    retryConceptIds: conceptsToRetry(conceptIds, results),
  };
}
