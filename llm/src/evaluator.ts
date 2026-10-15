// 체크포인트 평가자(Gemini). temperature 0, responseSchema로 판정 JSON을 강제하고,
// 서버에서 한 번 더 검증해 실패하면 1회 재시도한다. repairFormat(로컬 모델용)이면 그래도 어긋난 판정 필드를 규칙대로 보정한다(repairEvaluation).
// verifyBoundary(로컬 모델용)면 wrong·partial을 핵심 요소별로 한 번 더 물어 한 단계만 올린다(applyKeyPointCheck).
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
  const e = parseShape(raw, phase);
  if (typeof e === "string") return e;
  if (e.verdict === "correct" && e.misconception !== null) return "correct인데 misconception이 있음";
  return explainFromProblem(e, concept.key_points.length) ?? e;
}

function parseShape(raw: string, phase: Phase): Evaluation | string {
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
  return parsed.data;
}

/**
 * 형식 보정(재시도까지 틀렸을 때만): 판정 필드끼리 어긋난 출력을 평가자 규칙대로 맞춘다. JSON·스키마가 틀리면 보정하지 않는다(null).
 * - correct인데 misconception이 있음 → partial, explain_from null(규칙 3: 사실 오류가 있으면 최대 partial, 오개념만 바로잡음)
 * - correct인데 explain_from이 있음 → null
 * - correct가 아닌데 explain_from이 없음(오개념만 바로잡는 partial 제외)·범위 밖 → 0(처음 핵심 요소부터 설명. 덜 설명하는 쪽으로 틀리지 않게)
 */
export function repairEvaluation(raw: string, concept: RubricConcept, phase: Phase): { evaluation: Evaluation; notes: string[] } | null {
  const shape = parseShape(raw, phase);
  if (typeof shape === "string") return null;
  const e = { ...shape };
  const notes: string[] = [];
  const count = concept.key_points.length;
  if (e.verdict === "correct" && e.misconception !== null) {
    e.verdict = "partial";
    e.explain_from = null;
    notes.push("correct+misconception→partial");
  }
  if (e.verdict === "correct" && e.explain_from !== null) {
    e.explain_from = null;
    notes.push("correct의 explain_from 제거");
  }
  if (e.verdict !== "correct") {
    const onlyMisconception = e.verdict === "partial" && e.explain_from === null && !!e.misconception?.trim();
    if (!onlyMisconception && (e.explain_from === null || e.explain_from < 0 || e.explain_from >= count)) {
      notes.push(`explain_from ${e.explain_from}→0`);
      e.explain_from = 0;
    }
  }
  return explainFromProblem(e, count) === null ? { evaluation: e, notes } : null;
}

/** 경계 재확인 응답 스키마: 핵심 요소마다 맞게 말했는지와 학습자 답에서 옮긴 부분. */
export function keyPointsResponseSchema(): object {
  return {
    type: "OBJECT",
    properties: {
      points: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { index: { type: "INTEGER" }, stated: { type: "BOOLEAN" }, quote: { type: "STRING" } },
          required: ["index", "stated", "quote"],
          propertyOrdering: ["index", "stated", "quote"],
        },
      },
    },
    required: ["points"],
  };
}

const compact = (s: string) => s.normalize("NFC").replace(/[\s.,!?~'"“”‘’()·…-]/g, "").toLowerCase();

/**
 * 경계 재확인 응답 → 학습자가 맞게 말한 핵심 요소 번호. stated=true여도 quote가 학습자 답에 실제로 없으면(지어낸 인용) 인정하지 않는다.
 */
export function statedKeyPoints(raw: string, answer: string, count: number): number[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = z.object({ points: z.array(z.object({ index: z.number().int(), stated: z.boolean(), quote: z.string() })) }).safeParse(json);
  if (!parsed.success) return null;
  const a = compact(answer);
  return [...new Set(parsed.data.points
    .filter((p) => p.stated && p.index >= 0 && p.index < count && compact(p.quote).length >= 2 && a.includes(compact(p.quote)))
    .map((p) => p.index))].sort((x, y) => x - y);
}

/**
 * 경계 재확인으로 판정을 한 단계만 올린다(내리지 않는다). 오개념이 있으면 correct로 올리지 않는다(규칙 3).
 * - wrong인데 맞게 말한 핵심 요소가 있음 → partial(규칙 2: 핵심 요소를 하나 이상 맞게 말했으면 최소 partial). explain_from은 처음 놓친 요소(다 말했으면 0)
 * - partial인데 핵심 요소를 모두 맞게 말했고 오개념이 없음 → correct
 * - assisted·correct는 그대로
 */
export function applyKeyPointCheck(e: Evaluation, stated: number[], count: number): { evaluation: Evaluation; note: string | null } {
  const missing = [...Array(count).keys()].find((i) => !stated.includes(i));
  if (e.verdict === "wrong" && stated.length > 0) {
    return { evaluation: { ...e, verdict: "partial", explain_from: missing ?? 0 }, note: `wrong→partial(핵심 요소 ${stated.join(",")} 맞게 말함)` };
  }
  if (e.verdict === "partial" && missing === undefined && !e.misconception?.trim()) {
    return { evaluation: { ...e, verdict: "correct", explain_from: null }, note: "partial→correct(핵심 요소 모두 맞게 말함)" };
  }
  return { evaluation: e, note: null };
}

/** 평가 한 번의 상세 결과. formatProblems는 형식 검증에 실패한 시도의 이유(재시도 횟수 = 길이). */
export interface DetailedEvaluation {
  evaluation: Evaluation | null;
  attempts: number;
  formatProblems: string[];
  /** 형식 보정·경계 재확인으로 바꾼 내용(없으면 빈 배열). */
  adjustments: string[];
}

export interface EvaluatorOptions {
  /** 재시도까지 판정 필드가 어긋나면 규칙대로 보정해 살린다(repairEvaluation). 기본 끔: Gemini는 지금처럼 형식 오류로 본다. */
  repairFormat?: boolean;
  /** 경계 재확인(wrong·partial이면 핵심 요소별로 한 번 더 묻기). 작은 로컬 모델의 경계 오판을 줄이려고 둔다. 기본 끔(호출이 늘어서). */
  verifyBoundary?: boolean;
}

export class GeminiEvaluator implements Evaluator {
  constructor(private readonly gemini: LlmClient, private readonly options: EvaluatorOptions = {}) {}

  async evaluate(input: EvaluateInput): Promise<Evaluation> {
    const { evaluation, formatProblems } = await this.evaluateDetailed(input);
    if (evaluation) return evaluation;
    throw new EvaluationFormatError(`평가자 출력 형식 오류(${MAX_ATTEMPTS}회): ${formatProblems.join(" / ")}`);
  }

  /** 형식 재시도 기록까지 돌려준다. 끝까지 형식이 틀리면(보정도 못 하면) evaluation이 null이다. */
  async evaluateDetailed(input: EvaluateInput): Promise<DetailedEvaluation> {
    const { rubric, concept, question, answer, phase } = input;
    const request = {
      system: evaluatorSystemPrompt(rubric, concept, phase),
      prompt: evaluatorUserPrompt(question, answer),
      temperature: 0,
      maxOutputTokens: 512,
      responseSchema: evaluatorResponseSchema(phase),
    };
    const formatProblems: string[] = [];
    const adjustments: string[] = [];
    let evaluation: Evaluation | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !evaluation; attempt++) {
      attempts = attempt;
      // LLM 연결 오류(LlmUnavailableError)는 재시도하지 않고 그대로 올린다.
      const raw = await this.gemini.generate(request);
      const result = parseEvaluation(raw, concept, phase);
      if (typeof result !== "string") {
        evaluation = result;
        break;
      }
      formatProblems.push(result);
      // 마지막 시도까지 판정 필드가 어긋나면 규칙대로 보정해 살린다(JSON·스키마 오류는 보정하지 않는다).
      if (attempt === MAX_ATTEMPTS && this.options.repairFormat) {
        const repaired = repairEvaluation(raw, concept, phase);
        if (repaired) {
          evaluation = repaired.evaluation;
          adjustments.push(...repaired.notes);
        }
      }
    }
    if (evaluation && this.options.verifyBoundary && (evaluation.verdict === "wrong" || evaluation.verdict === "partial")) {
      const checked = await this.checkKeyPoints(input);
      if (checked) {
        const { evaluation: next, note } = applyKeyPointCheck(evaluation, checked, concept.key_points.length);
        evaluation = next;
        if (note) adjustments.push(note);
      }
    }
    return { evaluation, attempts, formatProblems, adjustments };
  }

  /** 핵심 요소별 재확인. 형식이 틀리면 null(판정을 바꾸지 않는다). */
  private async checkKeyPoints({ rubric, concept, question, answer }: EvaluateInput): Promise<number[] | null> {
    const glossary = rubric.glossary?.length ? rubric.glossary.map((g) => `${g.term} = ${g.aliases.join(", ")}`).join("; ") : "(없음)";
    const raw = await this.gemini.generate({
      system: renderPrompt("evaluator-keypoints", {
        name: concept.name,
        glossary,
        key_points: concept.key_points.map((k, i) => `${i}. ${k.point}`).join("\n"),
      }),
      prompt: evaluatorUserPrompt(question, answer),
      temperature: 0,
      maxOutputTokens: 400,
      responseSchema: keyPointsResponseSchema(),
    });
    return statedKeyPoints(raw, answer, concept.key_points.length);
  }
}
