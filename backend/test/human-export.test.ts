import assert from "node:assert/strict";
import test from "node:test";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { openDatabase } from "../src/db/database.js";
import { exportHumanAnswers } from "../../llm/eval/human-export.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

async function filledDb(users: Record<string, string[]>) {
  const db = openDatabase(":memory:");
  const engine = new CheckpointEngine({
    repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING, STEELMAKING],
  });
  for (const [user, answers] of Object.entries(users)) {
    const { view } = await engine.start(user, "ironmaking");
    await engine.respond(user, view.attempt_id, "네");
    for (const answer of answers) await engine.respond(user, view.attempt_id, answer);
  }
  return db;
}

test("사람 답변 내보내기: 첫 판정 답변만, 판정은 비우고 모델 판정은 따로, 사용자 id는 익명화", async () => {
  const first = await filledDb({
    "kim.real-id": ["correct", "wrong|불순물을 없앤다고 봄", "partial", "correct"],
    "lee.real-id": ["correct"],
  });
  const second = await filledDb({ "kim.real-id": ["assisted"] }); // 다른 DB의 같은 id는 다른 사람으로 본다

  const { cases, verdicts } = exportHumanAnswers([{ label: "a.sqlite", db: first }, { label: "b.sqlite", db: second }], "ironmaking");

  // 재확인 답변("partial")은 빼고 첫 판정 답변만: kim 3개, lee 1개, 두 번째 DB 1개
  assert.deepEqual(cases.map((c) => [c.respondent, c.concept_id, c.answer]), [
    ["p01", "a", "correct"],
    ["p01", "b", "wrong|불순물을 없앤다고 봄"],
    ["p01", "c", "correct"],
    ["p02", "a", "correct"],
    ["p03", "a", "assisted"],
  ]);
  assert.ok(cases.every((c) => c.expected_verdict === "" && c.source === "human" && c.phase === "initial"));
  assert.doesNotMatch(JSON.stringify({ cases, verdicts }), /real-id|attempt/);

  assert.deepEqual(verdicts.map((v) => v.case_id), cases.map((c) => c.case_id));
  assert.equal(new Set(cases.map((c) => c.case_id)).size, cases.length);
  const wrong = verdicts[1]!;
  assert.equal(wrong.model_verdict, "wrong");
  assert.equal(wrong.misconception, "불순물을 없앤다고 봄");
  assert.equal(wrong.explain_from, 0);

  // 같은 DB를 다시 내보내면 case_id가 같다(판정 파일과 다시 맞춰 볼 수 있게).
  const again = exportHumanAnswers([{ label: "a.sqlite", db: first }, { label: "b.sqlite", db: second }], "ironmaking");
  assert.deepEqual(again.cases.map((c) => c.case_id), cases.map((c) => c.case_id));
});

test("사람 답변 내보내기: 시연 기록(origin = 'seed')은 빼고 실제 기록만", async () => {
  const db = await filledDb({ "kim.real-id": ["correct"], "demo.id": ["wrong|시연 답변"] });
  db.prepare("UPDATE attempts SET origin = 'seed' WHERE user_id = 'demo.id'").run();
  const { cases } = exportHumanAnswers([{ label: "a.sqlite", db }], "ironmaking");
  assert.deepEqual(cases.map((c) => c.answer), ["correct"]);
});

test("사람 답변 내보내기: origin 컬럼이 없는 예전 DB는 대화 기록이 있는 시도만", async () => {
  const db = await filledDb({ "kim.real-id": ["correct"], "demo.id": ["wrong|시연 답변"] });
  // 005 전 DB 흉내: seed는 대화 기록을 남기지 않았고 origin 컬럼이 없다.
  db.prepare("DELETE FROM attempt_messages WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = 'demo.id')").run();
  db.exec("PRAGMA foreign_keys = OFF; ALTER TABLE attempts DROP COLUMN origin;");
  const { cases } = exportHumanAnswers([{ label: "a.sqlite", db }], "ironmaking");
  assert.deepEqual(cases.map((c) => c.answer), ["correct"]);
});
