// 관리자 대시보드 "AI 요약". 개념 통계(concept-stats.ts)에서 오답률 높은 개념을 골라 LLM에 집계 숫자만 넘긴다.
import type { DatabaseSync } from "node:sqlite";
import type { AdminSummarizer, SummaryConcept } from "../../../llm/src/admin-summary.js";
import { SECTION_NAMES, type Section } from "../checkpoint/types.js";
import type { Rubric } from "../rubrics.js";
import { conceptStats, type ConceptStat } from "./concept-stats.js";
import { defaultRubrics } from "./trainee-stats.js";

/** LLM에 넘기는 개념 수(오답률 높은 순). */
export const SUMMARY_TOP = 5;
/** 같은 집계로 다시 부르면 이 시간 동안 저장한 요약을 준다. 대시보드를 열 때마다 호출하지 않게 한다. */
export const SUMMARY_TTL_MS = 10 * 60_000;

export interface AiSummary {
  /** 요약 문장. 집계할 기록이 없으면 null. */
  summary: string | null;
  /** 요약에 쓴 개념(오답률 높은 순). */
  concepts: { section: string; concept_id: string; name: string }[];
  generated_at: string | null;
  cached: boolean;
}

const missOf = (c: ConceptStat) => c.partial + c.wrong + c.assisted;

/**
 * 요약에 넣을 개념: 지금 final 루브릭에 있는 개념(`name`이 있음) 중 정답이 아닌 첫 답변이 있는 것.
 * 정렬은 대시보드 '오답률 높은 개념'과 같다(오답률 내림차순, 같으면 wrong 많은 순).
 */
export function topMissedConcepts(stats: readonly ConceptStat[], top = SUMMARY_TOP): ConceptStat[] {
  return stats
    .filter((c) => c.name && c.asked > 0 && missOf(c) > 0)
    .sort((a, b) => missOf(b) / b.asked - missOf(a) / a.asked || b.wrong - a.wrong)
    .slice(0, top);
}

/** LLM 입력. 숫자와 공정·개념 이름만 남긴다. */
export function toSummaryInput(stats: readonly ConceptStat[]): SummaryConcept[] {
  return stats.map((c) => ({
    section_name: SECTION_NAMES[c.section as Section] ?? c.section,
    name: c.name!,
    asked: c.asked, partial: c.partial, wrong: c.wrong, assisted: c.assisted,
    final_wrong: c.final_wrong, open: c.open,
  }));
}

export class AiSummaryService {
  /** 섹션(전체는 "all")별 마지막 요약. */
  private readonly cache = new Map<string, { key: string; summary: string; at: number }>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly summarizer: AdminSummarizer,
    private readonly rubrics: () => readonly Rubric[] = defaultRubrics,
    private readonly now: () => number = Date.now,
  ) {}

  /** LLM 연결 실패·호출 한도 초과는 예외 그대로 올려 보낸다(라우터가 상태 코드로 바꿈). */
  async summarize(section?: Section): Promise<AiSummary> {
    const top = topMissedConcepts(conceptStats(this.db, section, this.rubrics()).concepts);
    const concepts = top.map((c) => ({ section: c.section, concept_id: c.concept_id, name: c.name! }));
    if (top.length === 0) return { summary: null, concepts, generated_at: null, cached: false };

    const input = toSummaryInput(top);
    // 집계 숫자가 같을 때만 저장한 요약을 쓴다. 기록이 바뀌면 키가 달라져 새로 부른다.
    const scope = section ?? "all";
    const key = JSON.stringify(input);
    const hit = this.cache.get(scope);
    if (hit && hit.key === key && this.now() - hit.at < SUMMARY_TTL_MS) {
      return { summary: hit.summary, concepts, generated_at: new Date(hit.at).toISOString(), cached: true };
    }
    const summary = await this.summarizer.summarize(input);
    const at = this.now();
    this.cache.set(scope, { key, summary, at });
    return { summary, concepts, generated_at: new Date(at).toISOString(), cached: false };
  }
}
