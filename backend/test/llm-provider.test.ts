// LLM provider(llm/src/provider.ts)·Ollama 클라이언트(llm/src/ollama.ts)·로컬 모델용 학습 튜터 설정(compact)을 검사한다.
// 실제 Gemini·Ollama는 부르지 않는다(가짜 fetch).
import assert from "node:assert/strict";
import test from "node:test";
import { RetryingLlmClient } from "../../llm/eval/run-log.js";
import { GeminiCallError, GeminiClient } from "../../llm/src/gemini.js";
import { toJsonSchema } from "../../llm/src/json-schema.js";
import { COMPACT_OUTPUT_TOKENS, GeminiLearningAgent, type LearningInput } from "../../llm/src/learning-agent.js";
import { compactLearningInput, LOCAL_CONTEXT_LIMITS } from "../../llm/src/learning-context.js";
import type { GenerateRequest } from "../../llm/src/llm-client.js";
import { OllamaClient } from "../../llm/src/ollama.js";
import { configuredProvider, createLlmClient, profileFor, providerInfo } from "../../llm/src/provider.js";
import { runWithTrace, Trace } from "../../llm/src/trace.js";

const req: GenerateRequest = { system: "s", prompt: "p", temperature: 0.3, maxOutputTokens: 100 };

/** 보낸 요청을 기록하고 정해 둔 응답을 돌려주는 가짜 fetch. */
function fakeFetch(reply: (url: string, body: any) => Response) {
  const sent: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url: String(url), body });
    return reply(String(url), body);
  }) as unknown as typeof fetch;
  return { sent, fetch: fetchImpl };
}

// 재시도 안내(process.stdout.write)를 가리는 테스트는 맨 앞에 둔다. 뒤에 두면 앞 테스트들의 결과 출력까지 가려진다.
test("RetryingLlmClient: 어느 provider든 연결 오류를 다시 부르고 이유를 남긴다", async (t) => {
  t.mock.method(process.stdout, "write", () => true);
  let n = 0;
  const flaky = { generate: async () => { if (n++ < 2) throw new GeminiCallError("Ollama 연결 실패", "network"); return "답"; } };
  const client = new RetryingLlmClient(flaky, 0);
  assert.equal(await client.generate(req), "답");
  assert.equal(client.retries.length, 2);
  client.reset();
  assert.deepEqual(client.retries, []);
  const http = new RetryingLlmClient({ generate: async () => { throw new GeminiCallError("HTTP 500", "http", 500); } }, 0);
  await assert.rejects(http.generate(req), /HTTP 500/);
});

test("provider: 기본은 gemini, ollama 선택, 모르는 값과 PRIVATE_LLM_ONLY=1의 gemini는 막는다", () => {
  assert.equal(configuredProvider({}), "gemini");
  assert.equal(configuredProvider({ LLM_PROVIDER: " Ollama " }), "ollama");
  assert.throws(() => configuredProvider({ LLM_PROVIDER: "vllm" }), /gemini\|ollama/);
  assert.throws(() => configuredProvider({ PRIVATE_LLM_ONLY: "1" }), /Gemini를 쓸 수 없습니다/);
  assert.ok(createLlmClient({}, { LLM_PROVIDER: "ollama" }) instanceof OllamaClient);
  assert.ok(createLlmClient({}, {}) instanceof GeminiClient);
  assert.deepEqual(providerInfo({ LLM_PROVIDER: "ollama", OLLAMA_MODEL: "exaone3.5:2.4b" }), { provider: "ollama", model: "exaone3.5:2.4b", label: "ollama:exaone3.5:2.4b" });
  assert.equal(providerInfo({ GEMINI_MODEL: "gemini-x" }).label, "gemini:gemini-x");
  assert.deepEqual(profileFor("ollama"), { learning: "compact", evaluatorGuards: true });
  assert.deepEqual(profileFor("gemini"), { learning: "full", evaluatorGuards: false });
});

test("createLlmClient: beforeCall(호출 수 제한)을 어느 provider에도 넣는다", async () => {
  let charged = 0;
  const { fetch } = fakeFetch(() => Response.json({ message: { content: "답" } }));
  const client = createLlmClient({ beforeCall: () => { charged++; }, ollama: { fetch } }, { LLM_PROVIDER: "ollama" });
  assert.equal(await client.generate(req), "답");
  assert.equal(charged, 1);
});

test("toJsonSchema: 대문자 type·nullable·propertyOrdering을 표준 JSON Schema로 바꾸고 입력은 바꾸지 않는다", () => {
  const schema = { type: "OBJECT", properties: { a: { type: "STRING", nullable: true, enum: ["x"] }, b: { type: "OBJECT", nullable: true } }, propertyOrdering: ["a", "b"] };
  assert.deepEqual(toJsonSchema(schema), { type: "object", properties: { a: { type: ["string", "null"], enum: ["x", null] }, b: { type: ["object", "null"] } } });
  assert.equal(schema.properties.a.type, "STRING");
});

test("OllamaClient: /api/chat에 모델·문맥 길이·keep_alive·JSON Schema를 넣고, 토큰 수를 trace에 남긴다", async () => {
  const { sent, fetch } = fakeFetch(() => Response.json({ message: { content: "{\"a\":1}" }, prompt_eval_count: 300, eval_count: 40 }));
  const client = new OllamaClient({ baseUrl: "http://ollama.test/", model: "qwen2.5:3b", contextLength: 4096, keepAlive: "20m", fetch });
  const t = new Trace("learning");
  const text = await runWithTrace(t, () => client.generate({ ...req, responseSchema: { type: "OBJECT", properties: { a: { type: "INTEGER" } } } }));
  assert.equal(text, "{\"a\":1}");
  const { url, body } = sent[0]!;
  assert.equal(url, "http://ollama.test/api/chat");
  assert.equal(body.model, "qwen2.5:3b");
  assert.equal(body.stream, false);
  assert.deepEqual(body.options, { temperature: 0.3, num_predict: 100, num_ctx: 4096 });
  assert.equal(body.keep_alive, "20m");
  assert.deepEqual(body.format, { type: "object", properties: { a: { type: "integer" } } });
  assert.match(body.messages[0].content, /JSON Schema/);
  assert.equal(body.messages[1].content, "p");
  assert.equal(t.llm_calls[0]!.model, "ollama:qwen2.5:3b");
  assert.deepEqual(t.llm_calls[0]!.tokens, { prompt: 300, output: 40, total: 340 });
});

test("OllamaClient: 스트리밍(onText)은 NDJSON 조각을 이어 붙여 알리고 마지막 줄의 토큰 수를 남긴다", async () => {
  const lines = [{ message: { content: "{\"answer\":\"코" } }, { message: { content: "크스\"}" } }, { done: true, prompt_eval_count: 10, eval_count: 5 }];
  const { sent, fetch } = fakeFetch(() => new Response(lines.map((l) => JSON.stringify(l)).join("\n")));
  const seen: string[] = [];
  const t = new Trace("learning");
  const text = await runWithTrace(t, () => new OllamaClient({ fetch }).generate({ ...req, onText: (s) => seen.push(s) }));
  assert.equal(sent[0]!.body.stream, true);
  assert.equal(text, "{\"answer\":\"코크스\"}");
  assert.deepEqual(seen, ["{\"answer\":\"코", "{\"answer\":\"코크스\"}"]);
  assert.deepEqual(t.llm_calls[0]!.tokens, { prompt: 10, output: 5, total: 15 });
  assert.equal(t.llm_calls[0]!.streamed, true);
});

test("OllamaClient: 오류는 GeminiCallError로 올리고(재시도·오류 처리를 같이 탐), 호출 수 제한이 먼저 막는다", async () => {
  let calls = 0;
  const limited = new OllamaClient({ beforeCall: () => { throw new Error("quota"); }, fetch: (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch });
  await assert.rejects(limited.generate(req), /quota/);
  assert.equal(calls, 0);
  await assert.rejects(new OllamaClient({ fetch: fakeFetch(() => new Response("", { status: 500 })).fetch }).generate(req), (e: unknown) => e instanceof GeminiCallError && e.httpStatus === 500 && e.reason === "http");
  await assert.rejects(new OllamaClient({ fetch: fakeFetch(() => Response.json({ done: true })).fetch }).generate(req), /비어 있거나/);
  await assert.rejects(new OllamaClient({ fetch: fakeFetch(() => Response.json({ error: "model not found" })).fetch }).generate(req), /model not found/);
  const down = new OllamaClient({ fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
  const t = new Trace("learning");
  await assert.rejects(runWithTrace(t, () => down.generate(req)), (e: unknown) => e instanceof GeminiCallError && e.reason === "network");
  assert.equal(t.llm_calls[0]!.failure, "network");
});

test("OllamaClient: 연결 확인(받아 둔 모델·없는 모델·꺼진 서버), 미리 올리기는 호출 수에 넣지 않는다", async () => {
  const tags = (models: object[]) => fakeFetch(() => Response.json({ models })).fetch;
  assert.deepEqual(await new OllamaClient({ model: "qwen2.5", fetch: tags([{ name: "qwen2.5:latest" }]) }).checkConnection(), { connected: true, reason: "ready" });
  assert.deepEqual(await new OllamaClient({ model: "qwen2.5:3b", fetch: tags([{ name: "exaone3.5:2.4b" }]) }).checkConnection(), { connected: false, reason: "model_missing" });
  assert.deepEqual(await new OllamaClient({ fetch: (async () => { throw new Error("off"); }) as unknown as typeof fetch }).checkConnection(), { connected: false, reason: "unreachable" });

  let charged = 0;
  const { sent, fetch } = fakeFetch(() => Response.json({ done: true }));
  await new OllamaClient({ contextLength: 2048, beforeCall: () => { charged++; }, fetch }).warmUp();
  assert.equal(charged, 0);
  assert.deepEqual(sent[0]!.body.messages, []);
  assert.equal(sent[0]!.body.options.num_ctx, 2048);
  await assert.rejects(new OllamaClient({ fetch: fakeFetch(() => new Response("", { status: 404 })).fetch }).warmUp(), /미리 올리기 실패/);
});

const chunk = (i: number, text = `코크스 환원 ${i}`) => ({ id: `c#${i}`, section: "ironmaking" as const, title: "근거", text, source_ids: ["src"], tags: i === 0 ? ["blast_furnace"] : [], score: 1 - i / 10 });
const baseInput = (over: Partial<LearningInput> = {}): LearningInput => ({
  section: "ironmaking",
  question: "그럼 전로에서 하는 일은 뭐예요?",
  screen: { process_id: "ironmaking", equipment_id: null },
  chunks: [0, 1, 2, 3, 4].map((i) => chunk(i)),
  history: Array.from({ length: 6 }, (_, i) => ({ question: `질문 ${i}`, answer: "앞선 설명".repeat(300) })),
  openMisconceptions: Array.from({ length: 5 }, (_, i) => ({ concept_id: `k${i}`, summary: "메모" })),
  concepts: [],
  scene: { processes: [
    { id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로" }, { id: "sinter_plant", name: "소결기" }] },
    { id: "steelmaking", name: "제강", equipment: [{ id: "bof_converter", name: "전로 (BOF·LD)" }, { id: "ladle", name: "래들" }] },
  ] },
  ...over,
});

test("compactLearningInput: 근거는 자르지 않고 개수만 줄이며, 최근 대화·메모·관련 설비만 남긴다", () => {
  const input = baseInput();
  const compact = compactLearningInput(input);
  assert.equal(compact.question, input.question);
  assert.equal(compact.chunks.length, LOCAL_CONTEXT_LIMITS.chunks);
  assert.equal(compact.chunks[0]!.text, input.chunks[0]!.text);
  assert.deepEqual(compact.history.map((h) => h.question), ["질문 4", "질문 5"]);
  assert.match(compact.history[0]!.answer, /일부 생략/);
  assert.equal(compact.openMisconceptions.length, LOCAL_CONTEXT_LIMITS.notes);
  // 근거 태그(blast_furnace)와 질문이 가리킨 설비(전로)만 남는다.
  assert.deepEqual(compact.scene!.processes.map((p) => p.equipment.map((e) => e.id)), [["blast_furnace"], ["bof_converter"]]);
  assert.equal(input.history.length, 6, "입력은 바꾸지 않는다");
  // 첫 조각이 상한보다 길어도 근거가 하나도 없게 되지 않게 넣는다(자르지 않음).
  const long = compactLearningInput(baseInput({ chunks: [chunk(0, "근거".repeat(2000)), chunk(1)] }));
  assert.deepEqual(long.chunks.map((c) => c.id), ["c#0"]);
});

const replyJson = (over: object = {}) => JSON.stringify({ answer: "코크스는 환원제예요.", status: "grounded", source_ids: ["c#0"], follow_up: null, scene_actions: [], detected_misconception: null, keyword_card: null, ...over });

test("compact 튜터: 짧은 프롬프트·출력 상한을 쓰고, 보낸 근거 밖 인용은 버리며, 형식 오류로 다시 부를 때 temperature 0", async () => {
  const sent: GenerateRequest[] = [];
  const replies = ["{잘린 JSON", replyJson({ source_ids: ["c#0", "c#4"] })];
  const agent = new GeminiLearningAgent({ generate: async (r) => (sent.push(r), replies.shift()!) }, [], "compact");
  const t = new Trace("learning");
  const reply = await runWithTrace(t, () => agent.reply(baseInput({ history: [], question: "코크스는 왜 넣어?" })));
  assert.equal(sent[0]!.maxOutputTokens, COMPACT_OUTPUT_TOKENS);
  assert.match(sent[0]!.system, /follow_up은 기본 null/);
  assert.doesNotMatch(sent[0]!.prompt, /\[c#4\]/, "줄인 근거만 보낸다");
  assert.deepEqual([sent[0]!.temperature, sent[1]!.temperature], [0.3, 0]);
  assert.deepEqual(reply.source_ids, ["c#0"], "보내지 않은 조각(c#4) 인용은 버린다");
  assert.equal((t.fields.agent as { profile: string }).profile, "compact");

  const full: GenerateRequest[] = [];
  await new GeminiLearningAgent({ generate: async (r) => (full.push(r), replyJson()) }, []).reply(baseInput({ history: [] }));
  assert.equal(full[0]!.maxOutputTokens, 1200);
  assert.match(full[0]!.prompt, /\[c#4\]/);
});
