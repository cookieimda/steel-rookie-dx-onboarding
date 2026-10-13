// 근거 검색 평가 세트(llm/eval/retrieval/ironmaking.jsonl)와 채점(run-retrieval.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { FOLLOW_UP_SET_PATH, loadRetrievalSet, scoreRetrieval } from "../../llm/eval/run-retrieval.js";
import { publicSources } from "../../llm/src/ironmaking-sources.js";
import { looksLikeFollowUp, Retriever, retrieveWithHistory } from "../../llm/src/retrieval.js";

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

test("이어지는 질문 세트: 직전 대화(history)가 있고, 주제를 바꾸는 질문도 섞여 있다", () => {
  const cases = loadRetrievalSet(FOLLOW_UP_SET_PATH);
  assert.ok(cases.length >= 10);
  assert.ok(cases.every((c) => c.history?.length));
  assert.ok(cases.some((c) => c.id.startsWith("switch-")), "주제 전환 케이스");
});

test("retrieveWithHistory: 이어지는 질문은 직전 질문의 주제 조각도 찾고(merge), 주제를 바꾼 질문은 새 주제로 찾는다", () => {
  const retriever = new Retriever({ chunksFor: () => [
    { id: "tlc#1", section: "ironmaking", title: "", text: "토페도카는 용선 약 300톤을 담아 제강공장으로 옮긴다.", source_ids: ["tlc"], tags: [] },
    { id: "sinter#1", section: "ironmaking", title: "", text: "소결광은 가루 철광석을 덩어리로 만든 것이다.", source_ids: ["sinter"], tags: [] },
    { id: "misc#1", section: "ironmaking", title: "", text: "얼마나 많은 양을 실어 나르는지는 설비마다 다르다.", source_ids: ["misc"], tags: [] },
  ] });
  const previous = { question: "토페도카가 뭐야?", answer: "토페도카는 용선을 옮기는 열차예요." };
  // 질문만으로도 일반 표현('얼마나…실어')이 맞는 조각이 있어 예전 방식(못 찾을 때만 붙임)은 주제 조각을 놓친다.
  const ids = (strategy: "empty-fallback" | "merge") => retrieveWithHistory(retriever, "ironmaking", "그건 얼마나 실어?", {}, previous, strategy).map((r) => r.id);
  assert.ok(!ids("empty-fallback").includes("tlc#1"));
  assert.ok(ids("merge").includes("tlc#1"), "직전 질문의 주제(토페도카) 조각을 함께 찾음");
  assert.equal(retrieveWithHistory(retriever, "ironmaking", "소결광은 뭐야?", {}, previous)[0]!.id, "sinter#1");
  assert.deepEqual(retrieveWithHistory(retriever, "ironmaking", "그건 얼마나 실어?", {}, undefined).map((r) => r.id), retriever.retrieve("ironmaking", "그건 얼마나 실어?").map((r) => r.id), "직전 대화가 없으면 질문만");
  assert.equal(looksLikeFollowUp("그 바람은 몇 도야?"), true);
  assert.equal(looksLikeFollowUp("열풍로는 무슨 일을 해?"), false);
});
