import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../src/db/database.js";
import { countUserData, deleteUserData } from "../src/db/user-data.js";
import { latestPerConcept, LearningRepository, MAX_OPEN_MISCONCEPTIONS, type NewTurn } from "../src/learning/repository.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { MeRepository } from "../src/me/repository.js";

const turn = (over: Partial<NewTurn> = {}): NewTurn => ({
  user_id: "minsu",
  session_id: "s1",
  section: "ironmaking",
  equipment_id: "blast_furnace",
  question: "고로에 코크스를 왜 넣나요?",
  answer: "열원이면서 환원제이기 때문입니다.",
  status: "grounded",
  source_ids: ["posco-ironmaking-1"],
  ...over,
});

function setup() {
  const db = openDatabase(":memory:");
  return { db, repo: new LearningRepository(db) };
}

test("saveTurn: 세션 안에서 seq가 1부터 이어지고 근거 id 배열이 그대로 돌아온다", () => {
  const { repo } = setup();
  const first = repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  const second = repo.saveTurn(turn({ question: "소결은 뭔가요?" }), "2026-10-02T01:00:00Z"); // 같은 시각
  const other = repo.saveTurn(turn({ session_id: "s2" }), "2026-10-02T01:00:00Z");
  assert.deepEqual([first.seq, second.seq, other.seq], [1, 2, 1]);

  const recent = repo.recentTurns("s1", 6);
  assert.deepEqual(recent.map((t) => t.question), ["고로에 코크스를 왜 넣나요?", "소결은 뭔가요?"]);
  assert.deepEqual(recent[0].source_ids, ["posco-ironmaking-1"]);
  assert.equal(recent[0].equipment_id, "blast_furnace");
});

test("recentTurns: 최근 limit개만 오래된 것부터 돌려준다", () => {
  const { repo } = setup();
  for (let i = 1; i <= 8; i++) repo.saveTurn(turn({ question: `질문 ${i}` }), `2026-10-02T01:0${i}:00Z`);
  assert.deepEqual(repo.recentTurns("s1", 3).map((t) => t.question), ["질문 6", "질문 7", "질문 8"]);
  assert.deepEqual(repo.recentTurns("없는 세션", 3), []);
});

test("sessionOwner: 세션을 만든 사용자를 알려 주고, 없는 세션은 null", () => {
  const { repo } = setup();
  repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  assert.equal(repo.sessionOwner("s1"), "minsu");
  assert.equal(repo.sessionOwner("s9"), null);
});

test("status는 grounded·unverified·safety_redirect만 저장된다", () => {
  const { repo } = setup();
  repo.saveTurn(turn({ status: "safety_redirect", source_ids: [] }), "2026-10-02T01:00:00Z");
  assert.throws(() => repo.saveTurn(turn({ status: "maybe" as never }), "2026-10-02T01:00:00Z"));
});

test("recordMisconception·openMisconceptions: 학습 모드 오개념은 source=learning, 해결되지 않은 것만 섹션별로 나온다", () => {
  const { db, repo } = setup();
  repo.recordMisconception({ user_id: "minsu", section: "ironmaking", concept_id: "coke_role", answer_text: "코크스는 연료죠?", summary: "환원제 역할 누락" }, "2026-10-02T01:00:00Z");
  repo.recordMisconception({ user_id: "minsu", section: "steelmaking", concept_id: "bof", answer_text: "산소로 철을 태워요", summary: "산화 대상 오해" }, "2026-10-02T01:01:00Z");
  repo.recordMisconception({ user_id: "jiwoo", section: "ironmaking", concept_id: "coke_role", answer_text: "x", summary: "다른 사람" }, "2026-10-02T01:02:00Z");
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, resolved, created_at) VALUES ('done', 'minsu', 'ironmaking', 'sinter', 'checkpoint', 'a', '해결된 것', 1, '2026-10-01')").run();
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at) VALUES ('cp', 'minsu', 'ironmaking', 'hot_stove', 'checkpoint', 'a', '열풍로 역할 오해', '2026-10-02T00:00:00Z')").run();

  const open = repo.openMisconceptions("minsu", "ironmaking");
  assert.deepEqual(open.map((m) => [m.concept_id, m.source]), [["hot_stove", "checkpoint"], ["coke_role", "learning"]]);
  const learning = db.prepare("SELECT phase, attempt_id, resolved FROM misconceptions WHERE source = 'learning' AND user_id = 'minsu' AND section = 'ironmaking'").get();
  assert.deepEqual({ ...learning }, { phase: null, attempt_id: null, resolved: 0 });
});

test("deleteUserData: 학습 대화도 그 사용자 것만 지운다", () => {
  const { db, repo } = setup();
  repo.saveTurn(turn(), "2026-10-02T01:00:00Z");
  repo.saveTurn(turn({ user_id: "jiwoo", session_id: "s2" }), "2026-10-02T01:00:00Z");
  assert.equal(countUserData(db, "minsu").learning_turns, 1);
  assert.equal(deleteUserData(db, "minsu").learning_turns, 1);
  assert.equal(countUserData(db, "minsu").learning_turns, 0);
  assert.equal(countUserData(db, "jiwoo").learning_turns, 1);
});

test("recordMisconception: 같은 사용자·섹션·개념의 미해결 learning 오개념이 있으면 새로 넣지 않고 summary·답변만 갱신한다", () => {
  const { db, repo } = setup();
  const base = { user_id: "minsu", section: "ironmaking" as const, concept_id: "coke_reduction" };
  const first = repo.recordMisconception({ ...base, answer_text: "코크스는 불순물 없애죠?", summary: "불순물 제거로 앎" }, "2026-10-02T01:00:00Z");
  const again = repo.recordMisconception({ ...base, answer_text: "코크스가 불순물 잡는 거 맞죠?", summary: "여전히 불순물 제거로 앎" }, "2026-10-02T02:00:00Z");
  assert.equal(again, first);
  const rows = db.prepare("SELECT answer_text, summary, created_at FROM misconceptions WHERE user_id = 'minsu'").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ answer_text: "코크스가 불순물 잡는 거 맞죠?", summary: "여전히 불순물 제거로 앎", created_at: "2026-10-02T01:00:00Z" }]);

  // 다른 섹션·다른 사람·체크포인트 오개념은 따로, 해결된 뒤 다시 나오면 새로 넣는다.
  repo.recordMisconception({ ...base, section: "steelmaking", answer_text: "a", summary: "s" }, "2026-10-02T03:00:00Z");
  repo.recordMisconception({ ...base, user_id: "jiwoo", answer_text: "a", summary: "s" }, "2026-10-02T03:00:00Z");
  db.prepare("UPDATE misconceptions SET resolved = 1 WHERE id = ?").run(first);
  assert.notEqual(repo.recordMisconception({ ...base, answer_text: "b", summary: "다시 헷갈림" }, "2026-10-02T04:00:00Z"), first);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM misconceptions").get()?.n), 4);
});

test("해결 후 재발: 체크포인트에서 해결된 오개념이 다시 나오면 새 미해결 행이 생기고, 해결된 옛 기록은 그대로 남는다", () => {
  const { db, repo } = setup();
  const checkpoints = new CheckpointRepository(db);
  const me = new MeRepository(db);
  const base = { user_id: "minsu", section: "ironmaking" as const, concept_id: "coke_reduction" };
  const fromCheckpoint = (id: string, summary: string, at: string) =>
    checkpoints.insertMisconception({ id, ...base, source: "checkpoint", phase: "initial", attempt_id: null, answer_text: "불순물 없애요", summary }, at);

  // 1) 학습 모드·체크포인트에서 같은 개념의 오개념이 기록된다.
  const firstLearning = repo.recordMisconception({ ...base, answer_text: "코크스는 불순물 없애죠?", summary: "불순물 제거로 앎" }, "2026-10-02T01:00:00Z");
  fromCheckpoint("cp-1", "불순물 제거로 설명", "2026-10-02T02:00:00Z");
  assert.equal(repo.openMisconceptions("minsu", "ironmaking").length, 2);

  // 2) 체크포인트에서 그 개념을 1점으로 확정하면 출처와 상관없이 모두 해결된다(CheckpointRepository.resolveMisconceptions).
  checkpoints.resolveMisconceptions("minsu", "coke_reduction", "2026-10-02T03:00:00Z");
  assert.deepEqual(repo.openMisconceptions("minsu", "ironmaking"), []);

  // 3) 다시 틀리면(재발) 학습 모드는 해결된 행을 고치지 않고 새로 넣고, 체크포인트도 새 행을 넣는다.
  const again = repo.recordMisconception({ ...base, answer_text: "코크스가 불순물 잡죠?", summary: "다시 불순물 제거로 앎" }, "2026-10-03T01:00:00Z");
  assert.notEqual(again, firstLearning);
  fromCheckpoint("cp-2", "다시 불순물 제거로 설명", "2026-10-03T02:00:00Z");

  // 학습자 메모·학습 모드 프롬프트에는 재발한 미해결 기록만, 개념당 최근 1개가 들어간다.
  const open = repo.openMisconceptions("minsu", "ironmaking");
  assert.deepEqual(open.map((m) => m.summary), ["다시 불순물 제거로 앎", "다시 불순물 제거로 설명"]);
  assert.deepEqual(latestPerConcept(open).map((m) => m.summary), ["다시 불순물 제거로 설명"]);

  // 개인 페이지에는 해결된 옛 기록과 재발 기록이 모두 최근 것부터 보인다.
  assert.deepEqual(me.listMisconceptions("minsu").map((m) => [m.summary, m.resolved]), [
    ["다시 불순물 제거로 설명", false],
    ["다시 불순물 제거로 앎", false],
    ["불순물 제거로 설명", true],
    ["불순물 제거로 앎", true],
  ]);
  // 해결된 옛 행의 해결 시각은 재발로 바뀌지 않는다.
  assert.equal(db.prepare("SELECT resolved_at FROM misconceptions WHERE id = ?").get(firstLearning)?.resolved_at, "2026-10-02T03:00:00Z");

  // 4) 다시 맞히면 재발 기록도 해결되고, 행은 지우지 않는다(4행 모두 남음).
  checkpoints.resolveMisconceptions("minsu", "coke_reduction", "2026-10-04T01:00:00Z");
  assert.deepEqual(repo.openMisconceptions("minsu", "ironmaking"), []);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM misconceptions WHERE user_id = 'minsu'").get()?.n), 4);
});

test("latestPerConcept: 개념당 최근 1개만 남겨 최근 것부터 최대 5개", () => {
  const items = [
    ...Array.from({ length: 7 }, (_, i) => ({ concept_id: `c${i}`, summary: `오해 ${i}`, source: "learning" as const, created_at: `2026-10-02T0${i}:00:00Z` })),
    { concept_id: "c0", summary: "c0 최신", source: "checkpoint" as const, created_at: "2026-10-02T09:00:00Z" },
  ];
  const picked = latestPerConcept(items);
  assert.equal(picked.length, MAX_OPEN_MISCONCEPTIONS);
  assert.deepEqual(picked.map((m) => m.concept_id), ["c0", "c6", "c5", "c4", "c3"]);
  assert.equal(picked[0].summary, "c0 최신");
});

test("openMisconceptions·recordMisconception: 시연 기록(origin = 'seed')은 읽지도 갱신하지도 않는다", () => {
  const { db, repo } = setup();
  db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at, origin) VALUES ('seed1', 'minsu', 'ironmaking', 'coke_role', 'learning', 'x', '시연 오개념', '2026-10-01T00:00:00Z', 'seed')").run();
  assert.deepEqual(repo.openMisconceptions("minsu", "ironmaking"), []);

  const id = repo.recordMisconception({ user_id: "minsu", section: "ironmaking", concept_id: "coke_role", answer_text: "코크스는 연료죠?", summary: "실제 오개념" }, "2026-10-02T01:00:00Z");
  assert.notEqual(id, "seed1");
  assert.equal(db.prepare("SELECT summary FROM misconceptions WHERE id = 'seed1'").get()?.summary, "시연 오개념");
  assert.deepEqual(repo.openMisconceptions("minsu", "ironmaking").map((m) => m.summary), ["실제 오개념"]);
});
