// 학습 모드 trace(llm/src/trace.ts)·근거 겹침(llm/src/grounding.ts)·trace 요약(llm/eval/trace-report.ts)을 검사한다. 실제 Gemini는 호출하지 않는다.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { groundingLines } from "../../llm/eval/run-learning.js";
import { formatReport, quantile, readTraces, summarizeTraces } from "../../llm/eval/trace-report.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { groundingSupport, splitSentences, SUPPORT_THRESHOLD } from "../../llm/src/grounding.js";
import { GeminiLearningAgent, LearningFormatError, modelProposal, type LearningAgent, type LearningInput, type LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { currentTrace, localDate, runWithTrace, Trace, TraceLog, traceSinkFromEnv, type TraceRecord } from "../../llm/src/trace.js";
import { openDatabase } from "../src/db/database.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter, unverifiedReason } from "../src/learning/routes.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics } from "../src/rubrics.js";

const CHUNKS: Chunk[] = [
  { id: "posco-brochure-2015#3", section: "ironmaking", title: "", text: "고로에서는 코크스가 산화하며 철광석의 산소를 떼어낸다.", source_ids: ["posco-brochure-2015"], tags: ["blast_furnace"] },
];

/** 받은 Gemini 응답 본문을 차례로 돌려주는 가짜 fetch. 숫자면 그 HTTP 상태로 실패한다. */
function fakeFetch(replies: (object | number)[]): typeof fetch {
  return (async () => {
    const next = replies.shift();
    if (typeof next === "number") return new Response("{}", { status: next });
    return new Response(JSON.stringify(next ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
}
const geminiBody = (text: string, totalTokens?: number) => ({
  candidates: [{ content: { parts: [{ text }] } }],
  ...(totalTokens ? { usageMetadata: { promptTokenCount: totalTokens - 10, candidatesTokenCount: 10, totalTokenCount: totalTokens } } : {}),
});

test("Trace: 클라이언트 id는 형식이 맞을 때만 쓰고, 단계 시간을 더하며, 토큰 합을 낸다", async () => {
  assert.equal(new Trace("learning", "web-12345678").id, "web-12345678");
  assert.match(new Trace("learning", "bad id!").id, /^[0-9a-f-]{36}$/);
  assert.match(new Trace("learning").id, /^[0-9a-f-]{36}$/);

  const t = new Trace("learning");
  assert.equal(t.time("retrieve", () => 7), 7);
  t.time("retrieve", () => 0);
  assert.equal(await t.timeAsync("llm", async () => "ok"), "ok");
  await assert.rejects(t.timeAsync("save", async () => { throw new Error("x"); }));
  t.once("first_text_ms", 5);
  t.once("first_text_ms", 99);
  t.llm({ model: "m", ms: 1, ok: true, streamed: false, tokens: { total: 100 } });
  t.llm({ model: "m", ms: 1, ok: true, streamed: false, tokens: { total: 50 } });
  const r = t.toRecord();
  assert.deepEqual(Object.keys(r.stages).sort(), ["llm", "retrieve", "save"]);
  assert.equal(r.first_text_ms, 5);
  assert.equal(r.llm_tokens, 150);
  assert.equal(new Trace("x").toRecord().llm_tokens, null);
});

test("runWithTrace: 비동기 안에서도 currentTrace()가 같은 trace이고, 밖에서는 undefined", async () => {
  const t = new Trace("learning");
  await runWithTrace(t, async () => {
    await new Promise((r) => setTimeout(r, 1));
    assert.equal(currentTrace(), t);
  });
  assert.equal(currentTrace(), undefined);
});

test("TraceLog: 날짜별 파일에 한 줄씩 덧붙이고, TRACE_LOG=off면 sink가 없다", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  try {
    const log = new TraceLog(dir);
    const t = new Trace("learning");
    log.write(t.toRecord());
    log.write(t.toRecord());
    const [file] = readdirSync(dir);
    assert.equal(file, `learning-${localDate(new Date(t.at))}.jsonl`);
    assert.equal(readFileSync(join(dir, file!), "utf8").trim().split("\n").length, 2);
    assert.equal(traceSinkFromEnv({ TRACE_LOG: "off" }), undefined);
    assert.equal(typeof traceSinkFromEnv({ TRACE_DIR: dir }), "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GeminiClient: trace 안에서 부르면 호출마다 모델·성공 여부·토큰·HTTP 상태를 남긴다", async () => {
  const client = new GeminiClient({ apiKey: "k", model: "test-model", fetch: fakeFetch([geminiBody("hi", 120), 429]) });
  const t = new Trace("learning");
  await runWithTrace(t, async () => {
    assert.equal(await client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 10 }), "hi");
    await assert.rejects(client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 10 }));
  });
  assert.equal(t.llm_calls.length, 2);
  assert.deepEqual({ ...t.llm_calls[0], ms: 0 }, { model: "test-model", ms: 0, ok: true, streamed: false, tokens: { prompt: 110, output: 10, thoughts: undefined, total: 120 } });
  assert.equal(t.llm_calls[1]!.ok, false);
  assert.equal(t.llm_calls[1]!.failure, "rate_limit");
  assert.equal(t.llm_calls[1]!.http_status, 429);
  // trace 밖에서는 아무것도 남기지 않는다(오류도 나지 않는다).
  await new GeminiClient({ apiKey: "k", fetch: fakeFetch([geminiBody("x")]) }).generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 1 });
});

const agentInput = (): LearningInput => ({
  section: "ironmaking",
  question: "코크스는 왜 넣어?",
  screen: { process_id: "ironmaking", equipment_id: null },
  chunks: [{ ...CHUNKS[0]!, score: 0.5 }],
  history: [],
  openMisconceptions: [],
  concepts: [{ concept_id: "coke_reduction", name: "코크스의 환원 역할" }],
});
const replyText = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ answer: "코크스는 환원제예요.", status: "grounded", source_ids: ["posco-brochure-2015#3"], follow_up: null, scene_actions: [], detected_misconception: null, keyword_card: null, ...over });

test("GeminiLearningAgent: 과부하 재시도·형식 오류·모델 제안(서버 검증 전)을 trace에 남긴다", async () => {
  const agent = new GeminiLearningAgent(new GeminiClient({ apiKey: "k", fetch: fakeFetch([503, geminiBody("not json"), geminiBody(replyText({ source_ids: ["posco-brochure-2015#3", "made-up#9"] }))]) }), [0, 0]);
  const t = new Trace("learning");
  const r = await runWithTrace(t, () => agent.reply(agentInput()));
  assert.deepEqual(r.source_ids, ["posco-brochure-2015#3"]);
  const recorded = t.fields.agent as { retries: string[]; format_problems: string[]; proposal: { source_ids: string[] } };
  assert.deepEqual(recorded.retries, ["overload_503"]);
  assert.deepEqual(recorded.format_problems, ["JSON이 아님"]);
  // 서버가 버린 id도 제안에는 남아 있다(무엇을 버렸는지 보려고).
  assert.deepEqual(recorded.proposal.source_ids, ["posco-brochure-2015#3", "made-up#9"]);
  assert.equal(t.llm_calls.length, 3);

  const bad = new GeminiLearningAgent(new GeminiClient({ apiKey: "k", fetch: fakeFetch([geminiBody("x"), geminiBody("y")]) }), [0, 0]);
  const t2 = new Trace("learning");
  await assert.rejects(runWithTrace(t2, () => bad.reply(agentInput())), LearningFormatError);
  assert.equal((t2.fields.agent as { proposal: unknown; format_problems: string[] }).proposal, null);
  assert.equal((t2.fields.agent as { format_problems: string[] }).format_problems.length, 2);
});

test("modelProposal: 형식이 맞는 응답에서 모델이 낸 값을 꺼내고, 아니면 null", () => {
  assert.deepEqual(modelProposal(replyText({ scene_actions: [{ type: "focus", target_id: "nope" }], keyword_card: { concept_id: "c" } })), {
    status: "grounded", source_ids: ["posco-brochure-2015#3"], scene_actions: [{ type: "focus", target_id: "nope" }], misconception: null, keyword_card: "c",
  });
  assert.equal(modelProposal("{"), null);
});

test("unverifiedReason: 검색 결과 없음 · 모델 판단 · 출처 검증 실패 · 저장한 답을 나눈다", () => {
  const proposal = (status: string) => ({ status, source_ids: [], scene_actions: [], misconception: null, keyword_card: null });
  assert.equal(unverifiedReason("grounded", 3, proposal("grounded")), null);
  assert.equal(unverifiedReason("unverified", 0, proposal("unverified")), "no_chunks");
  assert.equal(unverifiedReason("unverified", 2, proposal("unverified")), "model_unverified");
  assert.equal(unverifiedReason("unverified", 2, proposal("grounded")), "invalid_sources");
  assert.equal(unverifiedReason("unverified", 2, null), "model_unverified");
  assert.equal(unverifiedReason("unverified", 2, "cached"), "cached");
});

/** 정해 둔 응답을 돌려주는 가짜 튜터. propose가 있으면 실제 튜터처럼 trace에 제안을 남긴다. */
class FakeAgent implements LearningAgent {
  next: () => Promise<LearningReply> = async () => ({ answer: "고로에서는 코크스가 철광석의 산소를 떼어내요. 제철소의 심장이라고 불러요.", status: "grounded", source_ids: ["posco-brochure-2015#3"], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null });
  propose: object | null = null;
  async reply(): Promise<LearningReply> {
    if (this.propose) currentTrace()?.set("agent", { prompt_chars: 10, retries: [], format_problems: [], proposal: this.propose });
    return this.next();
  }
}

async function setup() {
  const db = openDatabase(":memory:");
  const agent = new FakeAgent();
  const traces: TraceRecord[] = [];
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(createLearningRouter({
    repo: new LearningRepository(db),
    agent,
    retriever: new Retriever({ chunksFor: (s) => CHUNKS.filter((c) => c.section === s) }),
    rubrics: loadFinalRubrics(),
    traceSink: (r) => traces.push(r),
  }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ask = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": "minsu", ...headers }, body: JSON.stringify(body) });
    return { status: res.status, header: res.headers.get("x-trace-id"), text: await res.text() };
  };
  return { agent, traces, ask, close: () => server.close() };
}

test("POST /api/chat: 요청마다 trace를 남기고 X-Trace-Id·trace_id로 돌려준다", async () => {
  const t = await setup();
  try {
    const res = await t.ask({ question: "코크스는 고로에서 무슨 일을 해?" }, { "x-trace-id": "web-abcdef12" });
    assert.equal(res.status, 200);
    assert.equal(res.header, "web-abcdef12");
    assert.equal(JSON.parse(res.text).trace_id, "web-abcdef12");
    const [r] = t.traces;
    assert.equal(r!.trace_id, "web-abcdef12");
    assert.equal(r!.outcome, "grounded");
    assert.equal(r!.http_status, 200);
    assert.deepEqual(Object.keys(r!.stages).sort(), ["context", "llm", "retrieve", "save"]);
    assert.equal((r!.retrieval as { count: number }).count, 1);
    assert.equal((r!.request as { question: string }).question, "코크스는 고로에서 무슨 일을 해?");
    assert.equal((r!.result as { unverified_reason: null }).unverified_reason, null);
    // 둘째 문장(제철소의 심장)은 근거에 없다.
    const g = r!.grounding as { sentences: number; supported: number; weakest: { text: string } };
    assert.equal(g.sentences, 2);
    assert.equal(g.supported, 1);
    assert.match(g.weakest.text, /심장/);
    // 근거 원문·답 원문은 남기지 않는다.
    assert.doesNotMatch(JSON.stringify(r), /산소를 떼어낸다|산소를 떼어내요/);
  } finally {
    t.close();
  }
});

test("POST /api/chat: 안전 질문·형식 오류·입력 오류·출처 검증 실패도 trace에 결과를 남긴다(스트리밍 포함)", async () => {
  const t = await setup();
  try {
    await t.ask({ question: "고로 비상 정지는 어떻게 해?" });
    assert.equal(t.traces.at(-1)!.outcome, "safety_redirect");

    t.agent.next = async () => { throw new LearningFormatError("형식 오류"); };
    const res = await t.ask({ question: "코크스는?", stream: true });
    assert.equal(res.status, 200);
    const done = JSON.parse(res.text.trim().split("\n").at(-1)!);
    assert.equal(done.status, 502);
    assert.equal(done.body.trace_id, res.header);
    assert.deepEqual(t.traces.at(-1)!.error, { kind: "format_error", message: "형식 오류" });
    assert.equal(t.traces.at(-1)!.http_status, 502);

    await t.ask({ question: "" });
    assert.equal(t.traces.at(-1)!.outcome, "bad_request");

    t.agent.propose = { status: "grounded", source_ids: ["made-up#1"], scene_actions: [], misconception: null, keyword_card: null };
    t.agent.next = async () => ({ answer: "확인하지 못했어요.", status: "unverified", source_ids: [], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null });
    await t.ask({ question: "코크스는 왜 넣어?" });
    const last = t.traces.at(-1)!;
    assert.equal((last.result as { unverified_reason: string }).unverified_reason, "invalid_sources");
    assert.equal(last.grounding, undefined);
  } finally {
    t.close();
  }
});

test("groundingSupport: 근거와 겹치는 문장을 세고, 짧은 문장은 빼며, 소수점에서 나누지 않는다", () => {
  assert.deepEqual(splitSentences("온도는 1.5배예요. 좋아요!\n다음은?"), ["온도는 1.5배예요.", "좋아요!", "다음은?"]);
  const g = groundingSupport("네. 코크스가 철광석의 산소를 떼어내요. 쇳물은 1,500℃ 정도로 뜨거워요.", ["고로에서는 코크스가 산화하며 철광석의 산소를 떼어낸다."]);
  assert.equal(g.sentences, 2);
  assert.equal(g.supported, 1);
  assert.equal(g.rate, 0.5);
  assert.match(g.weakest!.text, /1,500/);
  assert.ok(g.weakest!.overlap < SUPPORT_THRESHOLD);
  assert.deepEqual(groundingSupport("네.", ["x"]), { sentences: 0, supported: 0, rate: null, weakest: null });
  assert.equal(groundingSupport("코크스가 철광석의 산소를 떼어내요.", []).supported, 0);
});

test("eval:learning 보고서: grounded 답의 근거 겹침 줄을 만든다", () => {
  const row = (id: string, answer: string, status = "grounded") => ({
    c: { id } as never,
    r: { status, answer } as never,
    evidence: ["고로에서는 코크스가 산화하며 철광석의 산소를 떼어낸다."],
  });
  const lines = groundingLines([row("a", "코크스가 철광석의 산소를 떼어내요."), row("b", "제철소의 심장이라고 불러요."), row("c", "x", "unverified")]);
  assert.match(lines[0]!, /grounded 2개.*1\/2/);
  assert.match(lines[1]!, /- b 0 · "제철소의 심장/);
  assert.deepEqual(groundingLines([]), []);
});

test("trace 요약: 결과·unverified 원인·지연 분위수·서버 검증으로 버린 값을 센다", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  const base = (over: Record<string, unknown>) => ({ trace_id: "t", kind: "learning", at: "2026-10-15T00:00:00Z", total_ms: 100, stages: { llm: 80 }, llm_calls: [{ model: "m", ms: 80, ok: true, streamed: true }], llm_tokens: 500, ...over });
  const records = [
    base({ trace_id: "a", outcome: "grounded", cache: "miss", first_text_ms: 30, request: { question: "q1" }, retrieval: { count: 2, results: [{ id: "x#1", score: 0.6 }] },
      agent: { prompt_chars: 900, retries: ["overload_503"], format_problems: [], proposal: { status: "grounded", source_ids: ["x#1", "bad#1"], scene_actions: [{ type: "focus", target_id: "nope" }], misconception: "c1", keyword_card: null } },
      result: { status: "grounded", unverified_reason: null, source_ids: ["x#1"], scene_actions: [], misconception: null, keyword_card: null },
      grounding: { sentences: 2, supported: 1, rate: 0.5, weakest: { text: "근거 밖 문장", overlap: 0.1 } } }),
    base({ trace_id: "b", outcome: "unverified", total_ms: 300, cache: "personal", request: { question: "q2" }, retrieval: { count: 0, results: [] },
      agent: { prompt_chars: 700, retries: [], format_problems: ["JSON이 아님"], proposal: { status: "unverified", source_ids: [], scene_actions: [], misconception: null, keyword_card: null } },
      result: { status: "unverified", unverified_reason: "no_chunks", source_ids: [], scene_actions: [], misconception: null, keyword_card: null } }),
    base({ trace_id: "c", outcome: "error", llm_calls: [{ model: "m", ms: 5, ok: false, streamed: false, failure: "timeout" }], llm_tokens: null, error: { kind: "llm_unavailable", message: "x" } }),
  ];
  const s = summarizeTraces(records as never);
  assert.deepEqual(s.outcomes, { grounded: 1, unverified: 1, error: 1 });
  assert.deepEqual(s.unverified_reasons, { no_chunks: 1 });
  assert.deepEqual(s.errors, { llm_unavailable: 1 });
  assert.deepEqual(s.latency_ms.total, { n: 2, p50: 100, p95: 300 });
  assert.equal(s.latency_ms.first_text!.p50, 30);
  assert.deepEqual(s.llm.retries, { overload_503: 1 });
  assert.equal(s.llm.failed_calls, 1);
  assert.equal(s.llm.format_problems, 1);
  assert.equal(s.llm.tokens_per_grounded, 500);
  assert.equal(s.retrieval.zero_results, 1);
  assert.equal(s.validation.dropped_source_ids, 1);
  assert.equal(s.validation.proposed_scene_actions, 1);
  assert.equal(s.validation.final_scene_actions, 0);
  assert.equal(s.validation.misconception_dropped, 1);
  assert.equal(s.grounding.low[0]!.trace_id, "a");
  assert.deepEqual(s.unverified_questions.map((u) => u.question), ["q2"]);
  const text = formatReport(s);
  assert.match(text, /unverified 원인: no_chunks 1/);
  assert.match(text, /버린 source id 1\/2/);
});

test("readTraces: 날짜 범위의 파일만 읽고 깨진 줄은 건너뛴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "trace-"));
  try {
    const log = new TraceLog(dir);
    // 파일 날짜는 서버 시간대 기준이라 어느 시간대에서도 같은 날이 되게 정오(UTC)로 둔다.
    log.write({ ...new Trace("learning").toRecord(), at: "2026-10-14T12:00:00Z" });
    log.write({ ...new Trace("learning").toRecord(), at: "2026-10-15T12:00:00Z" });
    log.write({ ...new Trace("other").toRecord(), at: "2026-10-15T12:00:00Z" });
    assert.equal(readTraces(dir).records.length, 2);
    assert.equal(readTraces(dir, { since: "2026-10-15" }).records.length, 1);
    assert.equal(readTraces(join(dir, "none")).records.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
