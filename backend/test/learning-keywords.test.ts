// 학습 모드 키워드 카드(backend/src/learning/keywords.ts)를 실제 final 루브릭으로 검사한다.
import assert from "node:assert/strict";
import test from "node:test";
import { keywordCard, keywordCardConcepts, KEYWORD_CARD_CONCEPTS } from "../src/learning/keywords.js";
import { loadFinalRubrics, type Rubric } from "../src/rubrics.js";

const rubrics = loadFinalRubrics();
const ironmaking = rubrics.find((r) => r.section === "ironmaking");

test("카드 허용 개념은 모두 final 루브릭에 있고 answer_terms가 있다(concept_id가 바뀌면 여기서 걸린다)", () => {
  const all = new Map(rubrics.flatMap((r) => r.concepts.map((c) => [c.concept_id, c] as const)));
  for (const id of KEYWORD_CARD_CONCEPTS) {
    assert.ok(all.has(id), `final 루브릭에 없는 개념: ${id}`);
    assert.ok((all.get(id)!.answer_terms?.length ?? 0) > 0, `answer_terms가 없는 개념: ${id}`);
  }
});

test("coke_reduction 카드: answer_terms를 그대로 쓰고 용어집의 같은 말을 붙이며, 루브릭 근거 자료 id를 담는다", () => {
  assert.deepEqual(keywordCardConcepts(ironmaking).map((c) => c.concept_id), ["coke_reduction"]);
  const card = keywordCard(ironmaking, "coke_reduction");
  assert.ok(card);
  assert.equal(card.concept_id, "coke_reduction");
  assert.equal(card.name, ironmaking!.concepts.find((c) => c.concept_id === "coke_reduction")!.name);
  assert.deepEqual(card.keywords, [{ term: "일산화탄소", aliases: ["CO"] }, { term: "환원", aliases: [] }]);
  assert.equal(card.source_id, "posco-newsroom-fe-2019");
});

test("허용 목록에 없는 개념, 없는 개념, 루브릭이 없는 섹션은 카드가 없다", () => {
  const other = ironmaking!.concepts.find((c) => !KEYWORD_CARD_CONCEPTS.includes(c.concept_id))!;
  assert.equal(keywordCard(ironmaking, other.concept_id), null);
  assert.equal(keywordCard(ironmaking, "made_up"), null);
  assert.equal(keywordCard(undefined, "coke_reduction"), null);
  assert.deepEqual(keywordCardConcepts(undefined), []);
});

test("용어집 동의어로 올라 있는 용어는 대표 용어와 나머지 동의어를 같은 말로 붙이고, answer_terms가 없으면 카드를 만들지 않는다", () => {
  const rubric = {
    section: "ironmaking",
    reviewed: false,
    glossary: [{ term: "용선", aliases: ["쇳물", "선철"] }],
    concepts: [
      { concept_id: "a", name: "A", key_points: [], correct: "", partial: "", wrong: "", source: { file: "x" }, answer_terms: ["쇳물"] },
      { concept_id: "b", name: "B", key_points: [], correct: "", partial: "", wrong: "", source: { file: "x" } },
    ],
  } as unknown as Rubric;
  assert.deepEqual(keywordCard(rubric, "a", ["a", "b"])?.keywords, [{ term: "쇳물", aliases: ["용선", "선철"] }]);
  assert.equal(keywordCard(rubric, "a", ["a"])?.source_id, null);
  assert.equal(keywordCard(rubric, "b", ["a", "b"]), null);
});
