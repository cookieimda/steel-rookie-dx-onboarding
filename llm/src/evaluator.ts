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

/**
 * 핵심 요소를 빠뜨렸다는 말("~과정을 빠뜨렸습니다", "~설명이 부족", "~설명하지 않았다")은 틀린 지식(오개념)이 아니라 누락이다.
 * 작은 로컬 모델은 이런 말을 misconception에 적어, 맞는 답이 partial로 내려가고 오개념 기록이 오염된다.
 * 2026-10-15 저장된 채점 기록 81건(qwen2.5 3b·7b)에서 이 패턴에 걸린 19건은 모두 학습자 답에 실제 오류가 없었다(docs/llm-providers.md).
 */
export const OMISSION_MISCONCEPTION = /빠뜨|빠져\s?있|빠졌|빠짐|누락|부족|언급하지 않|언급이 없|설명하지 (않|못)|설명이 없|포함되지 않|설명되지 않|놓쳤/;

/** 응답 원문의 misconception이 누락을 말하는 문장이면 null로 바꾼 원문(바꿨는지와 함께). JSON이 아니면 그대로 둔다. */
export function stripOmissionMisconception(raw: string): { raw: string; dropped: string | null } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { raw, dropped: null };
  }
  const m = (json as { misconception?: unknown })?.misconception;
  if (typeof m !== "string" || !OMISSION_MISCONCEPTION.test(m)) return { raw, dropped: null };
  return { raw: JSON.stringify({ ...(json as object), misconception: null }), dropped: m };
}

/**
 * 지어낸 오개념을 지운다. 핵심 요소를 모두 맞게 말했으면(checked) correct, 아니면 partial을 유지하고 explain_from을 처음 놓친 요소로 둔다
 * (오개념 없는 partial은 explain_from이 있어야 한다). 핵심 요소 확인이 형식 오류(null)면 모두 말했다고 보지 않는다.
 */
export function dropInventedMisconception(e: Evaluation, checked: number[] | null, count: number): { evaluation: Evaluation; note: string } {
  const missing = [...Array(count).keys()].find((i) => !(checked ?? []).includes(i));
  if (checked && missing === undefined) {
    return { evaluation: { ...e, verdict: "correct", misconception: null, explain_from: null }, note: "partial→correct(핵심 요소 모두 맞고 루브릭 오개념과 다름: 지어낸 오개념을 버림)" };
  }
  return { evaluation: { ...e, misconception: null, explain_from: e.explain_from ?? missing ?? 0 }, note: "지어낸 오개념을 버림(partial 유지)" };
}

/** 오개념 재확인 응답 스키마: 루브릭 오개념과 같은 뜻인지, 같으면 답에서 옮긴 부분. */
export function misconceptionCheckSchema(): object {
  return {
    type: "OBJECT",
    properties: { matches: { type: "BOOLEAN" }, quote: { type: "STRING" } },
    required: ["matches", "quote"],
    propertyOrdering: ["matches", "quote"],
  };
}

/** 오개념 재확인 응답 → 같음(true)·다름(false)·형식 오류(null). matches=true여도 인용이 실제 답에 없으면 형식 오류로 본다(판정을 바꾸지 않음). */
export function knownMisconception(raw: string, answer: string): boolean | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = z.object({ matches: z.boolean(), quote: z.string() }).safeParse(json);
  if (!parsed.success) return null;
  if (!parsed.data.matches) return false;
  const q = compact(parsed.data.quote);
  return q.length >= 2 && compact(answer).includes(q) ? true : null;
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
  /** 누락을 말하는 misconception은 오개념이 아니라 지운다(OMISSION_MISCONCEPTION). 모델을 더 부르지 않는다. 기본 끔(Gemini는 지금처럼). */
  ignoreOmission?: boolean;
  /**
   * 오개념 재확인(verifyBoundary와 함께): partial에 오개념이 붙어 있으면 루브릭의 흔한 오개념과 같은지 예/아니오로 묻고, 다르면 지어낸 오개념으로 보고 지운다
   * (핵심 요소를 모두 말했으면 correct, 아니면 partial 유지, dropInventedMisconception). 루브릭에 없는 새로운 사실 오류는 놓칠 수 있다. 기본 끔.
   */
  verifyMisconception?: boolean;
}

/** 로컬 모델 채점 보강을 한꺼번에 켠다(provider.ts profileFor의 evaluatorGuards). 오개념 재확인(verifyMisconception)은 측정용이라 넣지 않는다. */
export function evaluatorGuardOptions(on: boolean): EvaluatorOptions {
  return { repairFormat: on, verifyBoundary: on, ignoreOmission: on };
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
      let raw = await this.gemini.generate(request);
      // 누락을 말하는 misconception은 지운 뒤 검사한다(맞는 답이 "correct인데 misconception이 있음" 형식 오류·partial로 내려가지 않게).
      if (this.options.ignoreOmission) {
        const stripped = stripOmissionMisconception(raw);
        if (stripped.dropped) adjustments.push(`누락을 적은 오개념을 버림("${stripped.dropped.slice(0, 40)}")`);
        raw = stripped.raw;
      }
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
      // partial에 오개념이 붙어 있으면 그 오개념이 학습자 답에 실제로 있는지 루브릭의 흔한 오개념으로 닫힌 질문을 한다.
      // 작은 모델은 루브릭의 오답 기준 문장을 그대로 옮기거나 뒤집어("~라고 설명하지 않음") 오개념 칸에 적는다. 가짜 오개념은 점수를 깎고 오개념 기록도 오염시킨다.
      if (this.options.verifyMisconception && evaluation.verdict === "partial" && evaluation.misconception?.trim()) {
        const known = await this.checkKnownMisconception(input);
        if (known === false) {
          const { evaluation: next, note } = dropInventedMisconception(evaluation, checked, concept.key_points.length);
          evaluation = next;
          adjustments.push(note);
        }
      }
    }
    return { evaluation, attempts, formatProblems, adjustments };
  }

  /**
   * 학습자 답이 루브릭의 흔한 오개념(concept.wrong)과 같은 뜻인지 예/아니오로 묻는다. 같으면 답에서 그 부분을 글자 그대로 옮겨야 한다.
   * true: 같음(인용이 실제 답에 있음), false: 다름, null: 형식 오류(판정을 바꾸지 않는다).
   */
  private async checkKnownMisconception({ rubric, concept, question, answer }: EvaluateInput): Promise<boolean | null> {
    const glossary = rubric.glossary?.length ? rubric.glossary.map((g) => `${g.term} = ${g.aliases.join(", ")}`).join("; ") : "(없음)";
    const raw = await this.gemini.generate({
      system: renderPrompt("evaluator-misconception", { name: concept.name, wrong: concept.wrong, glossary }),
      prompt: evaluatorUserPrompt(question, answer),
      temperature: 0,
      maxOutputTokens: 200,
      responseSchema: misconceptionCheckSchema(),
    });
    return knownMisconception(raw, answer);
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
