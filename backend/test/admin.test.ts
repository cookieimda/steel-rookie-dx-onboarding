import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import express from "express";
import { conceptStats } from "../src/admin/concept-stats.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { traineeStats } from "../src/admin/trainee-stats.js";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import type { Rubric, RubricConcept } from "../src/rubrics.js";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
let db: DatabaseSync;
let server: ReturnType<express.Express["listen"]>;
let base = "";
let admin: User;
let kim: User;
let lee: User;

before(async () => {
  db = openDatabase(":memory:");
  const users = new UserRepository(db);
  admin = await users.create({ username: "admin01", password: "password123", name: "관리자", employee_no: "A1", role: "admin" });
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const app = express();
  app.use(createAdminRouter(db, { users, secret }));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = async (user?: User, path = "/api/admin/trainees") => {
  const headers: Record<string, string> = user ? { authorization: `Bearer ${await signToken(user, secret)}` } : {};
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, json: (await res.json()) as any };
};

test("only admins can read trainee stats", async () => {
  assert.equal((await get()).status, 401);
  assert.equal((await get(kim)).status, 403);
  assert.equal((await get(admin)).status, 200);
});

test("concept statistics require admin and come from completed trainee answers", async () => {
  assert.equal((await get(undefined, "/api/admin/concepts")).status, 401);
  assert.equal((await get(kim, "/api/admin/concepts")).status, 403);
  const before = await get(admin, "/api/admin/concepts");
  assert.equal(before.status, 200);
  assert.deepEqual(before.json.concepts, []);
  db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES ('concept-test', ?, 'ironmaking', 'completed', 0.5, 0, '2026-10-01', '2026-10-01', '2026-10-01', 'first', '[\"hot_stove\"]')").run(lee.id);
  db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES ('concept-test', 'hot_stove', 'q', 'a', 'wrong', 'partial', '2026-10-01', '2026-10-01')").run();
  const after = await get(admin, "/api/admin/concepts");
  assert.deepEqual(after.json.concepts, [{ section: "ironmaking", concept_id: "hot_stove", asked: 1, partial: 0, wrong: 1, assisted: 0, final_wrong: 0, open: 0 }]);
  db.prepare("DELETE FROM concept_results WHERE attempt_id = 'concept-test'").run();
  db.prepare("DELETE FROM attempts WHERE id = 'concept-test'").run();
});

test("concept statistics include retries, filter by section, and reject unknown sections", async () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, ?, 'completed', 0.5, 0, '2026-10-01', '2026-10-01', '2026-10-01', ?, '[]')");
  attempt.run("cs-first", lee.id, "ironmaking", "first");
  attempt.run("cs-retry", lee.id, "ironmaking", "retry");
  attempt.run("cs-steel", lee.id, "steelmaking", "first");
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES (?, ?, 'q', 'a', ?, ?, '2026-10-01', '2026-10-01')");
  result.run("cs-first", "hot_stove", "wrong", "partial");
  result.run("cs-retry", "hot_stove", "assisted", "wrong"); // 재도전도 센다
  result.run("cs-steel", "converter", "partial", "correct");

  const all = await get(admin, "/api/admin/concepts");
  assert.deepEqual(all.json.concepts, [
    { section: "ironmaking", concept_id: "hot_stove", asked: 2, partial: 0, wrong: 1, assisted: 1, final_wrong: 1, open: 0 },
    { section: "steelmaking", concept_id: "converter", asked: 1, partial: 1, wrong: 0, assisted: 0, final_wrong: 0, open: 0 },
  ]);
  const steel = await get(admin, "/api/admin/concepts?section=steelmaking");
  assert.deepEqual(steel.json.concepts.map((c: { concept_id: string }) => c.concept_id), ["converter"]);
  const bad = await get(admin, "/api/admin/concepts?section=sintering");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "INVALID_SECTION");

  db.prepare("DELETE FROM concept_results WHERE attempt_id LIKE 'cs-%'").run();
  db.prepare("DELETE FROM attempts WHERE id LIKE 'cs-%'").run();
});

test("concept statistics carry the rubric concept name, and only for current rubric concepts", () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, 'ironmaking', 'completed', 0.5, 0, '2026-10-01', '2026-10-01', '2026-10-01', 'first', '[]')");
  attempt.run("cn-first", lee.id);
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES ('cn-first', ?, 'q', 'a', 'wrong', 'partial', '2026-10-01', '2026-10-01')");
  result.run("coke_reduction");
  result.run("hot_stove"); // 시연 기록의 설비 id: 루브릭에 없어 name이 없다
  const rubric: Rubric = { section: "ironmaking", reviewed: true, concepts: [{ concept_id: "coke_reduction", name: "고로에서 코크스의 역할" } as RubricConcept] };
  const names = conceptStats(db, undefined, [rubric]).concepts.map((c) => [c.concept_id, c.name]);
  assert.deepEqual(names, [["coke_reduction", "고로에서 코크스의 역할"], ["hot_stove", undefined]]);
  db.prepare("DELETE FROM concept_results WHERE attempt_id = 'cn-first'").run();
  db.prepare("DELETE FROM attempts WHERE id = 'cn-first'").run();
});

test("without checkpoint tables, concept statistics are empty", () => {
  const bare = new DatabaseSync(":memory:");
  bare.exec("CREATE TABLE users (id TEXT, username TEXT, password_hash TEXT, role TEXT, name TEXT, employee_no TEXT, created_at TEXT)");
  assert.deepEqual(conceptStats(bare), { concepts: [] });
});

test("without checkpoint tables, trainees are listed with empty records", () => {
  // 001_checkpoint.sql 없이 users만 있는 DB.
  const bare = new DatabaseSync(":memory:");
  bare.exec("CREATE TABLE users (id TEXT, username TEXT, password_hash TEXT, role TEXT, name TEXT, employee_no TEXT, created_at TEXT)");
  bare.prepare("INSERT INTO users VALUES ('u1', 'trainee01', 'x', 'trainee', '김신입', 'T1', '2026-10-01')").run();
  const stats = traineeStats(bare);
  assert.equal(stats.checkpoint_data, false);
  assert.equal(stats.trainees[0].sections.ironmaking, null);
  assert.deepEqual(stats.trainees[0].misconceptions, { open: 0, resolved: 0 });
});

test("with no records yet, every trainee has empty sections", async () => {
  const { json } = await get(admin);
  assert.equal(json.checkpoint_data, true);
  assert.deepEqual(json.trainees.map((t: { username: string }) => t.username), ["trainee01", "trainee02"]);
  assert.equal(json.trainees[0].passed_sections, 0);
});

const IR: Rubric = { section: "ironmaking", reviewed: true, concepts: ["a", "b", "c"].map((id) => ({ concept_id: id, name: id }) as RubricConcept) };

test("with checkpoint tables, stats merge retries like the engine and count checkpoint misconceptions by concept", () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'first', '[]')");
  attempt.run("a1", kim.id, "ironmaking", "completed", 0.5, 0, "2026-10-01T01:00Z", "2026-10-01T01:10Z", "2026-10-01T01:10Z");
  attempt.run("a2", kim.id, "ironmaking", "completed", 1, 1, "2026-10-01T02:00Z", "2026-10-01T02:10Z", "2026-10-01T02:10Z");
  attempt.run("a3", kim.id, "steelmaking", "in_progress", null, null, "2026-10-01T03:00Z", "2026-10-01T03:05Z", null);
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES (?, ?, 'q', 'a', ?, ?, 't', 't')");
  result.run("a1", "a", "correct", null);
  result.run("a1", "b", "wrong", "wrong");
  result.run("a1", "c", "partial", "partial");
  result.run("a2", "b", "correct", null);
  result.run("a2", "c", "correct", null);
  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, answer_text, summary, resolved, created_at, section, concept_id, source) VALUES (?, ?, ?, ?, ?, ?, 'ironmaking', ?, 'checkpoint')");
  mis.run("m1", kim.id, "열풍로가 쇳물을 데워요", "b 오해", 0, "2026-10-01", "b");
  mis.run("m2", kim.id, "코크스는 연료", "c 오해", 1, "2026-10-01", "c");

  const stats = traineeStats(db, [IR]);
  const k = stats.trainees.find((t) => t.username === "trainee01")!;
  assert.equal(stats.checkpoint_data, true);
  assert.deepEqual(k.sections.ironmaking, { understanding: 1, passed: true, attempts: 2, unconfirmed_concept_ids: [] });
  assert.equal(k.sections.steelmaking, null); // 진행 중인 시도는 세지 않는다
  assert.equal(k.passed_sections, 1);
  assert.equal(k.last_activity, "2026-10-01T03:05Z");
  assert.deepEqual(k.misconceptions, { open: 1, resolved: 1 });
  assert.ok(!JSON.stringify(stats).includes("열풍로가 쇳물을")); // 답변 원문은 내보내지 않는다

  const l = stats.trainees.find((t) => t.username === "trainee02")!;
  assert.equal(l.passed_sections, 0);
  assert.equal(l.last_activity, null);

  db.exec("DELETE FROM concept_results; DELETE FROM attempts; DELETE FROM misconceptions;");
});

test("이어 풀기로 멈춘 시도는 실패로 세지 않고 in_progress_sections에 '진행 중'으로 보인다", () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')");
  attempt.run("p1", kim.id, "ironmaking", "completed", 0.5, 0, "2026-10-01T01:00Z", "2026-10-01T01:10Z", "2026-10-01T01:10Z", "first");
  attempt.run("p2", kim.id, "ironmaking", "paused", null, null, "2026-10-01T02:00Z", "2026-10-01T02:05Z", null, "retry");
  attempt.run("p3", lee.id, "ironmaking", "paused", null, null, "2026-10-01T03:00Z", "2026-10-01T03:05Z", null, "first");
  db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES (?, ?, 'q', 'a', ?, ?, 't', 't')").run("p1", "a", "correct", null);

  const stats = traineeStats(db, [IR]);
  const k = stats.trainees.find((t) => t.username === "trainee01")!;
  assert.deepEqual(k.in_progress_sections, ["ironmaking"]);
  assert.equal(k.sections.ironmaking!.attempts, 1); // 멈춘 재도전은 시도 수에 넣지 않는다
  assert.equal(k.sections.ironmaking!.passed, false);
  const l = stats.trainees.find((t) => t.username === "trainee02")!;
  assert.deepEqual(l.in_progress_sections, ["ironmaking"]);
  assert.equal(l.sections.ironmaking, null); // 끝낸 시도가 없으면 미응시(null)이고 실패가 아니다
  assert.equal(l.last_activity, "2026-10-01T03:05Z");

  db.exec("DELETE FROM concept_results; DELETE FROM attempts;");
});

/** 바꾸기 전 traineeStats의 섹션·오개념 집계(dev a3de972). 차이를 보여 주려고 테스트에만 남긴다. */
function legacyStats(db: DatabaseSync, userId: string) {
  const sections: Record<string, { understanding: number; passed: boolean; attempts: number }> = {};
  for (const row of db.prepare("SELECT section, understanding, unlocked FROM attempts WHERE user_id = ? AND state = 'completed' ORDER BY completed_at, created_at").all(userId)) {
    const prev = sections[String(row.section)];
    sections[String(row.section)] = { understanding: Number(row.understanding ?? 0), passed: Boolean(prev?.passed) || Number(row.unlocked) === 1, attempts: (prev?.attempts ?? 0) + 1 };
  }
  const misconceptions = { open: 0, resolved: 0 };
  for (const row of db.prepare("SELECT resolved, COUNT(*) AS n FROM misconceptions WHERE user_id = ? GROUP BY resolved").all(userId)) {
    if (Number(row.resolved) === 1) misconceptions.resolved = Number(row.n);
    else misconceptions.open = Number(row.n);
  }
  return { sections, misconceptions };
}

test("before → after: 이해도는 엔진과 같은 계산, 오개념은 체크포인트·지금 루브릭 개념만 개념 수로", () => {
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, state, understanding, unlocked, created_at, updated_at, completed_at, kind, concept_ids, origin) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, '[]', ?)");
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES (?, ?, 'q', 'a', ?, ?, 't', 't')");
  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, answer_text, summary, resolved, created_at, section, concept_id, source, origin) VALUES (?, ?, 'ans', 's', ?, 't', ?, ?, ?, ?)");

  // 김신입: 루브릭이 a·b·c일 때 첫 시도 50%, 재도전으로 100% 통과. 그 뒤 b의 핵심 요소가 바뀌어 b2로 새 id가 됐다.
  attempt.run("k1", kim.id, "ironmaking", 0.5, 0, "1", "1", "1", "first", "live");
  attempt.run("k2", kim.id, "ironmaking", 1, 1, "2", "2", "2", "retry", "live");
  result.run("k1", "a", "correct", null);
  result.run("k1", "b", "wrong", "wrong");
  result.run("k1", "c", "partial", "partial");
  result.run("k2", "b", "correct", null);
  result.run("k2", "c", "correct", null);
  // 루브릭이 없는 제강 기록(예전 데이터)
  attempt.run("k3", kim.id, "steelmaking", 0.9, 1, "3", "3", "3", "first", "live");
  // 오개념: a 미해결 2행, b(옛 id) 미해결, c 해결, 학습 모드 a 미해결, 제강 미해결
  mis.run("x1", kim.id, 0, "ironmaking", "a", "checkpoint", "live");
  mis.run("x2", kim.id, 0, "ironmaking", "a", "checkpoint", "live");
  mis.run("x3", kim.id, 0, "ironmaking", "b", "checkpoint", "live");
  mis.run("x4", kim.id, 1, "ironmaking", "c", "checkpoint", "live");
  mis.run("x5", kim.id, 0, "ironmaking", "a", "learning", "live");
  mis.run("x6", kim.id, 0, "steelmaking", "bof", "checkpoint", "live");
  // 이신입: 시연 기록(seed)만 있다. 관리자 화면은 시연 기록도 센다.
  attempt.run("l1", lee.id, "ironmaking", 2 / 3, 0, "1", "1", "1", "first", "seed");
  result.run("l1", "a", "correct", null);
  result.run("l1", "b2", "correct", null);
  result.run("l1", "c", "wrong", "wrong");
  mis.run("y1", lee.id, 0, "ironmaking", "c", "checkpoint", "seed");

  const changed: Rubric = { ...IR, concepts: ["a", "b2", "c"].map((id) => ({ concept_id: id, name: id }) as RubricConcept) };
  const after = traineeStats(db, [changed]);
  const k = after.trainees.find((t) => t.id === kim.id)!;
  const l = after.trainees.find((t) => t.id === lee.id)!;

  // 전: 마지막 시도에 저장된 이해도(1)와 해금 / 후: 지금 루브릭(a·b2·c) 기준. b2는 재응시 없이 미확인(0점), 통과는 유지
  assert.deepEqual(legacyStats(db, kim.id).sections.ironmaking, { understanding: 1, passed: true, attempts: 2 });
  assert.deepEqual(k.sections.ironmaking, { understanding: 2 / 3, passed: true, attempts: 2, unconfirmed_concept_ids: ["b2"] });
  // 전: 루브릭 없는 제강도 통과로 셈 / 후: 미시작
  assert.deepEqual(legacyStats(db, kim.id).sections.steelmaking, { understanding: 0.9, passed: true, attempts: 1 });
  assert.equal(k.sections.steelmaking, null);
  assert.equal(k.passed_sections, 1);
  // 전: 행 수(학습 모드·옛 id·제강 포함) 미해결 5, 해결 1 / 후: 체크포인트·지금 개념만 개념 수로 a 미해결 1, c 해결 1
  assert.deepEqual(legacyStats(db, kim.id).misconceptions, { open: 5, resolved: 1 });
  assert.deepEqual(k.misconceptions, { open: 1, resolved: 1 });
  // 시연 기록: 전후 모두 센다
  assert.deepEqual(legacyStats(db, lee.id).misconceptions, { open: 1, resolved: 0 });
  assert.deepEqual(l.sections.ironmaking, { understanding: 2 / 3, passed: false, attempts: 1, unconfirmed_concept_ids: [] });
  assert.deepEqual(l.misconceptions, { open: 1, resolved: 0 });

  db.exec("DELETE FROM concept_results; DELETE FROM attempts; DELETE FROM misconceptions;");
});
