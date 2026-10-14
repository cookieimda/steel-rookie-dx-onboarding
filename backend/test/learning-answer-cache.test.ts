// 학습 답 저장(answer-cache.ts)과 추천 질문 미리 받기(warmAnswers·suggested.ts).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import type { LearningAgent, LearningInput, LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { openDatabase } from "../src/db/database.js";
import { AnswerCache, answerCacheVersion } from "../src/learning/answer-cache.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter } from "../src/learning/routes.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { loadSuggestedQuestions, warmItems } from "../src/learning/suggested.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics } from "../src/rubrics.js";

const CHUNKS: Chunk[] = [{ id: "src#1", section: "ironmaking", title: "", text: "토페도카는 고로의 쇳물을 제강공장으로 옮긴다.", source_ids: ["src"], tags: ["torpedo_car"] }];
const reply = (over: Partial<LearningReply> = {}): LearningReply => ({
  answer: "토페도카는 쇳물을 옮겨요.", status: "grounded", source_ids: ["src#1"], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null, ...over,
});
const key = { section: "ironmaking", processId: "ironmaking", equipmentId: null, question: "토페도카가 뭐야?", chunkIds: ["src#1"] };

test("AnswerCache: 근거 있는 답만 저장하고, 질문 공백·근거 순서는 같게 보며, 버전·근거·화면이 다르면 다른 답", () => {
  const cache = new AnswerCache("m:1");
  cache.set(key, reply({ status: "unverified" }));
  assert.equal(cache.get(key), null, "근거 없는 답은 저장하지 않음");
  cache.set(key, reply());
  assert.deepEqual(cache.get({ ...key, question: "  토페도카가   뭐야? " }), reply());
  assert.equal(cache.get({ ...key, chunkIds: ["src#2"] }), null);
  assert.equal(cache.get({ ...key, equipmentId: "torpedo_car" }), null);
  assert.equal(new AnswerCache("m:2").get(key), null);
  assert.notEqual(answerCacheVersion("m", ["a"]), answerCacheVersion("m", ["b"]), "프롬프트가 바뀌면 버전이 바뀜");
});

test("AnswerCache: 파일에 남겨 다시 켜도 쓰고, 버전이 다르면 버린다", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "answers-")), "answer-cache.json");
  const a = new AnswerCache("m:1", file);
  a.set(key, reply());
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(new AnswerCache("m:1", file).get(key), reply());
  assert.equal(new AnswerCache("m:2", file).size, 0);
});

async function server(opts: { suggested?: string[] } = {}) {
  const calls: LearningInput[] = [];
  const agent: LearningAgent = { reply: async (input) => (calls.push(input), reply({ detected_misconception: input.question.includes("죠?") ? { concept_id: "coke_reduction", summary: "s" } : null })) };
  const repo = new LearningRepository(openDatabase(":memory:"));
  const cache = new AnswerCache("test");
  const router = createLearningRouter({
    repo, agent, cache, retriever: new Retriever({ chunksFor: () => CHUNKS }), rubrics: loadFinalRubrics(),
    suggestedQuestions: () => opts.suggested ?? [],
  });
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(router);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const ask = async (body: unknown, user = "u1") => {
    const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": user }, body: JSON.stringify(body) });
    return (await res.json()) as { answer: string; session_id: string };
  };
  return { calls, repo, cache, router, ask, close: () => srv.close() };
}

test("POST /api/chat: 개인 기록이 없는 같은 질문은 저장한 답을 쓰고(모델 1번), 이어지는 대화는 다시 묻는다", async () => {
  const s = await server();
  try {
    const screen = { process_id: "ironmaking" };
    const first = await s.ask({ question: "토페도카가 뭐야?", screen });
    await s.ask({ question: "토페도카가 뭐야?", screen }, "u2");
    assert.equal(s.calls.length, 1, "다른 사람의 같은 질문도 저장한 답");
    await s.ask({ question: "토페도카가 뭐야?", screen, session_id: first.session_id });
    assert.equal(s.calls.length, 2, "대화 이력이 있으면 모델을 부름");
  } finally {
    s.close();
  }
});

test("POST /api/chat: 추천 질문은 오개념 메모가 있어도 저장한 답을 쓰고(오개념 감지는 빼고), 개인화된 답은 저장하지 않는다", async () => {
  const s = await server({ suggested: ["코크스는 왜 넣어?"] });
  try {
    s.repo.recordMisconception({ user_id: "memo-user", section: "ironmaking", concept_id: "coke_reduction", answer_text: "x", summary: "코크스를 불순물 제거로 앎" }, "2026-10-13T00:00:00Z");
    const screen = { process_id: "ironmaking" };
    await s.ask({ question: "코크스는 왜 넣어?", screen }, "memo-user");
    assert.equal(s.calls.length, 1);
    assert.equal(s.cache.size, 0, "메모가 있는 사람의 답은 저장하지 않음");
    await s.ask({ question: "코크스는 왜 넣어?", screen }, "fresh");
    await s.ask({ question: "코크스는 왜 넣어?", screen }, "memo-user");
    assert.equal(s.calls.length, 2, "처음 사람이 저장 → 메모 있는 사람도 추천 질문은 저장한 답");
  } finally {
    s.close();
  }
});

test("warmAnswers: 미리 받아 저장하고, 이미 있는 답은 건너뛴다", async () => {
  const s = await server();
  try {
    const items = [{ processId: "ironmaking", equipmentId: null, question: "토페도카가 뭐야?" }, { processId: null, equipmentId: null, question: "토페도카가 뭐야?" }];
    assert.deepEqual(await s.router.warmAnswers(items), { saved: 2, cached: 0, failed: 0 });
    assert.deepEqual(await s.router.warmAnswers(items), { saved: 0, cached: 2, failed: 0 });
    await s.ask({ question: "토페도카가 뭐야?", screen: { process_id: "ironmaking" } });
    assert.equal(s.calls.length, 2, "미리 받은 답을 씀");
  } finally {
    s.close();
  }
});

test("suggested.ts: 화면과 같은 규칙의 추천 질문, 미리 받기 순서는 전체 화면 → 제선 → 제선 설비 → 다른 공정", async () => {
  const suggested = await loadSuggestedQuestions();
  assert.ok(suggested(null, null).length > 0 && !suggested(null, null).some((q) => q.startsWith("이 설비")));
  assert.ok(suggested("ironmaking", "torpedo_car").includes("토페도카는 뭘 옮겨?"));
  assert.ok(!suggested("rolling", null).some((q) => q.startsWith("이 설비")));
  const items = warmItems(suggested, await loadSceneCatalog());
  assert.equal(items[0].processId, null);
  assert.ok(items.findIndex((i) => i.processId === "steelmaking") > items.findIndex((i) => i.equipmentId === "torpedo_car"));
  assert.equal(new Set(items.map((i) => `${i.processId}|${i.equipmentId}|${i.question}`)).size, items.length, "중복 없음");
});
