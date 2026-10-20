// 사고 사례 역할·관문(lab/incidents.ts의 checkRolesAndGates): 사례 파일의 역할·관문이 타임라인·갈림길과 맞는지.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRolesAndGates, loadIncidents, scenarioView } from "../src/lab/incidents.js";

const { scenarios } = loadIncidents();

test("사고 사례: 네 사례 모두 역할·관문이 있고, 장면마다 움직인 역할이 정해져 있다", () => {
  assert.equal(scenarios.length, 4);
  for (const s of scenarios) {
    assert.ok((s.roles ?? []).length >= 3, s.id);
    assert.ok((s.gates ?? []).length >= 2, s.id);
    for (const t of s.timeline) assert.ok(t.actor, `${s.id} ${t.time}`);
    // 건너뛴 관문은 모두 갈림길의 안전한 선택으로 지킬 수 있다(화면에서 '다르게 하면 지킴'을 보여 줄 수 있게)
    for (const g of s.gates ?? []) if (g.actual === "skipped") assert.ok(g.passed_by?.length, `${s.id} ${g.id}`);
  }
});

test("사고 사례: 네 사례 모두 실제 공개 사례의 출처(사례집·기관·사례 번호·쪽·주소)가 있고 공정이 하나씩이다", () => {
  for (const s of scenarios) {
    assert.ok(s.source, s.id);
    assert.match(s.source!.title, /철강산업 중대재해 사례집/);
    assert.match(s.source!.publisher, /한국산업안전보건공단/);
    assert.ok(s.source!.case && s.source!.page && /^https:\/\//.test(s.source!.url), s.id);
  }
  assert.deepEqual(scenarios.map((s) => s.section).sort(), ["continuous_casting", "ironmaking", "rolling", "steelmaking"]);
});

test("사고 사례: 없는 역할·장면이나 실제로 일어난 선택으로 지키는 관문은 막는다", () => {
  const base = structuredClone(scenarios[0]);
  const bad = (mutate: (s: typeof base) => void) => { const s = structuredClone(base); mutate(s); return () => checkRolesAndGates(s); };
  assert.throws(bad((s) => { s.timeline[0].actor = "nobody"; }), /없는 역할/);
  assert.throws(bad((s) => { s.gates![0].role = "nobody"; }), /없는 역할/);
  assert.throws(bad((s) => { s.gates![0].at = 99; }), /장면 99/);
  assert.throws(bad((s) => { s.gates![0].passed_by = [{ at: 1, option: 0 }]; }), /실제로 일어난 선택/);
  assert.throws(bad((s) => { s.gates![0].passed_by = [{ at: 0, option: 1 }]; }), /갈림길 보기/);
});

test("사고 사례: 화면에 보내는 사례에 역할·관문·검수 여부가 실린다", () => {
  const v = scenarioView(scenarios[0], "u1");
  assert.ok(v.roles.length && v.gates.length);
  assert.equal(v.gates_reviewed, false);
  assert.equal(v.source?.page, 22);
  assert.ok(v.timeline.every((t) => t.actor));
});
