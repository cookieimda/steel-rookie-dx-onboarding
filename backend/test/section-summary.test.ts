import assert from "node:assert/strict";
import test from "node:test";
import { summarizeSection } from "../src/checkpoint/section-summary.js";
import { IRONMAKING } from "./checkpoint-fakes.js";

const r = (concept_id: string, verdict: "correct" | "partial" | "wrong" | "assisted", recheck_verdict: "correct" | "partial" | "wrong" | null = null) => ({ concept_id, verdict, recheck_verdict });

test("summarizeSection: 완료한 시도가 없으면 미시작", () => {
  assert.deepEqual(summarizeSection(IRONMAKING, []), { passed: false, understanding: null, retry_concept_ids: [], unconfirmed_concept_ids: [] });
});

test("summarizeSection: 재도전 결과를 덮어써 합치고 80% 기준으로 통과를 정한다", () => {
  const first = { unlocked: false, results: [r("a", "correct"), r("b", "wrong", "wrong"), r("c", "partial", "partial")] };
  assert.deepEqual(summarizeSection(IRONMAKING, [first]), { passed: false, understanding: 0.5, retry_concept_ids: ["b", "c"], unconfirmed_concept_ids: [] });

  const retry = { unlocked: true, results: [r("b", "correct"), r("c", "correct")] };
  assert.deepEqual(summarizeSection(IRONMAKING, [first, retry]), { passed: true, understanding: 1, retry_concept_ids: [], unconfirmed_concept_ids: [] });
});

test("summarizeSection: 루브릭에 없는 개념 결과는 버리고, 통과했던 섹션의 새 개념은 미확인", () => {
  const passedBefore = { unlocked: true, results: [r("a", "correct"), r("old", "correct"), r("c", "correct")] };
  const summary = summarizeSection(IRONMAKING, [passedBefore]);
  assert.equal(summary.passed, true);
  assert.deepEqual(summary.unconfirmed_concept_ids, ["b"]);
  assert.equal(summary.understanding, 2 / 3);
  assert.deepEqual(summary.retry_concept_ids, []);
});
