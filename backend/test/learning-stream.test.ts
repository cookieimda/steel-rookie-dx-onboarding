// 학습 모드 답 스트리밍: Gemini 조각 읽기(SSE), 받는 중인 JSON에서 답 꺼내기(partialAnswer), 라우트 NDJSON 응답.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { GeminiClient } from "../../llm/src/gemini.js";
import { GeminiLearningAgent, LearningFormatError, partialAnswer, type LearningAgent, type LearningInput, type LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { openDatabase } from "../src/db/database.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter } from "../src/learning/routes.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics } from "../src/rubrics.js";

/** 문자열 조각들을 차례로 흘려보내는 응답 본문. */
const streamOf = (parts: string[], type: string) =>
  new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), { headers: { "content-type": type } });

const REPLY = { answer: "토페도카는 쇳물을 옮깁니다.\n제강으로 가요.", status: "grounded", source_ids: ["src#1"], follow_up: null, scene_actions: [], detected_misconception: null, keyword_card: null };
const RAW = JSON.stringify(REPLY);
const INPUT: LearningInput = {
  section: "ironmaking", question: "토페도카가 뭐야?", screen: { process_id: "ironmaking" },
  chunks: [{ id: "src#1", section: "ironmaking", title: "", text: "토페도카는 쇳물을 옮긴다.", source_ids: ["src"], tags: [], score: 1 }],
  history: [], openMisconceptions: [], concepts: [],
};

test("partialAnswer: 받는 중인 JSON에서 answer까지의 글을 꺼내고, 잘린 이스케이프는 뺀다", () => {
  assert.equal(partialAnswer('{"ans'), null);
  assert.equal(partialAnswer('{"answer": "토페'), "토페");
  assert.equal(partialAnswer('{"answer":"줄\\n바꿈 \\"인용\\" \\u0041'), '줄\n바꿈 "인용" A');
  assert.equal(partialAnswer('{"answer":"끝\\'), "끝");
  assert.equal(partialAnswer('{"answer":"끝\\u00'), "끝");
  assert.equal(partialAnswer(RAW), REPLY.answer);
});

const event = (t: string) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`;

test("Gemini 스트리밍: streamGenerateContent(SSE)로 받아 조각마다 알리고, 줄이 조각 경계에서 잘려 와도 읽는다", async () => {
  const client = new GeminiClient({ apiKey: "k", model: "m", fetch: (async (url) => {
    assert.match(String(url), /:streamGenerateContent\?alt=sse$/);
    const all = event(RAW.slice(0, 30)) + event(RAW.slice(30));
    return streamOf([all.slice(0, 50), all.slice(50)], "text/event-stream");
  }) as typeof fetch });
  const seen: string[] = [];
  assert.equal(await client.generate({ system: "s", prompt: "p", temperature: 0, maxOutputTokens: 10, onText: (t) => seen.push(t) }), RAW);
  assert.deepEqual(seen, [RAW.slice(0, 30), RAW]);
});

test("학습 튜터 스트리밍: 받는 중인 답을 해요체로 넘기고, 최종 답은 검증한 답", async () => {
  const client = new GeminiClient({ apiKey: "k", model: "m", fetch: (async () => streamOf([event(RAW.slice(0, 25)), event(RAW.slice(25))], "text/event-stream")) as typeof fetch });
  const seen: string[] = [];
  const reply = await new GeminiLearningAgent(client).reply(INPUT, { onAnswer: (t) => seen.push(t) });
  assert.ok(seen.length >= 1);
  assert.equal(seen.at(-1), "토페도카는 쇳물을 옮겨요.\n제강으로 가요.");
  assert.equal(reply.answer, seen.at(-1));
});

const CHUNKS: Chunk[] = [{ id: "src#1", section: "ironmaking", title: "", text: "토페도카는 고로의 쇳물을 옮긴다.", source_ids: ["src"], tags: [] }];

async function server(agent: LearningAgent) {
  const router = createLearningRouter({ repo: new LearningRepository(openDatabase(":memory:")), agent, retriever: new Retriever({ chunksFor: () => CHUNKS }), rubrics: loadFinalRubrics() });
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(router);
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const post = (body: unknown) => fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": "u" }, body: JSON.stringify(body) });
  return { post, close: () => srv.close() };
}
const lines = async (res: Response) => (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { type: string; text?: string; status?: number; body?: Record<string, unknown> });

test("POST /api/chat stream: 답 조각 줄 뒤에 done 줄(상태·평소 본문), 스트리밍을 안 쓰면 평소 JSON", async () => {
  const reply: LearningReply = { answer: "토페도카는 쇳물을 옮겨요.", status: "grounded", source_ids: ["src#1"], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null };
  const s = await server({ reply: async (_input, opts) => (opts?.onAnswer?.("토페도카는"), opts?.onAnswer?.("토페도카는 쇳물을"), reply) });
  try {
    const res = await s.post({ question: "토페도카가 뭐야?", screen: { process_id: "ironmaking" }, stream: true });
    assert.match(res.headers.get("content-type") ?? "", /ndjson/);
    const got = await lines(res);
    assert.deepEqual(got.slice(0, 2), [{ type: "answer", text: "토페도카는" }, { type: "answer", text: "토페도카는 쇳물을" }]);
    assert.equal(got[2]!.type, "done");
    assert.equal(got[2]!.status, 200);
    assert.equal(got[2]!.body!.answer, reply.answer);
    assert.equal(typeof got[2]!.body!.session_id, "string");

    const plain = await s.post({ question: "토페도카가 뭐야?", screen: { process_id: "ironmaking" } });
    assert.match(plain.headers.get("content-type") ?? "", /json/);
    assert.equal(((await plain.json()) as { answer: string }).answer, reply.answer);
  } finally {
    s.close();
  }
});

test("POST /api/chat stream: 답 도중 형식 오류면 done 줄에 502와 오류 문장", async () => {
  const s = await server({ reply: async (_input, opts) => { opts?.onAnswer?.("토페"); throw new LearningFormatError("x"); } });
  try {
    const got = await lines(await s.post({ question: "토페도카가 뭐야?", stream: true }));
    // trace_id는 요청마다 달라서 따로 본다(learning-trace.test.ts).
    const { trace_id, ...body } = got.at(-1)!.body!;
    assert.deepEqual({ ...got.at(-1), body }, { type: "done", status: 502, body: { error: "답변을 처리하지 못했어요. 다시 시도해 주세요." } });
    assert.equal(typeof trace_id, "string");
  } finally {
    s.close();
  }
});
