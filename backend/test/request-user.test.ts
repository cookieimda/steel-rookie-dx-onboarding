// 요청 사용자 구분: 로그인 토큰이 있으면 토큰의 사용자, 없으면(임시) X-User-Id 헤더.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";

process.env.JWT_SECRET = "request-user-test-secret-request-user-test-secret";
const { jwtSecret, signToken } = await import("../src/auth/tokens.js");
const { currentUserId, userIdOf, withRequestUser } = await import("../src/request-user.js");

let server: ReturnType<express.Express["listen"]>;
let base = "";

before(async () => {
  const app = express();
  app.use("/api", withRequestUser);
  // 체크포인트 라우트는 userIdOf(req), LLM 호출 직전에는 currentUserId()를 쓴다.
  app.get("/api/who", (req, res) => res.json({ userIdOf: userIdOf(req), current: currentUserId() }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const who = async (headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}/api/who`, { headers });
  return { status: res.status, json: (await res.json()) as any };
};
const user = { id: "6f1c2b2e-0000-4000-8000-000000000001", username: "trainee01", role: "trainee" as const, name: "김신입", employee_no: "T1" };

test("로그인 토큰이 있으면 토큰의 사용자 id로 구분하고, X-User-Id는 무시한다", async () => {
  const token = await signToken(user, jwtSecret());
  const { status, json } = await who({ authorization: `Bearer ${token}`, "x-user-id": "someone-else" });
  assert.equal(status, 200);
  assert.deepEqual(json, { userIdOf: user.id, current: user.id });
});

test("틀리거나 다른 키로 서명한 토큰은 401", async () => {
  const forged = await signToken(user, new TextEncoder().encode("another-secret-another-secret-another"));
  for (const token of ["not-a-token", forged]) {
    const { status, json } = await who({ authorization: `Bearer ${token}` });
    assert.equal(status, 401);
    assert.equal(json.code, "TOKEN_INVALID");
  }
});

test("[임시] 토큰이 없으면 X-User-Id, 그것도 없으면 demo-user", async () => {
  assert.deepEqual((await who({ "x-user-id": encodeURIComponent("민수") })).json, { userIdOf: "민수", current: "민수" });
  assert.deepEqual((await who()).json, { userIdOf: "demo-user", current: "demo-user" });
  assert.equal((await who({ "x-user-id": "bad name!" })).status, 400);
});

test("jwtSecret()은 프로세스 안에서 같은 키를 돌려준다", () => {
  assert.equal(jwtSecret(), jwtSecret());
});
