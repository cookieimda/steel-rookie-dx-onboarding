// update v01: 공통 오류 응답, 튜터 대체 답(근거 원문), 로그인 시도 제한, 공개 모드 비밀키 검사.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { z } from "zod";
import type { LearningAgent, LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { LoginAttempts } from "../src/auth/login-attempts.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { assertPublicSecrets } from "../src/auth/tokens.js";
import { UserRepository } from "../src/auth/users.js";
import { CheckpointError, LlmUnavailableError } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { AppError, errorResponse } from "../src/http/errors.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter, FALLBACK_NOTE } from "../src/learning/routes.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics } from "../src/rubrics.js";
import { UsageLimitError } from "../src/usage.js";

const CHUNKS: Chunk[] = [
  { id: "posco-brochure-2015#3", section: "ironmaking", title: "", text: "고로에서는 코크스가 산화하며 철광석의 산소를 떼어낸다.", source_ids: ["posco-brochure-2015"], tags: ["blast_furnace"] },
  { id: "posco-newsroom-fe-2019#3", section: "ironmaking", title: "", text: "코크스가 일산화탄소를 만들어 산소를 떼어낸다.", source_ids: ["posco-newsroom-fe-2019"], tags: [] },
];

class ThrowingAgent implements LearningAgent {
  constructor(public error: Error) {}
  async reply(): Promise<LearningReply> {
    throw this.error;
  }
}

async function learningApp(agent: LearningAgent, chunks: Chunk[], fallbackOnLlmError = true) {
  const db = openDatabase(":memory:");
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(createLearningRouter({
    repo: new LearningRepository(db), agent, rubrics: loadFinalRubrics(),
    retriever: new Retriever({ chunksFor: (s) => chunks.filter((c) => c.section === s) }),
    fallbackOnLlmError,
  }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ask = async (question: string) => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": "minsu" }, body: JSON.stringify({ question }) });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { ask, db, close: () => server.close() };
}

test("튜터 연결 실패·형식 오류면 근거 원문으로 200 답하고, AI가 쓴 답이 아니라고 표시하며, 대화는 저장하지 않는다", async () => {
  for (const error of [new LlmUnavailableError("no key", 503), new LlmUnavailableError("down")]) {
    const t = await learningApp(new ThrowingAgent(error), CHUNKS);
    try {
      const { status, json } = await t.ask("코크스가 뭐예요?");
      assert.equal(status, 200);
      assert.equal(json.generated_by_ai, false);
      assert.equal(json.grounding_note, FALLBACK_NOTE);
      assert.match(json.answer, /코크스/);
      assert.ok(json.sources.length > 0, "근거 출처를 함께 보여 준다");
      assert.equal(Number(t.db.prepare("SELECT COUNT(*) AS n FROM learning_turns").get()?.n), 0);
    } finally {
      t.close();
    }
  }
});

test("대체 답: 검색된 근거가 없으면 원래 오류(503), 하루 한도 초과는 429 그대로, 옵션을 끄면 원래 오류", async () => {
  const empty = await learningApp(new ThrowingAgent(new LlmUnavailableError("no key", 503)), []);
  const limit = await learningApp(new ThrowingAgent(new UsageLimitError(150)), CHUNKS);
  const off = await learningApp(new ThrowingAgent(new LlmUnavailableError("down")), CHUNKS, false);
  try {
    assert.equal((await empty.ask("코크스가 뭐예요?")).status, 503);
    assert.equal((await limit.ask("코크스가 뭐예요?")).status, 429);
    assert.equal((await off.ask("코크스가 뭐예요?")).status, 502);
  } finally {
    empty.close();
    limit.close();
    off.close();
  }
});

test("errorResponse: 오류 종류마다 같은 모양 { error, code }와 상태", () => {
  assert.deepEqual(errorResponse(new CheckpointError(404, "시도를 찾지 못했어요.")), { status: 404, body: { error: "시도를 찾지 못했어요.", code: "NOT_FOUND" } });
  assert.equal(errorResponse(new LlmUnavailableError("x", 503)).body.code, "LLM_NOT_CONFIGURED");
  assert.equal(errorResponse(new LlmUnavailableError("x")).status, 502);
  assert.equal(errorResponse(new UsageLimitError(150)).body.code, "USAGE_LIMIT");
  assert.deepEqual(errorResponse(new AppError("CONFLICT")).body, { error: "다른 요청과 겹쳤어요. 다시 시도해 주세요.", code: "CONFLICT" });
  const zod = z.object({ name: z.string().min(1, "이름을 입력해 주세요.") }).safeParse({ name: "" });
  assert.equal(errorResponse(zod.error).body.error, "이름을 입력해 주세요.");
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(errorResponse(new Error("boom")), { status: 500, body: { error: "서버 오류가 생겼어요.", code: "INTERNAL" } });
  } finally {
    console.error = original;
  }
});

test("LoginAttempts: 실패 5번이면 막고, 성공하면 기록을 지우고, 5분이 지나면 풀린다", () => {
  let now = 0;
  const attempts = new LoginAttempts(undefined, () => now);
  for (let i = 0; i < 5; i++) assert.ok(attempts.begin("steel_kim", "1.1.1.1"));
  assert.equal(attempts.begin("steel_kim", "1.1.1.1"), null);
  assert.ok(attempts.begin("other_user", "1.1.1.1"), "다른 계정은 IP 한도(20) 전까지 된다");
  now += 5 * 60_000 + 1;
  assert.ok(attempts.begin("steel_kim", "1.1.1.1"));

  const fresh = new LoginAttempts(undefined, () => 0);
  for (let i = 0; i < 10; i++) fresh.begin("ok_user", "2.2.2.2")!.succeeded();
  assert.ok(fresh.begin("ok_user", "2.2.2.2"), "성공한 시도는 세지 않는다");
});

test("로그인 API: 같은 계정으로 6번째 틀리면 429 TOO_MANY_ATTEMPTS", async () => {
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users: new UserRepository(openDatabase(":memory:")), secret: new TextEncoder().encode("test-secret-test-secret-test-secret") }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = () => fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "nobody_here", password: "wrong-password" }) });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login()).status, 401);
    const blocked = await login();
    assert.equal(blocked.status, 429);
    assert.equal(((await blocked.json()) as any).code, "TOO_MANY_ATTEMPTS");
  } finally {
    server.close();
  }
});

test("assertPublicSecrets: 공개 모드에서 JWT_SECRET이 없거나 짧으면 시작을 막는다", () => {
  assert.doesNotThrow(() => assertPublicSecrets({}));
  assert.throws(() => assertPublicSecrets({ TEST_PASSCODE: "1234" }), /JWT_SECRET/);
  assert.throws(() => assertPublicSecrets({ NODE_ENV: "production", JWT_SECRET: "short" }), /JWT_SECRET/);
  assert.doesNotThrow(() => assertPublicSecrets({ TEST_PASSCODE: "1234", JWT_SECRET: "x".repeat(32) }));
});
