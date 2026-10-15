// 평가자 보강(llm/src/evaluator.ts): 재시도까지 어긋난 판정 필드 보정(repairEvaluation)과 경계 재확인(verifyBoundary).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { applyKeyPointCheck, GeminiEvaluator, repairEvaluation, statedKeyPoints } from "../../llm/src/evaluator.js";
import type { GenerateRequest, LlmClient } from "../../llm/src/llm-client.js";
import type { Rubric } from "../src/rubrics.js";

const rubric = JSON.parse(readFileSync(join(process.cwd(), "content", "rubrics", "final", "01_제선.json"), "utf8")) as Rubric;
const coke = rubric.concepts.find((c) => c.concept_id === "coke_reduction")!; // 핵심 요소 2개
const out = (o: object) => JSON.stringify({ evidence: "e", misconception: null, explain_from: null, ...o });

test("repairEvaluation: 판정 필드가 어긋나면 규칙대로 맞추고, JSON·스키마가 틀리면 보정하지 않는다", () => {
  assert.deepEqual(repairEvaluation(out({ verdict: "assisted" }), coke, "initial")?.evaluation.explain_from, 0, "assisted에 explain_from 없음 → 0");
  assert.deepEqual(repairEvaluation(out({ verdict: "wrong", explain_from: 3 }), coke, "initial")?.evaluation.explain_from, 0, "범위 밖 → 0");
  const mis = repairEvaluation(out({ verdict: "correct", misconception: "불순물 제거라고 함" }), coke, "initial")!.evaluation;
  assert.deepEqual([mis.verdict, mis.explain_from], ["partial", null], "correct+오개념 → partial(오개념만 교정)");
  assert.equal(repairEvaluation(out({ verdict: "correct", explain_from: 1 }), coke, "initial")?.evaluation.explain_from, null);
  assert.equal(repairEvaluation("{not json", coke, "initial"), null);
  assert.equal(repairEvaluation(out({ verdict: "assisted" }), coke, "recheck"), null, "재확인 단계에는 assisted가 없다(스키마 오류는 보정 안 함)");
});

test("statedKeyPoints: stated=true여도 인용이 학습자 답에 없으면 인정하지 않는다", () => {
  const answer = "코크스가 열풍이랑 만나서 CO를 만들어요.";
  const raw = JSON.stringify({ points: [
    { index: 0, stated: true, quote: "열풍이랑 만나서 CO를 만들어요" },
    { index: 1, stated: true, quote: "철광석의 산소를 떼어내요" },
  ] });
  assert.deepEqual(statedKeyPoints(raw, answer, 2), [0]);
  assert.equal(statedKeyPoints("x", answer, 2), null);
  assert.deepEqual(statedKeyPoints(JSON.stringify({ points: [{ index: 5, stated: true, quote: "코크스" }] }), answer, 2), [], "없는 번호는 버림");
});

test("applyKeyPointCheck: 한 단계만 올린다. wrong→partial, partial→correct(오개념이 없을 때만), assisted·correct는 그대로", () => {
  const e = (verdict: "wrong" | "partial" | "assisted" | "correct", misconception: string | null = null) =>
    ({ verdict, misconception, explain_from: verdict === "correct" ? null : 0, evidence: "e" });
  assert.deepEqual(applyKeyPointCheck(e("wrong"), [1], 2).evaluation, { ...e("wrong"), verdict: "partial", explain_from: 0 });
  assert.deepEqual(applyKeyPointCheck(e("wrong"), [0, 1], 2).evaluation.verdict, "partial", "wrong은 correct까지 올리지 않음");
  assert.deepEqual(applyKeyPointCheck(e("partial"), [0, 1], 2).evaluation, { ...e("partial"), verdict: "correct", explain_from: null });
  assert.equal(applyKeyPointCheck(e("partial", "불순물 제거"), [0, 1], 2).evaluation.verdict, "partial", "오개념이 있으면 correct로 올리지 않음");
  assert.equal(applyKeyPointCheck(e("partial"), [0], 2).evaluation.verdict, "partial");
  assert.equal(applyKeyPointCheck(e("wrong"), [], 2).note, null);
  assert.equal(applyKeyPointCheck(e("assisted"), [0, 1], 2).evaluation.verdict, "assisted");
});

/** 차례로 정해 둔 응답을 돌려주는 가짜 모델. */
function fake(replies: string[]): LlmClient & { sent: GenerateRequest[] } {
  const sent: GenerateRequest[] = [];
  return { sent, generate: async (req) => (sent.push(req), replies.shift() ?? "") };
}

test("GeminiEvaluator: 재시도까지 어긋나면 보정해 살리고, verifyBoundary면 wrong을 핵심 요소별로 다시 물어 partial로 올린다", async () => {
  const input = { rubric, concept: coke, question: "q", answer: "코크스가 열풍과 반응해 일산화탄소를 만들어요.", phase: "initial" as const };
  const repaired = await new GeminiEvaluator(fake([out({ verdict: "assisted" }), out({ verdict: "assisted" })]), { repairFormat: true }).evaluateDetailed(input);
  assert.deepEqual([repaired.evaluation?.verdict, repaired.evaluation?.explain_from, repaired.attempts], ["assisted", 0, 2]);
  assert.equal(repaired.formatProblems.length, 2, "형식 문제는 그대로 기록");

  const client = fake([out({ verdict: "wrong", explain_from: 0 }), JSON.stringify({ points: [{ index: 0, stated: true, quote: "열풍과 반응해 일산화탄소를 만들어요" }, { index: 1, stated: false, quote: "" }] })]);
  const verified = await new GeminiEvaluator(client, { verifyBoundary: true }).evaluateDetailed(input);
  assert.deepEqual([verified.evaluation?.verdict, verified.evaluation?.explain_from], ["partial", 1]);
  assert.match(verified.adjustments[0]!, /wrong→partial/);
  assert.match(client.sent[1]!.system, /핵심 요소/);
  assert.doesNotMatch(client.sent[1]!.system, /근거:/, "재확인에는 근거 문장(quote)을 주지 않는다");

  const off = await new GeminiEvaluator(fake([out({ verdict: "wrong", explain_from: 0 })])).evaluateDetailed(input);
  assert.equal(off.evaluation?.verdict, "wrong", "기본은 재확인하지 않음(호출 1번)");
  const strict = await new GeminiEvaluator(fake([out({ verdict: "assisted" }), out({ verdict: "assisted" })])).evaluateDetailed(input);
  assert.equal(strict.evaluation, null, "기본은 보정하지 않음(Gemini는 지금처럼 형식 오류)");
});
