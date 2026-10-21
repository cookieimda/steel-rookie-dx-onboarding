import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SECTION_ORDER } from "../src/checkpoint/types.js";
import { loadFinalRubrics } from "../src/rubrics.js";

const FINAL = join(process.cwd(), "content", "rubrics", "final", "01_제선.json");
const ironmaking = JSON.parse(readFileSync(FINAL, "utf8"));

/** final/ 제선 루브릭과 제강 루브릭(개념 id를 고를 수 있음)을 담은 임시 폴더. */
function finalDir(steelConceptIds: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "final-"));
  copyFileSync(FINAL, join(dir, "01_제선.json"));
  const template = ironmaking.concepts[0];
  const concepts = steelConceptIds.map((id) => ({ ...template, concept_id: id, name: `제강 ${id}` }));
  writeFileSync(join(dir, "02_제강.json"), JSON.stringify({ ...ironmaking, section: "steelmaking", concepts }));
  return dir;
}

test("loadFinalRubrics: concept_id는 섹션이 달라도 겹치면 오류", (t) => {
  t.mock.method(console, "warn", () => {});
  const duplicate = ironmaking.concepts[1].concept_id;
  assert.throws(() => loadFinalRubrics(finalDir(["bof_role", duplicate])), new RegExp(`섹션이 달라도 겹치면 안 됩니다: .*${duplicate}\\(ironmaking, steelmaking\\)`));
  assert.equal(loadFinalRubrics(finalDir(["bof_role", "slag_role"])).length, 2);
});

test("현재 final 루브릭의 concept_id는 전체에서 고유하다", (t) => {
  t.mock.method(console, "warn", () => {});
  const ids = loadFinalRubrics().flatMap((r) => r.concepts.map((c) => c.concept_id));
  assert.equal(new Set(ids).size, ids.length);
});

test("섹션 목록은 SECTION_ORDER 하나이고 루브릭 스키마의 section enum과 같다", () => {
  const schema = JSON.parse(readFileSync(join(process.cwd(), "content", "rubrics", "schema.json"), "utf8"));
  assert.deepEqual([...schema.properties.section.enum].sort(), [...SECTION_ORDER].sort());
});
