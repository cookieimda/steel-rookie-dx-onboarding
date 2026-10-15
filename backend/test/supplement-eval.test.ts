// 보충학습 시나리오 평가(llm/eval/run-supplement.ts): 시나리오 형식과, 가짜 모델(--dry-run)로 엔진 흐름·판정이 맞는지.
import assert from "node:assert/strict";
import test from "node:test";
import { dryVerdicts, loadScenarios, runScenario } from "../../llm/eval/run-supplement.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { loadFinalRubrics } from "../src/rubrics.js";

test("보충학습 시나리오: 형식이 맞고, 바로 맞힘·다시 설명 뒤 맞힘·끝까지 고집·힌트 요청·재도전 개념이 모두 있다", () => {
  const scenarios = loadScenarios();
  const concepts = new Set(loadFinalRubrics().flatMap((r) => r.concepts.map((c) => c.concept_id)));
  assert.ok(scenarios.every((s) => concepts.has(s.concept_id)), "지금 루브릭 개념만");
  assert.ok(scenarios.some((s) => s.expect.quizzes === 1 && s.expect.outcome === "resolved"));
  assert.ok(scenarios.some((s) => s.expect.quizzes === 2 && s.expect.outcome === "resolved"));
  assert.ok(scenarios.some((s) => s.expect.outcome === "not_resolved"));
  assert.ok(scenarios.some((s) => dryVerdicts(s)[0] === "assisted"));
  assert.ok(scenarios.some((s) => s.retry && !s.memo));
});

test("보충학습 시나리오 --dry-run: 가짜 모델로 모든 시나리오가 기대 결과와 모든 확인을 통과한다(엔진 흐름·판정 확인)", async () => {
  const rubrics = loadFinalRubrics();
  const scene = await loadSceneCatalog();
  for (const s of loadScenarios()) {
    const r = await runScenario(s, { rubrics, scene, dry: true });
    assert.deepEqual(Object.entries(r.checks).filter(([, ok]) => !ok).map(([k]) => k), [], s.id);
    assert.deepEqual(r.verdicts, dryVerdicts(s).slice(0, s.expect.quizzes), s.id);
  }
});
