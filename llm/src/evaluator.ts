// 체크포인트 평가자(Gemini). temperature 0, responseSchema로 판정 JSON을 강제하고,
// 서버에서 한 번 더 검증해 실패하면 1회 재시도한다.
import { z } from "zod";
import {
  EvaluationFormatError,
  explainFromProblem,
  type EvaluateInput,
  type Evaluation,
  type Evaluator,
  type Phase,
} from "../../backend/src/checkpoint/types.js";
import type { Rubric, RubricConcept } from "../../backend/src/rubrics.js";
import { escapeDelimited, renderPrompt, type LlmClient } from "./gemini.js";

const MAX_ATTEMPTS = 2;

const ASSISTED_RULE: Record<Phase, string> = {
  initial: '- assisted: 답하지 않고 되묻거나("무슨 뜻이에요?"), 힌트·정답을 요청하거나("모르겠어요, 알려 주세요"), 질문과 무관한 말을 한 경우.',
  recheck: "- 이 질문은 설명을 들은 뒤의 재확인 질문입니다. 되묻기·힌트 요청·질문과 무관한 말은 wrong입니다. 이 단계에는 assisted 판정이 없습니다.",
};
const PHASE_NOTE: Record<Phase, string> = {
  initial: "",
  recheck: "- 재확인 단계이므로 verdict는 correct, partial, wrong 중 하나입니다.",
};

function verdicts(phase: Phase): string[] {
  return phase === "recheck" ? ["correct", "partial", "wrong"] : ["correct", "partial", "wrong", "assisted"];
}

/** Gemini responseSchema. 재확인 단계는 verdict에서 assisted를 뺀다. */
export function evaluatorResponseSchema(phase: Phase): object {
  return {
    type: "OBJECT",
    properties: {
      evidence: { type: "STRING" },
      verdict: { type: "STRING", enum: verdicts(phase) },
      misconception: { type: "STRING", nullable: true },
      explain_from: { type: "INTEGER", nullable: true },
    },
    required: ["evidence", "verdict", "misconception", "explain_from"],
    propertyOrdering: ["evidence", "verdict", "misconception", "explain_from"],
  };
}

export function evaluatorSystemPrompt(rubric: Rubric, concept: RubricConcept, phase: Phase): string {
  const glossary = rubric.glossary?.length
    ? rubric.glossary.map((g) => `- ${g.term} = ${g.aliases.join(", ")}`).join("\n")
    : "(없음)";
  return renderPrompt("evaluator", {
    name: concept.name,
    correct: concept.correct,
    partial: concept.partial,
    wrong: concept.wrong,
    assisted_rule: ASSISTED_RULE[phase],
    key_points: concept.key_points.map((k, i) => `${i}. ${k.point} — 근거: "${k.quote}"`).join("\n"),
    glossary,
    phase_note: PHASE_NOTE[phase],
  });
}

export function evaluatorUserPrompt(question: string, answer: string): string {
  return `<question>${escapeDelimited(question)}</question>\n<answer>${escapeDelimited(answer)}</answer>`;
}

/** 형식과 일관성을 검사한다. 맞지 않으면 이유를 돌려준다. */
export function parseEvaluation(raw: string, concept: RubricConcept, phase: Phase): Evaluation | string {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return "JSON이 아님";
  }
  const parsed = z.object({
    evidence: z.string(),
    verdict: z.enum(verdicts(phase) as [Evaluation["verdict"], ...Evaluation["verdict"][]]),
    misconception: z.string().nullable(),
    explain_from: z.number().int().nullable(),
  }).safeParse(json);
  if (!parsed.success) return `스키마 불일치: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`;
  const e = parsed.data;
  if (e.verdict === "correct" && e.misconception !== null) return "correct인데 misconception이 있음";
  return explainFromProblem(e, concept.key_points.length) ?? e;
}

/** 평가 한 번의 상세 결과. formatProblems는 형식 검증에 실패한 시도의 이유(재시도 횟수 = 길이). */
export interface DetailedEvaluation {
  evaluation: Evaluation | null;
  attempts: number;
  formatProblems: string[];
}

export class GeminiEvaluator implements Evaluator {
  constructor(private readonly gemini: LlmClient) {}

  async evaluate(input: EvaluateInput): Promise<Evaluation> {
    const { evaluation, formatProblems } = await this.evaluateDetailed(input);
    if (evaluation) return evaluation;
    throw new EvaluationFormatError(`평가자 출력 형식 오류(${MAX_ATTEMPTS}회): ${formatProblems.join(" / ")}`);
  }

  /** 형식 재시도 기록까지 돌려준다. 끝까지 형식이 틀리면 evaluation이 null이다. */
  async evaluateDetailed({ rubric, concept, question, answer, phase }: EvaluateInput): Promise<DetailedEvaluation> {
    const request = {
      system: evaluatorSystemPrompt(rubric, concept, phase),
      prompt: evaluatorUserPrompt(question, answer),
      temperature: 0,
      maxOutputTokens: 512,
      responseSchema: evaluatorResponseSchema(phase),
    };
    const formatProblems: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // LLM 연결 오류(LlmUnavailableError)는 재시도하지 않고 그대로 올린다.
      const result = parseEvaluation(await this.gemini.generate(request), concept, phase);
      if (typeof result !== "string") return { evaluation: result, attempts: attempt, formatProblems };
      formatProblems.push(result);
    }
    return { evaluation: null, attempts: MAX_ATTEMPTS, formatProblems };
  }
}
