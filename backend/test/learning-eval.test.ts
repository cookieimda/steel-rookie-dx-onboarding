// 학습 모드 평가 세트(llm/eval/learning/{공정}.jsonl)의 형식과 채점 규칙을 검사한다. 실제 Gemini는 호출하지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { claimViolations, loadLearningSet, loadSuggestionCases, missingFacts, score, type LearningCase } from "../../llm/eval/run-learning.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { isSafetyQuestion } from "../src/learning/safety.js";
import { loadFinalRubrics } from "../src/rubrics.js";

test("평가 세트: 화면 조작은 화면 목록의 id, 오개념은 그 공정 루브릭 개념, safety 기대는 실제 안전 규칙과 같다", async () => {
  const cases = loadLearningSet();
  assert.ok(cases.filter((c) => c.section === "ironmaking").length >= 20);
  const scene = await loadSceneCatalog();
  const processes = new Set<string>(scene.processes.map((p) => p.id));
  const equipment = new Set(scene.processes.flatMap((p) => p.equipment.map((e) => e.id)));
  const rubrics = loadFinalRubrics();
  for (const c of cases) {
    const concepts = new Set(rubrics.find((r) => r.section === c.section)?.concepts.map((k) => k.concept_id) ?? []);
    // 화면에 고른 설비는 그 공정의 설비여야 한다.
    if (c.screen.equipment_id) assert.ok(scene.processes.find((p) => p.id === c.section)!.equipment.some((e) => e.id === c.screen.equipment_id), `${c.id} 화면 설비`);
    if (c.expect.scene !== "any") {
      for (const a of c.expect.scene) {
        const ok = a.type === "goto_process" || a.type === "play_animation" ? processes.has(a.target_id) : equipment.has(a.target_id);
        assert.ok(ok, `${c.id} ${a.type}:${a.target_id}`);
      }
    }
    if (c.expect.misconception) assert.ok(concepts.has(c.expect.misconception), `${c.id} 개념`);
    assert.equal(isSafetyQuestion(c.question), c.expect.status === "safety_redirect", `${c.id} 안전 규칙`);
    for (const p of c.expect.must_not ?? []) assert.doesNotThrow(() => new RegExp(p), `${c.id} must_not 정규식: ${p}`);
  }
});

test("답변 사실: 빠진 사실은 첫 표현으로 알리고, 하면 안 되는 주장은 부정하며 바로잡는 문장이면 위반이 아니다", () => {
  const facts = [["일산화탄소", "CO"], ["산소", "환원"]];
  assert.deepEqual(missingFacts("코크스가 CO를 만들어 철광석의 산소를 떼어내요.", facts), []);
  assert.deepEqual(missingFacts("코크스는 연료예요.", facts), ["일산화탄소", "산소"]);
  const claim = ["불순물을?\\s?(없애|제거|줄이)"];
  assert.deepEqual(claimViolations("코크스는 불순물을 없애는 게 아니에요. 일산화탄소를 만들어요.", claim), []);
  assert.deepEqual(claimViolations("코크스의 주된 역할은 불순물을 줄이는 것이에요.", claim), ["코크스의 주된 역할은 불순물을 줄이는 것이에요."]);
  const c: LearningCase = { id: "x", type: "t", question: "q", section: "ironmaking", screen: { process_id: "ironmaking", equipment_id: null }, expect: { status: "grounded", scene: "any", misconception: null, facts, must_not: claim } };
  const k = score(c, { status: "grounded", scene_actions: [], misconception: null, answer: "코크스는 불순물을 제거해요." });
  assert.deepEqual([k.content, k.missing_facts, k.violations.length], [false, ["일산화탄소", "산소"], 1]);
});

test("추천 질문: 질문을 둔 공정은 설비 6개 모두 질문이 있고, 설비 id는 그 공정 화면 목록에 있으며, 안전 규칙에 걸리지 않는다", async () => {
  const chips = await loadSuggestionCases();
  const scene = await loadSceneCatalog();
  assert.ok(chips.some((c) => c.section === "ironmaking"));
  for (const p of scene.processes) {
    const mine = chips.filter((c) => c.section === p.id);
    if (!mine.length) continue;
    const covered = new Set(mine.map((c) => c.screen.equipment_id).filter(Boolean));
    assert.deepEqual([...covered].sort(), p.equipment.map((e) => e.id).sort(), p.id);
    assert.ok(mine.some((c) => c.screen.equipment_id === null), `${p.id}: 설비를 고르지 않았을 때 질문`);
  }
  for (const c of chips) assert.equal(isSafetyQuestion(c.question), false, c.question);
  assert.equal(new Set(chips.map((c) => c.id)).size, chips.length);
});

test("채점: 기대 조작이 모두 있으면 맞음(더 있어도 됨), []이면 조작이 없어야 하고, any는 보지 않는다", () => {
  const c = (scene: LearningCase["expect"]["scene"], misconception: string | null = null): LearningCase => ({
    id: "x",
    type: "t",
    question: "q",
    section: "ironmaking",
    screen: { process_id: "ironmaking", equipment_id: null },
    expect: { status: "grounded", scene, misconception },
  });
  const focus = { type: "focus" as const, target_id: "blast_furnace" };
  const highlight = { type: "highlight" as const, target_id: "blast_furnace" };
  const r = (scene_actions = [focus, highlight], status: "grounded" | "unverified" = "grounded", misconception: string | null = null, answer = "코크스는 환원제예요.") => ({ status, scene_actions, misconception, answer });
  assert.deepEqual(score(c([focus]), r()), { status: true, scene: true, misconception: true, answer: null, content: null, missing_facts: [], violations: [] });
  assert.equal(score(c([focus]), r([highlight])).scene, false);
  assert.equal(score(c([]), r()).scene, false);
  assert.equal(score(c([]), r([])).scene, true);
  assert.equal(score(c("any"), r([])).scene, null);
  assert.equal(score(c([focus]), r(undefined, "unverified")).status, false);
  assert.equal(score(c("any", "coke_reduction"), r(undefined, "grounded", null)).misconception, false);
  // answer_any: 답에 하나라도 있으면 맞음
  const fix = { ...c("any", "coke_reduction"), expect: { ...c("any", "coke_reduction").expect, answer_any: ["아니", "아닙"] } };
  assert.equal(score(fix, r(undefined, "grounded", "coke_reduction", "불순물 제거가 주된 역할은 아니에요.")).answer, true);
  assert.equal(score(fix, r(undefined, "grounded", "coke_reduction", "코크스는 연료이자 원료예요.")).answer, false);
});
