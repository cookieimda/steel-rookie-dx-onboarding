import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { createCheckpointRouter } from "../src/checkpoint/routes.js";
import { CheckpointError, LlmUnavailableError, type CheckpointView } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import type { Rubric } from "../src/rubrics.js";
import { FakeEvaluator, FakeTutor, IRONMAKING, STEELMAKING } from "./checkpoint-fakes.js";

const USER = "u1";

function setup() {
  const repo = new CheckpointRepository(openDatabase(":memory:"));
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  let tick = 0;
  const engine = new CheckpointEngine({
    repo,
    evaluator,
    tutor,
    rubrics: [IRONMAKING, STEELMAKING],
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
  return { repo, evaluator, tutor, engine };
}

/** 시작 → "네" → 답변들. 마지막 응답을 돌려준다. */
async function runCheckpoint(engine: CheckpointEngine, answers: string[], user = USER): Promise<CheckpointView> {
  const { view } = await engine.start(user, "ironmaking");
  let last = await engine.respond(user, view.attempt_id, "네");
  for (const answer of answers) last = await engine.respond(user, view.attempt_id, answer);
  return last;
}

const texts = (view: CheckpointView) => view.tutor.map((u) => `${u.type}:${u.text}`);

test("정답 흐름: 모든 개념이 correct면 완료되고 다음 섹션이 열린다", async () => {
  const { engine, evaluator } = setup();

  const { created, view: started } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(started.state, "awaiting_ready");
  assert.deepEqual(texts(started), ["intro:제선 질문 시작할게요, 준비됐나요?"]);

  const ready = await engine.respond(USER, started.attempt_id, "네");
  assert.equal(ready.state, "awaiting_answer");
  assert.deepEqual(ready.concept, { id: "a", name: "개념A", index: 1, total: 3 });
  assert.deepEqual(texts(ready), ["question:Q:a"]);

  const afterA = await engine.respond(USER, started.attempt_id, "correct");
  assert.deepEqual(texts(afterA), ["feedback:맞아요.", "question:Q:b"]);
  assert.deepEqual(afterA.progress.map((p) => p.status), ["done", "current", "pending"]);
  assert.equal(afterA.result, null);

  await engine.respond(USER, started.attempt_id, "correct");
  const done = await engine.respond(USER, started.attempt_id, "correct");
  assert.equal(done.state, "completed");
  assert.equal(done.concept, null);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.deepEqual(done.result?.concepts.map((c) => [c.concept_id, c.score, c.final_verdict]), [
    ["a", 1, "correct"], ["b", 1, "correct"], ["c", 1, "correct"],
  ]);
  assert.match(done.tutor.at(-1)!.text, /이해도 100%.*제강 섹션이 열렸어요/);
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "initial", "initial"]);

  assert.equal(engine.sectionProgress(USER, "ironmaking").unlocked, true);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, true);
  await assert.rejects(engine.start(USER, "ironmaking"), (e) => e instanceof CheckpointError && e.status === 409);
});

test("partial → 부가 설명과 다른 각도 재확인 → 재확인 판정이 최종 점수", async () => {
  const { engine, evaluator, tutor } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  const partial = await engine.respond(USER, view.attempt_id, "partial@1");
  assert.equal(partial.state, "awaiting_recheck");
  assert.deepEqual(texts(partial), ["explanation:EX:a:1", "recheck_question:RQ:a"]);
  assert.deepEqual(tutor.calls.find((c) => c.kind === "recheck")?.extra, { previousQuestion: "Q:a", exclude: [] });

  const rechecked = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(texts(rechecked), ["feedback:맞아요, 이번에는 정확해요.", "question:Q:b"]);
  assert.equal(evaluator.calls.at(-1)?.question, "RQ:a"); // 재확인 질문으로 채점

  await engine.respond(USER, view.attempt_id, "partial");
  const keyPoints = await engine.respond(USER, view.attempt_id, "partial");
  assert.equal(keyPoints.tutor[0]!.type, "key_points");
  assert.match(keyPoints.tutor[0]!.text, /개념B 핵심 1\n- 개념B 핵심 2/);

  const done = await engine.respond(USER, view.attempt_id, "correct");
  assert.deepEqual(done.result?.concepts.map((c) => c.score), [1, 0.5, 1]);
  assert.equal(done.result?.unlocked, true); // 2.5 / 3 ≥ 80%
  assert.deepEqual(evaluator.calls.map((c) => c.phase), ["initial", "recheck", "initial", "recheck", "initial"]);
});

test("발화 type 약속: feedback은 맞혔을 때만, explanation은 첫 판정이 correct가 아닐 때만, key_points는 재확인에서 못 맞혔을 때만 나온다", async () => {
  // 화면의 캐릭터 동작(frontend/3d-demo/checkpoint-chat.js의 motionFor)이 판정 없이 이 약속으로 칭찬·설명을 고른다.
  const runs = [
    ["correct", "partial", "correct", "wrong", "partial"], // a 맞음, b 부분→재확인 맞음, c 틀림→재확인 부분(마지막)
    ["assisted", "wrong", "wrong", "wrong", "correct"],    // a 도움→재확인 틀림, b 틀림→재확인 틀림, c 맞음(마지막)
    ["correct", "correct", "wrong", "correct"],            // c 틀림→재확인 맞음(마지막)
  ];
  const seen = new Set<string>();
  for (const answers of runs) {
    const { engine, evaluator } = setup();
    const { view } = await engine.start(USER, "ironmaking");
    await engine.respond(USER, view.attempt_id, "네");
    for (const answer of answers) {
      const out = await engine.respond(USER, view.attempt_id, answer);
      const phase = evaluator.calls.at(-1)!.phase;
      const correct = answer === "correct";
      const types = out.tutor.map((u) => u.type);
      const label = `${phase}:${answer} → ${types.join(",")}`;
      seen.add(`${phase}:${answer}`);
      assert.equal(types.includes("feedback"), correct, label);
      assert.equal(types.includes("explanation"), phase === "initial" && !correct, label);
      assert.equal(types.includes("key_points"), phase === "recheck" && !correct, label);
      if (correct || phase === "recheck") assert.ok(["question", "result"].includes(types.at(-1)!), label);
      else assert.equal(types.at(-1), "recheck_question", label);
    }
  }
  assert.deepEqual([...seen].sort(), [
    "initial:assisted", "initial:correct", "initial:partial", "initial:wrong", "recheck:correct", "recheck:partial", "recheck:wrong",
  ]);
});

test("핵심 요소를 모두 맞혔지만 사실 오류로 partial이면 explain_from null로 오개념만 교정한 뒤 재확인한다", async () => {
  const { engine, tutor } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  const partial = await engine.respond(USER, view.attempt_id, "partial@null|불순물 제거를 잘못 앎");
  assert.equal(partial.state, "awaiting_recheck");
  assert.deepEqual(texts(partial), ["explanation:EX:a:null", "recheck_question:RQ:a"]);
  assert.deepEqual(tutor.calls.find((c) => c.kind === "explanation")?.extra, { explainFrom: null, misconception: "불순물 제거를 잘못 앎", learnerNotes: null });
});

test("explain_from null인데 오개념이 없거나 partial이 아니면 채점 오류로 본다", async () => {
  for (const answer of ["partial@null", "wrong@null|x"]) {
    const { engine } = setup();
    const { view } = await engine.start(USER, "ironmaking");
    await engine.respond(USER, view.attempt_id, "네");
    assert.equal((await engine.respond(USER, view.attempt_id, answer)).state, "error", answer);
  }
});

test("assisted → 부가 설명 후 재확인 correct면 1점", async () => {
  const { engine, repo } = setup();
  const done = await runCheckpoint(engine, ["assisted", "correct", "correct", "correct"]);
  assert.equal(done.state, "completed");
  assert.equal(done.result?.concepts[0]!.score, 1);
  const row = repo.listResults(done.attempt_id).find((r) => r.concept_id === "a")!;
  assert.equal(row.verdict, "assisted");
  assert.equal(row.recheck_verdict, "correct");
  assert.equal(row.recheck_question, "RQ:a");
});

test("재확인 단계에서 평가자가 assisted를 내면 계약 위반으로 error 상태가 된다", async () => {
  const { engine } = setup();
  const view = await runCheckpoint(engine, ["wrong", "assisted"]);
  assert.equal(view.state, "error");
  assert.equal(view.tutor[0]!.type, "error");
});

test("80% 미달 → 재도전은 만점이 아닌 개념만 묻고, 맞힌 개념 점수와 오개념 해결을 반영한다", async () => {
  const { engine, evaluator, repo } = setup();
  const first = await runCheckpoint(engine, [
    "correct",
    "wrong|코크스가 불순물을 없앤다고 생각함", "wrong|여전히 불순물 제거로 설명함",
    "partial", "partial",
  ]);
  assert.equal(first.state, "completed");
  assert.equal(first.result?.understanding, 0.5);
  assert.equal(first.result?.unlocked, false);
  assert.deepEqual(first.result?.retry_concept_ids, ["b", "c"]);
  assert.match(first.tutor.at(-1)!.text, /이해도 50%.*섹션 처음으로.*개념B, 개념C/);

  // 첫 판정과 재확인에서 나온 오개념을 모두 기록한다.
  const recorded = repo.listMisconceptions(USER);
  assert.deepEqual(recorded.map((m) => [m.concept_id, m.phase, m.answer_text, m.summary, m.resolved]), [
    ["b", "initial", "wrong|코크스가 불순물을 없앤다고 생각함", "코크스가 불순물을 없앤다고 생각함", false],
    ["b", "recheck", "wrong|여전히 불순물 제거로 설명함", "여전히 불순물 제거로 설명함", false],
  ]);

  const progress = engine.sectionProgress(USER, "ironmaking");
  assert.equal(progress.unlocked, false);
  assert.deepEqual(progress.retry_concept_ids, ["b", "c"]);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, false);

  const { created, view: retry } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(retry.kind, "retry");
  assert.deepEqual(retry.progress.map((p) => p.concept_id), ["b", "c"]);
  assert.match(retry.tutor[0]!.text, /어려웠던 개념 2개만/);

  evaluator.calls = [];
  await engine.respond(USER, retry.attempt_id, "네");
  await engine.respond(USER, retry.attempt_id, "correct");
  const done = await engine.respond(USER, retry.attempt_id, "correct");
  assert.deepEqual(evaluator.calls.map((c) => c.concept.concept_id), ["b", "c"]);
  assert.equal(done.result?.understanding, 1);
  assert.equal(done.result?.unlocked, true);
  assert.equal(done.result?.concepts[0]!.score, 1); // 첫 시도에서 맞힌 a 유지
  assert.ok(repo.listMisconceptions(USER).every((m) => m.resolved));
});

test("평가자 형식 오류 → error 상태 → retry-evaluation으로 같은 답변을 다시 채점", async () => {
  const { engine, evaluator, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");

  evaluator.failNext = 1;
  const failed = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(failed.state, "error");
  assert.equal(failed.concept?.id, "a");
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), (e) => e instanceof CheckpointError && e.status === 409);

  const resumed = await engine.retryEvaluation(USER, view.attempt_id);
  assert.equal(resumed.state, "awaiting_answer");
  assert.equal(resumed.concept?.id, "b");
  assert.equal(repo.listResults(view.attempt_id)[0]?.answer, "correct");
  const userMessages = repo.listMessages(view.attempt_id).filter((m) => m.role === "user").map((m) => m.text);
  assert.deepEqual(userMessages, ["네", "correct"]); // 다시 채점해도 답변은 한 번만 기록
});

test("LLM 연결 실패면 아무것도 저장하지 않아 같은 메시지를 다시 보낼 수 있다", async () => {
  const { engine, tutor, repo } = setup();
  const { view } = await engine.start(USER, "ironmaking");

  tutor.failNext = 1;
  await assert.rejects(engine.respond(USER, view.attempt_id, "네"), LlmUnavailableError);
  assert.equal(engine.get(USER, view.attempt_id).state, "awaiting_ready");
  await engine.respond(USER, view.attempt_id, "네");

  tutor.failNext = 1; // correct 판정 뒤 다음 질문 생성에서 실패
  await assert.rejects(engine.respond(USER, view.attempt_id, "correct"), LlmUnavailableError);
  assert.equal(repo.listResults(view.attempt_id).length, 0);
  const again = await engine.respond(USER, view.attempt_id, "correct");
  assert.equal(again.concept?.id, "b");
});

test("진행 중인 시도를 다시 시작하면 같은 시도를 대화 기록과 함께 돌려준다", async () => {
  const { engine } = setup();
  const { view } = await engine.start(USER, "ironmaking");
  await engine.respond(USER, view.attempt_id, "네");
  const resumed = await engine.start(USER, "ironmaking");
  assert.equal(resumed.created, false);
  assert.equal(resumed.view.attempt_id, view.attempt_id);
  assert.deepEqual(resumed.view.history?.map((m) => m.role), ["tutor", "user", "tutor"]);
});

test("잠긴 섹션은 403, 없는 시도·다른 사용자의 시도는 404, 겹친 요청은 409", async () => {
  const { engine, tutor } = setup();
  await assert.rejects(engine.start(USER, "steelmaking"), (e) => e instanceof CheckpointError && e.status === 403);
  await assert.rejects(engine.start(USER, "rolling"), (e) => e instanceof CheckpointError && e.status === 404);

  const { view } = await engine.start(USER, "ironmaking");
  assert.throws(() => engine.get("someone-else", view.attempt_id), (e) => e instanceof CheckpointError && e.status === 404);
  assert.throws(() => engine.get(USER, "missing"), (e) => e instanceof CheckpointError && e.status === 404);

  tutor.delay = 20;
  const results = await Promise.allSettled([
    engine.respond(USER, view.attempt_id, "네"),
    engine.respond(USER, view.attempt_id, "네"),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((rejected.reason as CheckpointError).status, 409);
});

test("HTTP: 시작 201·재시작 200, 입력 오류 400, LLM 연결 실패 502", async (t) => {
  const { engine, tutor } = setup();
  const app = express();
  app.use(express.json());
  app.use(createCheckpointRouter(engine));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  const started = await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" });
  assert.equal(started.status, 201);
  const view = (await started.json()) as CheckpointView;
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "http-user" })).status, 200);

  assert.equal((await post("/api/checkpoints", { section: "mining" })).status, 400);
  assert.equal((await post("/api/checkpoints", { section: "ironmaking" }, { "X-User-Id": "bad id!" })).status, 400);
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: " " }, { "X-User-Id": "http-user" })).status, 400);
  assert.equal((await fetch(`${base}/api/checkpoints/${view.attempt_id}`)).status, 404); // demo-user의 시도가 아님

  tutor.failNext = 1;
  const unavailable = await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: "네" }, { "X-User-Id": "http-user" });
  assert.equal(unavailable.status, 502);
  assert.equal(((await unavailable.json()) as { code: string }).code, "LLM_UNAVAILABLE");

  const progress = await fetch(`${base}/api/sections/ironmaking/progress`, { headers: { "X-User-Id": "http-user" } });
  assert.equal(((await progress.json()) as { in_progress_attempt_id: string }).in_progress_attempt_id, view.attempt_id);
});

test("시연 기록(origin = 'seed')은 진행·해금·재도전·진행 중 시도에 쓰지 않는다", async () => {
  const db = openDatabase(":memory:");
  const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING, STEELMAKING] });

  // 시연 기록: 제선 통과(완료) + 제강 진행 중
  const passed = await runCheckpoint(engine, ["correct", "correct", "correct"]);
  assert.equal(passed.result?.unlocked, true);
  const { view: open } = await engine.start(USER, "steelmaking");
  db.prepare("UPDATE attempts SET origin = 'seed'").run();

  const progress = engine.sectionProgress(USER, "ironmaking");
  assert.equal(progress.unlocked, false);
  assert.equal(progress.understanding, null);
  assert.equal(engine.sectionProgress(USER, "steelmaking").open, false);
  assert.throws(() => engine.get(USER, open.attempt_id), (e: unknown) => e instanceof CheckpointError && e.status === 404);

  // 실제 체크포인트는 409 없이 처음부터 시작한다.
  const { created, view } = await engine.start(USER, "ironmaking");
  assert.ok(created);
  assert.equal(view.kind, "first");
});

test("루브릭 개념 id가 바뀌면: 예전 결과는 버리고, 통과한 섹션은 통과로 두고 새 개념은 미확인", async () => {
  const db = openDatabase(":memory:");
  const repo = new CheckpointRepository(db);
  const before = new CheckpointEngine({ repo, evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING, STEELMAKING] });
  // 통과한 사람(a·b·c 정답)과 미달인 사람(a만 정답)
  await runCheckpoint(before, ["correct", "correct", "correct"], "passed");
  await runCheckpoint(before, ["correct", "wrong", "wrong", "wrong", "wrong"], "failed");

  // 핵심 요소가 바뀌어 b → b2로 새 id
  const changed = { ...IRONMAKING, concepts: IRONMAKING.concepts.map((c) => (c.concept_id === "b" ? { ...c, concept_id: "b2" } : c)) };
  const after = new CheckpointEngine({ repo, evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [changed, STEELMAKING] });

  const passed = after.sectionProgress("passed", "ironmaking");
  assert.equal(passed.unlocked, true);
  assert.deepEqual(passed.unconfirmed_concept_ids, ["b2"]);
  assert.deepEqual(passed.retry_concept_ids, []);
  assert.equal(after.sectionProgress("passed", "steelmaking").open, true);
  await assert.rejects(after.start("passed", "ironmaking"), (e: unknown) => e instanceof CheckpointError && e.status === 409);

  // 미달인 사람은 예전 b 결과 없이 재도전: 맞힌 a는 빼고 b2·c를 묻는다.
  const failed = after.sectionProgress("failed", "ironmaking");
  assert.equal(failed.unlocked, false);
  assert.deepEqual(failed.retry_concept_ids, ["b2", "c"]);
  const { view } = await after.start("failed", "ironmaking");
  assert.equal(view.kind, "retry");
  assert.equal(view.concept, null);
  const ready = await after.respond("failed", view.attempt_id, "네");
  assert.equal(ready.concept?.id, "b2");
});

test("학습자 메모: 부가 설명 때만 읽어 튜터에게 넘기고, 평가자에게는 넘기지 않는다", async () => {
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  const asked: string[] = [];
  const engine = new CheckpointEngine({
    repo: new CheckpointRepository(openDatabase(":memory:")), evaluator, tutor, rubrics: [IRONMAKING, STEELMAKING],
    learnerNotes: async (userId, section) => {
      asked.push(`${userId}:${section}`);
      return { context: "- b (대화 중 감지됨): 코크스를 연료로만 앎" };
    },
  });

  // a는 correct(부가 설명 없음) → b는 wrong(부가 설명) → 재확인
  await runCheckpoint(engine, ["correct", "wrong", "correct"]);
  assert.deepEqual(asked, [`${USER}:ironmaking`]);
  const explanations = tutor.calls.filter((c) => c.kind === "explanation");
  assert.equal(explanations.length, 1);
  assert.equal((explanations[0]!.extra as { learnerNotes: string }).learnerNotes, "- b (대화 중 감지됨): 코크스를 연료로만 앎");
  assert.doesNotMatch(JSON.stringify(evaluator.calls), /코크스를 연료로만 앎/);

  // options.notes를 주면 그 메모를 쓰고 provider는 부르지 않는다. 빈 메모는 null로 넘긴다.
  const { view } = await engine.start("other", "ironmaking");
  await engine.respond("other", view.attempt_id, "네");
  await engine.respond("other", view.attempt_id, "wrong", { notes: {} });
  assert.deepEqual(asked, [`${USER}:ironmaking`]);
  assert.equal((tutor.calls.filter((c) => c.kind === "explanation").at(-1)!.extra as { learnerNotes: unknown }).learnerNotes, null);
});

// --- 나중에 이어 풀기(pause/resume) ---

/** 개념마다 질문 은행(첫 질문 2개, 재확인 2개)과 fallback_question을 둔 제선 루브릭. FakeTutor는 안 쓴 첫 후보를 고른다. */
const BANKED: Rubric = {
  ...IRONMAKING,
  concepts: IRONMAKING.concepts.map((c) => ({
    ...c,
    questions: [`${c.concept_id}-Q1`, `${c.concept_id}-Q2`],
    recheck_questions: [`${c.concept_id}-R1`, `${c.concept_id}-R2`],
    fallback_question: `${c.concept_id}-FB`,
  })),
};

function bankedSetup() {
  const repo = new CheckpointRepository(openDatabase(":memory:"));
  const evaluator = new FakeEvaluator();
  const tutor = new FakeTutor();
  let tick = 0;
  const engine = new CheckpointEngine({
    repo, evaluator, tutor, rubrics: [BANKED, STEELMAKING],
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  });
  return { repo, evaluator, tutor, engine };
}

const isConflict = (e: unknown) => e instanceof CheckpointError && e.status === 409;

test("이어 풀기: 답 대기 중 멈추면 맞힌 개념은 그대로, 풀던 개념은 안 쓴 질문으로 다시 묻고, 은행을 다 쓰면 fallback_question을 다시 쓴다", async () => {
  const { engine, repo, tutor } = bankedSetup();
  const { view } = await engine.start(USER, "ironmaking");
  const id = view.attempt_id;
  assert.deepEqual(texts(await engine.respond(USER, id, "네")), ["question:a-Q1"]);
  assert.deepEqual(texts(await engine.respond(USER, id, "correct")), ["feedback:맞아요.", "question:b-Q1"]);

  const paused = await engine.pause(USER, id);
  assert.equal(paused.state, "paused");
  assert.deepEqual(paused.concept, { id: "b", name: "개념B", index: 2, total: 3 });
  assert.deepEqual(paused.progress.map((p) => p.status), ["done", "current", "pending"]);
  assert.deepEqual(engine.sectionProgress(USER, "ironmaking").in_progress, { attempt_id: id, state: "paused", done: 1, total: 3 });
  await assert.rejects(engine.respond(USER, id, "correct"), isConflict);
  assert.equal((await engine.pause(USER, id)).state, "paused"); // 두 번 멈춰도 그대로

  const resumed = await engine.resume(USER, id);
  assert.equal(resumed.state, "awaiting_answer");
  assert.deepEqual(texts(resumed), ["intro:이어서 할게요. 개념 3개 중 1개를 마쳤어요.", "question:b-Q2"]);
  assert.deepEqual(repo.listResults(id).map((r) => [r.concept_id, r.verdict]), [["a", "correct"]]); // 맞힌 개념은 그대로

  await engine.pause(USER, id);
  assert.equal(texts(await engine.resume(USER, id)).at(-1), "question:b-FB"); // 은행을 다 씀
  await engine.pause(USER, id);
  assert.equal(texts(await engine.resume(USER, id)).at(-1), "question:b-FB"); // fallback_question은 다시 쓴다
  const excludes = tutor.calls.filter((c) => c.kind === "question" && c.conceptId === "b").map((c) => [...(c.extra as { exclude: string[] }).exclude].sort());
  assert.deepEqual(excludes, [[], ["b-Q1"], ["b-Q1", "b-Q2"], ["b-FB", "b-Q1", "b-Q2"]]);

  await engine.respond(USER, id, "correct");
  const done = await engine.respond(USER, id, "correct");
  assert.equal(done.state, "completed");
  assert.equal(done.result?.understanding, 1);
  await assert.rejects(engine.pause(USER, id), isConflict);
  await assert.rejects(engine.resume(USER, id), isConflict);
});

test("이어 풀기: 재확인 대기 중 pause → resume해도 첫 판정은 유지되고 안 쓴 재확인 질문으로 묻는다(멈춰서 재확인을 건너뛸 수 없다)", async () => {
  const { engine, repo, evaluator } = bankedSetup();
  const { view } = await engine.start(USER, "ironmaking");
  const id = view.attempt_id;
  await engine.respond(USER, id, "네");
  const wrong = await engine.respond(USER, id, "wrong|소결을 녹이는 것으로 앎");
  assert.equal(wrong.state, "awaiting_recheck");
  assert.equal(wrong.tutor.at(-1)!.text, "a-R1");

  await engine.pause(USER, id);
  assert.equal(repo.getResult(id, "a")!.verdict, "wrong"); // 첫 판정 유지
  const resumed = await engine.resume(USER, id);
  assert.equal(resumed.state, "awaiting_recheck"); // 첫 질문(awaiting_answer)으로 돌아가지 않는다
  assert.deepEqual(texts(resumed), ["intro:이어서 할게요. 개념 3개 중 0개를 마쳤어요.", "recheck_question:a-R2"]);

  await engine.respond(USER, id, "partial");
  assert.deepEqual([evaluator.calls.at(-1)!.phase, evaluator.calls.at(-1)!.question], ["recheck", "a-R2"]);
  const result = repo.getResult(id, "a")!;
  assert.deepEqual([result.verdict, result.recheck_question, result.recheck_verdict], ["wrong", "a-R2", "partial"]);

  await engine.respond(USER, id, "correct");
  const done = await engine.respond(USER, id, "correct");
  // 재확인 판정(partial)이 최종 점수: 멈췄다 와서 첫 질문을 새로 받아 1점을 받는 길은 없다.
  assert.deepEqual(done.result!.concepts.map((c) => [c.concept_id, c.score]), [["a", 0.5], ["b", 1], ["c", 1]]);
  assert.equal(repo.listMisconceptions(USER).filter((m) => !m.resolved).length, 1); // 첫 판정의 오개념은 미해결로 남는다
});

test("이어 풀기: 시작 전·채점 오류 상태에서도 멈출 수 있고, 시작하면 같은 멈춘 시도를 돌려주며 멈춘 동안 재채점은 막는다", async () => {
  const { engine, repo, evaluator } = bankedSetup();
  const { view } = await engine.start(USER, "ironmaking");
  const id = view.attempt_id;
  await engine.pause(USER, id); // 준비 전
  assert.deepEqual(texts(await engine.resume(USER, id)), ["intro:이어서 할게요. 개념 3개 중 0개를 마쳤어요.", "question:a-Q1"]);

  evaluator.failNext = 1;
  assert.equal((await engine.respond(USER, id, "correct")).state, "error");
  const paused = await engine.pause(USER, id);
  assert.equal(paused.state, "paused");
  const row = repo.getAttempt(id)!;
  assert.deepEqual([row.resume_state, row.pending_answer, row.current_question], ["awaiting_answer", null, null]); // 채점 못 한 답변은 버린다
  await assert.rejects(engine.retryEvaluation(USER, id), isConflict);

  const again = await engine.start(USER, "ironmaking");
  assert.equal(again.created, false);
  assert.equal(again.view.state, "paused");
  assert.equal(again.view.attempt_id, id);
  assert.match(again.view.history!.at(-1)!.text, /여기서 멈출게요/);

  assert.equal(texts(await engine.resume(USER, id)).at(-1), "question:a-Q2");
  assert.throws(() => engine.get("other", id), (e: unknown) => e instanceof CheckpointError && e.status === 404);
  await assert.rejects(engine.pause("other", id), (e) => e instanceof CheckpointError && e.status === 404);
});

test("HTTP: pause·resume 200, 멈춘 시도에 답하면 409, 남의 시도는 404", async (t) => {
  const { engine } = bankedSetup();
  const app = express();
  app.use(express.json());
  app.use(createCheckpointRouter(engine));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { "Content-Type": "application/json", "X-User-Id": "http-user" };
  const post = (path: string, body: unknown = {}, h: Record<string, string> = headers) => fetch(base + path, { method: "POST", headers: h, body: JSON.stringify(body) });

  const view = (await (await post("/api/checkpoints", { section: "ironmaking" })).json()) as CheckpointView;
  await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: "네" });
  const paused = await post(`/api/checkpoints/${view.attempt_id}/pause`);
  assert.equal(paused.status, 200);
  assert.equal(((await paused.json()) as CheckpointView).state, "paused");
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/messages`, { text: "correct" })).status, 409);
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/pause`, {}, { "Content-Type": "application/json", "X-User-Id": "someone" })).status, 404);
  const progress = (await (await fetch(`${base}/api/sections/ironmaking/progress`, { headers })).json()) as { in_progress: { state: string; done: number; total: number } };
  assert.deepEqual([progress.in_progress.state, progress.in_progress.done, progress.in_progress.total], ["paused", 0, 3]);
  const resumed = await post(`/api/checkpoints/${view.attempt_id}/resume`);
  assert.equal(resumed.status, 200);
  assert.equal(((await resumed.json()) as CheckpointView).state, "awaiting_answer");
  assert.equal((await post(`/api/checkpoints/${view.attempt_id}/resume`)).status, 409);
});
