// 운영 기능(012): 자료 검수 워크플로, 작업 대기열 일반화, 알림, 사고 사례, What-if, 설비 주석 공유, 오답 패턴, 채점 근거 하이라이트.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { deleteUserData } from "../src/db/user-data.js";
import { highlightAnswer, clauses } from "../src/education/highlights.js";
import { EducationJobs } from "../src/education/jobs.js";
import { createJobRouter } from "../src/education/job-routes.js";
import { lineDiff, MaterialWorkflow, stageOf } from "../src/education/workflow.js";
import { createWorkflowRouter, materialCheckJob } from "../src/education/workflow-routes.js";
import { buildDeck } from "../src/lab/deck.js";
import { createLabExtrasRouter } from "../src/lab/extras-routes.js";
import { gradeIncident, loadIncidents, scenarioView, shuffledKeys } from "../src/lab/incidents.js";
import { ASSUMPTIONS, BASELINE, normalizeInput, simulate, whatIf } from "../src/lab/whatif.js";
import { Notifier } from "../src/notify/service.js";
import { createNotifyRouter } from "../src/notify/routes.js";
import { clusterTexts } from "../src/ops/patterns.js";
import { createOpsRouter } from "../src/ops/routes.js";
import type { CardEvent } from "../src/me/employee-card.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 순수 계산 ──
test("검수 단계: 기록으로 정하고, 승인·반려는 자료 상태가 정한다", () => {
  assert.equal(stageOf("draft", []), "draft");
  assert.equal(stageOf("draft", [{ action: "created" }, { action: "submitted" }]), "in_review");
  assert.equal(stageOf("draft", [{ action: "submitted" }, { action: "changes_requested" }, { action: "commented" }]), "changes_requested");
  assert.equal(stageOf("approved", [{ action: "submitted" }]), "approved");
  assert.deepEqual(lineDiff("a\nb\nc", "a\nB\nc\nd").map((d) => `${d.op}:${d.text}`), ["same:a", "del:b", "add:B", "same:c", "add:d"]);
});

test("What-if: 기준 조건은 슬래그 175~350kg·염기도 1.0~1.2(BREF)·1,500℃, 펠릿이 늘면 슬래그가 줄고 연료가 늘면 온도가 오른다", () => {
  const base = simulate(BASELINE);
  assert.ok(base.slag_kg >= 175 && base.slag_kg <= 350, String(base.slag_kg));
  assert.ok(base.basicity >= 1.0 && base.basicity <= 1.2, String(base.basicity));
  assert.equal(base.fuel_rate_kg, 480, "JFE 코크스 380 + 미분탄 100kg/t");
  // 화면에 보이는 가정마다 출처(BREF·JFE)나 '가정'을 밝힌다(단순화 설명인 CO2 줄은 예외).
  for (const line of ASSUMPTIONS.filter((l) => !l.startsWith("CO2"))) assert.match(line, /BREF|JFE|가정/, line);
  assert.equal(base.hot_metal_temp_c, 1500);
  assert.deepEqual(base.warnings, []);
  const pellet = whatIf({ sinter_pct: 30, pellet_pct: 60, lump_pct: 10 }).result;
  assert.ok(pellet.slag_kg < base.slag_kg);
  assert.ok(whatIf({ coke_kg: 400 }).result.hot_metal_temp_c > 1500);
  assert.ok(whatIf({ coke_kg: 280, pci_kg: 100 }).result.warnings.some((w) => w.includes("연료비")));
  // 비율 합을 100으로 맞추고 범위를 벗어난 값은 자른다
  const n = normalizeInput({ sinter_pct: 50, pellet_pct: 50, lump_pct: 100, coke_kg: 9999 });
  assert.equal(Math.round(n.sinter_pct + n.pellet_pct + n.lump_pct), 100);
  assert.equal(n.coke_kg, 550);
});

test("사고 사례: 파일 형식·설비 id 확인, 보기 순서는 사람마다 같게 섞고 채점은 원래 key로", () => {
  const known = new Set(["taphole_casthouse", "blast_furnace", "bof_converter", "tapping_ladle_crane", "ladle_turret", "cc_mold", "secondary_cooling", "finishing_mill", "runout_table"]);
  const file = loadIncidents(undefined, known);
  assert.equal(file.scenarios.length, 4);
  assert.throws(() => loadIncidents(undefined, new Set(["x"])), /없는 설비 id/);
  const keys = shuffledKeys("u1", "s", "q", 4);
  assert.deepEqual([...keys].sort(), [0, 1, 2, 3]);
  assert.deepEqual(shuffledKeys("u1", "s", "q", 4), keys);
  const s = file.scenarios[0];
  const view = scenarioView(s, "u1");
  assert.ok(!JSON.stringify(view).includes("explain"), "보기 화면에는 해설이 없다");
  const right = Object.fromEntries(s.questions.map((q) => [q.id, q.answer]));
  assert.equal(gradeIncident(s, right).score, 1);
  assert.equal(gradeIncident(s, {}).score, 0);
});

test("오답 패턴: 비슷한 설명끼리 묶고 낱말 이름표를 단다", () => {
  const items = [
    { id: "1", user_id: "a", text: "코크스가 불순물을 없애는 역할이라고 오해", resolved: false },
    { id: "2", user_id: "b", text: "코크스는 불순물 제거용이라고 생각함", resolved: true },
    { id: "3", user_id: "c", text: "소결은 쇳물을 만드는 공정이라고 오해", resolved: false },
    { id: "4", user_id: "a", text: "소결 공정에서 쇳물을 만든다고 답함", resolved: false },
  ];
  const groups = clusterTexts(items);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.count === 2));
  assert.ok(groups.some((g) => g.keywords.includes("코크스")));
  assert.ok(groups.some((g) => g.keywords.includes("쇳물")));
});

test("채점 근거 하이라이트: 핵심 요소를 말한 구절, 동의어, 평가자 근거를 표시한다", () => {
  const points = ["소결은 가루 철광석을 덩어리로 만든다.", "덩어리가 되면 고로 안에서 바람이 잘 통한다."];
  const answer = "소결은 가루 철광석을 구워서 덩어리로 만들어요. 그래서 고로 안에서 바람이 잘 통하게 돼요. 색깔은 잘 모르겠어요.";
  const out = highlightAnswer(answer, points, [], "바람이 잘 통하게");
  assert.equal(out.segments.map((s) => s.text).join(""), answer, "조각을 이으면 원문");
  assert.deepEqual(out.key_points.map((k) => k.matched), [true, true]);
  assert.ok(out.segments.some((s) => s.evidence && s.text.includes("바람이")));
  assert.ok(out.segments.some((s) => s.kp === null && s.text.includes("색깔")));
  const alias = highlightAnswer("쇳물이 아래로 모여요.", ["용선이 노 아래에 모인다."], [{ term: "용선", aliases: ["쇳물"] }]);
  assert.equal(alias.key_points[0].matched, true);
  assert.equal(clauses("가, 나. 다").length, 3);
});

// ── HTTP ──
const secret = new TextEncoder().encode("ops-test-secret-ops-test-secret-ops-test");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let admin: User, admin2: User, kim: User, lee: User;
let jobs: EducationJobs;
let notifier: Notifier;
let clock = new Date("2026-10-15T03:00:00Z"); // 한국 시간 12:00
const sent: unknown[] = [];
const events: Record<string, CardEvent[]> = {};

before(async () => {
  process.env.JOB_RETRY_BASE_MS = "20";
  const users = new UserRepository(db);
  admin = await users.create({ username: "admin01", password: "password123", name: "관리자", employee_no: "A1", role: "admin" } as never);
  admin2 = await users.create({ username: "admin02", password: "password123", name: "관리자둘", employee_no: "A2", role: "admin" } as never);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  db.prepare("UPDATE users SET role='admin' WHERE id IN (?, ?)").run(admin.id, admin2.id);
  admin = { ...admin, role: "admin" }; admin2 = { ...admin2, role: "admin" };
  const auth = { users, secret };
  jobs = new EducationJobs(db);
  notifier = new Notifier({ db, now: () => clock, cardEvents: (id) => events[id] ?? [], passed: () => false,
    env: { NOTIFY_MESSENGER_WEBHOOK: "https://hooks.example.test/x" }, fetch: (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("ok"); }) as never });
  const workflow = new MaterialWorkflow(db);
  const deck = buildDeck([{ id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로", role: "철광석을 녹여 용선을 만든다." }, { id: "taphole_casthouse", name: "출선구", role: "용선을 꺼낸다." }] }], () => []);
  const incidents = { disclaimer: "가상", scenarios: [loadIncidents().scenarios[0]] };
  const app = express();
  app.use(express.json());
  app.use(createJobRouter(auth, jobs));
  app.use(createWorkflowRouter({ auth, jobs, notifier }, workflow));
  app.use(createNotifyRouter(auth, notifier));
  app.use(createOpsRouter(auth, db));
  app.use(createLabExtrasRouter({ db, auth, deck, incidents, notifier }));
  // 자료 등록은 기존 API 대신 직접 넣는다(routes.ts의 등록과 같은 기록)
  app.post("/test/material", (req, res) => {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO education_materials(id,section,title,body,source_url,publisher,version,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)")
      .run(id, "ironmaking", req.body.title, req.body.body, "https://example.test/a", "테스트", "v1", req.body.by, new Date().toISOString());
    workflow.log(id, req.body.by, "created");
    res.json({ id });
  });
  jobs.register("material-check", materialCheckJob(workflow));
  jobs.register("test-flaky", { role: "any", label: "테스트", maxAttempts: 3, run: (() => { let n = 0; return async () => { n++; if (n < 3) throw new Error("잠시 오류(연결 끊김)"); return { tries: n }; }; })() });
  jobs.register("test-admin", { role: "admin", label: "관리자 테스트", run: async () => ({ ok: true }) });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { jobs.dispose(); server.close(); });

const call = async (method: string, path: string, user?: User, body?: unknown) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${await signToken(user, secret)}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};

test("HTTP 자료 검수: 초안 → 검수 요청 → 수정 요청 → 수정본 → 검수 요청 → 승인, 단계가 틀리면 409, 알림과 검수 도우미", async () => {
  const { json: { id } } = await call("POST", "/test/material", undefined, { title: "고로 개요", body: "고로는 철광석을 녹인다.\n열풍은 1,200℃다.", by: admin.id });
  assert.equal((await call("POST", `/api/admin/education/materials/${id}/submit`, kim)).status, 403);
  assert.equal((await call("POST", `/api/admin/education/materials/${id}/request-changes`, admin, { comment: "x" })).status, 409, "검수 요청 전에는 수정 요청 불가");
  const sub = await call("POST", `/api/admin/education/materials/${id}/submit`, admin, { comment: "검수 부탁" });
  assert.equal(sub.json.stage, "in_review");
  assert.equal((await call("GET", "/api/me/notifications", admin2)).json.notifications[0].kind, "material_review", "다른 관리자에게 검수 요청 알림");
  const changes = await call("POST", `/api/admin/education/materials/${id}/request-changes`, admin2, { comment: "출처 보강" });
  assert.equal(changes.json.stage, "changes_requested");
  const revised = await call("POST", `/api/admin/education/materials/${id}/revise`, admin, { body: "고로는 철광석을 녹인다.\n열풍은 약 1,200℃다.", comment: "수치 보강" });
  assert.equal(revised.status, 201);
  assert.equal(revised.json.parent_id, id);
  assert.ok(revised.json.diff.some((d: any) => d.op === "add" && d.text.includes("약")));
  const child = revised.json.material.id;
  await call("POST", `/api/admin/education/materials/${child}/submit`, admin);
  const check = await call("POST", `/api/admin/education/materials/${child}/check`, admin);
  assert.equal(check.status, 202);
  for (let i = 0; i < 50 && (await call("GET", `/api/jobs/${check.json.id}`, admin)).json.state !== "succeeded"; i++) await wait(10);
  const done = await call("GET", `/api/jobs/${check.json.id}`, admin);
  assert.ok(done.json.result.notes.some((n: any) => n.text.includes("수치")));
  const list = await call("GET", "/api/admin/education/materials/workflow?stage=in_review", admin);
  assert.deepEqual(list.json.materials.map((m: any) => m.id), [child]);
  assert.equal(list.json.counts.changes_requested, 1);
  const detail = await call("GET", `/api/admin/education/materials/${child}/workflow`, admin);
  assert.deepEqual(detail.json.events.map((e: any) => e.action), ["created", "submitted", "checked"]);
});

test("HTTP 작업 대기열: 일시 오류는 다시 시도해 성공, 관리자 종류는 403, 목록·통계, 끝나면 완료 알림", async () => {
  jobs.onSettled = (job) => { notifier.notify(job.user_id, "job_done", "작업 완료", "", null, `job_done:${job.id}`); };
  const kinds = await call("GET", "/api/jobs/kinds", kim);
  assert.ok(kinds.json.kinds.some((k: any) => k.kind === "test-flaky"));
  assert.ok(!kinds.json.kinds.some((k: any) => k.kind === "test-admin"));
  assert.equal((await call("POST", "/api/jobs", kim, { kind: "test-admin" })).status, 403);
  assert.equal((await call("POST", "/api/jobs", kim, { kind: "nope" })).status, 404);
  const job = await call("POST", "/api/jobs", kim, { kind: "test-flaky" });
  assert.equal(job.status, 202);
  let state = job.json;
  for (let i = 0; i < 100 && state.state !== "succeeded"; i++) { await wait(15); state = (await call("GET", `/api/jobs/${job.json.id}`, kim)).json; }
  assert.equal(state.state, "succeeded");
  assert.deepEqual([state.attempts, state.result.tries, state.progress], [3, 3, 1]);
  assert.equal((await call("GET", `/api/jobs/${job.json.id}`, lee)).status, 404, "다른 학습자는 못 본다");
  assert.equal((await call("GET", `/api/jobs/${job.json.id}`, admin)).status, 200, "관리자는 본다");
  const adminList = await call("GET", "/api/admin/jobs?kind=test-flaky", admin);
  assert.equal(adminList.json.jobs.length, 1);
  assert.ok(adminList.json.stats.by_state.succeeded >= 1);
  assert.equal((await call("GET", "/api/admin/jobs", kim)).status, 403);
  const notes = await call("GET", "/api/me/notifications", kim);
  assert.ok(notes.json.notifications.some((n: any) => n.kind === "job_done"));
});

test("HTTP 알림: 복습·배정 시험·연속 학습일 알림은 하루 한 번, 끈 종류는 안 만들고, 켠 채널로 발송", async () => {
  db.prepare("DELETE FROM notifications WHERE user_id=?").run(lee.id);
  const attempt = crypto.randomUUID();
  db.prepare("INSERT INTO attempts(id,user_id,section,kind,state,concept_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run(attempt, lee.id, "ironmaking", "first", "completed", "[]", clock.toISOString(), clock.toISOString());
  db.prepare("INSERT INTO review_tasks(id,user_id,section,concept_id,concept_name,due_date,reason,based_attempt,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(crypto.randomUUID(), lee.id, "ironmaking", "c1", "소결의 목적", "2026-10-15", "다시 확인", attempt, clock.toISOString());
  const group = crypto.randomUUID();
  db.prepare("INSERT INTO education_groups(id,name,created_by,created_at) VALUES(?,?,?,?)").run(group, "1기", admin.id, clock.toISOString());
  db.prepare("INSERT INTO education_members(group_id,user_id) VALUES(?,?)").run(group, lee.id);
  db.prepare("INSERT INTO education_assignments(id,group_id,section,title,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(), group, "ironmaking", "제선 평가", "2026-10-16", admin.id, clock.toISOString());
  // 메신저를 켠다
  assert.equal((await call("PUT", "/api/me/notification-prefs", lee, { browser: true, email: true, email_address: "", messenger: true, kinds: {} })).status, 400, "메일을 켜면 주소가 필요");
  await call("PUT", "/api/me/notification-prefs", lee, { browser: true, email: false, email_address: "", messenger: true, kinds: { streak_risk: true } });
  const first = await call("GET", "/api/me/notifications", lee);
  assert.deepEqual(first.json.notifications.map((n: any) => n.kind).sort(), ["assignment_due", "review_due"]);
  assert.match(first.json.notifications.find((n: any) => n.kind === "assignment_due").title, /내일/);
  assert.equal((await call("GET", "/api/me/notifications", lee)).json.notifications.length, 2, "같은 날 다시 읽어도 늘지 않는다");
  // 저녁 7시, 어제까지 이어진 연속 학습일
  events[lee.id] = [{ kind: "question", at: "2026-10-14T01:00:00Z" }];
  clock = new Date("2026-10-15T10:00:00Z");
  const evening = await call("GET", "/api/me/notifications", lee);
  assert.ok(evening.json.notifications.some((n: any) => n.kind === "streak_risk"));
  assert.equal(evening.json.unread, 3);
  // 종류를 끄면 만들지 않는다
  await call("PUT", "/api/me/notification-prefs", lee, { browser: true, email: false, email_address: "", messenger: true, kinds: { review_due: false } });
  clock = new Date("2026-10-16T03:00:00Z");
  const next = await call("GET", "/api/me/notifications", lee);
  assert.ok(!next.json.notifications.some((n: any) => n.kind === "review_due" && n.dedupe_key.endsWith("2026-10-16")));
  // 발송: 메신저 웹훅으로 보내고 기록
  const run = await call("POST", "/api/admin/notifications/run", admin);
  assert.ok(run.json.delivery.sent >= 3);
  assert.ok((sent[0] as any).text.startsWith("[ST-ROOKIE]"));
  assert.ok((await call("GET", "/api/admin/notifications/outbox", admin)).json.deliveries.every((d: any) => d.channel === "messenger"));
  assert.equal((await call("POST", "/api/me/notifications/read-all", lee)).json.read > 0, true);
});

test("HTTP 설비 메모: 공개·비공개, 이름 가림, 공감 토글, 답글 알림, 신고 3번이면 숨김, 관리자 복구", async () => {
  const pub = await call("POST", "/api/lab/notes", kim, { equipment_id: "blast_furnace", kind: "question", text: "장입은 몇 층으로 하나요?", visibility: "public" });
  assert.equal(pub.status, 201);
  await call("POST", "/api/lab/notes", kim, { equipment_id: "blast_furnace", kind: "memo", text: "나만 볼 메모", visibility: "private" });
  assert.equal((await call("POST", "/api/lab/notes", kim, { equipment_id: "nope", kind: "memo", text: "xx", visibility: "public" })).status, 404);
  const seen = await call("GET", "/api/lab/notes?equipment_id=blast_furnace", lee);
  assert.deepEqual(seen.json.notes.map((n: any) => [n.author, n.text]), [["김*입", "장입은 몇 층으로 하나요?"]]);
  assert.equal((await call("GET", "/api/lab/notes?equipment_id=blast_furnace", kim)).json.notes.length, 2);
  const id = pub.json.id;
  assert.equal((await call("POST", `/api/lab/notes/${id}/vote`, lee)).json.votes, 1);
  assert.equal((await call("POST", `/api/lab/notes/${id}/vote`, lee)).json.votes, 0);
  await call("POST", `/api/lab/notes/${id}/replies`, lee, { text: "보통 여러 층으로 번갈아 넣어요" });
  assert.ok((await call("GET", "/api/me/notifications", kim)).json.notifications.some((n: any) => n.kind === "note_reply"));
  assert.equal((await call("POST", `/api/lab/notes/${id}/report`, kim, { reason: "x" })).status, 400, "내 메모는 신고 불가");
  await call("POST", `/api/lab/notes/${id}/report`, lee, { reason: "광고" });
  await call("POST", `/api/lab/notes/${id}/report`, admin, { reason: "광고" });
  const third = await call("POST", `/api/lab/notes/${id}/report`, admin2, { reason: "광고" });
  assert.equal(third.json.hidden, true);
  assert.equal((await call("GET", "/api/lab/notes?equipment_id=blast_furnace", lee)).json.notes.length, 0);
  assert.equal((await call("GET", "/api/admin/notes/reported", admin)).json.notes[0].reports, 3);
  await call("POST", `/api/admin/notes/${id}/hide`, admin, { hidden: false });
  assert.equal((await call("GET", "/api/lab/notes/summary", lee)).json.counts.blast_furnace, 1);
});

test("HTTP 사고 사례·What-if: 문항 풀이 기록, 최고 점수, 숫자가 아니면 400", async () => {
  const list = await call("GET", "/api/lab/incidents", kim);
  const sid = list.json.scenarios[0].id;
  const view = await call("GET", `/api/lab/incidents/${sid}`, kim);
  const scenario = loadIncidents().scenarios[0];
  const answers = Object.fromEntries(scenario.questions.map((q) => [q.id, q.answer]));
  const graded = await call("POST", `/api/lab/incidents/${sid}/submit`, kim, { answers });
  assert.equal(graded.json.score, 1);
  assert.equal(view.json.scenario.questions.length, scenario.questions.length);
  assert.equal((await call("GET", "/api/lab/incidents", kim)).json.scenarios[0].best, 1);
  assert.equal((await call("POST", "/api/lab/whatif", kim, { coke_kg: "많이" })).status, 400);
  assert.equal((await call("POST", "/api/lab/whatif", kim, { coke_kg: 400 })).json.result.fuel_rate_kg, 500);
});

test("HTTP 오답 패턴: 관리자는 이름표·개수만(설명 원문 없음), 학습자는 내 설명", async () => {
  const add = db.prepare("INSERT INTO misconceptions(id,user_id,section,concept_id,source,answer_text,summary,resolved,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
  add.run(crypto.randomUUID(), kim.id, "ironmaking", "coke_role", "checkpoint", "답1", "코크스가 불순물을 없앤다고 오해", 0, clock.toISOString());
  add.run(crypto.randomUUID(), lee.id, "ironmaking", "coke_role", "checkpoint", "답2", "코크스는 불순물 제거용이라고 생각", 0, clock.toISOString());
  const adminView = await call("GET", "/api/admin/misconception-patterns", admin);
  assert.ok(!JSON.stringify(adminView.json).includes("오해"), "관리자 응답에 설명 원문이 없다");
  assert.equal((await call("GET", "/api/admin/misconception-patterns", kim)).status, 403);
  const mine = await call("GET", "/api/me/misconception-patterns", kim);
  assert.ok(JSON.stringify(mine.json).includes("코크스가 불순물을 없앤다고 오해"));
  assert.ok(!JSON.stringify(mine.json).includes("불순물 제거용"), "남의 설명은 없다");
});

test("사용자 기록 지우기에 운영 기록(알림·사고 사례·설비 메모)도 들어간다", () => {
  assert.equal(deleteUserData(db, kim.id, { origin: "seed" }).operations, 0);
  assert.ok(deleteUserData(db, kim.id, { origin: "live" }).operations > 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM equipment_notes WHERE user_id=?").get(kim.id)?.n), 0);
});
