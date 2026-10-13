// 학습 모드 라우트(POST /api/chat)를 가짜 튜터로 검사한다. 실제 Gemini는 호출하지 않는다.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { LearningFormatError, type LearningAgent, type LearningInput, type LearningReply, type SceneCatalog } from "../../llm/src/learning-agent.js";
import { Retriever, type Chunk } from "../../llm/src/retrieval.js";
import { LlmUnavailableError } from "../src/checkpoint/types.js";
import { openDatabase } from "../src/db/database.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter, type LearningDeps } from "../src/learning/routes.js";
import { SAFETY_ANSWER } from "../src/learning/safety.js";
import { withRequestUser } from "../src/request-user.js";
import { loadFinalRubrics } from "../src/rubrics.js";
import { UsageLimitError } from "../src/usage.js";

const CHUNKS: Chunk[] = [
  { id: "posco-brochure-2015#3", section: "ironmaking", title: "", text: "고로에서는 코크스가 산화하며 철광석의 산소를 떼어낸다.", source_ids: ["posco-brochure-2015"], tags: ["blast_furnace"] },
  { id: "posco-newsroom-fe-2019#3", section: "ironmaking", title: "", text: "코크스가 일산화탄소를 만들어 산소를 떼어낸다.", source_ids: ["posco-newsroom-fe-2019"], tags: [] },
];

const okReply = (over: Partial<LearningReply> = {}): LearningReply => ({
  answer: "코크스는 환원제예요.",
  status: "grounded",
  source_ids: ["posco-brochure-2015#3"],
  follow_up: "일산화탄소는 어디서 생기나요?",
  detected_misconception: null,
  scene_actions: [],
  keyword_card: null,
  ...over,
});

const SCENE: SceneCatalog = {
  processes: [{ id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로·장입 장치" }] }],
};

/** 받은 입력을 기록하고 정해 둔 응답(또는 예외)을 돌려주는 가짜 튜터. */
class FakeAgent implements LearningAgent {
  calls: LearningInput[] = [];
  next: () => Promise<LearningReply> = async () => okReply();
  async reply(input: LearningInput): Promise<LearningReply> {
    this.calls.push(input);
    return this.next();
  }
}

async function setup(scene?: SceneCatalog, checkpointProgress?: LearningDeps["checkpointProgress"]) {
  const db = openDatabase(":memory:");
  const repo = new LearningRepository(db);
  const agent = new FakeAgent();
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  let clock = 0;
  app.use(createLearningRouter({
    repo,
    agent,
    retriever: new Retriever({ chunksFor: (s) => CHUNKS.filter((c) => c.section === s) }),
    rubrics: loadFinalRubrics(),
    scene,
    checkpointProgress,
    now: () => new Date(Date.UTC(2026, 9, 2, 0, 0, clock++)).toISOString(),
  }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ask = async (body: unknown, user = "minsu") => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": user }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as any };
  };
  const history = async (sessionId: string, user = "minsu") => {
    const res = await fetch(`${base}/api/chat/sessions/${sessionId}`, { headers: { "x-user-id": user } });
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, repo, agent, ask, history, close: () => server.close() };
}

test("새 질문: 근거 조각·루브릭 개념을 튜터에 넘기고, 출처를 자료 정보로 바꿔 돌려주며 대화를 저장한다", async () => {
  const t = await setup();
  try {
    const { status, json } = await t.ask({ question: "고로에 코크스를 왜 넣나요?", screen: { process_id: "ironmaking", equipment_id: "blast_furnace" } });
    assert.equal(status, 200);
    assert.equal(json.answer, "코크스는 환원제예요.");
    assert.equal(json.follow_up, "일산화탄소는 어디서 생기나요?");
    assert.deepEqual(json.sources.map((s: { id: string }) => s.id), ["posco-brochure-2015"]);
    assert.ok(json.sources[0].url.startsWith("https://"));
    assert.match(json.session_id, /^[0-9a-f-]{36}$/);

    const input = t.agent.calls[0];
    assert.equal(input.section, "ironmaking");
    assert.equal(input.screen.equipment_id, "blast_furnace");
    assert.ok(input.chunks.length > 0 && input.chunks[0].id === "posco-brochure-2015#3"); // 설비 태그 가중치
    assert.ok(input.concepts.some((c) => c.concept_id === "coke_reduction"));
    assert.deepEqual(input.history, []);

    const saved = t.repo.recentTurns(json.session_id, 6);
    assert.deepEqual(saved.map((x) => [x.status, x.equipment_id, x.source_ids]), [["grounded", "blast_furnace", ["posco-brochure-2015#3"]]]);
  } finally {
    t.close();
  }
});

test("화면 조작: 화면 목록과 설비 이름을 튜터에 넘기고, 튜터의 scene_actions를 응답에 담는다", async () => {
  const t = await setup(SCENE);
  try {
    t.agent.next = async () => okReply({ scene_actions: [{ type: "focus", target_id: "blast_furnace" }] });
    const { json } = await t.ask({ question: "고로가 뭐예요?", screen: { process_id: "ironmaking", equipment_id: "blast_furnace" } });
    assert.deepEqual(json.scene_actions, [{ type: "focus", target_id: "blast_furnace" }]);
    assert.equal(t.agent.calls[0].scene, SCENE);
    assert.equal(t.agent.calls[0].screen.equipment_name, "고로·장입 장치");

    // 전체 공정 화면에서는 답은 제선 기준이지만 화면은 process_id 없음으로 넘긴다.
    t.agent.next = async () => okReply();
    const overview = await t.ask({ question: "고로가 뭐예요?", screen: { process_id: null } });
    assert.deepEqual(overview.json.scene_actions, []);
    assert.equal(t.agent.calls[1].section, "ironmaking");
    assert.equal(t.agent.calls[1].screen.process_id, null);

    const safety = await t.ask({ question: "고로 밸브는 어떻게 열어요?" });
    assert.deepEqual(safety.json.scene_actions, []);
  } finally {
    t.close();
  }
});

test("같은 세션의 다음 질문에는 이전 대화가 넘어가고, 다른 사람·없는 세션은 404", async () => {
  const t = await setup();
  try {
    const first = await t.ask({ question: "코크스가 뭐예요?" });
    await t.ask({ question: "그럼 그건 어디서 만들어요?", session_id: first.json.session_id });
    assert.deepEqual(t.agent.calls[1].history, [{ question: "코크스가 뭐예요?", answer: "코크스는 환원제예요." }]);
    // 질문만으로는 근거를 못 찾지만 직전 대화(코크스)를 붙여 다시 찾는다.
    assert.ok(t.agent.calls[1].chunks.length > 0);

    assert.equal((await t.ask({ question: "코크스", session_id: first.json.session_id }, "jiwoo")).status, 404);
    assert.equal((await t.ask({ question: "코크스", session_id: "00000000-0000-4000-8000-000000000000" })).status, 404);
    assert.equal(t.agent.calls.length, 2);
  } finally {
    t.close();
  }
});

test("저장된 대화: 순서대로 질문·답·근거 판정·출처를 돌려주고, 다른 사람·없는 세션·잘못된 id는 404", async () => {
  const t = await setup();
  try {
    const first = await t.ask({ question: "코크스가 뭐예요?", screen: { process_id: "ironmaking", equipment_id: "coke_oven" } });
    await t.ask({ question: "고로 밸브는 어떻게 열어요?", session_id: first.json.session_id });
    const { status, json } = await t.history(first.json.session_id);
    assert.equal(status, 200);
    assert.equal(json.session_id, first.json.session_id);
    assert.deepEqual(
      json.turns.map((x: any) => [x.question, x.status, x.equipment_id, x.sources.map((s: any) => s.id)]),
      [
        ["코크스가 뭐예요?", "grounded", "coke_oven", ["posco-brochure-2015"]],
        ["고로 밸브는 어떻게 열어요?", "safety_redirect", null, []],
      ],
    );
    assert.equal(json.turns[0].answer, "코크스는 환원제예요.");
    assert.ok(json.turns[0].sources[0].url.startsWith("https://"));

    assert.equal((await t.history(first.json.session_id, "jiwoo")).status, 404);
    assert.equal((await t.history("00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await t.history("not-a-uuid")).status, 404);
  } finally {
    t.close();
  }
});

test("안전 질문은 튜터를 부르지 않고 고정 답변을 safety_redirect로 저장한다", async () => {
  const t = await setup();
  try {
    const { json } = await t.ask({ question: "고로 밸브는 어떻게 열어요?" });
    assert.deepEqual([json.answer, json.status, json.sources], [SAFETY_ANSWER, "safety_redirect", []]);
    assert.equal(t.agent.calls.length, 0);
    assert.equal(t.repo.recentTurns(json.session_id, 6)[0].status, "safety_redirect");
  } finally {
    t.close();
  }
});

test("감지된 오개념은 질문 원문과 함께 source=learning으로 기록되고, 다음 질문의 학습자 메모로 넘어간다", async () => {
  const t = await setup();
  try {
    t.agent.next = async () => okReply({ detected_misconception: { concept_id: "coke_reduction", summary: "코크스를 불순물 제거로 앎" } });
    const first = await t.ask({ question: "코크스가 불순물 없애는 거죠?" });
    const row = t.db.prepare("SELECT source, concept_id, answer_text, resolved FROM misconceptions WHERE user_id = 'minsu'").get();
    assert.deepEqual({ ...row }, { source: "learning", concept_id: "coke_reduction", answer_text: "코크스가 불순물 없애는 거죠?", resolved: 0 });

    t.agent.next = async () => okReply();
    await t.ask({ question: "코크스 더 알려 줘", session_id: first.json.session_id });
    assert.deepEqual(t.agent.calls[1].openMisconceptions, [{ concept_id: "coke_reduction", summary: "코크스를 불순물 제거로 앎" }]);
  } finally {
    t.close();
  }
});

test("잘못된 요청은 400", async () => {
  const t = await setup();
  try {
    assert.equal((await t.ask({ question: "  " })).status, 400);
    assert.equal((await t.ask({ question: "x", screen: { process_id: "unknown" } })).status, 400);
    assert.equal((await t.ask({ question: "x", screen: { equipment_id: "Bad Id!" } })).status, 400);
    assert.equal((await t.ask({ question: "x", session_id: "not-a-uuid" })).status, 400);
  } finally {
    t.close();
  }
});

test("오류: 하루 한도 429, Gemini 키 없음 503, 연결 오류 502, 형식 오류 502이고 대화는 저장하지 않는다", async () => {
  const t = await setup();
  try {
    const cases: [Error, number][] = [
      [new UsageLimitError(150), 429],
      [new LlmUnavailableError("no key", 503), 503],
      [new LlmUnavailableError("down"), 502],
      [new LearningFormatError("bad"), 502],
    ];
    for (const [error, status] of cases) {
      t.agent.next = async () => { throw error; };
      assert.equal((await t.ask({ question: "코크스가 뭐예요?" })).status, status, error.constructor.name);
    }
    assert.equal(Number(t.db.prepare("SELECT COUNT(*) AS n FROM learning_turns").get()?.n), 0);
  } finally {
    t.close();
  }
});

test("같은 세션에서 답변 중에 또 질문하면 409", async () => {
  const t = await setup();
  try {
    const first = await t.ask({ question: "코크스가 뭐예요?" });
    let release!: () => void;
    t.agent.next = () => new Promise((r) => { release = () => r(okReply()); });
    const pending = t.ask({ question: "소결은요?", session_id: first.json.session_id });
    while (t.agent.calls.length < 2) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await t.ask({ question: "고로는요?", session_id: first.json.session_id })).status, 409);
    release();
    assert.equal((await pending).status, 200);
  } finally {
    t.close();
  }
});

test("키워드 카드: 카드 개념을 튜터에 넘기고, 튜터가 고른 카드를 루브릭 내용과 출처로 채워 돌려준다(호출 1회)", async () => {
  const t = await setup();
  try {
    t.agent.next = async () => okReply({ keyword_card: { concept_id: "coke_reduction" } });
    const { json } = await t.ask({ question: "코크스 역할 정리해 줘", screen: { process_id: "ironmaking" } });
    assert.deepEqual(t.agent.calls[0].keywordConcepts?.map((c) => c.concept_id), ["coke_reduction"]);
    assert.equal(t.agent.calls.length, 1);
    assert.equal(json.keyword_card.concept_id, "coke_reduction");
    assert.deepEqual(json.keyword_card.keywords, [{ term: "일산화탄소", aliases: ["CO"] }, { term: "환원", aliases: [] }]);
    assert.equal(json.keyword_card.source.id, "posco-newsroom-fe-2019");
    assert.ok(json.keyword_card.source.url.startsWith("https://"));

    // 카드를 고르지 않은 답변·안전 질문은 null
    t.agent.next = async () => okReply();
    assert.equal((await t.ask({ question: "코크스가 뭐예요?" })).json.keyword_card, null);
    assert.equal((await t.ask({ question: "고로 밸브는 어떻게 열어요?" })).json.keyword_card, null);
  } finally {
    t.close();
  }
});

test("키워드 카드: 루브릭이 없는 섹션은 카드 개념이 비어 있다", async () => {
  const t = await setup();
  try {
    await t.ask({ question: "전로가 뭐예요?", screen: { process_id: "steelmaking" } });
    assert.deepEqual(t.agent.calls[0].keywordConcepts, []);
  } finally {
    t.close();
  }
});

test("체크포인트 상태: 재도전 개념은 튜터에 넘기고, 진행 중이면 카드 개념을 비우며 튜터가 카드를 내도 붙이지 않는다", async () => {
  let inProgress = false;
  const seen: [string, string][] = [];
  const t = await setup(undefined, (userId, section) => {
    seen.push([userId, section]);
    return { retry_concept_ids: ["coke_reduction"], in_progress: inProgress };
  });
  try {
    t.agent.next = async () => okReply({ keyword_card: { concept_id: "coke_reduction" } });
    const before = await t.ask({ question: "코크스 역할 정리해 줘" });
    assert.deepEqual(t.agent.calls[0].retryConcepts, ["coke_reduction"]);
    assert.equal(before.json.keyword_card.concept_id, "coke_reduction");
    assert.deepEqual(seen, [["minsu", "ironmaking"]]);

    inProgress = true;
    const during = await t.ask({ question: "코크스 역할 정리해 줘" });
    assert.deepEqual(t.agent.calls[1].keywordConcepts, []);
    assert.equal(during.json.keyword_card, null);
  } finally {
    t.close();
  }
});
