// Langfuse 내보내기(llm/src/langfuse.ts): trace 기록 → OTLP span·점수 변환, 설정, 보내기. 실제 Langfuse는 부르지 않는다(가짜 fetch).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { langfuseConfigFromEnv, LangfuseExporter, otelTraceId, readSentIds, toOtlpSpans, toScores } from "../../llm/src/langfuse.js";
import { Trace, traceSinkFromEnv, type TraceRecord } from "../../llm/src/trace.js";

/** 서버가 남기는 학습 trace 한 줄(2026-10-18 기록 모양). */
const learning = (over: Partial<TraceRecord> = {}): TraceRecord => ({
  trace_id: "3c1bc23c-5c22-46a3-b4f5-e8f5dd24757a",
  kind: "learning",
  at: "2026-10-18T06:49:08.493Z",
  total_ms: 2332,
  stages: { context: 3, retrieve: 9, llm: 2306, save: 12 },
  stage_offsets: { context: 1, retrieve: 4, llm: 13, save: 2319 },
  llm_calls: [{ model: "gemini:gemini-3.5-flash-lite", ms: 2180, ok: true, streamed: false, tokens: { prompt: 3262, output: 205, total: 3467 }, start_ms: 120 }],
  llm_tokens: 3467,
  request: { session_id: "63b7c39f-354d-4ff0-b814-d6252d50b16f", section: "ironmaking", equipment_id: null, question: "고로는 어떻게 작동해?" },
  retrieval: { count: 2, results: [{ id: "posco-newsroom-furnace-2019#1", score: 0.228 }] },
  agent: { profile: "full", prompt_chars: 6415 },
  outcome: "grounded",
  result: { status: "grounded", unverified_reason: null, source_ids: ["posco-newsroom-furnace-2019#1"], scene_actions: [{ type: "show_operation", target_id: "blast_furnace" }] },
  grounding: { sentences: 2, supported: 2, rate: 1 },
  ...over,
});
const attrOf = (span: { attributes: { key: string; value: Record<string, unknown> }[] }, key: string) => {
  const a = span.attributes.find((x) => x.key === key);
  return a ? Object.values(a.value)[0] : undefined;
};

test("toOtlpSpans: 요청 하나를 루트 span·단계 span·generation으로 바꾸고, 시작 시각을 기록대로 놓는다", () => {
  const spans = toOtlpSpans(learning());
  const [root, ...rest] = spans;
  assert.equal(root!.traceId, "3c1bc23c5c2246a3b4f5e8f5dd24757a");
  assert.match(root!.spanId, /^[0-9a-f]{16}$/);
  assert.equal(root!.parentSpanId, undefined);
  assert.equal(attrOf(root!, "langfuse.trace.name"), "learning");
  assert.equal(attrOf(root!, "langfuse.session.id"), "63b7c39f-354d-4ff0-b814-d6252d50b16f");
  assert.equal(JSON.parse(String(attrOf(root!, "langfuse.observation.input"))).question, "고로는 어떻게 작동해?");
  assert.equal(JSON.parse(String(attrOf(root!, "langfuse.observation.output"))).status, "grounded");
  assert.deepEqual((attrOf(root!, "langfuse.trace.tags") as { values: { stringValue: string }[] }).values.map((v) => v.stringValue), ["learning", "grounded", "gemini:gemini-3.5-flash-lite"]);
  assert.equal(attrOf(root!, "langfuse.trace.metadata.prompt_chars"), "6415");
  const start = BigInt(Date.parse("2026-10-18T06:49:08.493Z")) * 1_000_000n;
  assert.equal(BigInt(root!.endTimeUnixNano) - BigInt(root!.startTimeUnixNano), 2332n * 1_000_000n);

  const stage = (name: string) => rest.find((s) => s.name === name)!;
  assert.deepEqual(rest.filter((s) => s.parentSpanId === root!.spanId).map((s) => s.name), ["context", "retrieve", "llm", "save"]);
  assert.equal(BigInt(stage("save").startTimeUnixNano), start + 2319n * 1_000_000n);
  assert.equal(attrOf(stage("retrieve"), "langfuse.observation.type"), "retriever");

  const gen = rest.find((s) => attrOf(s, "langfuse.observation.type") === "generation")!;
  assert.equal(gen.parentSpanId, stage("llm").spanId, "LLM 호출은 llm 단계 아래");
  assert.equal(attrOf(gen, "langfuse.observation.model.name"), "gemini-3.5-flash-lite");
  assert.deepEqual(JSON.parse(String(attrOf(gen, "langfuse.observation.usage_details"))), { input: 3262, output: 205, total: 3467 });
  assert.equal(BigInt(gen.startTimeUnixNano), start + 120n * 1_000_000n);
  assert.deepEqual(toOtlpSpans(learning()).map((s) => s.spanId), spans.map((s) => s.spanId), "같은 기록은 늘 같은 id");
});

test("toOtlpSpans: 시작 시각이 없는 예전 기록은 단계를 차례로 놓고, 실패 호출·오류는 ERROR, 시험 작업은 이름에 작업 종류", () => {
  const old = toOtlpSpans(learning({ stage_offsets: undefined, llm_calls: [{ model: "ollama:qwen2.5:3b", ms: 50, ok: false, failure: "timeout", streamed: false }], outcome: "error", error: { kind: "llm", message: "시간 초과" } }));
  const save = old.find((s) => s.name === "save")!, root = old[0]!;
  assert.equal(BigInt(save.startTimeUnixNano) - BigInt(root.startTimeUnixNano), (3n + 9n + 2306n) * 1_000_000n);
  assert.equal(attrOf(root, "langfuse.observation.level"), "ERROR");
  assert.equal(attrOf(root, "langfuse.observation.status_message"), "시간 초과");
  const gen = old.find((s) => attrOf(s, "langfuse.observation.type") === "generation")!;
  assert.equal(attrOf(gen, "langfuse.observation.model.name"), "qwen2.5:3b");
  assert.equal(attrOf(gen, "langfuse.observation.status_message"), "timeout");
  assert.equal(gen.status.code, 2);

  const exam = toOtlpSpans({ trace_id: "job-trace-0001", kind: "exam", at: "2026-10-18T06:49:15.279Z", total_ms: 27, stages: {}, llm_calls: [], llm_tokens: null, job: { id: "j", kind: "exam-start", queue_ms: 30 }, outcome: "succeeded" });
  assert.equal(exam[0]!.name, "exam:exam-start");
  assert.match(exam[0]!.traceId, /^[0-9a-f]{32}$/, "UUID가 아닌 trace id는 해시");
  assert.equal(otelTraceId("job-trace-0001"), exam[0]!.traceId);
});

test("toScores: 결과(범주)와 근거 겹침 비율(숫자), 정해진 id", () => {
  const scores = toScores(learning());
  assert.deepEqual(scores.map((s) => [s.name, s.value, s.dataType]), [["outcome", "grounded", "CATEGORICAL"], ["grounding_rate", 1, "NUMERIC"]]);
  assert.equal(scores[0]!.id, "3c1bc23c5c2246a3b4f5e8f5dd24757a-outcome");
  assert.deepEqual(toScores(learning({ grounding: undefined, outcome: undefined })), []);
});

test("langfuseConfigFromEnv: 세 값이 다 있어야 켜지고, 이 컴퓨터가 아닌 주소는 LANGFUSE_ALLOW_REMOTE=1이 있어야 한다", () => {
  const keys = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };
  assert.equal(langfuseConfigFromEnv({}), null);
  assert.equal(langfuseConfigFromEnv({ LANGFUSE_HOST: "http://localhost:3100" }), null);
  assert.deepEqual(langfuseConfigFromEnv({ ...keys, LANGFUSE_HOST: "http://localhost:3100/" }), { host: "http://localhost:3100", publicKey: "pk", secretKey: "sk" });
  assert.throws(() => langfuseConfigFromEnv({ ...keys, LANGFUSE_HOST: "https://cloud.langfuse.com" }), /LANGFUSE_ALLOW_REMOTE/);
  assert.equal(langfuseConfigFromEnv({ ...keys, LANGFUSE_HOST: "https://cloud.langfuse.com", LANGFUSE_ALLOW_REMOTE: "1" })!.host, "https://cloud.langfuse.com");
});

test("LangfuseExporter: OTLP JSON과 점수를 Basic 인증·v4 헤더로 보내고, 실패하면 경고 한 번만 남기고 막지 않는다", async () => {
  const sent: { url: string; headers: Record<string, string>; body: any }[] = [];
  const ok = (async (url: string, init: RequestInit) => { sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
  const exporter = new LangfuseExporter({ host: "http://localhost:3100", publicKey: "pk", secretKey: "sk" }, { fetch: ok, flushMs: 0 });
  exporter.push(learning());
  await exporter.flush();
  assert.equal(sent[0]!.url, "http://localhost:3100/api/public/otel/v1/traces");
  assert.equal(sent[0]!.headers.Authorization, `Basic ${Buffer.from("pk:sk").toString("base64")}`);
  assert.equal(sent[0]!.headers["x-langfuse-ingestion-version"], "4");
  assert.equal(sent[0]!.body.resourceSpans[0].scopeSpans[0].spans.length, 6);
  assert.deepEqual(sent.slice(1).map((s) => [s.url.endsWith("/api/public/scores"), s.body.name]), [[true, "outcome"], [true, "grounding_rate"]]);
  assert.deepEqual(exporter.sent, { traces: 1, spans: 6, scores: 2, failed: 0 });

  // 보낸 기록 파일: 보내기에 성공한 trace id만 적는다(지난 기록 내보내기가 건너뛴다).
  const dir = mkdtempSync(join(tmpdir(), "langfuse-"));
  try {
    const sentLog = join(dir, "langfuse-sent.txt");
    const logged = new LangfuseExporter({ host: "http://localhost:3100", publicKey: "pk", secretKey: "sk" }, { fetch: ok, flushMs: 0, sentLog });
    logged.push(learning());
    await logged.flush();
    assert.deepEqual([...readSentIds(sentLog)], ["3c1bc23c-5c22-46a3-b4f5-e8f5dd24757a"]);
    assert.equal(readSentIds(join(dir, "없음.txt")).size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const warnings: string[] = [];
  const down = new LangfuseExporter({ host: "http://localhost:3100", publicKey: "pk", secretKey: "sk" }, {
    fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch, flushMs: 0, warn: (m) => warnings.push(m),
  });
  down.push(learning());
  down.push(learning({ trace_id: "other-trace-0002" }));
  await down.flush();
  down.push(learning());
  await down.flush();
  assert.equal(warnings.length, 1);
  assert.equal(down.sent.failed, 3);
});

test("Trace: 단계·LLM 호출의 시작 시각을 남기고, traceSinkFromEnv는 Langfuse 설정이 있을 때만 함께 보낸다", async () => {
  const t = new Trace("learning");
  await t.timeAsync("retrieve", async () => {});
  t.llm({ model: "gemini:m", ms: 0, ok: true, streamed: false });
  const r = t.toRecord();
  assert.equal(typeof r.stage_offsets!.retrieve, "number");
  assert.equal(typeof r.llm_calls[0]!.start_ms, "number");
  assert.equal(traceSinkFromEnv({ TRACE_LOG: "off", LANGFUSE_HOST: "http://localhost:3100", LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }), undefined);
  assert.throws(() => traceSinkFromEnv({ TRACE_DIR: "x", LANGFUSE_HOST: "http://10.0.0.5:3100", LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }), /LANGFUSE_ALLOW_REMOTE/);
});
