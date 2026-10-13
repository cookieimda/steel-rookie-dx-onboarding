// 학습 화면 안내: 근거 자료로 답하지 못하는 말(예: 반광)이 학습 화면의 설비 작동 단계에 나오면 그 위치를 튜터에 넘긴다.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { learningUserPrompt, type LearningAgent, type LearningInput, type LearningReply } from "../../llm/src/learning-agent.js";
import { Retriever } from "../../llm/src/retrieval.js";
import { openDatabase } from "../src/db/database.js";
import { LearningRepository } from "../src/learning/repository.js";
import { createLearningRouter } from "../src/learning/routes.js";
import { findScreenMaterial, keywordsOf, loadScreenSteps, type ScreenStep } from "../src/learning/screen-material.js";
import { withRequestUser } from "../src/request-user.js";

test("loadScreenSteps: 3D(data_v2.js)와 2D(process-2d.js) 작동 단계를 모두 읽는다", async () => {
  const steps = await loadScreenSteps();
  const sinter = steps.filter((s) => s.equipment_id === "sinter_plant");
  assert.ok(sinter.length >= 7, `소결기 단계 ${sinter.length}개`);
  assert.ok(steps.some((s) => s.text.includes("반광")), "2D 작동 단계의 '반광' 문장");
  assert.ok(new Set(steps.map((s) => s.process_id)).size === 4, "공정 4개");
});

test("keywordsOf: 조사를 떼고 묻는 말·설비 같은 일반어는 뺀다", () => {
  assert.deepEqual(keywordsOf("반광이 뭐야?"), ["반광"]);
  assert.deepEqual(keywordsOf("이 설비의 역할은?"), []);
  assert.deepEqual(keywordsOf("드럼 믹서에서 뭘 해?"), ["드럼", "믹서"]);
});

test("findScreenMaterial: 질문 단어가 나오는 단계(같은 공정 먼저)를 설비 이름·단계 번호와 함께 준다", async () => {
  const steps = await loadScreenSteps();
  const found = findScreenMaterial("반광이 뭐야?", steps, "ironmaking");
  assert.ok(found.length > 0);
  assert.ok(found.every((m) => m.equipment_id === "sinter_plant" && m.text.includes("반광")));
  assert.deepEqual(found.map((m) => m.step).sort(), [1, 7]);
  assert.deepEqual(findScreenMaterial("이 설비의 역할은?", steps, "ironmaking"), [], "찾을 말이 없으면 빈 배열");
});

test("learningUserPrompt: 화면 단계 설명은 <screen_material>로 따로 넘긴다", () => {
  const input = {
    section: "ironmaking", question: "반광이 뭐야?", screen: { process_id: "ironmaking" }, chunks: [], history: [], openMisconceptions: [], concepts: [],
    screenMaterial: [{ equipment_id: "sinter_plant", equipment_name: "소결기", step: 7, text: "가루(반광)는 1번으로 되돌린다" }],
  } satisfies LearningInput;
  const prompt = learningUserPrompt(input);
  assert.match(prompt, /<screen_material>\n- 소결기 \(sinter_plant\) 작동 단계 7: 가루\(반광\)는 1번으로 되돌린다\n<\/screen_material>/);
  assert.match(learningUserPrompt({ ...input, screenMaterial: [] }), /<screen_material>\n\(없음\)\n<\/screen_material>/);
});

test("POST /api/chat: 질문 단어가 나오는 화면 단계 설명을 튜터에 넘긴다", async () => {
  const calls: LearningInput[] = [];
  const reply: LearningReply = { answer: "공개 자료에서는 확인하지 못했어요.", status: "unverified", source_ids: [], follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null };
  const agent: LearningAgent = { reply: async (input) => (calls.push(input), reply) };
  const steps: ScreenStep[] = [
    { process_id: "ironmaking", equipment_id: "sinter_plant", equipment_name: "소결기", step: 7, text: "가루(반광)는 1번으로 되돌린다" },
    { process_id: "ironmaking", equipment_id: "blast_furnace", equipment_name: "고로", step: 1, text: "소결광을 올린다" },
  ];
  const app = express();
  app.use(express.json());
  app.use("/api", withRequestUser);
  app.use(createLearningRouter({ repo: new LearningRepository(openDatabase(":memory:")), agent, retriever: new Retriever({ chunksFor: () => [] }), rubrics: [], screenSteps: steps }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "반광이 뭐야?", screen: { process_id: "ironmaking" } }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(calls[0].screenMaterial, [{ equipment_id: "sinter_plant", equipment_name: "소결기", step: 7, text: "가루(반광)는 1번으로 되돌린다" }]);
  } finally {
    server.close();
  }
});
