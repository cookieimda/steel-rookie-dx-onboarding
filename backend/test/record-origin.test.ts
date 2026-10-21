import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const MIGRATIONS = join(process.cwd(), "backend", "src", "db", "migrations");
const run = (db: DatabaseSync, name: string) => db.exec(readFileSync(join(MIGRATIONS, name), "utf8"));

test("005_record_origin: 예전 시연 기록(대화 기록 없는 시도, 대화 없는 학습 오개념)을 seed로 표시한다", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of ["001_checkpoint.sql", "002_llm_usage.sql", "003_users.sql", "004_learning.sql"]) run(db, name);

  const attempt = db.prepare("INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, created_at, updated_at) VALUES (?, 'u', 'ironmaking', 'first', 'completed', '[]', 't', 't')");
  attempt.run("live");
  attempt.run("seeded");
  db.prepare("INSERT INTO attempt_messages (attempt_id, seq, role, type, text, created_at) VALUES ('live', 1, 'tutor', 'intro', '준비됐나요?', 't')").run();

  const mis = db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, attempt_id, answer_text, summary, created_at) VALUES (?, 'u', 'ironmaking', 'c', ?, ?, ?, 's', 't')");
  mis.run("cp-live", "checkpoint", "live", "답");
  mis.run("cp-seed", "checkpoint", "seeded", "답");
  mis.run("learn-live", "learning", null, "코크스가 불순물 없애는 거죠?");
  mis.run("learn-seed", "learning", null, "소결로는 쇳물을 직접 만드는 곳이죠?");
  db.prepare("INSERT INTO learning_turns (id, user_id, session_id, seq, section, question, answer, status, source_ids, created_at) VALUES ('t1', 'u', 's1', 1, 'ironmaking', '코크스가 불순물 없애는 거죠?', '아니요', 'grounded', '[]', 't')").run();

  run(db, "005_record_origin.sql");

  const origins = (table: string) => Object.fromEntries(db.prepare(`SELECT id, origin FROM ${table} ORDER BY id`).all().map((r) => [r.id, r.origin]));
  assert.deepEqual(origins("attempts"), { live: "live", seeded: "seed" });
  assert.deepEqual(origins("misconceptions"), { "cp-live": "live", "cp-seed": "seed", "learn-live": "live", "learn-seed": "seed" });

  // 새 기록은 기본 live, 다른 값은 막는다.
  attempt.run("new");
  assert.equal(db.prepare("SELECT origin FROM attempts WHERE id = 'new'").get()?.origin, "live");
  assert.throws(() => db.prepare("UPDATE attempts SET origin = 'test' WHERE id = 'new'").run());
});
