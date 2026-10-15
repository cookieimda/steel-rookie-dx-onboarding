// 3D 시뮬레이션: What-if 원인별 효과·다음 공정 영향(lab/whatif.ts), 이상 상황 훈련(lab/faults.ts).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { deleteUserData } from "../src/db/user-data.js";
import { buildDeck } from "../src/lab/deck.js";
import { createLabExtrasRouter } from "../src/lab/extras-routes.js";
import { checkStep, faultScore, faultView, loadFaults, FAULTS_PATH } from "../src/lab/faults.js";
import { loadIncidents } from "../src/lab/incidents.js";
import { MeRepository } from "../src/me/repository.js";
import { BASELINE, downstreamOf, effectsOf, simulate, whatIf } from "../src/lab/whatif.js";
import { readFileSync } from "node:fs";

const ALL = new Set(["sinter_plant", "coke_oven", "blast_furnace", "hot_stove", "taphole_casthouse", "torpedo_car", "hot_metal_pretreatment", "bof_converter", "oxygen_lance_offgas",
  "tapping_ladle_crane", "secondary_refining", "ladle_transfer", "ladle_turret", "tundish", "cc_mold", "secondary_cooling", "withdrawal_straightener", "torch_cutter",
  "reheating_furnace", "descaler", "roughing_mill", "finishing_mill", "runout_table", "coiler"]);

test("What-if 원인별 효과: 바꾼 조건만, 원료 비율은 '원료 배합' 하나로, 효과 방향이 맞다", () => {
  assert.deepEqual(effectsOf({ ...BASELINE }), []);
  const coke = effectsOf({ ...BASELINE, coke_kg: 400 });
  assert.equal(coke.length, 1);
  assert.deepEqual([coke[0].label, coke[0].equipment_id], ["코크스", "coke_oven"]);
  assert.ok(coke[0].deltas.hot_metal_temp_c > 0 && coke[0].deltas.co2_kg > 0);
  const mix = effectsOf({ ...BASELINE, sinter_pct: 40, pellet_pct: 50, lump_pct: 10 });
  assert.deepEqual(mix.map((e) => e.label), ["원료 배합"]);
  assert.ok(mix[0].deltas.slag_kg < 0, "펠릿이 늘면 슬래그가 준다");
  const lime = effectsOf({ ...BASELINE, limestone_kg: 50 })[0];
  assert.ok(lime.deltas.basicity > 0 && lime.deltas.slag_kg > 0);
  assert.equal(whatIf({ coke_kg: 400, blast_temp_c: 1250 }).effects.length, 2);
});

test("What-if 다음 공정 영향: 용선이 식으면 전로 고철, 뜨거우면 규소·슬로핑, 염기도가 낮으면 탈황", () => {
  assert.deepEqual(downstreamOf(simulate(BASELINE)), []);
  const cold = downstreamOf(whatIf({ coke_kg: 280, pci_kg: 120 }).result);
  assert.ok(cold.some((d) => d.equipment_id === "bof_converter" && d.text.includes("고철")));
  const hot = downstreamOf(whatIf({ coke_kg: 450 }).result);
  assert.ok(hot.some((d) => d.text.includes("슬로핑")));
  const acid = downstreamOf(whatIf({ sinter_pct: 20, pellet_pct: 70, lump_pct: 10 }).result);
  assert.ok(acid.some((d) => d.text.includes("탈황")));
});

test("이상 상황: 파일 검사(신호 정답 = 정상 범위 밖, 조치 결과 수, 설비 id)와 단계 확인·점수", () => {
  const file = loadFaults(undefined, ALL);
  assert.equal(file.faults.length, 4);
  assert.deepEqual(file.faults.map((f) => f.section), ["ironmaking", "steelmaking", "continuous_casting", "rolling"]);
  assert.throws(() => loadFaults(undefined, new Set(["coiler"])), /없는 설비 id/);
  // 신호 정답이 범위 밖 값과 다르면 막는다
  const raw = JSON.parse(readFileSync(FAULTS_PATH, "utf8"));
  raw.faults[0].signal.answer = ["blast_pressure"];
  const dir = mkdtempSync(join(tmpdir(), "faults-"));
  writeFileSync(join(dir, "f.json"), JSON.stringify(raw));
  assert.throws(() => loadFaults(join(dir, "f.json")), /신호 정답/);

  const f = file.faults[0];
  const view = faultView(f, "u1");
  assert.ok(!JSON.stringify(view).includes(f.cause.explain), "보기 화면에는 해설이 없다");
  assert.ok(!("fixed" in view.readings[0]), "조치 후 값은 맞히기 전에는 없다");
  assert.equal(checkStep(f, "signal", "blast_pressure").correct, false);
  assert.deepEqual(checkStep(f, "signal", f.signal.answer[0]), { correct: true, explain: f.signal.explain, abnormal: f.signal.answer });
  const cause = checkStep(f, "cause", f.cause.answer) as { chain: string[] };
  assert.deepEqual(cause.chain, ["coke_oven", "blast_furnace", "taphole_casthouse"]);
  const wrong = checkStep(f, "action", 1) as { consequence: string };
  assert.match(wrong.consequence, /식어요/);
  const right = checkStep(f, "action", f.action.answer) as { fixed: Record<string, number>; downstream: { equipment_id: string }; whatif: unknown };
  assert.equal(right.fixed.hm_temp, 1505);
  assert.equal(right.downstream.equipment_id, "bof_converter");
  assert.ok(right.whatif);
  assert.equal(faultScore({ signal: 1, cause: 1, action: 1 }), 1);
  assert.equal(faultScore({ signal: 1, cause: 2, action: 4 }), 0.58);
});

// ── HTTP ──
const secret = new TextEncoder().encode("sim-test-secret-sim-test-secret-sim-test");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let kim: User;

before(async () => {
  const users = new UserRepository(db);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  const deck = buildDeck([{ id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로", role: "용선을 만든다." }] }], () => []);
  const app = express();
  app.use(createLabExtrasRouter({ db, auth: { users, secret }, deck, incidents: loadIncidents(), faults: loadFaults(), lessons: (await import("../src/lab/lessons.js")).loadLessons() }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${await signToken(kim, secret)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};

test("HTTP 이상 상황: 목록 → 보기 → 단계 확인 → 완료 기록·최고 점수, What-if는 원인별 효과와 다음 공정 영향을 준다", async () => {
  const list = await call("GET", "/api/lab/faults");
  assert.equal(list.json.faults.length, 4);
  const id = list.json.faults[1].id;
  const view = await call("GET", `/api/lab/faults/${id}`);
  assert.equal(view.json.fault.readings.length, 4);
  assert.equal((await call("POST", `/api/lab/faults/${id}/check`, { step: "cause", key: "x".repeat(50) })).status, 400);
  const answer = loadFaults().faults[1].cause.answer;
  const cause = await call("POST", `/api/lab/faults/${id}/check`, { step: "cause", key: answer });
  assert.ok(cause.json.chain.includes("bof_converter"));
  const done = await call("POST", `/api/lab/faults/${id}/complete`, { tries: { signal: 1, cause: 1, action: 2 } });
  assert.equal(done.json.score, 0.83);
  assert.equal((await call("GET", "/api/lab/faults")).json.faults[1].best, 0.83);
  assert.equal((await call("GET", "/api/lab/faults/nope")).status, 404);
  const wi = await call("POST", "/api/lab/whatif", { coke_kg: 290, pci_kg: 120 });
  assert.ok(wi.json.effects.length === 2 && wi.json.downstream.length >= 1);
  // 인과 퀴즈 칸 채점은 기록되고, 사원증 기록(cardEvents)에 맞힌 칸·끝낸 훈련이 들어간다
  await call("POST", "/api/lab/causal/quiz/check", { chain_id: "coke_rate>hm_temp>scrap_pct", dir: 1, hop: 1, choice: "up" });
  await call("POST", "/api/lab/causal/quiz/check", { chain_id: "coke_rate>hm_temp>scrap_pct", dir: 1, hop: 2, choice: "down" });
  const kinds = new MeRepository(db).cardEvents(kim.id).map((e) => e.kind);
  assert.deepEqual([kinds.filter((k) => k === "causal_correct").length, kinds.filter((k) => k === "fault_drill").length], [1, 1]);
  assert.ok(deleteUserData(db, kim.id, { origin: "live" }).operations >= 3, "이상 상황·퀴즈 기록도 지운다");
});

test("사고 사례 갈림길: 사례마다 1개 이상, 갈림길마다 실제 선택 하나와 다른 선택, 다른 선택의 결과는 실제와 다르다", () => {
  const file = loadIncidents();
  for (const s of file.scenarios) {
    const branches = s.timeline.filter((t) => t.branch);
    assert.ok(branches.length >= 1, s.id);
    for (const t of branches) {
      const opts = t.branch!.options;
      assert.equal(opts.filter((o) => o.actual).length, 1);
      assert.ok(opts.some((o) => !o.actual));
      assert.ok(opts.filter((o) => !o.actual).every((o) => !o.outcome.startsWith("실제로")));
    }
  }
});

test("3D 실습 통계: 이상 상황 단계별 시도·사고 사례 약한 문항·인과 퀴즈 한 칸/두 칸·헷갈리는 연결, 시연 계정 빼기, 관리자만", async () => {
  const sdb = openDatabase(":memory:"), users = new UserRepository(sdb);
  const a = await users.create({ username: "trainee02", password: "password123", name: "가", employee_no: "S2" });
  const b = await users.create({ username: "trainee03", password: "password123", name: "나", employee_no: "S3" });
  sdb.prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(b.id);
  const faults = loadFaults().faults, scenarios = loadIncidents().scenarios, f = faults[0], s = scenarios[0];
  const now = new Date().toISOString();
  const addFault = (u: User, tries: Record<string, number>) => sdb.prepare("INSERT INTO fault_attempts VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), u.id, f.id, JSON.stringify(tries), faultScore(tries as never), now);
  addFault(a, { signal: 1, cause: 3, action: 1 });
  addFault(b, { signal: 1, cause: 1, action: 1 });
  const answers = Object.fromEntries(s.questions.map((q) => [q.id, q.answer]));
  answers[s.questions[0].id] = (s.questions[0].answer + 1) % s.questions[0].options.length;
  sdb.prepare("INSERT INTO incident_attempts VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), a.id, s.id, JSON.stringify({ answers }), 0.5, now);
  const quiz = (u: User, hop: number, correct: number) => sdb.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run(crypto.randomUUID(), u.id, "coke_rate>hm_temp>scrap_pct", hop, correct, now);
  quiz(a, 1, 1); quiz(b, 1, 1); quiz(a, 2, 0); quiz(b, 2, 1);
  const { practiceStats } = await import("../src/lab/practice-stats.js");
  const all = practiceStats(sdb, { faults, scenarios });
  assert.deepEqual([all.faults[0].attempts, all.faults[0].learners, all.faults[0].hardest_step, all.faults[0].first_try_rate], [2, 2, "cause", 0.5]);
  assert.equal(all.faults[1].avg_score, null);
  assert.equal(all.incidents[0].weakest?.id, s.questions[0].id);
  assert.deepEqual([all.causal.one_hop, all.causal.two_hop, all.causal.cross_process], [1, 0.5, 0.5]);
  assert.deepEqual(all.causal.confusing.map((l) => [l.path, l.rate]), [["코크스비 → 용선 온도 → 전로 고철 투입 여유", 0.5]]);
  const real = practiceStats(sdb, { faults, scenarios }, { includeDemo: false });
  assert.deepEqual([real.faults[0].attempts, real.causal.answers, real.causal.confusing.length], [1, 2, 0], "시연 계정 기록은 빠지고 헷갈리는 연결은 답 2칸 미만이라 없다");
  assert.equal((await call("GET", "/api/admin/practice-stats")).status, 403, "신입사원은 볼 수 없다");
});

test("오늘의 실습 경로: 기록이 없으면 제선부터, 틀린 퀴즈·낮은 훈련 점수가 있는 공정을 고르고 틀린 칸의 변수를 먼저 보게 한다", async () => {
  const { practicePath } = await import("../src/lab/practice-path.js");
  const { causalQuiz, NODES } = await import("../src/lab/causal.js");
  const pdb = openDatabase(":memory:"), u = await new UserRepository(pdb).create({ username: "trainee04", password: "password123", name: "다", employee_no: "S4" });
  const faults = loadFaults().faults, now = new Date().toISOString();
  const empty = practicePath(pdb, u.id, faults);
  assert.equal(empty.process, "ironmaking");
  assert.match(empty.reason, /아직 안 해 봤어요/);
  assert.deepEqual(empty.steps.map((s) => s.kind), ["map", "quiz", "fault"]);
  assert.ok(empty.steps.every((s) => s.href.startsWith("/3d-demo/Steel%20Academy%20v4.dc.html?p=ironmaking&lab=")));
  // 제강이 걸린 칸을 틀리고 제강 훈련 점수가 낮다
  pdb.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run("q1", u.id, "coke_rate>hm_temp>scrap_pct", 2, 0, now);
  const steel = faults.find((f) => f.section === "steelmaking")!;
  pdb.prepare("INSERT INTO fault_attempts VALUES(?,?,?,?,?,?)").run("f1", u.id, steel.id, "{}", 0.33, now);
  const path = practicePath(pdb, u.id, faults);
  assert.equal(path.process, "steelmaking");
  assert.match(path.steps[0].href, /lab=map&var=scrap_pct$/, "틀린 칸이 지난 제강 변수");
  assert.match(path.steps[2].href, new RegExp(`lab=fault&fault=${steel.id}$`));
  assert.match(path.reason, /정답률이 0%/);
  assert.equal(path.processes.find((p) => p.process === "steelmaking")?.fault_best, 0.33);
  // 공정을 주면 그 공정 변수가 든 길이 먼저 나온다
  const rolling = new Set(NODES.filter((n) => n.process === "rolling").map((n) => n.id));
  assert.ok(causalQuiz(7, 5, "rolling").slice(0, 1).every((c) => c.nodes.some((n) => rolling.has(n.id))));
  assert.equal((await call("GET", "/api/lab/practice-path")).status, 200);
});

test("이상 상황 → 인과 지도 재현: 훈련마다 조정 값이 있고, 그 값으로 인과 지도를 돌리면 그 공정에 정상 범위 밖 값이 생긴다", async () => {
  const { simulateCausal } = await import("../src/lab/causal.js");
  for (const f of loadFaults().faults) {
    assert.ok(f.causal, `${f.id}: causal`);
    const r = simulateCausal(f.causal);
    assert.ok(r.nodes.some((n) => n.process === f.section && n.status === "warn"), `${f.id}: ${f.section}에 범위 밖 값`);
    assert.ok(r.story.length >= 2, `${f.id}: 따라갈 단계가 2개 이상`);
    const action = checkStep(f, "action", f.action.answer) as { causal: unknown };
    assert.deepEqual(action.causal, f.causal, "조치를 맞히면 재현 값을 준다");
  }
  // 조정할 수 없는 값·범위 밖 값은 파일 검사에서 막는다
  const raw = JSON.parse(readFileSync(FAULTS_PATH, "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "faults-causal-"));
  raw.faults[0].causal = { hm_temp: 1400 };
  writeFileSync(join(dir, "a.json"), JSON.stringify(raw));
  assert.throws(() => loadFaults(join(dir, "a.json")), /조정할 수 없는 값/);
  raw.faults[0].causal = { coke_rate: 999 };
  writeFileSync(join(dir, "b.json"), JSON.stringify(raw));
  assert.throws(() => loadFaults(join(dir, "b.json")), /범위/);
});

test("HTTP 갈림길 탐험: 같은 선택은 한 번만 남고, 실제로 일어난 선택은 사원증 기록에서 빼며, 없는 장면·선택은 404", async () => {
  const s = loadIncidents().scenarios[0], at = s.timeline.findIndex((t) => t.branch), opts = s.timeline[at].branch!.options;
  const actual = opts.findIndex((o) => o.actual), other = opts.findIndex((o) => !o.actual);
  const first = await call("POST", `/api/lab/incidents/${s.id}/branch`, { at, pick: other });
  assert.deepEqual([first.status, first.json.explored, first.json.new], [201, 1, true]);
  assert.equal((await call("POST", `/api/lab/incidents/${s.id}/branch`, { at, pick: other })).status, 200, "같은 선택은 다시 세지 않는다");
  assert.equal((await call("POST", `/api/lab/incidents/${s.id}/branch`, { at, pick: actual })).json.explored, 2);
  assert.equal((await call("POST", `/api/lab/incidents/${s.id}/branch`, { at: 0, pick: 0 })).status, at === 0 ? 201 : 404);
  assert.equal((await call("POST", `/api/lab/incidents/${s.id}/branch`, { at, pick: 9 })).status, 404);
  assert.equal((await call("POST", `/api/lab/incidents/nope/branch`, { at, pick: 0 })).status, 404);
  const events = new MeRepository(db).cardEvents(kim.id).filter((e) => e.kind === "branch_explored");
  assert.deepEqual(events.map((e) => e.object_id), [`${s.id}#${at}.${other}`], "실제 선택은 XP·배지에 넣지 않는다");
  assert.ok(deleteUserData(db, kim.id, { origin: "live" }).operations >= 1);
  assert.equal(new MeRepository(db).cardEvents(kim.id).filter((e) => e.kind === "branch_explored").length, 0);
});

test("내 3D 실습 요약: 퀴즈 칸·정답률, 끝낸 훈련 종류·만점, 골라 본 갈림길 수와 전체 선택 수", async () => {
  const { practicePath } = await import("../src/lab/practice-path.js");
  const pdb = openDatabase(":memory:"), u = await new UserRepository(pdb).create({ username: "trainee06", password: "password123", name: "라", employee_no: "S6" });
  const faults = loadFaults().faults, scenarios = loadIncidents().scenarios, now = new Date().toISOString();
  const empty = practicePath(pdb, u.id, faults, scenarios).summary;
  const totalOptions = scenarios.reduce((n, s) => n + s.timeline.reduce((m, t) => m + (t.branch?.options.length ?? 0), 0), 0);
  assert.deepEqual(empty, { quiz_answers: 0, quiz_rate: null, faults_done: 0, faults_total: 4, faults_perfect: 0, branches_explored: 0, branches_total: totalOptions });
  pdb.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run("a", u.id, "coke_rate>hm_temp>scrap_pct", 1, 1, now);
  pdb.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run("b", u.id, "coke_rate>hm_temp>scrap_pct", 2, 0, now);
  pdb.prepare("INSERT INTO fault_attempts VALUES(?,?,?,?,?,?)").run("f1", u.id, faults[0].id, "{}", 1, now);
  pdb.prepare("INSERT INTO fault_attempts VALUES(?,?,?,?,?,?)").run("f2", u.id, faults[1].id, "{}", 0.5, now);
  pdb.prepare("INSERT INTO branch_explorations VALUES(?,?,?,?,?,?,?)").run("x", u.id, scenarios[0].id, 1, 1, 0, now);
  const s = practicePath(pdb, u.id, faults, scenarios).summary;
  assert.deepEqual([s.quiz_answers, s.quiz_rate, s.faults_done, s.faults_perfect, s.branches_explored], [2, 0.5, 2, 1, 1]);
  assert.ok(totalOptions >= 16, "사례 4개 × 갈림길 2개 × 선택 2개 이상");
});

test("수업 모드: 수업 파일의 참조(변수·이상 상황·갈림길)가 맞고, 진행자 안내의 인과 설명이 모델과 맞는다, 잘못된 참조는 막는다", async () => {
  const { loadLessons, LESSONS_PATH } = await import("../src/lab/lessons.js");
  const { simulateCausal } = await import("../src/lab/causal.js");
  const refs = { faults: loadFaults().faults, scenarios: loadIncidents().scenarios };
  const lessons = loadLessons(undefined, refs);
  assert.deepEqual(lessons.map((l) => l.id), ["causal-101", "diagnose-drill"]);
  // 'diagnose-drill' 1·2단계 안내: 재가열 온도↓는 사상압연 출구·권취 온도를 함께 내리고, 냉각 뱅크↑는 권취 온도만 내린다
  const v = (input: Record<string, number>, id: string) => simulateCausal(input).nodes.find((n) => n.id === id)!.delta;
  assert.ok(v({ reheat_temp: 1160 }, "fdt") < 0 && v({ reheat_temp: 1160 }, "coiling_temp") < 0);
  assert.ok(v({ cool_banks: 15 }, "coiling_temp") < 0 && v({ cool_banks: 15 }, "fdt") === 0);
  const raw = JSON.parse(readFileSync(LESSONS_PATH, "utf8"));
  const dir = mkdtempSync(join(tmpdir(), "lessons-"));
  const bad = (mutate: (j: any) => void, re: RegExp) => { const j = structuredClone(raw); mutate(j); const f = join(dir, `${Math.random()}.json`); writeFileSync(f, JSON.stringify(j)); assert.throws(() => loadLessons(f, refs), re); };
  bad((j) => { j.lessons[0].steps[4].fault = "nope"; }, /없는 이상 상황/);
  bad((j) => { j.lessons[0].steps[5].pick = 9; }, /없는 사고 사례 갈림길/);
  bad((j) => { j.lessons[0].steps[1].set = { hm_temp: 1400 }; }, /조정할 수 없는 값/);
  bad((j) => { delete j.lessons[0].steps[1].set; }, /조건\(set\)/);
  bad((j) => { j.lessons[1].id = "causal-101"; }, /겹칩니다/);
});

test("HTTP 수업: 목록은 단계 수만, 하나는 단계 전체, 없는 수업 404", async () => {
  const list = await call("GET", "/api/lab/lessons");
  assert.equal(list.json.lessons[0].steps, 6);
  const one = await call("GET", "/api/lab/lessons/causal-101");
  assert.equal(one.json.lesson.steps[1].lab, "map");
  assert.equal((await call("GET", "/api/lab/lessons/nope")).status, 404);
});

test("개념 → 인과 지도 변수: 표의 개념은 final 루브릭에 있고 변수는 같은 공정의 인과 지도 변수, API는 개념마다 공정·변수를 준다", async () => {
  const { CONCEPT_VARS, NODES, conceptVars } = await import("../src/lab/causal.js");
  const { loadFinalRubrics } = await import("../src/rubrics.js");
  const { loadDemoSections } = await import("../src/demo-sections.js");
  const finals = loadFinalRubrics().flatMap((r) => r.concepts.map((c) => ({ id: c.concept_id, section: r.section })));
  const demos = Object.entries(loadDemoSections()).flatMap(([section, list]) => (list ?? []).map((c) => ({ id: c.id, section })));
  const concepts = [...finals, ...demos];
  for (const [cid, vars] of Object.entries(CONCEPT_VARS)) {
    const c = concepts.find((x) => x.id === cid);
    assert.ok(c, `${cid}는 final 루브릭 또는 시연 개념`);
    for (const v of vars) assert.equal(NODES.find((n) => n.id === v)?.process, c!.section, `${cid} → ${v}`);
  }
  assert.deepEqual(conceptVars("unknown_concept", ["torpedo_car"]), ["hm_s"], "표에 없으면 같은 설비의 변수");
  const res = await call("GET", "/api/lab/causal/concepts");
  assert.deepEqual(res.json.concepts.coke_reduction, { section: "ironmaking", vars: ["coke_rate", "hm_temp"] });
  assert.equal(Object.keys(res.json.concepts).length, concepts.length, "final 3개 + 시연 9개 모두 연결");
  assert.deepEqual(res.json.concepts.demo_cooling_coiling, { section: "rolling", vars: ["cool_banks", "coiling_temp"] });
});

test("3D 실습 통계 · 수업: 수업별 연 사람·끝 단계까지 간 사람·단계별 사람 수(xAPI 수업 열람 기록)", async () => {
  const { practiceStats } = await import("../src/lab/practice-stats.js");
  const { loadLessons } = await import("../src/lab/lessons.js");
  const sdb = openDatabase(":memory:"), users = new UserRepository(sdb);
  const a = await users.create({ username: "trainee07", password: "password123", name: "마", employee_no: "S7" });
  const b = await users.create({ username: "trainee08", password: "password123", name: "바", employee_no: "S8" });
  const add = (u: User, step: number) => sdb.prepare("INSERT INTO xapi_statements (id, user_id, verb, object_id, object_name, timestamp, stored) VALUES (?, ?, 'experienced', ?, 'x', ?, ?)")
    .run(crypto.randomUUID(), u.id, `practice:lesson:causal-101_${step}`, "2026-10-16T00:00:00Z", "2026-10-16T00:00:00Z");
  for (const s of [1, 2, 3, 4, 5, 6]) add(a, s);
  add(a, 1); add(b, 1); add(b, 2);
  const st = practiceStats(sdb, { faults: [], scenarios: [], lessons: loadLessons() });
  const l = st.lessons.find((x) => x.id === "causal-101")!;
  assert.deepEqual([l.learners, l.finished, l.by_step.map((x) => x.learners)], [2, 1, [2, 2, 1, 1, 1, 1]]);
  assert.equal(st.lessons.find((x) => x.id === "diagnose-drill")!.learners, 0);
});
