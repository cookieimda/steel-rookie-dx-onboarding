import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { decodeJwt } from "jose";
import { DEMO_ACCOUNTS, demoPassword, seedDemoAccounts } from "../src/auth/demo-accounts.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({ users: new UserRepository(db), secret }));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function call(path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
}

const NEW_USER = { username: "steel_kim", password: "password123", name: "김철강", employee_no: "t2026100" };
const hoursValid = (token: string) => {
  const { iat, exp } = decodeJwt(token);
  return (exp! - iat!) / 3600;
};

test("signup creates a trainee and returns a token that /me accepts", async () => {
  const signup = await call("/api/auth/signup", NEW_USER);
  assert.equal(signup.status, 201);
  assert.equal(signup.json.user.role, "trainee");
  assert.equal(signup.json.user.employee_no, "T2026100"); // 대문자로 맞춘다

  const me = await call("/api/auth/me", undefined, signup.json.token);
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.user, signup.json.user);
});

test("password is stored as a bcrypt hash", () => {
  const row = db.prepare("SELECT password_hash FROM users WHERE username = ?").get("steel_kim");
  assert.match(String(row?.password_hash), /^\$2[aby]\$10\$/);
});

test("duplicate username or employee number is rejected", async () => {
  const sameId = await call("/api/auth/signup", { ...NEW_USER, employee_no: "T2026999" });
  assert.equal(sameId.status, 409);
  assert.equal(sameId.json.code, "USERNAME_TAKEN");

  const sameNo = await call("/api/auth/signup", { ...NEW_USER, username: "steel_lee" });
  assert.equal(sameNo.status, 409);
  assert.equal(sameNo.json.code, "EMPLOYEE_NO_TAKEN");
});

test("invalid signup input is rejected", async () => {
  for (const patch of [
    { username: "ab" },
    { username: "Steel" },
    { password: "short" },
    { password: "가".repeat(25) }, // 75바이트
    { name: " " },
    { employee_no: "사번" },
  ]) {
    assert.equal((await call("/api/auth/signup", { ...NEW_USER, username: "steel_new", ...patch })).status, 400, JSON.stringify(patch));
  }
});

test("login token lasts 12 hours, or 7 days with remember", async () => {
  const short = await call("/api/auth/login", { username: "steel_kim", password: "password123" });
  assert.equal(short.status, 200);
  assert.equal(hoursValid(short.json.token), 12);

  const long = await call("/api/auth/login", { username: "steel_kim", password: "password123", remember: true });
  assert.equal(hoursValid(long.json.token), 7 * 24);
});

test("wrong password and unknown user get the same error", async () => {
  const wrong = await call("/api/auth/login", { username: "steel_kim", password: "wrong-password" });
  const unknown = await call("/api/auth/login", { username: "nobody", password: "password123" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.json, unknown.json);
});

test("find-id returns the username for a matching name and employee number", async () => {
  assert.equal((await call("/api/auth/find-id", { name: "김철강", employee_no: "T2026100" })).json.username, "steel_kim");
  assert.equal((await call("/api/auth/find-id", { name: "김철강", employee_no: "T2026101" })).status, 404);
});

test("reset-password changes the password only when id, name and employee number match", async () => {
  const mismatch = await call("/api/auth/reset-password", { username: "other", name: "김철강", employee_no: "T2026100", password: "new-password1" });
  assert.equal(mismatch.status, 404);

  const ok = await call("/api/auth/reset-password", { username: "steel_kim", name: "김철강", employee_no: "T2026100", password: "new-password1" });
  assert.equal(ok.status, 200);
  assert.equal((await call("/api/auth/login", { username: "steel_kim", password: "password123" })).status, 401);
  assert.equal((await call("/api/auth/login", { username: "steel_kim", password: "new-password1" })).status, 200);
});

test("/me rejects missing, forged and orphaned tokens", async () => {
  const ghost: User = { id: "deleted-user", username: "ghost", role: "admin", name: "유령", employee_no: "X0" };
  assert.equal((await call("/api/auth/me")).json.code, "AUTH_REQUIRED");

  const forged = await signToken(ghost, new TextEncoder().encode("other-secret"));
  assert.equal((await call("/api/auth/me", undefined, forged)).json.code, "TOKEN_INVALID");

  const orphan = await signToken(ghost, secret);
  assert.equal((await call("/api/auth/me", undefined, orphan)).json.code, "TOKEN_INVALID");
});

test("demo accounts are seeded once with roles and can log in", async () => {
  const users = new UserRepository(db);
  assert.equal(await seedDemoAccounts(users), DEMO_ACCOUNTS.length);
  assert.equal(await seedDemoAccounts(users), 0);

  const list = await call("/api/auth/demo-accounts");
  assert.deepEqual(list.json.accounts.map((a: { username: string }) => a.username), DEMO_ACCOUNTS.map((a) => a.username));
  assert.equal(list.json.accounts.filter((a: { role: string }) => a.role === "trainee").length, 20);
  assert.equal(list.json.accounts[0].employee_no, undefined); // 사번은 목록에 내보내지 않는다

  const admin = await call("/api/auth/login", { username: "admin01", password: list.json.password });
  assert.equal((await call("/api/auth/me", undefined, admin.json.token)).json.user.role, "admin");

  const trainee = await call("/api/auth/login", { username: "trainee03", password: demoPassword() });
  assert.equal(trainee.json.user.role, "trainee");
});

test("demo account passwords cannot be reset", async () => {
  const { username, name, employee_no } = DEMO_ACCOUNTS[0];
  const res = await call("/api/auth/reset-password", { username, name, employee_no, password: "hijacked-pass" });
  assert.equal(res.status, 403);
  assert.equal((await call("/api/auth/login", { username, password: demoPassword() })).status, 200);
});

test("demo accounts can be turned off", async () => {
  process.env.DEMO_ACCOUNTS = "off";
  try {
    assert.deepEqual((await call("/api/auth/demo-accounts")).json, { accounts: [], password: null });
  } finally {
    delete process.env.DEMO_ACCOUNTS;
  }
});
