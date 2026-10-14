import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { openDatabase } from "../src/db/database.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { signToken } from "../src/auth/tokens.js";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { EducationJobs, jobAwareClient, jobPhase, jobUserId, phaseEvaluator, phaseTutor } from "../src/education/jobs.js";
import { EducationRepository } from "../src/education/repository.js";
import { createEducationRouter } from "../src/education/routes.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

const secret = new TextEncoder().encode("education-test-secret-education-secret");
const db = openDatabase(":memory:"), users = new UserRepository(db), jobs = new EducationJobs(db);
const repo = new EducationRepository(db, [IRONMAKING, STEELMAKING]);
const tutor = new FakeTutor(), evaluator = new FakeEvaluator();
const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), rubrics: [IRONMAKING, STEELMAKING], evaluator: phaseEvaluator(evaluator), tutor: phaseTutor(tutor) });
let learner: User, peer: User, admin: User, server: ReturnType<express.Express["listen"]>, base = "", invalidations = 0;
before(async () => {
  learner = await users.create({ username: "exam_user", password: "password123", name: "학습자", employee_no: "EX01" });
  peer = await users.create({ username: "exam_peer", password: "password123", name: "다른 학습자", employee_no: "EX02" });
  admin = await users.create({ username: "exam_admin", password: "password123", name: "교육 관리자", employee_no: "EX03", role: "admin" });
  const app = express(); app.use(express.json({ limit: "128kb" }));
  app.use(createEducationRouter({ auth: { users, secret }, engine, jobs, repo, metadata: () => ({ provider: "test", model: "fixture", prompt_hash: "prompt-v1" }), onMaterialsChanged: () => { invalidations++; } }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { jobs.dispose(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); });
const request = async (user: User | null, method: string, path: string, body?: unknown, requestKey?: string) => {
  const response = await fetch(`${base}${path}`, { method,
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${await signToken(user, secret)}` } : {}), ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as any };
};
async function finished(id: string, user = learner) {
  for (let n = 0; n < 100; n++) {
    const r = await request(user, "GET", `/api/exam-jobs/${id}`);
    if (["succeeded", "failed", "cancelled"].includes(r.body.state)) return r.body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("test job did not finish");
}
let sequence = 0;
const command = async (id: string, text: string) => {
  const r = await request(learner, "POST", `/api/exams/${id}/commands`, { action: "answer", text }, `answer-key-${++sequence}`);
  assert.equal(r.status, 202);
  const done = await finished(r.body.id); assert.equal(done.state, "succeeded"); return done.result;
};

test("exam requests require login, are owner-scoped and reuse a submitted key", async () => {
  assert.equal((await request(null, "GET", "/api/exams/sections")).status, 401);
  assert.equal((await request(learner, "POST", "/api/exams", { section: "continuous_casting" }, "not-ready-01")).status, 404);
  const start = await request(learner, "POST", "/api/exams", { section: "ironmaking" }, "first-exam-01");
  assert.equal(start.status, 202);
  const same = await request(learner, "POST", "/api/exams", { section: "ironmaking" }, "first-exam-01");
  assert.equal(same.body.id, start.body.id);
  assert.equal((await request(learner, "POST", "/api/exams", { section: "steelmaking" }, "first-exam-01")).status, 409);
  assert.equal((await request(peer, "GET", `/api/exam-jobs/${start.body.id}`)).status, 404);
  assert.equal((await request(peer, "DELETE", `/api/exam-jobs/${start.body.id}`)).status, 404);
  const done = await finished(start.body.id);
  assert.equal(done.result.state, "awaiting_ready");
  assert.equal((await request(peer, "GET", `/api/exams/${done.result.attempt_id}`)).status, 404);
});

test("exam goes through incorrect answer, recheck, completion, snapshots and scheduled review", async () => {
  const attempt = engine.sectionProgress(learner.id, "ironmaking").in_progress_attempt_id!;
  assert.equal((await command(attempt, "준비" )).state, "awaiting_answer");
  assert.equal((await command(attempt, "wrong|공정 혼동")).state, "awaiting_recheck");
  assert.equal((await command(attempt, "correct")).state, "awaiting_answer");
  assert.equal((await command(attempt, "correct")).state, "awaiting_answer");
  const done = await command(attempt, "correct");
  assert.equal(done.state, "completed"); assert.equal(done.result.understanding, 1); assert.equal(done.result.unlocked, true);
  const history = await request(learner, "GET", `/api/me/exam-history?attempt=${attempt}`);
  assert.equal(history.body.events.length, 6);
  assert.ok(history.body.events.every((e: any) => e.rubric_version === repo.rubricVersions.get("ironmaking")));
  assert.ok(history.body.events.every((e: any) => !e.rubric), "unanswered criteria are not exposed to learners");
  assert.equal((await request(peer, "GET", `/api/me/exam-history?attempt=${attempt}`)).body.events.length, 0);
  assert.equal((await request(learner, "GET", `/api/admin/exam-history/${learner.id}`)).status, 403);
  assert.ok((await request(admin, "GET", `/api/admin/exam-history/${learner.id}`)).body.events[0].rubric);
  const reviews = (await request(learner, "GET", "/api/me/reviews")).body.tasks;
  assert.equal(reviews.length, 3);
  const rechecked = reviews.find((r: any) => r.concept_id === "a"), direct = reviews.find((r: any) => r.concept_id === "b");
  assert.equal((Date.parse(direct.due_date) - Date.parse(rechecked.due_date)) / 86400000, 4);
  assert.equal((await request(peer, "POST", `/api/me/reviews/${rechecked.id}/complete`, {})).status, 404);
  assert.equal((await request(learner, "POST", `/api/me/reviews/${rechecked.id}/complete`, {})).status, 200);
  assert.equal((await request(learner, "GET", "/api/me/reviews")).body.tasks.find((r: any) => r.id === rechecked.id).completed, true);
});

test("queued cancellation skips execution and running cancellation aborts inference in the correct owner context", async () => {
  let release!: () => void, skipped = false, signalSeen = false;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  const first = jobs.submit(learner.id, "test", "queue-blocker-01", {}, {}, async () => { await blocker; return "ok"; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = jobs.submit(peer.id, "test", "queue-cancel-01", {}, {}, async () => { skipped = true; });
  jobs.cancel(second.id, peer.id); release(); await finished(first.id);
  assert.equal(skipped, false); assert.equal(jobs.get(second.id, peer.id).state, "cancelled");
  const client = jobAwareClient({ generate: async (req) => {
    assert.equal(jobUserId(), peer.id); signalSeen = true; jobPhase("grading");
    await new Promise<void>((_resolve, reject) => req.signal!.addEventListener("abort", () => reject(new Error("cancel")), { once: true }));
    return "never";
  } });
  const third = jobs.submit(peer.id, "test", "running-cancel-01", {}, {}, () => client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 1 }));
  for (let n = 0; n < 30 && !signalSeen; n++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(jobs.get(third.id, peer.id).phase, "grading");
  jobs.cancel(third.id, peer.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(jobs.get(third.id, peer.id).state, "cancelled");
});

test("completed exam results keep their recorded snapshot when current criteria calculate a different view", async () => {
  const event = repo.history(learner.id).find((e) => e.view.state === "completed")!;
  const get = engine.get.bind(engine);
  try {
    engine.get = (userId, id) => { const view = get(userId, id); return { ...view, result: view.result ? { ...view.result, understanding: .5 } : null }; };
    const r = await request(learner, "GET", `/api/exams/${event.attempt_id}`);
    assert.equal(r.body.result.understanding, 1);
    assert.ok(r.body.history.length);
  } finally { engine.get = get; }
});

test("group assignments are admin-only and report actual completion for members", async () => {
  assert.equal((await request(learner, "POST", "/api/admin/education/groups", { name: "기초반" })).status, 403);
  const group = await request(admin, "POST", "/api/admin/education/groups", { name: "기초반" });
  assert.equal(group.status, 201);
  assert.equal((await request(admin, "PUT", `/api/admin/education/groups/${group.body.id}/members`, { users: [learner.id, peer.id, learner.id] })).body.users.length, 2);
  assert.equal((await request(admin, "POST", "/api/admin/education/assignments", { group_id: group.body.id, section: "ironmaking", title: "제선 평가", due_date: "2026-02-30" })).status, 400);
  assert.equal((await request(admin, "POST", "/api/admin/education/assignments", { group_id: group.body.id, section: "ironmaking", title: "제선 평가", due_date: "2026-10-30" })).status, 201);
  assert.equal((await request(learner, "GET", "/api/me/assignments")).body.assignments[0].status, "completed");
  assert.equal((await request(peer, "GET", "/api/me/assignments")).body.assignments[0].status, "pending");
});

test("a cancelled generation cannot advance an exam through the tutor's original-question fallback", async () => {
  let generating = false;
  const client = jobAwareClient({ generate: async (req) => {
    generating = true;
    await new Promise<void>((_resolve, reject) => req.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    return "unused";
  } });
  const fallbackTutor = new FakeTutor();
  fallbackTutor.question = async () => {
    try { await client.generate({ system: "", prompt: "", temperature: 0, maxOutputTokens: 1 }); } catch { /* question-bank fallback */ }
    return { text: "은행 질문", bank: "은행 질문" };
  };
  const isolatedEngine = new CheckpointEngine({ repo: new CheckpointRepository(db), rubrics: [IRONMAKING], evaluator, tutor: phaseTutor(fallbackTutor) });
  const first = await isolatedEngine.start(peer.id, "ironmaking");
  const task = jobs.submit(peer.id, "exam-answer", "fallback-cancel-01", {}, { section: "ironmaking" }, () => isolatedEngine.respond(peer.id, first.view.attempt_id, "준비"));
  for (let n = 0; n < 100 && !generating; n++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(generating, true);
  jobs.cancel(task.id, peer.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(isolatedEngine.get(peer.id, first.view.attempt_id).state, "awaiting_ready");
  assert.equal(jobs.get(task.id, peer.id).state, "cancelled");
});

test("only approved materials enter retrieval; approved revisions are immutable and cache invalidation fires", async () => {
  const input = { section: "ironmaking", title: "열풍로 교육 메모", body: "## 열풍로 {#hot_stove}\n열풍로는 열풍을 만드는 설비다.", source_url: "https://example.com/source", publisher: "교육팀" };
  assert.equal((await request(peer, "POST", "/api/admin/education/materials", input)).status, 403);
  const material = await request(admin, "POST", "/api/admin/education/materials", input);
  assert.equal(material.status, 201); assert.equal(repo.approvedChunks("ironmaking").length, 0);
  assert.equal((await request(admin, "POST", `/api/admin/education/materials/${material.body.id}/review`, { decision: "approved" })).status, 200);
  const chunks = repo.approvedChunks("ironmaking"); assert.equal(chunks.length, 1); assert.match(chunks[0].id, new RegExp(material.body.version.slice(0, 12)));
  assert.equal(repo.approvedSources()[0].url, input.source_url); assert.equal(invalidations, 1);
  assert.equal((await request(admin, "POST", `/api/admin/education/materials/${material.body.id}/review`, { decision: "rejected" })).status, 409);
});
