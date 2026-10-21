// 학습 모드 화면 목록(scene-catalog.ts)이 data_v2.js를 읽고, 형식이 틀리면 막는지 검사한다.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SECTION_ORDER } from "../src/checkpoint/types.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";

test("data_v2.js에서 공정 4개(섹션 순서)와 설비 24개의 id·이름, 작동 단계가 있는지(operation)만 읽는다", async () => {
  const scene = await loadSceneCatalog();
  assert.deepEqual(scene.processes.map((p) => p.id), SECTION_ORDER);
  const equipment = scene.processes.flatMap((p) => p.equipment);
  assert.equal(equipment.length, 24);
  assert.deepEqual(scene.processes[0].equipment.find((e) => e.id === "blast_furnace"), { id: "blast_furnace", name: "고로·장입 장치", operation: true });
  // 작동 단계(steps)가 없는 설비는 operation이 없다(작동 보기를 시키지 않는다).
  assert.deepEqual(scene.processes[0].equipment.find((e) => e.id === "torpedo_car"), { id: "torpedo_car", name: "토페도카" });
  assert.deepEqual(Object.keys(scene.processes[0]).sort(), ["equipment", "id", "name"]);
});

test("공정 id가 섹션이 아니거나 설비 id가 겹치면 예외", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scene-catalog-"));
  const file = (name: string, processes: unknown) => {
    const path = join(dir, name);
    writeFileSync(path, `export const PROCESSES = ${JSON.stringify(processes)};\n`);
    return path;
  };
  const eq = (id: string) => ({ id, name: id });
  await assert.rejects(loadSceneCatalog(file("bad-process.js", [{ id: "site", name: "전체", equipment: [eq("a")] }])), /형식 오류/);
  await assert.rejects(loadSceneCatalog(file("bad-id.js", [{ id: "ironmaking", name: "제선", equipment: [eq("Bad Id")] }])), /형식 오류/);
  await assert.rejects(
    loadSceneCatalog(file("dup.js", [{ id: "ironmaking", name: "제선", equipment: [eq("ladle")] }, { id: "steelmaking", name: "제강", equipment: [eq("ladle")] }])),
    /겹칩니다/,
  );
});
