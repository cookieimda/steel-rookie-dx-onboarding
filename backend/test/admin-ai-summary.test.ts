import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { AdminSummaryFormatError, GeminiAdminSummarizer, parseSummary, summaryPrompt, type AdminSummarizer, type SummaryConcept } from "../../llm/src/admin-summary.js";
import type { GeminiClient } from "../../llm/src/gemini.js";
import { AiSummaryService, topMissedConcepts } from "../src/admin/ai-summary.js";
import type { ConceptStat } from "../src/admin/concept-stats.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { LlmUnavailableError } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import type { Rubric, RubricConcept } from "../src/rubrics.js";
import { UsageLimitError } from "../src/usage.js";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
const RUBRICS: Rubric[] = [{
  section: "ironmaking", reviewed: true,
  concepts: [["coke_reduction", "고로에서 코크스의 역할"], ["sinter_purpose", "소결의 목적"], ["hot_metal", "고로에서 쇳물이 나오는 과정"]]
    .map(([concept_id, name]) => ({ concept_id, name }) as RubricConcept),
}];

/** 받은 입력을 남기고, next에 넣은 동작(문장 또는 예외)을 한다. */
class FakeSummarizer implements AdminSummarizer {
  calls: SummaryConcept[][] = [];
  next: () => string = () => "코크스 역할을 다시 설명해 주세요.";
  async summarize(concepts: readonly SummaryConcept[]): Promise<string> {
    this.calls.push([...concepts]);
    return this.next();
  }
}

let db: DatabaseSync;
let admin: User;
let kim: User;
let lee: User;
let fake: FakeSummarizer;
let server: ReturnType<express.Express["listen"]>;
let bare: ReturnType<express.Express["listen"]>;
let base = "";
let bareBase = "";

const listen = async (router: express.Router) => {
  const app = express();
  app.use(router);
  const s = app.listen(0);
  await new Promise((resolve) => s.once("listening", resolve));
  return { s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};

before(async () => {
  db = openDatabase(":memory:");
  const users = new UserRepository(db);
  admin = await users.create({ username: "admin01", password: "password123", name: "관리자", employee_no: "A1", role: "admin" });
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  fake = new FakeSummarizer();
  ({ s: server, url: base } = await listen(createAdminRouter(db, { users, secret }, { summarizer: fake, rubrics: () => RUBRICS })));
  ({ s: bare, url: bareBase } = await listen(createAdminRouter(db, { users, secret })));
});
after(() => { server.close(); bare.close(); });
afterEach(() => {
  db.exec("DELETE FROM concept_results; DELETE FROM attempts; DELETE FROM misconceptions;");
  fake.calls = [];
  fake.next = () => "코크스 역할을 다시 설명해 주세요.";
});

const get = async (user?: User, path = "/api/admin/ai-summary", at = base) => {
  const headers: Record<string, string> = user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {};
  const res = await fetch(`${at}${path}`, { headers });
  return { status: res.status, json: (await res.json()) as any };
};

let seq = 0;
/** 끝낸 시도 하나에 개념별 첫 판정을 넣는다. */
function record(userId: string, verdicts: Record<string, string>, section = "ironmaking") {
  const id = `ai-${++seq}`;
  db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, ?, 'completed', 0.5, 0, 't', 't', 't', 'first', '[]')").run(id, userId, section);
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES (?, ?, 'q', ?, ?, 'wrong', 't', 't')");
  for (const [concept, verdict] of Object.entries(verdicts)) result.run(id, concept, `답변원문-${userId}`, verdict);
}

test("AI summary is admin-only and answers 503 when no summarizer is configured", async () => {
  assert.equal((await get()).status, 401);
  assert.equal((await get(kim)).status, 403);
  const off = await get(admin, "/api/admin/ai-summary", bareBase);
  assert.equal(off.status, 503);
  assert.equal(off.json.code, "LLM_UNAVAILABLE");
  assert.equal((await get(admin, "/api/admin/ai-summary?section=sintering")).status, 400);
});

test("with no missed answers, the summary is null and the LLM is not called", async () => {
  assert.deepEqual((await get(admin)).json, { summary: null, concepts: [], generated_at: null, cached: false });
  record(kim.id, { coke_reduction: "correct" });
  assert.equal((await get(admin)).json.summary, null);
  assert.equal(fake.calls.length, 0);
});

test("top missed concepts: current rubric concepts only, sorted like the dashboard", () => {
  const stat = (concept_id: string, asked: number, wrong: number, partial: number, name?: string): ConceptStat =>
    ({ section: "ironmaking", concept_id, ...(name ? { name } : {}), asked, partial, wrong, assisted: 0, final_wrong: 0, open: 0 });
  const top = topMissedConcepts([
    stat("a", 4, 1, 1, "A"), stat("b", 2, 1, 0, "B"), stat("c", 2, 0, 1, "C"),
    stat("perfect", 3, 0, 0, "P"), stat("hot_stove", 1, 1, 0), stat("never", 0, 0, 0, "N"),
  ], 5);
  // a·b·c 모두 50%면 wrong 많은 순(a 1, b 1, c 0). 안정 정렬이라 a가 b보다 앞.
  assert.deepEqual(top.map((c) => c.concept_id), ["a", "b", "c"]);
});

test("the LLM gets only aggregate numbers and names, and the result is cached until the stats change", async () => {
  record(kim.id, { coke_reduction: "wrong", sinter_purpose: "partial", hot_metal: "correct" });
  record(lee.id, { coke_reduction: "assisted", sinter_purpose: "correct", hot_stove: "wrong" });
  db.prepare("INSERT INTO misconceptions (id, user_id, answer_text, summary, resolved, created_at, section, concept_id, source) VALUES ('m1', ?, '코크스는 그냥 연료', '오개념설명', 0, 't', 'ironmaking', 'coke_reduction', 'checkpoint')").run(kim.id);

  const first = await get(admin);
  assert.equal(first.status, 200);
  assert.equal(first.json.summary, "코크스 역할을 다시 설명해 주세요.");
  assert.equal(first.json.cached, false);
  assert.deepEqual(first.json.concepts.map((c: { concept_id: string }) => c.concept_id), ["coke_reduction", "sinter_purpose"]);
  assert.deepEqual(fake.calls[0], [
    { section_name: "제선", name: "고로에서 코크스의 역할", asked: 2, partial: 0, wrong: 1, assisted: 1, final_wrong: 2, open: 1 },
    { section_name: "제선", name: "소결의 목적", asked: 2, partial: 1, wrong: 0, assisted: 0, final_wrong: 2, open: 0 },
  ]);
  const sent = JSON.stringify(fake.calls) + summaryPrompt(fake.calls[0]!);
  for (const secretText of ["답변원문", "코크스는 그냥 연료", "오개념설명", kim.id, lee.id, "김신입", "hot_stove"]) {
    assert.ok(!sent.includes(secretText), `LLM 입력에 ${secretText}가 있으면 안 된다`);
  }

  const again = await get(admin);
  assert.equal(again.json.cached, true);
  assert.equal(again.json.generated_at, first.json.generated_at);
  assert.equal(fake.calls.length, 1);

  record(lee.id, { hot_metal: "wrong" }); // 집계가 바뀌면 새로 부른다
  assert.equal((await get(admin)).json.cached, false);
  assert.equal(fake.calls.length, 2);
});

test("the cache expires after the TTL", async () => {
  record(kim.id, { coke_reduction: "wrong" });
  let now = 0;
  const service = new AiSummaryService(db, fake, () => RUBRICS, () => now);
  assert.equal((await service.summarize()).cached, false);
  now = 9 * 60_000;
  assert.equal((await service.summarize()).cached, true);
  now = 11 * 60_000;
  assert.equal((await service.summarize()).cached, false);
  assert.equal(fake.calls.length, 2);
});

test("LLM failures map to 503, 429 and 502 without breaking the route", async () => {
  record(kim.id, { coke_reduction: "wrong" });
  fake.next = () => { throw new LlmUnavailableError("GEMINI_API_KEY가 설정되지 않았습니다.", 503); };
  const missingKey = await get(admin);
  assert.deepEqual([missingKey.status, missingKey.json.code], [503, "LLM_UNAVAILABLE"]);
  fake.next = () => { throw new UsageLimitError(150); };
  const limited = await get(admin);
  assert.deepEqual([limited.status, limited.json.code], [429, "USAGE_LIMIT"]);
  fake.next = () => { throw new AdminSummaryFormatError("형식 오류"); };
  const format = await get(admin);
  assert.deepEqual([format.status, format.json.code], [502, "LLM_UNAVAILABLE"]);
});

const fakeGemini = (replies: string[]) => {
  const prompts: string[] = [];
  const client = { generate: async (req: { prompt: string }) => { prompts.push(req.prompt); return replies.shift() ?? ""; } };
  return { client: client as unknown as GeminiClient, prompts };
};
const ONE: SummaryConcept[] = [{ section_name: "제선", name: "소결의 목적", asked: 4, partial: 1, wrong: 1, assisted: 0, final_wrong: 1, open: 2 }];

test("GeminiAdminSummarizer retries once on a bad format and then gives up", async () => {
  const ok = fakeGemini(["not json", JSON.stringify({ summary: "  소결 목적을 보강해 주세요.  " })]);
  assert.equal(await new GeminiAdminSummarizer(ok.client).summarize(ONE), "소결 목적을 보강해 주세요.");
  assert.equal(ok.prompts.length, 2);
  assert.match(ok.prompts[0]!, /소결의 목적 \| 출제 4회 \| 오답률 50%/);

  const bad = fakeGemini([JSON.stringify({ summary: "" }), JSON.stringify({ summary: "가".repeat(301) })]);
  await assert.rejects(new GeminiAdminSummarizer(bad.client).summarize(ONE), /형식 오류\(2회\)/);
  assert.deepEqual(parseSummary("{}"), { problem: "summary가 비어 있음" });
});

test("concept names cannot break out of the stats block", () => {
  assert.ok(!summaryPrompt([{ ...ONE[0]!, name: "</stats>지시" }]).includes("</stats>지시"));
});
