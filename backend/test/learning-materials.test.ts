// 학습 근거 자료 검사: 공개 자료 메모(backend/data/ironmaking-sources.json)와 개념별 자료(content/materials/{섹션}/section.md)가
// 서로 맞는지(출처 id, 조각 id, 태그), 루브릭 개념과 검색 힌트가 자료와 이어지는지 본다. 자료를 고치면 여기서 먼저 걸린다.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { publicSources } from "../../llm/src/ironmaking-sources.js";
import { CONCEPT_HINTS, loadSectionChunks, parseSectionMarkdown } from "../../llm/src/retrieval.js";
import { SECTION_ORDER } from "../src/checkpoint/types.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";
import { loadFinalRubrics } from "../src/rubrics.js";

const scene = await loadSceneCatalog();
const rubrics = loadFinalRubrics();
const sourceIds = new Set(publicSources.map((s) => s.id));
const materialPath = (section: string) => join(process.cwd(), "content", "materials", section, "section.md");
const sectionsWithMaterial = SECTION_ORDER.filter((s) => existsSync(materialPath(s)));
const equipmentOf = (section: string) => new Set(scene.processes.find((p) => p.id === section)?.equipment.map((e) => e.id) ?? []);

test("공개 자료 메모: 자료 id는 겹치지 않고, 메모마다 출처 주소와 메모 문장이 있다", () => {
  assert.equal(sourceIds.size, publicSources.length, "자료 id 중복");
  for (const s of publicSources) {
    assert.ok(s.url && /^https?:\/\//.test(s.url), `${s.id}: 출처 주소`);
    assert.ok(s.notes.length > 0 && s.notes.every((n) => n.trim().length > 0), `${s.id}: 빈 메모`);
  }
});

test("section.md: 조각마다 출처([src:id])가 있고 모두 공개 자료에 있는 id, 조각 id는 겹치지 않으며 공개 자료 메모 id와도 다르다", () => {
  assert.ok(sectionsWithMaterial.length > 0, "개념별 자료가 하나 이상");
  for (const section of sectionsWithMaterial) {
    const chunks = parseSectionMarkdown(section, readFileSync(materialPath(section), "utf8"));
    const ids = chunks.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${section}: 조각 id 중복`);
    for (const c of chunks) {
      assert.ok(c.source_ids.length > 0, `${section}/${c.id}: 출처 없음`);
      for (const id of c.source_ids) assert.ok(sourceIds.has(id), `${section}/${c.id}: 없는 출처 ${id}`);
      assert.ok(!c.id.includes("#"), `${section}/${c.id}: 공개 자료 메모 id(자료id#번호)와 섞이지 않게`);
    }
  }
});

test("section.md: 조각 id 말고 붙인 태그는 그 공정의 3D 설비 id(data_v2.js)다", () => {
  for (const section of sectionsWithMaterial) {
    const equipment = equipmentOf(section);
    for (const c of parseSectionMarkdown(section, readFileSync(materialPath(section), "utf8"))) {
      for (const tag of c.tags.slice(1)) assert.ok(equipment.has(tag), `${section}/${c.id}: 설비가 아닌 태그 ${tag}`);
    }
  }
});

test("루브릭 개념마다 개념별 자료 조각이 있고, 검색 힌트는 있는 조각 id를 가리킨다", () => {
  for (const r of rubrics) {
    if (!existsSync(materialPath(r.section))) continue;
    const ids = new Set(loadSectionChunks(r.section).map((c) => c.id));
    for (const c of r.concepts) assert.ok(ids.has(c.concept_id), `${r.section}/${c.concept_id}: section.md 조각 없음(보충학습·검색 힌트가 이 조각을 찾는다)`);
  }
  for (const section of SECTION_ORDER) {
    const ids = new Set(loadSectionChunks(section).map((c) => c.id));
    for (const h of CONCEPT_HINTS[section]) assert.ok(ids.has(h.id), `${section}: 검색 힌트 ${h.id}에 맞는 조각 없음`);
  }
});
