// 근거 검색 평가 세트(llm/eval/retrieval/ironmaking.jsonl)와 채점(run-retrieval.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { loadRetrievalSet, scoreRetrieval } from "../../llm/eval/run-retrieval.js";
import { publicSources } from "../../llm/src/ironmaking-sources.js";
import { Retriever } from "../../llm/src/retrieval.js";

test("검색 평가 세트: 형식이 맞고, 기대 출처는 공개 자료에 있는 id이며, 결과가 없어야 하는 케이스도 있다", () => {
  const cases = loadRetrievalSet();
  assert.ok(cases.length >= 20);
  const ids = new Set(publicSources.map((s) => s.id));
  for (const c of cases) for (const id of c.expected_source_ids) assert.ok(ids.has(id), `${c.id}: 없는 출처 ${id}`);
  assert.ok(cases.some((c) => c.expected_source_ids.length === 0));
});

test("scoreRetrieval: 기대 출처의 첫 순위로 적중·역순위를 내고, 기대 출처가 없으면 빈 결과가 적중", () => {
  const retriever = new Retriever({ chunksFor: () => [
    { id: "a#1", section: "ironmaking", title: "", text: "열풍로는 고로에 보낼 열풍을 만든다.", source_ids: ["a"], tags: [] },
    { id: "b#1", section: "ironmaking", title: "", text: "열풍은 풍구로 들어간다.", source_ids: ["b"], tags: [] },
  ] });
  const hit = scoreRetrieval({ id: "x", section: "ironmaking", query: "열풍로는 열풍을 만든다", expected_source_ids: ["b"] }, retriever);
  assert.equal(hit.hit, true);
  assert.equal(hit.reciprocalRank, 1 / 2);
  assert.equal(scoreRetrieval({ id: "y", section: "ironmaking", query: "점심 메뉴", expected_source_ids: [] }, retriever).hit, true);
});
