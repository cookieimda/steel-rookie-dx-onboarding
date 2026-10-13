// 체크포인트 튜터 발화(Gemini): 질문, 부가 설명, 다른 각도의 재확인 질문.
// 질문은 루브릭의 질문 은행(questions, recheck_questions)에서 골라 말투만 다듬는다.
// - 다듬은 문장이 정답 유출 검사(question-check.ts)에 걸리거나 다듬기 호출이 실패하면 은행 원문을 그대로 쓴다.
// - 재확인은 recheck_questions에서 고른다. 루브릭 로드 때 questions와 겹치지 않는지 확인하므로 첫 질문과 다른 질문이 된다.
// 은행이 비어 있을 때만 LLM이 질문을 만든다(대체 경로). 만든 질문은 유출 검사를 거쳐 걸리면 1회 다시 만들고,
// 그래도 걸리면 루브릭의 fallback_question(없거나 직전 질문과 같으면 고정 문장)을 쓴다.
// 이어 풀기: exclude(이 시도에서 이 개념에 이미 쓴 은행 원문)를 빼고 고른다. 은행을 다 썼으면 fallback_question을 다시 쓴다.
import { LlmUnavailableError, type AskedQuestion, type Tutor } from "../../backend/src/checkpoint/types.js";
import type { Rubric, RubricConcept } from "../../backend/src/rubrics.js";
import { escapeDelimited, GeminiCallError, renderPrompt, type GeminiClient } from "./gemini.js";
import { answerTerms, findLeaks, hasLeak, type LeakResult } from "./question-check.js";

const MAX_QUESTION_ATTEMPTS = 2;

const keyPointsWithQuotes = (points: RubricConcept["key_points"]) =>
  points.map((k) => `- ${k.point} (근거: "${k.quote}")`).join("\n");
// 질문 생성에는 근거 문장을 주지 않는다. 그대로 옮겨 쓰는 일을 줄이기 위해서다.
const keyPointsOnly = (points: RubricConcept["key_points"]) => points.map((k) => `- ${k.point}`).join("\n");

/** 은행 질문 다듬기 결과. */
export interface PolishResult {
  original: string;
  /** 다듬은 문장. 호출이 실패하면 null. */
  polished: string | null;
  originalLeaks: LeakResult;
  /** 다듬은 문장의 유출 검사 결과. 호출이 실패하면 null. */
  polishedLeaks: LeakResult | null;
  used: "polished" | "original";
  /** 원문을 쓴 이유: 다듬은 문장이 유출 검사에 걸림, 또는 다듬기 호출 실패. */
  reason?: "leak" | "error";
  error?: { message: string; infra: boolean };
}

export interface DetailedQuestion {
  text: string;
  /** bank: 질문 은행, generated: 은행이 비어 LLM이 만듦(대체 경로), fallback: 이어 풀기로 은행을 다 써서 대체 질문. */
  source: "bank" | "generated" | "fallback";
  /** 고른 은행 원문(fallback이면 fallback_question). 이어 풀 때 제외할 기준이다. LLM이 만들었거나 고정 문장이면 null. */
  bankQuestion: string | null;
  bank?: PolishResult;
  /** generated일 때 시도별 생성 결과와 유출 검사 결과. */
  attempts: { text: string; leaks: LeakResult }[];
  usedFallback: boolean;
}

export function genericQuestion(concept: RubricConcept): string {
  return `처음 배우는 동료에게 '${concept.name}'을 설명한다고 생각하고, 자기 말로 설명해 주세요.`;
}

export interface TutorOptions {
  /** 은행에서 질문을 고를 때 쓰는 난수(0 이상 1 미만). 테스트에서 고정한다. */
  random?: () => number;
}

export class GeminiTutor implements Tutor {
  private readonly random: () => number;

  constructor(private readonly gemini: GeminiClient, options: TutorOptions = {}) {
    this.random = options.random ?? Math.random;
  }

  private async say(prompt: string, temperature: number, maxOutputTokens: number): Promise<string> {
    const text = (await this.gemini.generate({ system: renderPrompt("tutor-system", {}), prompt, temperature, maxOutputTokens }))
      .trim()
      .replace(/^["“](.*)["”]$/s, "$1");
    if (!text) throw new LlmUnavailableError("튜터 응답이 비어 있습니다.");
    return text;
  }

  private pick(candidates: string[]): string {
    return candidates[Math.min(Math.floor(this.random() * candidates.length), candidates.length - 1)]!;
  }

  /** 은행 질문의 말투만 다듬는다. 다듬은 문장이 유출 검사에 걸리거나 호출이 실패하면 원문을 쓴다. */
  async polish(rubric: Rubric, concept: RubricConcept, original: string): Promise<PolishResult> {
    const originalLeaks = findLeaks(original, rubric, concept);
    let polished: string;
    try {
      // 정답을 모르게 하려고 핵심 요소와 정답 용어는 주지 않는다.
      polished = await this.say(renderPrompt("tutor-polish", { question: original }), 0.3, 200);
    } catch (error) {
      if (!(error instanceof LlmUnavailableError)) throw error;
      const failure = { message: error.message, infra: error instanceof GeminiCallError };
      return { original, polished: null, originalLeaks, polishedLeaks: null, used: "original", reason: "error", error: failure };
    }
    const polishedLeaks = findLeaks(polished, rubric, concept);
    return hasLeak(polishedLeaks)
      ? { original, polished, originalLeaks, polishedLeaks, used: "original", reason: "leak" }
      : { original, polished, originalLeaks, polishedLeaks, used: "polished" };
  }

  private async fromBank(rubric: Rubric, concept: RubricConcept, candidates: string[]): Promise<DetailedQuestion> {
    const bank = await this.polish(rubric, concept, this.pick(candidates));
    return {
      text: bank.used === "polished" ? bank.polished! : bank.original, source: "bank", bankQuestion: bank.original, bank, attempts: [], usedFallback: false,
    };
  }

  /** 은행을 다 쓴 경우(이어 풀기). fallback_question은 유출 검사를 통과한 문장이라 다듬지 않고 그대로 쓴다. */
  private exhausted(fallback: string | undefined, concept: RubricConcept): DetailedQuestion {
    return fallback
      ? { text: fallback, source: "fallback", bankQuestion: fallback, attempts: [], usedFallback: true }
      : { text: genericQuestion(concept), source: "fallback", bankQuestion: null, attempts: [], usedFallback: true };
  }

  private async generated(
    rubric: Rubric,
    concept: RubricConcept,
    prompt: string,
    temperature: number,
    fallback: string,
  ): Promise<DetailedQuestion> {
    const attempts: DetailedQuestion["attempts"] = [];
    for (let i = 0; i < MAX_QUESTION_ATTEMPTS; i++) {
      const last = attempts.at(-1);
      const retryNote = last
        ? `\n\n직전 질문에 정답 표현이 들어 있었습니다: ${[...last.leaks.terms, ...last.leaks.phrases].join(", ")}. 이 표현과 그 일부를 쓰지 말고 다시 만드세요.`
        : "";
      const text = await this.say(prompt + retryNote, temperature, 200);
      const leaks = findLeaks(text, rubric, concept);
      attempts.push({ text, leaks });
      if (!hasLeak(leaks)) return { text, source: "generated", bankQuestion: null, attempts, usedFallback: false };
    }
    return { text: fallback, source: "generated", bankQuestion: null, attempts, usedFallback: true };
  }

  questionDetailed({ rubric, concept, exclude = [] }: Parameters<Tutor["question"]>[0]): Promise<DetailedQuestion> {
    if (concept.questions?.length) {
      const left = concept.questions.filter((q) => !exclude.includes(q));
      return left.length ? this.fromBank(rubric, concept, left) : Promise.resolve(this.exhausted(concept.fallback_question, concept));
    }
    const prompt = renderPrompt("tutor-question", {
      name: concept.name,
      key_points: keyPointsOnly(concept.key_points),
      answer_terms: answerTerms(rubric, concept).join(", ") || "(없음)",
    });
    return this.generated(rubric, concept, prompt, 0.4, concept.fallback_question ?? genericQuestion(concept));
  }

  recheckQuestionDetailed({ rubric, concept, previousQuestion, exclude = [] }: Parameters<Tutor["recheckQuestion"]>[0]): Promise<DetailedQuestion> {
    const bank = (concept.recheck_questions ?? []).filter((q) => q !== previousQuestion && !exclude.includes(q));
    if (bank.length) return this.fromBank(rubric, concept, bank);
    if (concept.recheck_questions?.length) {
      // 은행을 다 썼다(이어 풀기). 직전 질문과 같은 fallback_question은 쓰지 않는다.
      const fallback = concept.fallback_question !== previousQuestion ? concept.fallback_question : undefined;
      return Promise.resolve(this.exhausted(fallback, concept));
    }
    const prompt = renderPrompt("tutor-recheck", {
      name: concept.name,
      key_points: keyPointsOnly(concept.key_points),
      answer_terms: answerTerms(rubric, concept).join(", ") || "(없음)",
      previous_question: previousQuestion,
    });
    const fallback = concept.fallback_question && concept.fallback_question !== previousQuestion
      ? concept.fallback_question
      : genericQuestion(concept);
    return this.generated(rubric, concept, prompt, 0.7, fallback);
  }

  async question(input: Parameters<Tutor["question"]>[0]): Promise<AskedQuestion> {
    const q = await this.questionDetailed(input);
    return { text: q.text, bank: q.bankQuestion };
  }

  async recheckQuestion(input: Parameters<Tutor["recheckQuestion"]>[0]): Promise<AskedQuestion> {
    const q = await this.recheckQuestionDetailed(input);
    return { text: q.text, bank: q.bankQuestion };
  }

  explanation({ concept, explainFrom, misconception, answer, learnerNotes }: Parameters<Tutor["explanation"]>[0]): Promise<string> {
    // 학습자 메모는 학습자 답변에서 나온 요약이라 지시가 아닌 자료로 구분자 안에 넣는다.
    const notes = learnerNotes?.trim() ? escapeDelimited(learnerNotes.trim()) : "없음";
    // explain_from이 null이면 핵심 요소는 모두 맞혔고 사실 오류만 있다: 오개념만 바로잡는다.
    if (explainFrom === null) {
      return this.say(renderPrompt("tutor-correction", {
        name: concept.name,
        key_points: keyPointsWithQuotes(concept.key_points),
        misconception: misconception ?? "없음",
        answer: escapeDelimited(answer),
        learner_notes: notes,
      }), 0.3, 400);
    }
    return this.say(renderPrompt("tutor-explanation", {
      name: concept.name,
      key_points: keyPointsWithQuotes(concept.key_points.slice(explainFrom)),
      misconception: misconception ?? "없음",
      answer: escapeDelimited(answer),
      learner_notes: notes,
    }), 0.3, 500);
  }
}
