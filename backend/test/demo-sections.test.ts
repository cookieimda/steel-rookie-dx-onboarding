// 관리자 대시보드 시연용 개념 목록(content/demo/sections.json)과 시연 계정 표시(users.is_demo).
// 시연 목록은 시연 기록과 관리자 통계만 읽고, 평가자·체크포인트 엔진·loadFinalRubrics()는 읽지 않는다.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express from "express";
import { conceptStats } from "../src/admin/concept-stats.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { traineeDetail } from "../src/admin/trainee-detail.js";
import { traineeStats } from "../src/admin/trainee-stats.js";
import { DEMO_RECORD_TRAINEES, seedDemoAccounts } from "../src/auth/demo-accounts.js";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository } from "../src/auth/users.js";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { CheckpointError, SECTION_ORDER } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { seedDemoRecords, type SectionConcepts } from "../src/db/demo-records.js";
import { loadDemoSections, statSections } from "../src/demo-sections.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { loadFinalRubrics, type Rubric, type RubricConcept } from "../src/rubrics.js";
import { FakeEvaluator, FakeTutor } from "./checkpoint-fakes.js";

const finalRubrics = loadFinalRubrics();
const demo = loadDemoSections();
const conceptsOf = (rubrics: readonly Rubric[]): SectionConcepts =>
  Object.fromEntries(statSections(rubrics, demo).map((s) => [s.section, s.concepts.map(({ concept_id, name }) => ({ id: concept_id, name }))]));

/** 시연 계정을 만들고 지금 final 루브릭 + 시연 목록으로 시연 기록을 넣은 DB. trainee01은 실제 테스트 계정. */
async function seededDb(seed = 42) {
  const db = openDatabase(":memory:");
  const users = new UserRepository(db);
  await seedDemoAccounts(users);
  seedDemoRecords(db, conceptsOf(finalRubrics), seed);
  const idOf = (username: string) => String(db.prepare("SELECT id FROM users WHERE username = ?").get(username)!.id);
  return { db, users, idOf };
}

test("시연 목록이 있어도 실제 계정의 제강·연주·열간압연 체크포인트 시작과 진입 상태는 404", async () => {
  const { db, idOf } = await seededDb();
  // 서버와 같은 루브릭(loadFinalRubrics)으로 엔진을 만든다.
  const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: finalRubrics });
  const is404 = (error: unknown) => error instanceof CheckpointError && error.status === 404;
  for (const section of Object.keys(demo) as (keyof typeof demo)[]) {
    for (const username of ["trainee01", "trainee11"]) {
      await assert.rejects(engine.start(idOf(username), section), is404, `${username} ${section} start`);
      assert.throws(() => engine.sectionProgress(idOf(username), section), is404, `${username} ${section} progress`);
    }
  }
  // 루브릭이 있는 제선은 그대로 열린다.
  assert.equal(engine.sectionProgress(idOf("trainee01"), "ironmaking").open, true);
});

test("loadFinalRubrics()는 시연 목록을 읽지 않고, 시연 목록은 형식이 맞고 final 개념 id와 겹치지 않는다", () => {
  const finalIds = new Set(finalRubrics.flatMap((r) => r.concepts.map((c) => c.concept_id)));
  const demoIds = Object.values(demo).flat().map((c) => c.id);
  assert.ok(demoIds.length > 0, "시연 목록이 비어 있음");
  assert.ok(demoIds.every((id) => id.startsWith("demo_") && !finalIds.has(id)));
  assert.ok([...finalIds].every((id) => !id.startsWith("demo_")), "final 루브릭에 시연 개념이 섞임");
  assert.ok(Object.keys(demo).every((s) => SECTION_ORDER.includes(s as never)));

  // 형식이 틀리면 거부한다: demo_ 접두사, 없는 섹션, 겹치는 id
  const dir = mkdtempSync(join(tmpdir(), "demo-sections-"));
  const write = (sections: unknown) => { const p = join(dir, `${Math.random()}.json`); writeFileSync(p, JSON.stringify({ sections })); return p; };
  assert.throws(() => loadDemoSections(write({ steelmaking: [{ id: "bof", name: "전로" }] })), /demo_/);
  assert.throws(() => loadDemoSections(write({ mining: [{ id: "demo_x", name: "x" }] })), /섹션/);
  assert.throws(() => loadDemoSections(write({ steelmaking: [{ id: "demo_x", name: "a" }], rolling: [{ id: "demo_x", name: "b" }] })), /겹칩니다/);
  assert.deepEqual(loadDemoSections(join(dir, "none.json")), {}, "파일이 없으면 빈 목록");
  assert.throws(() => loadDemoSections(write({ steelmaking: [{ id: "demo_x", name: "a", equipment_ids: "bof_converter" }] })), /equipment_ids/);
});

test("시연 목록의 equipment_ids는 화면 설비 목록(data_v2.js)의 같은 공정 설비다", async () => {
  const scene = await loadSceneCatalog();
  for (const [section, list] of Object.entries(demo)) {
    const ids = new Set(scene.processes.find((p) => p.id === section)?.equipment.map((e) => e.id) ?? []);
    for (const c of list ?? []) for (const id of c.equipment_ids ?? []) assert.ok(ids.has(id), `${section} ${c.id}: ${id}`);
  }
});

test("trainee03·04는 네 공정 모두 통과하고, 공정마다 다시 볼 개념(최종 만점이 아닌 개념)이 하나 이상 있다", async () => {
  const { db, idOf } = await seededDb();
  for (const username of ["trainee03", "trainee04"]) {
    for (const section of SECTION_ORDER) {
      const rows = db.prepare(`SELECT c.verdict, c.recheck_verdict FROM concept_results c JOIN attempts a ON a.id = c.attempt_id
        WHERE a.user_id = ? AND a.section = ? AND a.state = 'completed'`).all(idOf(username), section);
      assert.ok(rows.length > 0, `${username} ${section} 기록 없음`);
      assert.ok(rows.some((r) => r.verdict !== "correct" && r.recheck_verdict !== "correct"), `${username} ${section} 다시 볼 개념 없음`);
    }
    const passed = traineeStats(db).trainees.find((t) => t.username === username)!;
    assert.ok(SECTION_ORDER.every((s) => passed.sections[s]?.passed), `${username} 수료`);
  }
});

test("시연 기록은 trainee02~20에만 생기고, 시연 목록 섹션(제강 등)까지 채워진다", async () => {
  let demoSectionRecords = 0;
  for (const seed of [1, 7, 42]) {
    const { db } = await seededDb(seed);
    const rows = db.prepare("SELECT u.username, a.section, a.origin FROM attempts a JOIN users u ON u.id = a.user_id").all();
    assert.ok(rows.every((r) => DEMO_RECORD_TRAINEES.includes(String(r.username))), `${seed}: trainee02~20 밖에 기록이 있음`);
    assert.ok(rows.every((r) => r.origin === "seed"));
    demoSectionRecords += rows.filter((r) => String(r.section) in demo).length;
  }
  assert.ok(demoSectionRecords > 0, "시연 목록 섹션에 시연 기록이 하나도 없음");
});

test("is_demo: trainee02~20만 1, 이미 있던 계정도 서버 시작(seedDemoAccounts) 때 표시된다", async () => {
  const db = openDatabase(":memory:");
  const users = new UserRepository(db);
  // 006 전에 만들어진 것처럼 표시 없이 계정을 먼저 만든다.
  await users.create({ username: "trainee12", password: "password123", name: "오승우", employee_no: "T2026012" });
  await users.create({ username: "real_user", password: "password123", name: "실사용자", employee_no: "R1" });
  await seedDemoAccounts(users);
  const flags = Object.fromEntries(db.prepare("SELECT username, is_demo FROM users").all().map((r) => [String(r.username), Number(r.is_demo)]));
  for (let i = 1; i <= 20; i++) {
    const name = `trainee${String(i).padStart(2, "0")}`;
    assert.equal(flags[name], i >= 2 ? 1 : 0, name);
  }
  assert.equal(flags.real_user, 0);
  assert.equal(flags.admin01, 0);
});

test("관리자 통계: 시연 목록 섹션은 시연 기록만으로 계산하고, final 루브릭이 있으면 시연 목록을 무시한다", async () => {
  const { db, idOf } = await seededDb(42);
  // 실제 계정의 옛 제강 기록(루브릭이 없던 때)은 시연 개념과 맞지 않으므로 세지 않는다.
  db.prepare(`INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, understanding, unlocked, created_at, updated_at, completed_at, origin)
              VALUES ('old', ?, 'steelmaking', 'first', 'completed', '[]', 1, 1, 't', 't', 't', 'live')`).run(idOf("trainee01"));
  const stats = traineeStats(db, finalRubrics);
  assert.deepEqual(stats.demo_sections, Object.keys(demo));
  assert.equal(stats.trainees.find((t) => t.username === "trainee01")!.sections.steelmaking, null);
  const withSteel = stats.trainees.filter((t) => t.sections.steelmaking);
  assert.ok(withSteel.length > 0 && withSteel.every((t) => t.is_demo), "제강 통계는 시연 계정에만 있어야 함");
  const names = new Set(conceptStats(db, "steelmaking", finalRubrics).concepts.map((c) => c.name));
  assert.ok([...names].every((n) => demo.steelmaking!.some((c) => c.name === n)), "제강 개념 이름은 시연 목록 이름");

  // 제강 final 루브릭이 생기면 그 개념을 쓰고 시연 목록은 무시한다.
  const steel: Rubric = { section: "steelmaking", reviewed: true, concepts: [{ concept_id: "bof_real", name: "전로" } as RubricConcept] };
  const sections = statSections([...finalRubrics, steel], demo);
  assert.deepEqual(sections.find((s) => s.section === "steelmaking"), { section: "steelmaking", concepts: [{ concept_id: "bof_real", name: "전로" }], demo: false });
  assert.ok(!traineeStats(db, [...finalRubrics, steel]).demo_sections.includes("steelmaking"));
});

test("include_demo=false면 시연 계정을 빼고, API는 true·false 밖의 값을 400으로 막는다", async () => {
  const { db, users } = await seededDb(42);
  const all = traineeStats(db, finalRubrics);
  const real = traineeStats(db, finalRubrics, { includeDemo: false });
  assert.equal(all.include_demo, true);
  assert.equal(real.include_demo, false);
  assert.equal(all.trainees.filter((t) => t.is_demo).length, DEMO_RECORD_TRAINEES.length);
  assert.ok(real.trainees.length > 0 && real.trainees.every((t) => !t.is_demo));
  assert.equal(real.trainees.length, all.trainees.length - DEMO_RECORD_TRAINEES.length);
  // 시연 기록은 시연 계정에만 있으므로 실제만 보면 개념 통계가 비어 있다.
  assert.ok(conceptStats(db, undefined, finalRubrics).concepts.length > 0);
  assert.deepEqual(conceptStats(db, undefined, finalRubrics, { includeDemo: false }).concepts, []);

  const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
  const app = express();
  app.use(createAdminRouter(db, { users, secret }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const admin = users.findById(String(db.prepare("SELECT id FROM users WHERE username = 'admin01'").get()!.id))!;
    const headers = { authorization: `Bearer ${await signToken(admin, secret)}` };
    const get = async (path: string) => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers });
      return { status: res.status, json: (await res.json()) as any };
    };
    const mixed = await get("/api/admin/trainees");
    assert.equal(mixed.json.trainees.filter((t: { is_demo: boolean }) => t.is_demo).length, DEMO_RECORD_TRAINEES.length);
    const only = await get("/api/admin/trainees?include_demo=false");
    assert.ok(only.json.trainees.every((t: { is_demo: boolean }) => !t.is_demo));
    assert.deepEqual((await get("/api/admin/concepts?include_demo=false")).json, { concepts: [] });
    for (const path of ["/api/admin/trainees?include_demo=no", "/api/admin/concepts?include_demo=0"]) {
      const bad = await get(path);
      assert.equal(bad.status, 400, path);
      assert.equal(bad.json.code, "INVALID_INCLUDE_DEMO");
    }
  } finally {
    server.close();
  }
});

test("신입사원 상세(GET /api/admin/trainees/:id): 목록과 같은 섹션 통계, 개념별 점수, 시도 기록. 없는 사람·관리자는 404", async () => {
  const { db, users, idOf } = await seededDb(42);
  const stats = traineeStats(db, finalRubrics);
  // 제선을 끝낸 시연 계정 하나를 고른다.
  const someone = stats.trainees.find((t) => t.is_demo && t.sections.ironmaking)!;
  const detail = traineeDetail(db, someone.id, finalRubrics)!;
  assert.deepEqual(detail.trainee, someone, "목록과 같은 사람 통계");
  assert.deepEqual(detail.sections.map((s) => s.section), [...SECTION_ORDER]);
  const iron = detail.sections.find((s) => s.section === "ironmaking")!;
  assert.deepEqual(iron.stat, someone.sections.ironmaking);
  assert.equal(iron.demo, false);
  assert.deepEqual(iron.concepts.map((c) => c.concept_id), finalRubrics.find((r) => r.section === "ironmaking")!.concepts.map((c) => c.concept_id));
  // 이해도는 개념 점수의 평균이다.
  const scores = iron.concepts.map((c) => c.score ?? 0);
  assert.equal(Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000), Math.round(iron.stat!.understanding * 1000));
  assert.equal(iron.attempts.length, iron.stat!.attempts);
  assert.ok(iron.attempts.every((a, i) => i === 0 || a.completed_at >= iron.attempts[i - 1].completed_at), "오래된 순서");
  assert.ok(!JSON.stringify(detail).includes("summary") && !JSON.stringify(detail).includes("answer_text"), "오개념 내용·답변 원문은 내보내지 않음");
  assert.equal(traineeDetail(db, "nobody", finalRubrics), null);
  assert.equal(traineeDetail(db, idOf("admin01"), finalRubrics), null, "관리자는 신입사원 상세가 없음");

  const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
  const app = express();
  app.use(createAdminRouter(db, { users, secret }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const admin = users.findById(idOf("admin01"))!;
    const get = async (path: string, as = admin) => {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, { headers: { authorization: `Bearer ${await signToken(as, secret)}` } });
      return { status: res.status, json: (await res.json()) as any };
    };
    const ok = await get(`/api/admin/trainees/${someone.id}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.trainee.username, someone.username);
    const missing = await get("/api/admin/trainees/nobody");
    assert.deepEqual([missing.status, missing.json.code], [404, "TRAINEE_NOT_FOUND"]);
    assert.equal((await get(`/api/admin/trainees/${someone.id}`, users.findById(idOf("trainee01"))!)).status, 403, "신입사원은 볼 수 없음");
  } finally {
    server.close();
  }
});

test("시연용 신입사원 2(trainee02): seed와 상관없이 제선 재도전 뒤 통과, 제강 재도전 필요, 해결·미해결 오개념이 함께 보인다", async () => {
  for (const seed of [1, 42, 99]) {
    const { db, idOf } = await seededDb(seed);
    const d = traineeDetail(db, idOf("trainee02"), finalRubrics)!;
    const iron = d.sections.find((s) => s.section === "ironmaking")!;
    const steel = d.sections.find((s) => s.section === "steelmaking")!;
    assert.deepEqual(iron.attempts.map((a) => [a.kind, a.unlocked]), [["first", false], ["retry", true]], `${seed}: 제선 첫 시도 미달 → 재도전 통과`);
    assert.equal(iron.attempts[0].understanding, 0.5);
    assert.equal(iron.stat!.understanding, 1);
    assert.deepEqual([steel.stat!.passed, Math.round(steel.stat!.understanding * 100)], [false, 67], `${seed}: 제강 재도전 필요`);
    assert.deepEqual(steel.concepts.map((c) => c.final_verdict), ["correct", "wrong", "correct"]);
    assert.deepEqual(d.trainee.misconceptions, { open: 1, resolved: 3 }, `${seed}: 오개념`);
    assert.equal(d.sections.find((s) => s.section === "continuous_casting")!.stat, null, "제강을 통과하지 못해 연주는 미응시");
  }
});

test("관리자 화면 시연 분포: seed와 상관없이 수료 8·진행 중 4·재도전 필요 5(trainee02 포함)·미시작 2, trainee01은 기록 없음", async () => {
  const expected: Record<string, string> = {
    trainee01: "idle", trainee02: "retry",
    trainee03: "done", trainee04: "done", trainee05: "done", trainee06: "done", trainee07: "done", trainee08: "done", trainee18: "done", trainee19: "done",
    trainee09: "active", trainee10: "active", trainee11: "active", trainee12: "active",
    trainee13: "retry", trainee14: "retry", trainee15: "retry", trainee16: "retry",
    trainee17: "idle", trainee20: "idle",
  };
  // 관리자 화면(Admin Dashboard.dc.html statusOf)과 같은 기준
  const statusOf = (t: ReturnType<typeof traineeStats>["trainees"][number]) => {
    const secs = SECTION_ORDER;
    if (t.passed_sections === secs.length) return "done";
    if (secs.some((s) => t.sections[s] && !t.sections[s]!.passed)) return "retry";
    if (secs.some((s) => t.sections[s]) || t.in_progress_sections.length) return "active";
    return "idle";
  };
  for (const seed of [1, 7, 42, 99, 2026]) {
    const { db } = await seededDb(seed);
    const got = Object.fromEntries(traineeStats(db, finalRubrics).trainees.map((t) => [t.username, statusOf(t)]));
    assert.deepEqual(got, expected, `seed ${seed}`);
  }
});
