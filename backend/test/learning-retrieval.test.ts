import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  expandQuery,
  loadSectionChunks,
  MAX_RESULTS,
  parseSectionMarkdown,
  publicSourceChunks,
  Retriever,
  type Chunk,
  EQUIPMENT_WORDS,
} from "../../llm/src/retrieval.js";
import { publicSources, sectionOf } from "../../llm/src/ironmaking-sources.js";
import { loadSceneCatalog } from "../src/learning/scene-catalog.js";

// 공개 자료 메모 수(메모 하나가 조각 하나).
const NOTE_COUNT = publicSources.reduce((n, s) => n + s.notes.length, 0);

const chunk = (id: string, text: string, tags: string[] = [], section: Chunk["section"] = "ironmaking"): Chunk =>
  ({ id, section, title: "", text, source_ids: [`src-${id}`], tags });

test("publicSourceChunks: 공개 자료 메모 하나가 조각 하나이고, 자료의 공정과 그 공정 설비 태그가 붙는다", () => {
  const chunks = publicSourceChunks();
  assert.equal(chunks.length, NOTE_COUNT);
  assert.ok(chunks.every((c) => c.source_ids.length === 1 && c.id.startsWith(`${c.source_ids[0]}#`)));
  for (const c of chunks) {
    const source = publicSources.find((s) => s.id === c.source_ids[0])!;
    assert.equal(c.section, sectionOf(source));
    assert.ok(c.tags.every((t) => t in EQUIPMENT_WORDS[c.section]), `${c.id}: ${c.tags}`);
  }
  const sinter = chunks.find((c) => c.text.includes("소결광으로 만드는 전처리"))!;
  assert.ok(sinter.tags.includes("sinter_plant"));
});

test("설비 태그 낱말은 화면 목록(data_v2.js)의 공정·설비와 같다", async () => {
  const scene = await loadSceneCatalog();
  for (const p of scene.processes) assert.deepEqual(Object.keys(EQUIPMENT_WORDS[p.id]).sort(), p.equipment.map((e) => e.id).sort(), p.id);
});

test("공정 4개·설비 24개 모두 공개 자료 메모가 있고, 설비 이름으로 물으면 그 설비 메모가 맨 위에 온다", async () => {
  const chunks = publicSourceChunks();
  const r = new Retriever();
  const scene = await loadSceneCatalog();
  for (const p of scene.processes) {
    for (const e of p.equipment) {
      assert.ok(chunks.some((c) => c.section === p.id && c.tags.includes(e.id)), `${p.id}/${e.id} 메모 없음`);
      // 설비 이름의 첫 부분(가운뎃점·괄호 앞)으로 묻는다. 예: "고로·장입 장치" → "고로"
      const name = e.name.split(/[·(]/)[0]!.trim();
      const top = r.retrieve(p.id, `${name}는 무슨 일을 해?`, { process_id: p.id, equipment_id: e.id })[0];
      assert.ok(top?.tags.includes(e.id), `${p.id}/${e.id}: 맨 위 조각 ${top?.id}`);
    }
  }
});

test("retrieve: 실제 공개 자료에서 질문과 맞는 메모를 찾는다", () => {
  const r = new Retriever({ glossaryFor: () => [{ term: "용선", aliases: ["쇳물"] }] });
  const finex = r.retrieve("ironmaking", "FINEX가 뭐예요?");
  assert.ok(finex.length > 0 && finex.length <= MAX_RESULTS);
  assert.ok(finex.slice(0, 3).every((c) => c.text.includes("FINEX")), "FINEX 메모가 위에 와야 한다");

  const coke = r.retrieve("ironmaking", "고로에 코크스를 왜 넣나요?");
  assert.ok(coke.some((c) => c.text.includes("일산화탄소")), "코크스의 환원 역할 메모가 들어가야 한다");

  // "몇 도"는 메모의 "고온"·"온도"로도 찾는다(메모는 "1,300℃의 고온"처럼 적는다).
  const temp = r.retrieve("ironmaking", "코크스는 몇 도에서 만들어?");
  assert.ok(temp.some((c) => c.text.includes("1,300℃")), "코크스 건류 온도 메모가 들어가야 한다");
});

test("retrieve: 관련 없는 질문이나 조각이 없는 섹션은 빈 배열", () => {
  const r = new Retriever();
  assert.deepEqual(r.retrieve("ironmaking", "오늘 점심 뭐 먹지"), []);
  assert.deepEqual(r.retrieve("ironmaking", "   "), []);
  assert.deepEqual(new Retriever({ chunksFor: () => [] }).retrieve("rolling", "권취기는 뭐 해요?"), []);
});

test("retrieve: 조사가 붙어도 맞고(고로에서·고로를), 다른 섹션 조각은 쓰지 않는다", () => {
  const r = new Retriever({
    chunksFor: (s) => [chunk("a", "고로에서 용선을 만든다"), chunk("b", "전로에서 용강을 만든다", [], "steelmaking")].filter((c) => c.section === s),
  });
  assert.deepEqual(r.retrieve("ironmaking", "고로를 설명해 줘").map((c) => c.id), ["a"]);
  assert.deepEqual(r.retrieve("ironmaking", "전로는?"), []);
});

test("retrieve: 용어집 동의어로도 찾는다(쇳물 → 용선)", () => {
  const chunks = [chunk("a", "고로는 용선을 만든다")];
  const glossary = [{ term: "용선", aliases: ["쇳물"] }];
  assert.equal(expandQuery("쇳물이 뭐예요", glossary), "쇳물이 뭐예요 용선");
  assert.deepEqual(new Retriever({ chunksFor: () => chunks }).retrieve("ironmaking", "쇳물"), []);
  assert.deepEqual(new Retriever({ chunksFor: () => chunks, glossaryFor: () => glossary }).retrieve("ironmaking", "쇳물").map((c) => c.id), ["a"]);
});

test("retrieve: 현재 화면의 설비 조각을 앞으로 올리되, 질문과 무관한 조각을 끌어오지는 않는다", () => {
  const chunks = [chunk("furnace", "고로 원료는 소결광이다", ["blast_furnace"]), chunk("sinter", "소결광은 소결기에서 만든다", ["sinter_plant"]), chunk("torpedo", "토페도카가 용선을 나른다", ["torpedo_car"])];
  const r = new Retriever({ chunksFor: () => chunks });
  assert.equal(r.retrieve("ironmaking", "소결광")[0].id, "furnace"); // 동점이면 id 순
  assert.equal(r.retrieve("ironmaking", "소결광", { equipment_id: "sinter_plant" })[0].id, "sinter");
  assert.ok(!r.retrieve("ironmaking", "소결광", { equipment_id: "torpedo_car" }).some((c) => c.id === "torpedo"));
});

test("retrieve: 최대 5개", () => {
  const chunks = Array.from({ length: 9 }, (_, i) => chunk(`c${i}`, `고로 이야기 ${i}`));
  assert.equal(new Retriever({ chunksFor: () => chunks }).retrieve("ironmaking", "고로").length, MAX_RESULTS);
});

test("parseSectionMarkdown: 제목 하나가 조각 하나, {#id}는 id·태그, [src:]는 근거 id", () => {
  const md = [
    "# 제선",
    "머리말은 조각이 아니다.",
    "## 코크스의 역할 {#coke_reduction #coke_oven}",
    "코크스는 열원이면서 환원제다. [src:posco-brochure-2015]",
    "일산화탄소가 산소를 떼어낸다. [src:posco-newsroom-fe-2019] [src:posco-brochure-2015]",
    "### 소결",
    "가루 철광석을 덩어리로 만든다.",
    "## 빈 제목 {#empty}",
  ].join("\r\n");
  const chunks = parseSectionMarkdown("ironmaking", md);
  assert.deepEqual(chunks.map((c) => [c.id, c.title]), [["coke_reduction", "코크스의 역할"], ["ironmaking-2", "소결"]]);
  assert.deepEqual(chunks[0].tags, ["coke_reduction", "coke_oven"]);
  assert.deepEqual(chunks[0].source_ids, ["posco-brochure-2015", "posco-newsroom-fe-2019"]);
  assert.ok(!chunks[0].text.includes("[src:"));
});

test("loadSectionChunks: section.md가 있으면 그 문서, 없으면 그 공정의 공개 자료 메모", () => {
  const root = mkdtempSync(join(tmpdir(), "materials-"));
  mkdirSync(join(root, "rolling"));
  writeFileSync(join(root, "rolling", "section.md"), "## 권취기 {#coiler}\n강판을 코일로 감는다.\n");
  assert.deepEqual(loadSectionChunks("rolling", root).map((c) => c.id), ["coiler"]);
  const notesOf = (section: string) => publicSources.filter((s) => sectionOf(s) === section).reduce((n, s) => n + s.notes.length, 0);
  assert.equal(loadSectionChunks("ironmaking", root).length, notesOf("ironmaking"));
  assert.equal(loadSectionChunks("steelmaking", root).length, notesOf("steelmaking"));
  assert.ok(loadSectionChunks("steelmaking", root).every((c) => c.section === "steelmaking"));
});
