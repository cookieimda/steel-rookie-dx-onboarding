import assert from "node:assert/strict";
import { test } from "node:test";
import { traineeStats } from "../src/admin/trainee-stats.js";
import { SECTION_ORDER } from "../src/checkpoint/types.js";
import { seedDemoAccounts } from "../src/auth/demo-accounts.js";
import { UserRepository } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { SEED_MISCONCEPTIONS, seedDemoRecords, seedMisconception, type SectionConcepts } from "../src/db/demo-records.js";
import { loadFinalRubrics, type Rubric, type RubricConcept } from "../src/rubrics.js";

const concepts: SectionConcepts = Object.fromEntries(
  SECTION_ORDER.map((s) => [s, Array.from({ length: 6 }, (_, i) => ({ id: `${s}_${i}`, name: `${s} 설비 ${i}` }))]),
);
/** 관리자 통계는 지금 루브릭 개념만 보므로, 시연 개념으로 만든 루브릭을 넘긴다. */
const rubrics = Object.entries(concepts).map(([section, list]) => ({ section, reviewed: true, concepts: list.map((c) => ({ concept_id: c.id, name: c.name }) as RubricConcept) }) as Rubric);

async function seeded(seed: number) {
  const db = openDatabase(":memory:");
  const users = new UserRepository(db);
  await seedDemoAccounts(users);
  const outsider = await users.create({ username: "real_user", password: "password123", name: "실사용자", employee_no: "R1" });
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at) VALUES ('keep', ?, 'ironmaking', 'x', 'learning', 'a', 's', 'now')").run(outsider.id);
  const counts = seedDemoRecords(db, concepts, seed);
  return { db, counts };
}

test("seeded records follow the unlock order and scoring rules", async () => {
  for (const seed of [1, 2, 3, 42, 777]) {
    const { db } = await seeded(seed);
    const stats = traineeStats(db, rubrics);
    for (const t of stats.trainees.filter((x) => x.username.startsWith("trainee"))) {
      // 앞 섹션을 통과해야 다음 섹션 기록이 있다.
      SECTION_ORDER.forEach((s, i) => {
        if (i > 0 && t.sections[s]) assert.ok(t.sections[SECTION_ORDER[i - 1]]?.passed, `${seed} ${t.username} ${s} before passing previous`);
        const stat = t.sections[s];
        if (stat) {
          assert.equal(stat.passed, stat.understanding >= 0.8, `${seed} ${t.username} ${s} passed vs understanding`);
          assert.ok(stat.attempts >= 1 && stat.attempts <= 3);
          assert.equal((stat.understanding * 12) % 1, 0); // 개념 6개 × 0.5점 단위
        }
      });
    }
    assert.ok(stats.trainees.find((t) => t.username === "trainee11")!.sections.ironmaking, `${seed} trainee11 has no ironmaking record`);
  }
});

test("the same seed gives the same records and reseeding replaces only demo trainees", async () => {
  const a = await seeded(42);
  const b = await seeded(42);
  const strip = (db: typeof a.db) => traineeStats(db, rubrics).trainees.map(({ id, created_at, last_activity, ...rest }) => rest);
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(strip(a.db), strip(b.db));

  seedDemoRecords(a.db, concepts, 7);
  const attemptsPerUser = a.db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM attempts").get();
  assert.ok(Number(attemptsPerUser?.n) <= 20);
  assert.ok(a.db.prepare("SELECT 1 FROM misconceptions WHERE id = 'keep'").get(), "other users' records were deleted");
});

test("루브릭(개념)이 없는 섹션에는 기록을 만들지 않는다", async () => {
  const db = openDatabase(":memory:");
  await seedDemoAccounts(new UserRepository(db));
  seedDemoRecords(db, { ironmaking: concepts.ironmaking! }, 42);
  const sections = db.prepare("SELECT DISTINCT section FROM attempts").all().map((r) => String(r.section));
  assert.deepEqual(sections, ["ironmaking"]);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM misconceptions WHERE section <> 'ironmaking'").get()?.n), 0);
});

test("시연 기록은 trainee02~20에만 origin = 'seed'로 넣고, 다시 만들 때 trainee01의 seed 기록은 지우고 실제 기록(live)은 남긴다", async () => {
  const { db } = await seeded(42);
  const seededUsers = db.prepare("SELECT DISTINCT u.username FROM attempts a JOIN users u ON u.id = a.user_id ORDER BY 1").all().map((r) => String(r.username));
  assert.ok(seededUsers.length > 0 && seededUsers.every((u) => u >= "trainee02" && u <= "trainee20"), seededUsers.join(","));
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE origin <> 'seed'").get()?.n), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM misconceptions WHERE origin <> 'seed' AND id <> 'keep'").get()?.n), 0);

  // 예전 seed가 trainee01에 넣은 기록과 trainee01의 실제 기록
  const trainee01 = String(db.prepare("SELECT id FROM users WHERE username = 'trainee01'").get()?.id);
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, created_at, updated_at, origin) VALUES (?, ?, 'ironmaking', 'first', 'completed', '[]', 'now', 'now', ?)");
  attempt.run("old-seed", trainee01, "seed");
  attempt.run("live1", trainee01, "live");
  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at, origin) VALUES (?, ?, 'ironmaking', 'x', 'checkpoint', 'a', 's', 'now', ?)");
  mis.run("old-seed-mis", trainee01, "seed");
  mis.run("live-mis", trainee01, "live");

  seedDemoRecords(db, concepts, 7);
  const ids = (table: string) => db.prepare(`SELECT id FROM ${table} WHERE user_id = ? ORDER BY id`).all(trainee01).map((r) => String(r.id));
  assert.deepEqual(ids("attempts"), ["live1"]);
  assert.deepEqual(ids("misconceptions"), ["live-mis"]);
});

test("seedMisconception: 제선 개념은 개념마다 정해 둔 오해, 다른 개념은 일반 문장. 요약은 모두 다르다", () => {
  const ironmaking = loadFinalRubrics().find((r) => r.section === "ironmaking")!;
  for (const c of ironmaking.concepts) assert.ok(SEED_MISCONCEPTIONS[c.concept_id], `${c.concept_id}: 정해 둔 오해 없음`);
  assert.equal(new Set(Object.values(SEED_MISCONCEPTIONS).map((m) => m.summary)).size, Object.keys(SEED_MISCONCEPTIONS).length);
  assert.equal(seedMisconception("converter_role", "전로의 역할").summary, "'전로의 역할'을 다른 공정의 일과 헷갈림");
  assert.equal(seedMisconception("tundish", "턴디시").summary, "'턴디시'를 다른 공정의 일과 헷갈림");
});
