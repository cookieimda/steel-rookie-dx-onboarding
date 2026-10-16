// 오개념·복습 표시 정보(공정 › 소단원 › 개념, 다시 볼 핵심): backend/src/me/concept-topic.ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTopicResolver, shortEquipmentName } from "../src/me/concept-topic.js";
import { loadFinalRubrics } from "../src/rubrics.js";
import type { SceneCatalog } from "../../llm/src/learning-agent.js";

const SCENE: SceneCatalog = {
  processes: [
    { id: "ironmaking", name: "제선", equipment: [{ id: "sinter_plant", name: "소결기" }, { id: "blast_furnace", name: "고로·장입 장치" }, { id: "hot_stove", name: "열풍로·풍구" }] },
    { id: "steelmaking", name: "제강", equipment: [{ id: "ladle_transfer", name: "래들 이송" }, { id: "bof_converter", name: "전로 (BOF·LD)" }] },
  ],
};
const topic = createTopicResolver({ rubrics: loadFinalRubrics(), demo: { steelmaking: [{ id: "demo_bof_decarburization", name: "전로 취련과 탈탄" }, { id: "demo_ladle", name: "래들로 옮기기", equipment_ids: ["ladle_transfer"] }] }, scene: SCENE });

test("shortEquipmentName: 괄호를 빼고 '·' 앞부분만", () => {
  assert.equal(shortEquipmentName("고로·장입 장치"), "고로");
  assert.equal(shortEquipmentName("전로 (BOF·LD)"), "전로");
  assert.equal(shortEquipmentName("래들 이송"), "래들 이송");
});

test("루브릭 개념: 소단원은 개념의 첫 설비, 다시 볼 핵심은 처음 놓친 핵심 요소(없으면 첫 요소)", () => {
  const sinter = topic("ironmaking", "sinter_purpose");
  assert.deepEqual([sinter.unit, sinter.subunit, sinter.concept, sinter.label], ["제선", "소결기", "소결의 목적", "제선 › 소결기 › 소결의 목적"]);
  assert.equal(sinter.point, "소결은 철광석을 고로에 넣기 좋은 소결광으로 만드는 전처리 공정", "문장 끝 '이다.'를 뗀다");
  const coke = topic("ironmaking", "coke_reduction", 1);
  assert.equal(coke.subunit, "고로");
  assert.equal(coke.point, "일산화탄소가 철광석에서 산소를 떼어내는 환원에 관여한다", "explain_from 1 = 두 번째 핵심 요소");
  assert.equal(topic("ironmaking", "coke_reduction", 9).point, "코크스는 열풍과 반응해 일산화탄소를 만든다", "범위를 벗어나면 첫 요소");
});

test("시연 개념 목록은 이름만, 설비 id로 남은 기록은 '설비의 역할', 모르는 id는 공정만", () => {
  assert.deepEqual(topic("steelmaking", "demo_bof_decarburization"), { unit: "제강", subunit: null, concept: "전로 취련과 탈탄", label: "제강 › 전로 취련과 탈탄", point: null });
  assert.equal(topic("steelmaking", "demo_ladle").label, "제강 › 래들 이송 › 래들로 옮기기", "시연 개념의 equipment_ids가 소단원");
  assert.deepEqual(topic("steelmaking", "ladle_transfer"), { unit: "제강", subunit: "래들 이송", concept: "래들 이송의 역할", label: "제강 › 래들 이송의 역할", point: null });
  assert.deepEqual(topic("steelmaking", "bof"), { unit: "제강", subunit: null, concept: null, label: "제강 › 개념", point: null });
});
