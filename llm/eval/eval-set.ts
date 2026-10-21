// 평가자 정확도 평가 세트 로더. 실행(run-evaluator)과 형식 테스트가 함께 쓴다. 형식은 llm/eval/README.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Phase } from "../../backend/src/checkpoint/types.js";
import type { Verdict } from "../../backend/src/scoring.js";

export const EVAL_SETS = ["smoke", "hard"] as const;
export type EvalSetName = (typeof EVAL_SETS)[number];
export const SOURCES = ["synthetic", "human"] as const;
export const CASE_TYPES = ["paraphrase", "mixed", "noisy", "confusion", "injection", "pair", "out_of_rubric_fact"] as const;

export interface EvalCase {
  file: string;
  line: number;
  section: string;
  concept_id: string;
  phase: Phase;
  question: string;
  answer: string;
  expected_verdict: Verdict;
  source: (typeof SOURCES)[number];
  type?: (typeof CASE_TYPES)[number];
  pair_id?: string;
  question_id?: string;
  respondent?: string;
  case_id?: string;
  note?: string;
}

export const EVAL_DIR = join(process.cwd(), "llm", "eval");

/** 세트 폴더에서 섹션의 파일들: {section}.jsonl, {section}.{이름}.jsonl */
export function evalFiles(set: EvalSetName, section: string): string[] {
  const dir = join(EVAL_DIR, set);
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${section}(\\.[\\w-]+)?\\.jsonl$`);
  return readdirSync(dir).filter((name) => pattern.test(name)).sort();
}

export function loadEvalSet(set: EvalSetName, section: string): EvalCase[] {
  return evalFiles(set, section).flatMap((file) =>
    readFileSync(join(EVAL_DIR, set, file), "utf8")
      .split("\n")
      .map((text, i) => ({ text: text.trim(), line: i + 1 }))
      .filter(({ text }) => text)
      .map(({ text, line }) => ({ file: `${set}/${file}`, line, section, ...(JSON.parse(text) as Omit<EvalCase, "file" | "line" | "section">) })),
  );
}
