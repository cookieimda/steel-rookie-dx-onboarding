// 원격 팀원 테스트용 장치: 접속 비밀번호, ?user= 사용자 구분, 하루 LLM 호출 한도, 사용자 기록 삭제.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../src/app.js";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { openDatabase } from "../src/db/database.js";
import { countUserData, deleteUserData } from "../src/db/user-data.js";
import { currentUserId } from "../src/request-user.js";
import { LlmUsage, UsageLimitError } from "../src/usage.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

function setup(limit = 150) {
  const db = openDatabase(":memory:");
  const usage = new LlmUsage(db, limit);
  const tutor = new FakeTutor();
  tutor.beforeCall = () => usage.consume(currentUserId());
  const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor, rubrics: [IRONMAKING, STEELMAKING] });
  return { db, usage, engine, tutor };
}

async function serve(t: test.TestContext, limit?: number) {
  const ctx = setup(limit);
  const server = createApp({ engine: ctx.engine, usage: ctx.usage }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ...ctx, base, call };
}

function withPasscode(t: test.TestContext, value: string | undefined) {
  const saved = process.env.TEST_PASSCODE;
  if (value === undefined) delete process.env.TEST_PASSCODE;
  else process.env.TEST_PASSCODE = value;
  t.after(() => {
    if (saved === undefined) delete process.env.TEST_PASSCODE;
    else process.env.TEST_PASSCODE = saved;
  });
}

test("TEST_PASSCODE가 있으면 모든 /api에 비밀번호를 확인하고, /api/access와 화면은 열려 있다", async (t) => {
  withPasscode(t, "쇳물-2026");
  const { call } = await serve(t);
  const pass = { "X-Test-Passcode": encodeURIComponent("쇳물-2026") };

  assert.deepEqual(await (await call("GET", "/api/access")).json(), { passcode_required: true, daily_limit: 150 });
  assert.equal((await call("GET", "/")).status, 200);
  assert.equal((await call("GET", "/?p=ironmaking")).status, 200);
  assert.equal((await call("POST", "/api/checkpoints", {}, { section: "ironmaking" })).status, 401);
  const wrong = await call("POST", "/api/checkpoints", { "X-Test-Passcode": "nope" }, { section: "ironmaking" });
  assert.equal(wrong.status, 401);
  assert.equal(((await wrong.json()) as { code: string }).code, "PASSCODE_REQUIRED");
  assert.equal((await call("GET", "/api/status")).status, 401);
  assert.equal((await call("POST", "/api/checkpoints", pass, { section: "ironmaking" })).status, 201);
});

test("TEST_PASSCODE가 비어 있으면 검사하지 않는다(로컬 개발)", async (t) => {
  withPasscode(t, "");
  const { call } = await serve(t);
  assert.equal(((await (await call("GET", "/api/access")).json()) as { passcode_required: boolean }).passcode_required, false);
  assert.equal((await call("POST", "/api/checkpoints", {}, { section: "ironmaking" })).status, 201);
});

test("?user=이름(한글 포함)을 X-User-Id로 구분하고, 형식이 틀리면 400", async (t) => {
  withPasscode(t, undefined);
  const { call } = await serve(t);
  const minsu = { "X-User-Id": encodeURIComponent("민수") };
  const started = await call("POST", "/api/checkpoints", minsu, { section: "ironmaking" });
  const { attempt_id } = (await started.json()) as { attempt_id: string };

  const mine = await (await call("GET", "/api/sections/ironmaking/progress", minsu)).json() as { in_progress_attempt_id: string | null };
  const other = await (await call("GET", "/api/sections/ironmaking/progress", { "X-User-Id": "jiwoo" })).json() as { in_progress_attempt_id: string | null };
  assert.equal(mine.in_progress_attempt_id, attempt_id);
  assert.equal(other.in_progress_attempt_id, null);
  assert.equal((await call("GET", `/api/checkpoints/${attempt_id}`, { "X-User-Id": "jiwoo" })).status, 404);
  assert.equal((await call("GET", "/api/sections/ironmaking/progress", { "X-User-Id": encodeURIComponent("민 수") })).status, 400);
});

test("하루 LLM 호출 한도를 넘으면 429이고 체크포인트 상태는 바뀌지 않는다", async (t) => {
  withPasscode(t, undefined);
  const { call, usage } = await serve(t, 1);
  const user = { "X-User-Id": "limited" };
  const { attempt_id } = (await (await call("POST", "/api/checkpoints", user, { section: "ironmaking" })).json()) as { attempt_id: string };
  assert.equal((await call("POST", `/api/checkpoints/${attempt_id}/messages`, user, { text: "네" })).status, 200); // 질문 생성 1회
  const over = await call("POST", `/api/checkpoints/${attempt_id}/messages`, user, { text: "correct" });
  assert.equal(over.status, 429);
  assert.equal(((await over.json()) as { code: string }).code, "USAGE_LIMIT");
  assert.equal(((await (await call("GET", `/api/checkpoints/${attempt_id}`, user)).json()) as { state: string }).state, "awaiting_answer");
  assert.equal(usage.used("limited"), 1);
  assert.equal(usage.used("someone-else"), 0);
});

test("LlmUsage: 사용자·날짜별로 세고, 한도 0 이하는 제한 없음", () => {
  let day = "2026-10-01";
  const db = openDatabase(":memory:");
  const usage = new LlmUsage(db, 2, () => day);
  usage.consume("a");
  usage.consume("a");
  assert.throws(() => usage.consume("a"), UsageLimitError);
  usage.consume("b");
  day = "2026-10-02";
  usage.consume("a");
  assert.equal(usage.used("a"), 1);

  const unlimited = new LlmUsage(db, 0, () => day);
  for (let i = 0; i < 5; i++) unlimited.consume("c");
  assert.equal(unlimited.used("c"), 0);
});

test("deleteUserData: 한 사용자의 시도·답변·대화·오개념·사용량만 지운다", async () => {
  const { db, engine, usage } = setup();
  for (const user of ["minsu", "jiwoo"]) {
    const { view } = await engine.start(user, "ironmaking");
    await engine.respond(user, view.attempt_id, "네");
    await engine.respond(user, view.attempt_id, "wrong|오개념");
    usage.consume(user);
  }
  const deleted = deleteUserData(db, "minsu");
  assert.equal(deleted.attempts, 1);
  assert.equal(deleted.concept_results, 1);
  assert.equal(deleted.misconceptions, 1);
  assert.equal(deleted.llm_usage, 1);
  assert.ok(deleted.attempt_messages >= 4);
  assert.deepEqual(countUserData(db, "minsu"), { attempts: 0, misconceptions: 0, learning_turns: 0 });
  assert.deepEqual(countUserData(db, "jiwoo"), { attempts: 1, misconceptions: 1, learning_turns: 0 });
});

test("첫 화면(/)은 홈으로 보내고, 쿼리가 있는 주소는 3D 화면(v4)을 준다", async (t) => {
  const { base } = await serve(t);
  const home = await fetch(base + "/", { redirect: "manual" });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), "/login_ui/home-sleek.html");
  assert.match(await (await fetch(base + "/")).text(), /STEEL, IN 3D\./);
  const scene = await fetch(base + "/?p=ironmaking&tutor=1", { redirect: "manual" });
  assert.equal(scene.status, 200);
  assert.match(await scene.text(), /sleek-overview\.js/);
  const login = await fetch(base + "/login", { redirect: "manual" });
  assert.equal(login.headers.get("location"), "/login_ui/My%20Page.dc.html");
});
