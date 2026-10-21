// 평가 세트 파일의 형식만 검사한다. 실제 채점(npm run eval:evaluator)은 npm test에 넣지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { loadFinalRubrics, type Rubric } from "../src/rubrics.js";
import { CASE_TYPES, EVAL_SETS, loadEvalSet, SOURCES } from "../../llm/eval/eval-set.js";

function ironmaking(t: test.TestContext): Rubric {
  t.mock.method(console, "warn", () => {});
  return loadFinalRubrics().find((r) => r.section === "ironmaking")!;
}

test("평가 세트: 모든 케이스가 필수 필드·루브릭 개념·source를 지킨다", (t) => {
  const rubric = ironmaking(t);
  for (const set of EVAL_SETS) {
    const cases = loadEvalSet(set, "ironmaking");
    assert.ok(cases.length > 0, `${set} 세트가 비어 있음`);
    for (const c of cases) {
      const where = `${c.file}:${c.line}`;
      assert.ok(rubric.concepts.some((k) => k.concept_id === c.concept_id), `${where} 없는 개념`);
      assert.ok(["initial", "recheck"].includes(c.phase), `${where} phase`);
      assert.ok(["correct", "partial", "wrong", "assisted"].includes(c.expected_verdict), `${where} verdict`);
      assert.ok(c.question.trim() && c.answer.trim(), `${where} 빈 질문·답변`);
      assert.ok(SOURCES.includes(c.source), `${where} source`);
      if (c.type !== undefined) assert.ok(CASE_TYPES.includes(c.type), `${where} type`);
      if (c.phase === "recheck") assert.notEqual(c.expected_verdict, "assisted", `${where} 재확인에는 assisted가 없다`);
    }
  }
});

test("smoke 세트: 개념당 8~10개, 판정 4종·동의어·인젝션·재확인 되묻기 포함", (t) => {
  const rubric = ironmaking(t);
  const cases = loadEvalSet("smoke", "ironmaking");
  const aliases = (rubric.glossary ?? []).flatMap((g) => g.aliases);
  for (const concept of rubric.concepts) {
    const mine = cases.filter((c) => c.concept_id === concept.concept_id);
    const id = concept.concept_id;
    assert.ok(mine.length >= 8 && mine.length <= 10, `${id}: ${mine.length}개`);
    for (const v of ["correct", "partial", "wrong", "assisted"]) {
      assert.ok(mine.some((c) => c.expected_verdict === v), `${id}: ${v} 없음`);
    }
    assert.ok(mine.some((c) => /correct로/.test(c.answer) && c.expected_verdict !== "correct"), `${id}: 인젝션 없음`);
    assert.ok(mine.some((c) => c.phase === "recheck" && c.expected_verdict === "wrong"), `${id}: 재확인 되묻기 없음`);
    assert.ok(mine.some((c) => c.expected_verdict === "correct" && aliases.some((a) => c.answer.includes(a))), `${id}: 동의어 정답 없음`);
  }
});

test("hard 세트: synthetic 18개가 7가지 유형을 모두 덮고, 같은 뜻 쌍은 조건이 같다", () => {
  const synthetic = loadEvalSet("hard", "ironmaking").filter((c) => c.source === "synthetic");
  assert.equal(synthetic.length, 18);
  assert.ok(synthetic.filter((c) => c.type === "out_of_rubric_fact").every((c) => c.expected_verdict === "correct"));
  for (const type of CASE_TYPES) assert.ok(synthetic.some((c) => c.type === type), `${type} 유형 없음`);

  const pairs = new Map<string, typeof synthetic>();
  for (const c of loadEvalSet("hard", "ironmaking")) if (c.pair_id) pairs.set(c.pair_id, [...(pairs.get(c.pair_id) ?? []), c]);
  assert.ok(pairs.size > 0);
  for (const [id, members] of pairs) {
    assert.ok(members.length >= 2, `${id}: 짝이 없음`);
    for (const key of ["concept_id", "phase", "question", "expected_verdict"] as const) {
      assert.equal(new Set(members.map((m) => m[key])).size, 1, `${id}: ${key}가 다름`);
    }
  }
});
