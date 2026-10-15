// 학습 기록 '사원증': XP·직급·연속 학습일·배지·오늘의 미션 계산(me/employee-card.ts)과 DB 기록 읽기(MeRepository.cardEvents).
import assert from "node:assert/strict";
import { test } from "node:test";
import { UserRepository } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { DAILY_QUESTION_XP_CAP, RANKS, XP, buildEmployeeCard, kstDay, type CardEvent } from "../src/me/employee-card.js";
import { MeRepository } from "../src/me/repository.js";

const NOW = new Date("2026-10-15T03:00:00Z"); // 한국 시간 2026-10-15 12:00
const at = (day: string, hh = "01") => `${day}T${hh}:00:00Z`;

test("기록이 없으면 수습사원, XP 0, 연속 0일, 배지 없음", () => {
  const card = buildEmployeeCard([], NOW);
  assert.equal(card.xp, 0);
  assert.equal(card.rank.title, "수습사원");
  assert.equal(card.next_rank?.title, "사원");
  assert.equal(card.xp_to_next, RANKS[1].min_xp);
  assert.deepEqual(card.streak, { current: 0, longest: 0, today_done: false });
  assert.equal(card.week.length, 7);
  assert.equal(card.week[6].date, "2026-10-15");
  assert.ok(card.badges.every((b) => !b.earned));
});

test("날짜 경계는 한국 시간 자정", () => {
  assert.equal(kstDay("2026-10-14T14:59:59Z"), "2026-10-14");
  assert.equal(kstDay("2026-10-14T15:00:00Z"), "2026-10-15");
});

test("질문 XP는 하루 상한까지만 세고, 질문 수는 모두 센다", () => {
  const events: CardEvent[] = Array.from({ length: DAILY_QUESTION_XP_CAP + 5 }, (_, i) =>
    ({ kind: "question", at: `2026-10-15T01:${String(i).padStart(2, "0")}:00Z`, section: "ironmaking" }));
  const card = buildEmployeeCard(events, NOW);
  assert.equal(card.xp, XP.question * DAILY_QUESTION_XP_CAP);
  assert.equal(card.counts.questions, DAILY_QUESTION_XP_CAP + 5);
  assert.equal(card.today.xp, card.xp);
  assert.ok(card.missions.find((m) => m.id === "ask_3")?.done);
});

test("XP가 직급 경계에 닿으면 다음 직급, 최고 직급은 진행 1", () => {
  const passes = (n: number): CardEvent[] => Array.from({ length: n }, (_, i) => ({ kind: "section_passed", at: at("2026-10-01"), section: `s${i}` }));
  assert.equal(buildEmployeeCard(passes(3), NOW).rank.title, "주임"); // 300
  const top = buildEmployeeCard(passes(20), NOW);
  assert.equal(top.rank.title, "명장");
  assert.equal(top.next_rank, null);
  assert.equal(top.rank_progress, 1);
  assert.equal(top.xp_to_next, 0);
});

test("연속 학습일: 오늘 안 했으면 어제까지 이어진 날, 최장 기록은 따로", () => {
  const q = (day: string): CardEvent => ({ kind: "question", at: at(day), section: "ironmaking" });
  const events = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-12", "2026-10-13", "2026-10-14"].map(q);
  const card = buildEmployeeCard(events, NOW);
  assert.deepEqual(card.streak, { current: 3, longest: 4, today_done: false });
  const withToday = buildEmployeeCard([...events, q("2026-10-15")], NOW);
  assert.deepEqual(withToday.streak, { current: 4, longest: 4, today_done: true });
  // 그제 끊겼으면 0
  assert.equal(buildEmployeeCard([q("2026-10-13")], NOW).streak.current, 0);
  assert.ok(card.badges.find((b) => b.id === "streak_3")?.earned);
  assert.ok(!card.badges.find((b) => b.id === "streak_7")?.earned);
});

test("배지: 4개 공정 질문, 만점 이해도 확인", () => {
  const events: CardEvent[] = ["ironmaking", "steelmaking", "continuous_casting", "rolling"]
    .map((section) => ({ kind: "question", at: at("2026-10-15"), section }));
  events.push({ kind: "checkpoint_done", at: at("2026-10-15"), section: "ironmaking", understanding: 1 });
  const card = buildEmployeeCard(events, NOW);
  assert.ok(card.badges.find((b) => b.id === "explorer")?.earned);
  assert.ok(card.badges.find((b) => b.id === "perfect")?.earned);
  assert.deepEqual(card.badges.find((b) => b.id === "curious"), { id: "curious", name: "호기심 대장", description: "튜터에게 질문 50개", earned: false, progress: 4, goal: 50 });
});

test("cardEvents: 본인 기록만, 이해도 확인은 최종 판정 기준으로 읽는다", async () => {
  const db = openDatabase(":memory:");
  const users = new UserRepository(db);
  const kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  const lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const turn = db.prepare("INSERT INTO learning_turns (id, user_id, session_id, seq, section, question, answer, status, source_ids, created_at) VALUES (?, ?, 's', ?, 'ironmaking', '질문', '답', ?, '[]', ?)");
  turn.run("t1", kim.id, 1, "grounded", at("2026-10-15"));
  turn.run("t2", kim.id, 2, "safety_redirect", at("2026-10-15"));
  turn.run("t3", lee.id, 3, "grounded", at("2026-10-15"));
  db.prepare(`INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, understanding, unlocked, created_at, updated_at, completed_at)
              VALUES ('a1', ?, 'ironmaking', 'first', 'completed', '[]', 0.75, 0, ?, ?, ?)`).run(kim.id, at("2026-10-14"), at("2026-10-14"), at("2026-10-14"));
  const result = db.prepare("INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, recheck_verdict, created_at, updated_at) VALUES ('a1', ?, 'q', 'a', ?, ?, ?, ?)");
  result.run("c1", "correct", null, at("2026-10-14"), at("2026-10-14"));
  result.run("c2", "wrong", "partial", at("2026-10-14"), at("2026-10-14"));
  result.run("c3", "partial", "wrong", at("2026-10-14"), at("2026-10-14"));
  db.prepare("INSERT INTO learner_sketches (user_id, process_id, draw_mode, strokes, updated_at) VALUES (?, 'rolling', 'plan', '[]', ?)").run(kim.id, at("2026-10-15"));

  const kinds = new MeRepository(db).cardEvents(kim.id).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["checkpoint_done", "concept_correct", "concept_partial", "question", "sketch"]);
  const card = buildEmployeeCard(new MeRepository(db).cardEvents(kim.id), NOW);
  assert.equal(card.xp, XP.question + XP.checkpoint_done + XP.concept_correct + XP.concept_partial + XP.sketch);
  assert.deepEqual(card.streak, { current: 2, longest: 2, today_done: true });
});
