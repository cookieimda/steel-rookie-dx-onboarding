// 보충학습 에이전트(backend/src/learning/supplement.ts, agent-tools.ts)를 가짜 튜터·평가자로 검사한다. 실제 Gemini는 호출하지 않는다.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import type { LearningAgent, LearningInput, LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { LlmUnavailableError, type EvaluateInput, type Evaluation, type Evaluator } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { deleteUserData } from "../src/db/user-data.js";
import { executeLearningTool, type LearningToolContext } from "../src/learning/agent-tools.js";
import { LearningRepository } from "../src/learning/repository.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { createSupplementRouter, SUPPLEMENT_TEXT, SUPPLEMENT_TTL_MS, SupplementEngine, type SupplementView } from "../src/learning/supplement.js";
import { SupplementRepository } from "../src/learning/supplement-repository.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics, type Rubric, type RubricConcept } from "../src/rubrics.js";
import { UsageLimitError } from "../src/usage.js";

const rubrics = loadFinalRubrics();
const scene = await loadSceneCatalog();
const ironmaking = rubrics.find((r) => r.section === "ironmaking")!;

const CHUNKS: Chunk[] = [
  { id: "posco-newsroom-fe-2019#1", section: "ironmaking", title: "", text: "소결은 철광석을 고로에 사용하기 좋은 소결광으로 만드는 전처리 공정이다.", source_ids: ["posco-newsroom-fe-2019"], tags: ["sinter_plant"] },
  { id: "posco-newsroom-fe-2019#3", section: "ironmaking", title: "", text: "고로에서 코크스가 열풍과 반응해 일산화탄소를 만들고 일산화탄소는 환원에 관여한다.", source_ids: ["posco-newsroom-fe-2019"], tags: ["blast_furnace"] },
];

const grounded = (over: Partial<LearningReply> = {}): LearningReply => ({
  answer: "소결은 가루 철광석을 덩어리 소결광으로 만들어 고로에 넣기 좋게 하는 단계예요.", status: "grounded",
  source_ids: ["posco-newsroom-fe-2019#1"], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null, ...over,
});
const verdict = (v: Evaluation["verdict"], over: Partial<Evaluation> = {}): Evaluation =>
  ({ verdict: v, misconception: null, explain_from: v === "correct" ? null : 0, evidence: "e", ...over });

class FakeAgent implements LearningAgent {
  calls: LearningInput[] = [];
  next = async (): Promise<LearningReply> => grounded();
  async reply(input: LearningInput) {
    this.calls.push(input);
    return this.next();
  }
}
class FakeTutor {
  quizzes: { concept: string; previous: string | null }[] = [];
  explanations: { explainFrom: number | null; misconception: string | null; answer: string }[] = [];
  async practiceQuestion({ concept, previousQuestion = null }: { rubric: Rubric; concept: RubricConcept; previousQuestion?: string | null }) {
    this.quizzes.push({ concept: concept.concept_id, previous: previousQuestion });
    const text = previousQuestion ? "두 번째 확인 문제" : "첫 확인 문제";
    return { text, usedFallback: false, attempts: [{ text, leaked: [] }] };
  }
  async explanation(input: { explainFrom: number | null; misconception: string | null; answer: string }) {
    this.explanations.push(input);
    return "놓친 부분부터 다시 설명할게요.";
  }
}
class FakeEvaluator implements Evaluator {
  calls: EvaluateInput[] = [];
  queue: (Evaluation | Error)[] = [];
  async evaluate(input: EvaluateInput) {
    this.calls.push(input);
    const next = this.queue.shift() ?? verdict("correct");
    if (next instanceof Error) throw next;
    return next;
  }
}

async function setup(opts: { inProgress?: boolean; retry?: string[]; chunks?: Chunk[] } = {}) {
  const db = openDatabase(":memory:");
  const learningRepo = new LearningRepository(db);
  const repo = new SupplementRepository(db);
  const agent = new FakeAgent();
  const tutor = new FakeTutor();
  const evaluator = new FakeEvaluator();
  let clock = Date.parse("2026-10-14T12:00:00Z");
  const now = () => new Date(clock).toISOString();
  const engine = new SupplementEngine({
    repo, learningRepo, agent, tutor, evaluator, rubrics, scene, now,
    retriever: new Retriever({ chunksFor: () => opts.chunks ?? CHUNKS }),
    checkpointProgress: (_u, section) => (section === "ironmaking" ? { retry_concept_ids: opts.retry ?? [], in_progress: !!opts.inProgress } : null),
  });
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(createSupplementRouter(engine));
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, user = "u1") => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-user-id": user }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (res.status === 204 ? null : await res.json()) as SupplementView & { error?: string; code?: string; candidates?: unknown[]; active?: SupplementView | null } };
  };
  const memo = (concept: string, summary: string, source: "learning" | "checkpoint" = "learning", at = now(), origin: "live" | "seed" = "live") =>
    db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at, origin) VALUES (?, 'u1', 'ironmaking', ?, ?, 'a', ?, ?, ?)")
      .run(`${concept}-${source}-${origin}-${at}`, concept, source, summary, at, origin);
  const open = (concept: string) => learningRepo.openMisconceptions("u1", "ironmaking").filter((m) => m.concept_id === concept);
  return { db, repo, agent, tutor, evaluator, call, memo, open, tick: (ms: number) => (clock += ms), close: () => srv.close() };
}

test("rubric equipment_ids: 루브릭 개념의 관련 설비는 그 공정의 화면 목록(data_v2.js)에 있다", () => {
  for (const r of rubrics) {
    const ids = new Set(scene.processes.find((p) => p.id === r.section)?.equipment.map((e) => e.id) ?? []);
    for (const c of r.concepts) for (const id of c.equipment_ids ?? []) assert.ok(ids.has(id), `${c.concept_id}: ${id}`);
  }
  assert.ok(ironmaking.concepts.every((c) => c.equipment_ids?.length), "제선 개념은 모두 관련 설비가 있음");
});

test("후보: 미해결 오개념 개념과 체크포인트 재도전 개념, 보충학습으로 해결한 뒤에는 새 오개념이 생길 때까지 빼고, 루브릭 없는 공정은 빈 목록", async () => {
  const s = await setup({ retry: ["coke_reduction"] });
  try {
    s.memo("sinter_purpose", "소결을 쇳물 만드는 단계로 앎");
    let got = await s.call("GET", "/api/learning/supplements?section=ironmaking");
    assert.deepEqual(got.body.candidates, [
      { concept_id: "sinter_purpose", name: "소결의 목적", reason: "misconception", summary: "소결을 쇳물 만드는 단계로 앎" },
      { concept_id: "coke_reduction", name: "고로에서 코크스의 역할", reason: "retry", summary: null },
    ]);
    assert.equal(got.body.active, null);

    const started = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    s.tick(1000);
    await s.call("POST", `/api/learning/supplements/${started.body.id}/answer`, { answer: "가루 철광석을 덩어리로 만들어 고로에 넣는다" });
    got = await s.call("GET", "/api/learning/supplements?section=ironmaking");
    assert.deepEqual((got.body.candidates as { concept_id: string }[]).map((c) => c.concept_id), ["coke_reduction"], "해결한 개념은 빠짐");

    s.tick(1000);
    s.memo("sinter_purpose", "다시 헷갈림");
    got = await s.call("GET", "/api/learning/supplements?section=ironmaking");
    assert.ok((got.body.candidates as { concept_id: string }[]).some((c) => c.concept_id === "sinter_purpose"), "새 오개념이 생기면 다시 권함");
    assert.deepEqual((await s.call("GET", "/api/learning/supplements?section=rolling")).body.candidates, []);
  } finally {
    s.close();
  }
});

test("시작: 학습 상태 → 근거 검색 → 설비 보여 주기 → 설명·확인 문제. 은행이 아닌 확인 문제, 다른 공정 화면이면 공정 이동부터", async () => {
  const s = await setup();
  try {
    s.memo("sinter_purpose", "소결을 쇳물 만드는 단계로 앎");
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose", screen: { process_id: null } });
    assert.equal(r.status, 201);
    assert.equal(r.body.state, "awaiting_answer");
    assert.equal(r.body.question, "첫 확인 문제");
    assert.deepEqual(r.body.messages.map((m) => m.type), ["intro", "explanation", "question"]);
    assert.match(r.body.messages[0]!.text, /지난번 기록: 소결을 쇳물 만드는 단계로 앎/);
    assert.match(r.body.messages[0]!.text, /소결기/);
    assert.deepEqual(r.body.messages[1]!.sources?.map((x) => x.id), ["posco-newsroom-fe-2019"]);
    assert.equal(r.body.messages[2]!.text, "확인 문제예요. 첫 확인 문제");
    assert.deepEqual(r.body.scene_actions, [
      { type: "goto_process", target_id: "ironmaking" }, { type: "focus", target_id: "sinter_plant" }, { type: "highlight", target_id: "sinter_plant" },
    ]);
    // 튜터에 오개념 메모와 검색한 근거를 넘긴다. 확인 문제는 practiceQuestion(은행 아님).
    assert.deepEqual(s.agent.calls[0]!.openMisconceptions, [{ concept_id: "sinter_purpose", summary: "소결을 쇳물 만드는 단계로 앎" }]);
    assert.deepEqual(s.agent.calls[0]!.chunks.map((c) => c.id), ["posco-newsroom-fe-2019#1"]);
    assert.deepEqual(s.tutor.quizzes, [{ concept: "sinter_purpose", previous: null }]);
    // 실행 기록: 도구 4개(성공) + 말 3개.
    const steps = s.repo.steps(r.body.id);
    assert.deepEqual(steps.filter((x) => x.kind === "tool").map((x) => [x.name, x.ok]), [
      ["get_learning_state", true], ["search_materials", true], ["show_equipment", true], ["create_quiz", true],
    ]);
    assert.equal(steps.filter((x) => x.kind === "message").length, 3);

    // 같은 공정 화면이면 공정 이동은 넣지 않는다.
    const again = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose", screen: { process_id: "ironmaking" } });
    assert.deepEqual(again.body.scene_actions.map((a) => a.type), ["focus", "highlight"]);
    assert.equal(s.repo.get(r.body.id)!.state, "stopped", "같은 공정의 이전 보충학습은 끝냄");
  } finally {
    s.close();
  }
});

test("시작: 근거를 못 찾으면 튜터를 부르지 않고 루브릭 핵심 요소로 설명한다(자료 부족)", async () => {
  const s = await setup({ chunks: [] });
  try {
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "coke_reduction" });
    assert.equal(s.agent.calls.length, 0);
    assert.match(r.body.messages[1]!.text, new RegExp(SUPPLEMENT_TEXT.fallbackExplanation));
    assert.match(r.body.messages[1]!.text, /일산화탄소/);
    assert.match(r.body.messages[0]!.text, /아직 만점이 아닌/);
  } finally {
    s.close();
  }
});

test("첫 문제를 맞히면 끝내고 학습 메모 오개념만 해결한다(체크포인트 오개념은 그대로)", async () => {
  const s = await setup();
  try {
    s.memo("coke_reduction", "코크스로 불순물을 없앤다고 앎", "learning");
    s.memo("coke_reduction", "코크스를 불순물 제거로 설명", "checkpoint");
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "coke_reduction" });
    const done = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "코크스가 일산화탄소를 만들어 철광석의 산소를 떼어낸다" });
    assert.equal(done.body.state, "completed");
    assert.equal(done.body.outcome, "resolved");
    assert.equal(done.body.question, null);
    assert.deepEqual(done.body.messages.map((m) => m.type), ["reaction", "closing"]);
    assert.equal(done.body.messages[0]!.text, SUPPLEMENT_TEXT.correct);
    assert.match(done.body.messages[1]!.text, /해결로 바꿨어요/);
    assert.match(done.body.messages[1]!.text, /이해도 확인에서 이 개념을 맞히면/);
    assert.deepEqual(s.open("coke_reduction").map((m) => m.source), ["checkpoint"]);
    assert.deepEqual(s.evaluator.calls.map((c) => [c.phase, c.question]), [["initial", "첫 확인 문제"]]);
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "또" })).status, 409, "끝난 보충학습에는 답할 수 없음");
  } finally {
    s.close();
  }
});

test("틀리면 놓친 부분부터 다시 설명하고 다른 각도로 한 번 더, 또 틀리면 핵심 정리로 끝낸다. 오개념은 학습 메모로 남긴다", async () => {
  const s = await setup();
  try {
    s.evaluator.queue = [verdict("wrong", { misconception: "소결로 쇳물을 만든다고 함", explain_from: 0 }), verdict("partial", { explain_from: 0 })];
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    const second = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "소결로 쇳물을 만든다" });
    assert.equal(second.body.state, "awaiting_recheck");
    assert.equal(second.body.question, "두 번째 확인 문제");
    assert.deepEqual(second.body.messages.map((m) => [m.type, m.text]), [
      ["reaction", SUPPLEMENT_TEXT.miss], ["explanation", "놓친 부분부터 다시 설명할게요."], ["question", "다른 각도로 한 번 더 물어볼게요. 두 번째 확인 문제"],
    ]);
    assert.deepEqual(s.tutor.explanations[0], { rubric: ironmaking, concept: ironmaking.concepts[0], explainFrom: 0, misconception: "소결로 쇳물을 만든다고 함", answer: "소결로 쇳물을 만든다" });
    assert.deepEqual(s.tutor.quizzes.at(-1), { concept: "sinter_purpose", previous: "첫 확인 문제" });
    assert.deepEqual(s.open("sinter_purpose").map((m) => [m.source, m.summary]), [["learning", "소결로 쇳물을 만든다고 함"]]);

    const last = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "모르겠어요" });
    assert.equal(last.body.state, "completed");
    assert.equal(last.body.outcome, "not_resolved");
    assert.deepEqual(last.body.messages.map((m) => m.type), ["key_points", "closing"]);
    assert.match(last.body.messages[0]!.text, new RegExp(`^${SUPPLEMENT_TEXT.keyPoints}\n- `));
    assert.deepEqual(s.evaluator.calls.map((c) => [c.phase, c.question]), [["initial", "첫 확인 문제"], ["recheck", "두 번째 확인 문제"]]);
    assert.equal(s.open("sinter_purpose").length, 1, "해결하지 못했으면 메모는 남음");
  } finally {
    s.close();
  }
});

test("다시 설명한 뒤 맞히면 해결, 재확인 반응 문장", async () => {
  const s = await setup();
  try {
    s.memo("sinter_purpose", "x");
    s.evaluator.queue = [verdict("assisted"), verdict("correct")];
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    const second = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "힌트 주세요" });
    assert.equal(second.body.messages[0]!.text, SUPPLEMENT_TEXT.miss, "assisted도 다시 설명");
    const done = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "덩어리로 만든다" });
    assert.equal(done.body.outcome, "resolved");
    assert.equal(done.body.messages[0]!.text, SUPPLEMENT_TEXT.recheckCorrect);
    assert.equal(s.open("sinter_purpose").length, 0);
  } finally {
    s.close();
  }
});

test("채점 실패(모델 연결)면 502이고 답을 받지 않은 것으로 둔다(같은 문제에 다시 답함), 실패 기록은 남김. 하루 한도면 429", async () => {
  const s = await setup();
  try {
    s.evaluator.queue = [new LlmUnavailableError("down"), new UsageLimitError(150), verdict("correct")];
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    const failed = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "a" });
    assert.equal(failed.status, 502);
    assert.equal(s.repo.get(r.body.id)!.state, "awaiting_answer");
    assert.deepEqual(s.repo.steps(r.body.id).filter((x) => x.kind === "tool").at(-1)!.ok, false);
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "a" })).status, 429);
    const ok = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "a" });
    assert.equal(ok.body.outcome, "resolved");
  } finally {
    s.close();
  }
});

test("이해도 확인을 푸는 중이면 시작 409, 없는 개념·루브릭 없는 공정 404, 다른 사람의 보충학습 404", async () => {
  const busy = await setup({ inProgress: true });
  try {
    const r = await busy.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "CHECKPOINT_IN_PROGRESS");
  } finally {
    busy.close();
  }
  const s = await setup();
  try {
    assert.equal((await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "no_such" })).status, 404);
    assert.equal((await s.call("POST", "/api/learning/supplements", { section: "rolling", concept_id: "sinter_purpose" })).status, 404);
    assert.equal((await s.call("POST", "/api/learning/supplements", { section: "ironmaking" })).status, 400);
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "a" }, "u2")).status, 404);
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/stop`, undefined, "u2")).status, 404);
  } finally {
    s.close();
  }
});

test("이어 하기·그만두기·오래 멈춤: GET active는 지금까지의 말을 돌려주고, 2시간 넘게 멈추면 끝낸다", async () => {
  const s = await setup();
  try {
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    const active = (await s.call("GET", "/api/learning/supplements?section=ironmaking")).body.active!;
    assert.equal(active.id, r.body.id);
    assert.deepEqual(active.messages.map((m) => m.type), ["intro", "explanation", "question"]);

    const stopped = await s.call("POST", `/api/learning/supplements/${r.body.id}/stop`);
    assert.equal(stopped.body.state, "stopped");
    assert.equal((await s.call("GET", "/api/learning/supplements?section=ironmaking")).body.active, null);

    const old = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    s.tick(SUPPLEMENT_TTL_MS + 1000);
    const late = await s.call("POST", `/api/learning/supplements/${old.body.id}/answer`, { answer: "a" });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, "EXPIRED");
    assert.equal(s.repo.get(old.body.id)!.state, "stopped");
  } finally {
    s.close();
  }
});

test("화면 조작 결과(실제로 됐는지)를 실행 기록에 따로 남긴다", async () => {
  const s = await setup();
  try {
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    const results = [{ type: "focus", target_id: "sinter_plant", status: "failed" }];
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/scene-results`, { results })).status, 204);
    const last = s.repo.steps(r.body.id).at(-1)!;
    assert.deepEqual([last.kind, last.ok, last.payload], ["scene_result", false, results]);
    assert.equal((await s.call("POST", `/api/learning/supplements/${r.body.id}/scene-results`, { results: [{ type: "x" }] })).status, 400);
  } finally {
    s.close();
  }
});

test("도구 검증: 다른 공정·없는 설비·없는 개념·형식 오류는 실행하지 않고 거절 기록을 남긴다", async () => {
  const db = openDatabase(":memory:");
  const evaluator = new FakeEvaluator();
  const ctx: LearningToolContext = {
    userId: "u1", section: "ironmaking", rubric: ironmaking, openMisconceptions: () => new LearningRepository(db).openMisconceptions("u1", "ironmaking"), retriever: new Retriever({ chunksFor: () => CHUNKS }),
    scene, questioner: new FakeTutor(), evaluator,
  };
  const steps: unknown[] = [];
  const run = (raw: Record<string, unknown>) => executeLearningTool(raw as { tool: "show_equipment" }, ctx, (s) => steps.push(s));
  const codes = async (raw: Record<string, unknown>) => {
    const r = await run(raw);
    return r.ok ? "ok" : r.error.error;
  };
  assert.equal(await codes({ tool: "show_equipment", call_id: "a", arguments: { section: "rolling", equipment_id: "coiler" } }), "forbidden_section");
  assert.equal(await codes({ tool: "show_equipment", call_id: "b", arguments: { section: "ironmaking", equipment_id: "converter" } }), "unknown_equipment");
  assert.equal(await codes({ tool: "create_quiz", call_id: "c", arguments: { section: "ironmaking", concept_id: "no_such" } }), "unknown_concept");
  assert.equal(await codes({ tool: "evaluate_answer", call_id: "d", arguments: { section: "ironmaking", concept_id: "no_such", question: "q", answer: "a", phase: "initial" } }), "unknown_concept");
  assert.equal(await codes({ tool: "delete_everything", call_id: "e", arguments: {} }), "invalid_arguments");
  assert.equal(await codes({ tool: "show_equipment", call_id: "f", arguments: { section: "ironmaking", equipment_id: "torpedo_car" } }), "ok");
  assert.equal(evaluator.calls.length, 0);
  assert.equal(steps.length, 6, "거절도 기록");
});

test("deleteUserData: 보충학습과 실행 기록도 지운다(live·all), seed면 그대로", async () => {
  const s = await setup();
  try {
    await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "sinter_purpose" });
    assert.equal(deleteUserData(s.db, "u1", { origin: "seed" }).learning_supplements, 0);
    assert.equal(deleteUserData(s.db, "u1").learning_supplements, 1);
    assert.equal(Number(s.db.prepare("SELECT COUNT(*) AS n FROM learning_supplement_steps").get()!.n), 0);
  } finally {
    s.close();
  }
});

test("시연 기록(seed) 오개념도 후보·설명에 쓰고(시연 계정), 맞히면 다시 권하지 않는다. 해결 처리는 실제 기록만", async () => {
  const s = await setup();
  try {
    s.memo("coke_reduction", "시연: 코크스를 불순물 제거로 앎", "learning", undefined, "seed");
    const list = await s.call("GET", "/api/learning/supplements?section=ironmaking");
    assert.deepEqual((list.body.candidates as { concept_id: string; reason: string }[]).map((c) => [c.concept_id, c.reason]), [["coke_reduction", "misconception"]]);
    const r = await s.call("POST", "/api/learning/supplements", { section: "ironmaking", concept_id: "coke_reduction" });
    assert.match(r.body.messages[0]!.text, /지난번 기록: 시연: 코크스를 불순물 제거로 앎/);
    s.tick(1000);
    const done = await s.call("POST", `/api/learning/supplements/${r.body.id}/answer`, { answer: "일산화탄소로 환원" });
    assert.equal(done.body.outcome, "resolved");
    assert.doesNotMatch(done.body.messages[1]!.text, /해결로 바꿨어요/, "시연 기록은 해결로 바꾸지 않음");
    assert.deepEqual((await s.call("GET", "/api/learning/supplements?section=ironmaking")).body.candidates, []);
  } finally {
    s.close();
  }
});
