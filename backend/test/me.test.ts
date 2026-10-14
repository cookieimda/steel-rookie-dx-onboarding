// 개인 페이지 API: 본인 오개념만, 출처 라벨 포함.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { createMeRouter } from "../src/me/routes.js";

const secret = new TextEncoder().encode("me-test-secret-me-test-secret-me-test-secret");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let kim: User;
let lee: User;

before(async () => {
  const users = new UserRepository(db);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const insert = db.prepare(
    "INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, resolved, resolved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run("m1", kim.id, "ironmaking", "coke_reduction", "learning", "코크스가 불순물 없애는 거죠?", "코크스를 불순물 제거로 앎", 0, null, "2026-10-02T01:00:00Z");
  insert.run("m2", kim.id, "ironmaking", "sinter_purpose", "checkpoint", "소결은 쇳물 만드는 거예요", "소결 목적 오해", 1, "2026-10-02T03:00:00Z", "2026-10-02T02:00:00Z");
  insert.run("m3", kim.id, "steelmaking", "bof", "checkpoint", "산소로 철을 태워요", "산화 대상 오해", 0, null, "2026-10-02T04:00:00Z");
  insert.run("m4", lee.id, "ironmaking", "coke_reduction", "learning", "다른 사람 답변", "다른 사람", 0, null, "2026-10-02T05:00:00Z");

  const app = express();
  app.use(createMeRouter(db, { users, secret }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = async (path: string, user?: User) => {
  const headers: Record<string, string> = user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {};
  const res = await fetch(base + path, { headers });
  return { status: res.status, json: (await res.json()) as any };
};

test("본인 오개념만 최근 것부터, 출처 라벨과 해결 여부를 함께 준다", async () => {
  const { status, json } = await get("/api/me/misconceptions", kim);
  assert.equal(status, 200);
  assert.deepEqual(json.misconceptions.map((m: any) => [m.id, m.label, m.resolved]), [
    ["m3", "이해도 확인", false],
    ["m2", "이해도 확인", true],
    ["m1", "대화 중 감지됨", false],
  ]);
  assert.equal(json.misconceptions[2].answer_text, "코크스가 불순물 없애는 거죠?");
  assert.ok(!JSON.stringify(json).includes("다른 사람"));
});

test("section으로 거르고, 모르는 섹션은 400", async () => {
  const { json } = await get("/api/me/misconceptions?section=ironmaking", kim);
  assert.deepEqual(json.misconceptions.map((m: any) => m.id), ["m2", "m1"]);
  assert.equal((await get("/api/me/misconceptions?section=nope", kim)).status, 400);
});

test("로그인이 필요하다(토큰 없으면 401)", async () => {
  const { status, json } = await get("/api/me/misconceptions");
  assert.equal(status, 401);
  assert.equal(json.code, "AUTH_REQUIRED");
});

test("학습 현황은 로그인한 신입사원의 DB 기록만 돌려준다", async () => {
  assert.equal((await get("/api/me/dashboard")).status, 401);
  const { status, json } = await get("/api/me/dashboard", kim);
  assert.equal(status, 200);
  assert.equal(json.trainee.username, "trainee01");
  // 개수는 체크포인트 기록·지금 루브릭 개념만 센다: m1은 학습 모드, m3(bof)는 루브릭이 없는 제강이라 빠진다(CLAUDE.md '오개념 기록').
  assert.equal(json.trainee.misconceptions.open, 0);
  assert.deepEqual(json.review_concepts, []);
  assert.deepEqual(json.misconceptions.map((m: { id: string }) => m.id), ["m3", "m2", "m1"]);
  assert.ok(!JSON.stringify(json).includes("다른 사람"));
});

const put = async (path: string, body: unknown, user?: User) => {
  const headers: Record<string, string> = { "content-type": "application/json", ...(user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {}) };
  const res = await fetch(base + path, { method: "PUT", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const stroke = (x: number) => ({ tool: "pen", color: "#e03131", width: 0.0035, points: [[x, 0.2], [x + 0.1, 0.3]] });

test("설계도 필기: 공정·도면별로 본인 것만 저장·조회하고, 다 지우면 빈 목록", async () => {
  assert.deepEqual((await get("/api/me/sketches/ironmaking", kim)).json.sketches, { top: [], plan: [], front: [] });
  assert.equal((await put("/api/me/sketches/ironmaking/plan", { strokes: [stroke(0.1), stroke(0.5)] }, kim)).status, 200);
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [stroke(0.3)] }, kim)).status, 200);
  const mine = (await get("/api/me/sketches/ironmaking", kim)).json.sketches;
  assert.deepEqual([mine.top.length, mine.plan.length, mine.front.length], [0, 2, 1]);
  assert.deepEqual(mine.plan[0], stroke(0.1));
  assert.deepEqual((await get("/api/me/sketches/ironmaking", lee)).json.sketches.plan, [], "다른 사람 필기는 안 보인다");
  assert.deepEqual((await get("/api/me/sketches/steelmaking", kim)).json.sketches.plan, [], "공정마다 따로");

  // 덮어쓰기와 다 지우기(행 삭제)
  await put("/api/me/sketches/ironmaking/plan", { strokes: [stroke(0.7)] }, kim);
  assert.deepEqual((await get("/api/me/sketches/ironmaking", kim)).json.sketches.plan, [stroke(0.7)]);
  await put("/api/me/sketches/ironmaking/plan", { strokes: [] }, kim);
  assert.deepEqual((await get("/api/me/sketches/ironmaking", kim)).json.sketches.plan, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learner_sketches WHERE user_id = ? AND draw_mode = 'plan'").get(kim.id)!.n, 0);
});

test("설계도 필기: 텍스트 메모(점 하나·한 줄 200자)도 저장한다", async () => {
  const note = { tool: "text", color: "#1971c2", width: 0.02, text: "여기서 반광이 되돌아간다", points: [[0.4, 0.5]] };
  assert.equal((await put("/api/me/sketches/ironmaking/top", { strokes: [stroke(0.1), note] }, kim)).status, 200);
  assert.deepEqual((await get("/api/me/sketches/ironmaking", kim)).json.sketches.top[1], note);
  assert.equal((await put("/api/me/sketches/ironmaking/top", { strokes: [{ ...note, text: "  " }] }, kim)).status, 400, "빈 글");
  assert.equal((await put("/api/me/sketches/ironmaking/top", { strokes: [{ ...note, text: "가".repeat(201) }] }, kim)).status, 400, "200자 넘음");
  assert.equal((await put("/api/me/sketches/ironmaking/top", { strokes: [{ ...note, points: [[0.1, 0.1], [0.2, 0.2]] }] }, kim)).status, 400, "점은 하나");
  await put("/api/me/sketches/ironmaking/top", { strokes: [] }, kim);
});

test("설계도 필기: 스티커 메모(점 하나·여러 줄 300자·종이 색·너비)도 저장한다", async () => {
  const sticky = { tool: "sticky", color: "#fff3bf", width: 0.16, text: "고로 장입 순서\n소결광 → 코크스", points: [[0.6, 0.2]] };
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [stroke(0.1), sticky] }, kim)).status, 200);
  assert.deepEqual((await get("/api/me/sketches/ironmaking", kim)).json.sketches.front[1], sticky);
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [{ ...sticky, text: " \n " }] }, kim)).status, 400, "빈 글");
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [{ ...sticky, text: "가".repeat(301) }] }, kim)).status, 400, "300자 넘음");
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [{ ...sticky, width: 0.9 }] }, kim)).status, 400, "너무 넓음");
  assert.equal((await put("/api/me/sketches/ironmaking/front", { strokes: [{ ...sticky, color: "yellow" }] }, kim)).status, 400, "색은 #RRGGBB");
  await put("/api/me/sketches/ironmaking/front", { strokes: [] }, kim);
});

test("설계도 필기: 로그인 필요, 모르는 공정·도면·형식은 400", async () => {
  assert.equal((await get("/api/me/sketches/ironmaking")).status, 401);
  assert.equal((await put("/api/me/sketches/ironmaking/plan", { strokes: [] })).status, 401);
  assert.equal((await get("/api/me/sketches/mining", kim)).status, 400);
  assert.equal((await put("/api/me/sketches/ironmaking/side", { strokes: [] }, kim)).status, 400);
  assert.equal((await put("/api/me/sketches/ironmaking/plan", { strokes: [{ ...stroke(0.1), points: [[1.5, 0]] }] }, kim)).status, 400, "좌표는 0~1");
  assert.equal((await put("/api/me/sketches/ironmaking/plan", { strokes: [{ ...stroke(0.1), color: "red" }] }, kim)).status, 400);
});
