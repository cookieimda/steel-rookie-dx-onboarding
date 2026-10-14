// 학습 상태 HUD의 순수 계산(frontend/3d-demo/learn-hud-state.js). 브라우저 없이 확인한다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadFinalRubrics } from "../src/rubrics.js";

const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { CONCEPT_EQUIPMENT, PIN, STATUS_ORDER, conceptStatuses, equipmentStatuses, groupBySection, factChip, pinVisibility } = await load("learn-hud-state.js");
const { PROCESSES } = await load("data_v2.js");

const EQUIPMENT_IDS = new Set((PROCESSES as { id: string; equipment: { id: string }[] }[]).flatMap((p) => p.equipment.map((e) => e.id)));
const SECTION_OF = new Map((PROCESSES as { id: string; equipment: { id: string }[] }[]).flatMap((p) => p.equipment.map((e) => [e.id, p.id] as const)));

test("개념 → 설비 표: 설비 id는 data_v2.js의 24개 안에 있고, 섹션이 맞고, 개념 id는 final 루브릭에 있다", () => {
  const rubrics = loadFinalRubrics();
  for (const [section, concepts] of Object.entries(CONCEPT_EQUIPMENT as Record<string, Record<string, string[]>>)) {
    const rubric = rubrics.find((r) => r.section === section);
    for (const [conceptId, eqIds] of Object.entries(concepts)) {
      assert.ok(rubric, `${section}: final 루브릭이 없는데 개념 ${conceptId}가 표에 있다`);
      assert.ok(rubric!.concepts.some((c) => c.concept_id === conceptId), `${section}.${conceptId}: final 루브릭에 없는 개념`);
      assert.ok(eqIds.length > 0, `${conceptId}: 설비가 비어 있다`);
      for (const eq of eqIds) {
        assert.ok(EQUIPMENT_IDS.has(eq), `${conceptId}: 모르는 설비 ${eq}`);
        assert.equal(SECTION_OF.get(eq), section, `${conceptId}: ${eq}는 ${SECTION_OF.get(eq)} 설비인데 ${section}에 있다`);
      }
    }
  }
});

test("final 루브릭의 개념은 모두 표에 있다(새 개념을 넣으면 설비를 붙이라고 알린다)", () => {
  for (const rubric of loadFinalRubrics()) {
    for (const c of rubric.concepts) assert.ok(CONCEPT_EQUIPMENT[rubric.section]?.[c.concept_id], `${rubric.section}.${c.concept_id}: learn-hud-state.js CONCEPT_EQUIPMENT에 설비를 붙여야 한다`);
  }
});

test("개념 상태: 기록 없음 → open, 통과 → passed, 통과 뒤 새 개념 → unconfirmed", () => {
  assert.deepEqual(conceptStatuses("ironmaking", null), { sinter_purpose: "open", coke_reduction: "open", blast_furnace_hot_metal: "open" });
  assert.deepEqual(conceptStatuses("ironmaking", { unlocked: true, retry_concept_ids: [], unconfirmed_concept_ids: ["coke_reduction"] }), { sinter_purpose: "passed", coke_reduction: "unconfirmed", blast_furnace_hot_metal: "passed" });
  assert.deepEqual(conceptStatuses("steelmaking", null), {}, "루브릭이 없는 섹션은 비어 있다");
});

test("개념 상태: 미해결 체크포인트 오개념·재도전 개념은 review이고 통과보다 우선한다", () => {
  const mis = [
    { concept_id: "sinter_purpose", source: "checkpoint", resolved: false },
    { concept_id: "coke_reduction", source: "checkpoint", resolved: true },
    { concept_id: "blast_furnace_hot_metal", source: "learning", resolved: false },
  ];
  assert.deepEqual(conceptStatuses("ironmaking", { unlocked: true, retry_concept_ids: [], unconfirmed_concept_ids: [] }, mis), { sinter_purpose: "review", coke_reduction: "passed", blast_furnace_hot_metal: "passed" }, "해결된 오개념과 학습 모드 메모는 review가 아니다");
  assert.deepEqual(conceptStatuses("ironmaking", { unlocked: false, retry_concept_ids: ["coke_reduction"], unconfirmed_concept_ids: [] }), { sinter_purpose: "open", coke_reduction: "review", blast_furnace_hot_metal: "open" });
  assert.equal(conceptStatuses("ironmaking", null, [{ concept_id: "old_concept", source: "checkpoint", resolved: false }]).old_concept, "review", "표에 없는 개념의 오개념도 남긴다");
});

test("설비 상태: 개념이 여럿 걸린 설비는 가장 높은 상태를 쓰고 개념 목록을 함께 준다", () => {
  const eq = equipmentStatuses("ironmaking", { sinter_purpose: "passed", coke_reduction: "review", blast_furnace_hot_metal: "passed" });
  assert.equal(eq.sinter_plant.status, "passed");
  assert.equal(eq.coke_oven.status, "review");
  assert.equal(eq.blast_furnace.status, "review", "coke_reduction(review) + blast_furnace_hot_metal(passed) → review");
  assert.deepEqual(eq.blast_furnace.concepts.map((c: { concept_id: string }) => c.concept_id).sort(), ["blast_furnace_hot_metal", "coke_reduction"]);
  assert.equal(eq.taphole_casthouse.status, "passed");
  assert.equal(eq.torpedo_car, undefined, "개념이 없는 설비는 없다(open 핀도 안 붙는다)");
  assert.deepEqual(STATUS_ORDER, ["open", "unconfirmed", "passed", "review"]);
});

test("핀 문구·보임: open은 상태 칩 없음, 숫자 칩은 선택·호버 때만", () => {
  for (const s of STATUS_ORDER) assert.ok(PIN[s], `${s} 핀 정의`);
  assert.equal(PIN.open.text, "");
  assert.ok(PIN.review.pulse && !PIN.passed.pulse);
  const fact = { value: "원료 2.5t → 1t", label: "x", src: "" };
  assert.deepEqual(pinVisibility("open", { fact }), { statusChip: false, factChip: false });
  assert.deepEqual(pinVisibility("passed", { fact }), { statusChip: true, factChip: false });
  assert.deepEqual(pinVisibility("passed", { fact, selected: true }), { statusChip: true, factChip: true });
  assert.deepEqual(pinVisibility("open", { fact, hovered: true }), { statusChip: false, factChip: true });
  assert.deepEqual(pinVisibility("review", { fact: null, selected: true }), { statusChip: true, factChip: false });
});

test("숫자 칩: data_v2 설비의 facts[0]을 쓰고 없으면 null", () => {
  const sinter = (PROCESSES as { id: string; equipment: { id: string }[] }[])[0].equipment.find((e) => e.id === "sinter_plant");
  assert.deepEqual(factChip(sinter), { value: "원료 2.5t → 1t", label: "소결광 1톤에 드는 원료(수분·연료 포함)", src: "US EPA AP-42 12.5" });
  assert.equal(factChip({ facts: [] }), null);
  assert.equal(factChip(undefined), null);
});

test("오개념 섹션별 묶기", () => {
  const g = groupBySection([{ section: "ironmaking", concept_id: "a" }, { section: "rolling", concept_id: "b" }, { section: "ironmaking", concept_id: "c" }, { concept_id: "no-section" }]);
  assert.deepEqual(Object.keys(g).sort(), ["ironmaking", "rolling"]);
  assert.equal(g.ironmaking.length, 2);
});
