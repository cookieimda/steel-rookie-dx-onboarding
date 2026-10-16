// 학습자 보고서 모델(frontend/login_ui/learner-report-model.js): API 응답이 빠지거나 모양이 달라도 보고서 모델이 나오는지.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const front = (p: string) => import(pathToFileURL(join(process.cwd(), "frontend", ...p.split("/"))).href);
const { buildReportModel, equipmentForConcept, reportFileName } = await front("login_ui/learner-report-model.js");
const { renderPages, EXAMPLE_SOURCES } = await front("login_ui/learner-report.js");
const { PROCESSES } = await front("3d-demo/data_v2.js");

test("보고서 모델: 예시 응답으로 헷갈린 개념·이해한 개념·복습 일정·설비 상태를 만든다", () => {
  const m = buildReportModel({ ...EXAMPLE_SOURCES, processes: PROCESSES }, { section: "ironmaking", today: "2026-10-15" });
  assert.equal(m.schema, 1);
  assert.equal(m.learner.name, "예시 학습자");
  assert.equal(m.section.name, "제선");
  assert.deepEqual(m.confused.map((c: { conceptId: string }) => c.conceptId), ["coke_reduction"]);
  assert.equal(m.confused[0].answer, "코크스는 고로 안에서 불을 피우는 연료예요.", "오개념 기록의 답변 원문을 붙인다");
  assert.equal(m.confused[0].equipmentId, "blast_furnace", "개념 이름에서 가장 앞의 설비(고로)");
  assert.deepEqual(m.understood.map((u: { conceptId: string }) => u.conceptId), ["sinter_purpose"]);
  assert.equal(m.equipment.find((e: { id: string }) => e.id === "blast_furnace").state, "bad");
  assert.equal(m.equipment.find((e: { id: string }) => e.id === "torpedo_car").state, "fog");
  assert.equal(m.checkpoint.status, "todo");
  assert.equal(reportFileName(m), "예시 학습자_제선_학습보고서_2026-10-15");
});

test("보고서 모델: 응답이 하나도 없어도(로그인 안 됨·API 없음) 빈 보고서를 만들고, 빠진 소스를 표시한다", () => {
  const m = buildReportModel({}, { section: "rolling" });
  assert.equal(m.section.name, "열간압연");
  assert.deepEqual([m.confused, m.understood, m.reviews, m.equipment], [[], [], [], []]);
  assert.equal(m.checkpoint.status, "none");
  assert.ok(Object.values(m.sources).every((v) => v === "missing"));
  assert.equal(renderPages(m).length, 2, "1쪽(한눈에 보기) + 마지막 쪽");
});

test("보고서 모델: 모양이 다른 응답(배열 아님, 필드 없음, 다른 공정)은 건너뛴다", () => {
  const m = buildReportModel({
    processes: PROCESSES,
    supplements: { candidates: "잘못된 값" },
    misconceptions: { misconceptions: [{ section: "steelmaking", concept_id: "x", summary: "다른 공정" }, null, { resolved: true, concept_id: "y" }] },
    reviews: { tasks: [{ section: "ironmaking" }] },
    dashboard: { trainee: { sections: { ironmaking: { passed: true, understanding: 0.9 } } } },
  }, { section: "ironmaking" });
  assert.deepEqual(m.confused, []);
  assert.equal(m.checkpoint.status, "passed");
  assert.equal(m.checkpoint.understanding, 0.9);
  assert.equal(m.reviews[0].name, "개념");
});

test("보고서 모델: 개념-설비 연결을 받으면 그 안에서 설비를 고른다", () => {
  const eq = [{ id: "coke_oven", name: "코크스 오븐" }, { id: "blast_furnace", name: "고로·장입 장치" }];
  assert.equal(equipmentForConcept("고로에서 코크스의 역할", eq), "blast_furnace");
  assert.equal(equipmentForConcept("고로에서 코크스의 역할", eq, ["coke_oven"]), "coke_oven");
  assert.equal(equipmentForConcept("관계없는 개념", eq), null);
  assert.equal(equipmentForConcept("소결의 목적", [{ id: "sinter_plant", name: "소결기" }]), "sinter_plant", "앞 두 글자로도 맞춘다");
});

test("보고서 그리기: 학습자가 쓴 글은 HTML로 해석하지 않는다", () => {
  const m = buildReportModel({ processes: PROCESSES, supplements: { candidates: [{ concept_id: "c", name: "<b>개념</b>", summary: "<script>x</script>" }] } }, { section: "ironmaking" });
  const html = renderPages(m).join("");
  assert.ok(!html.includes("<script>x</script>") && html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<b>개념</b>"));
});
