import assert from "node:assert/strict";
import test from "node:test";
import { UserRepository } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { countUserData, deleteUserData, userIdsForName } from "../src/db/user-data.js";

async function setup() {
  const db = openDatabase(":memory:");
  const account = await new UserRepository(db).create({ username: "minsu", password: "password123", name: "민수", employee_no: "T1" });
  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, created_at, updated_at, origin) VALUES (?, ?, 'ironmaking', 'first', 'completed', '[]', 't', 't', ?)");
  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at, origin) VALUES (?, ?, 'ironmaking', 'c', 'checkpoint', 'a', 's', 't', ?)");
  attempt.run("acc-live", account.id, "live");
  attempt.run("acc-seed", account.id, "seed");
  attempt.run("hdr-live", "minsu", "live"); // 토큰 없이 X-User-Id: minsu로 쌓인 기록
  attempt.run("other", "jiwoo", "live");
  db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, created_at, updated_at) VALUES ('acc-seed', 'c', 'q', 'a', 'wrong', 't', 't')").run();
  mis.run("m-live", account.id, "live");
  mis.run("m-seed", account.id, "seed");
  db.prepare("INSERT INTO learning_turns (id, user_id, session_id, seq, question, answer, status, source_ids, created_at) VALUES ('t1', ?, 's', 1, 'q', 'a', 'grounded', '[]', 't')").run(account.id);
  return { db, accountId: account.id };
}

const ids = (db: Awaited<ReturnType<typeof setup>>["db"], table: string) => db.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((r) => String(r.id));

test("userIdsForName: 로그인 아이디면 users.id와 헤더 이름을 함께, 아니면 이름만", async () => {
  const { db, accountId } = await setup();
  assert.deepEqual(userIdsForName(db, "minsu"), { userIds: [accountId, "minsu"], accountId });
  assert.deepEqual(userIdsForName(db, "헤더만"), { userIds: ["헤더만"], accountId: null });
});

test("deleteUserData --origin seed: 시연 기록만 지우고 실제 기록·학습 대화는 남긴다", async () => {
  const { db, accountId } = await setup();
  assert.deepEqual(countUserData(db, accountId, { origin: "seed" }), { attempts: 1, misconceptions: 1, learning_turns: 0 });
  const d = deleteUserData(db, accountId, { origin: "seed" });
  assert.deepEqual([d.attempts, d.concept_results, d.misconceptions, d.learning_turns], [1, 1, 1, 0]);
  assert.deepEqual(ids(db, "attempts"), ["acc-live", "hdr-live", "other"]);
  assert.deepEqual(ids(db, "misconceptions"), ["m-live"]);
  assert.deepEqual(ids(db, "learning_turns"), ["t1"]);
});

test("deleteUserData --origin live·all: live는 실제 기록과 학습 대화, all은 전부. 다른 사람 기록은 남긴다", async () => {
  const { db, accountId } = await setup();
  deleteUserData(db, accountId, { origin: "live" });
  assert.deepEqual(ids(db, "attempts"), ["acc-seed", "hdr-live", "other"]);
  assert.deepEqual(ids(db, "learning_turns"), []);

  for (const id of userIdsForName(db, "minsu").userIds) deleteUserData(db, id); // 기본 all, 헤더 이름 기록도
  assert.deepEqual(ids(db, "attempts"), ["other"]);
  assert.deepEqual(ids(db, "misconceptions"), []);
});

test("deleteUserData: 이어 풀기 질문 기록(attempt_questions)도 지운다(외래 키 때문에 시도보다 먼저)", async () => {
  const { db, accountId } = await setup();
  const asked = db.prepare("INSERT INTO attempt_questions (attempt_id, concept_id, phase, bank_question, asked_text, created_at) VALUES (?, 'c', 'initial', 'Q1', 'Q1?', 't')");
  asked.run("acc-live");
  asked.run("other");
  const d = deleteUserData(db, accountId, { origin: "live" });
  assert.equal(d.attempt_questions, 1);
  assert.deepEqual(ids(db, "attempts"), ["acc-seed", "hdr-live", "other"]);
  assert.deepEqual(db.prepare("SELECT attempt_id FROM attempt_questions").all().map((r) => String(r.attempt_id)), ["other"]);
});
