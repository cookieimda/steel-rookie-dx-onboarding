// 관리자 대시보드 시연용 개념 목록(content/demo/sections.json). 시연 기록(db:seed-demo)과 관리자 통계만 읽는다.
// 평가자·체크포인트 엔진·loadFinalRubrics()는 이 파일을 읽지 않는다. 그래서 실제 계정의 그 섹션 체크포인트는 계속 404다.
// final 루브릭이 있는 섹션은 루브릭 개념을 쓰고 이 목록은 무시한다(statSections).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECTION_ORDER, type Section } from "./checkpoint/types.js";
import type { Rubric } from "./rubrics.js";

export interface DemoConcept {
  id: string;
  name: string;
  /** 이 개념을 다루는 설비 id(data_v2.js). 화면의 소단원 표시에만 쓴다. */
  equipment_ids?: string[];
}
export type DemoSections = Partial<Record<Section, DemoConcept[]>>;

/** 통계 계산에 쓰는 섹션별 개념(final 루브릭 또는 시연 목록). summarizeSection에 그대로 넘길 수 있다. */
export interface StatSection {
  section: Section;
  concepts: { concept_id: string; name: string }[];
  /** 시연 목록에서 온 섹션인지. */
  demo: boolean;
}

export const DEMO_SECTIONS_PATH = join(process.cwd(), "content", "demo", "sections.json");
const DEMO_ID = /^demo_[a-z0-9_]{1,60}$/;

/** 시연 목록을 읽고 검사한다. 섹션 이름, demo_ 접두사, 이름, 전체 id 중복을 확인하고 틀리면 예외. 파일이 없으면 빈 목록. */
export function loadDemoSections(path = DEMO_SECTIONS_PATH): DemoSections {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`시연 개념 목록을 읽지 못했습니다(${path}): ${(error as Error).message}`);
  }
  const sections = (raw as { sections?: unknown })?.sections;
  if (!sections || typeof sections !== "object") throw new Error(`시연 개념 목록에 sections가 없습니다: ${path}`);
  const seen = new Set<string>();
  const result: DemoSections = {};
  for (const [section, list] of Object.entries(sections)) {
    if (!SECTION_ORDER.includes(section as Section)) throw new Error(`시연 개념 목록의 섹션이 올바르지 않습니다: ${section}`);
    if (!Array.isArray(list)) throw new Error(`시연 개념 목록의 ${section}이 배열이 아닙니다.`);
    result[section as Section] = list.map((c: Partial<DemoConcept>) => {
      if (typeof c?.id !== "string" || !DEMO_ID.test(c.id)) throw new Error(`시연 개념 id는 demo_로 시작하는 소문자·숫자·_여야 합니다: ${String(c?.id)}`);
      if (typeof c.name !== "string" || !c.name.trim()) throw new Error(`시연 개념 이름이 비어 있습니다: ${c.id}`);
      if (seen.has(c.id)) throw new Error(`시연 개념 id가 겹칩니다: ${c.id}`);
      seen.add(c.id);
      // equipment_ids(선택): 오개념·복습 화면의 소단원(설비) 표시에만 쓴다(me/concept-topic.ts). 통계·채점과는 상관없다.
      if (c.equipment_ids !== undefined && (!Array.isArray(c.equipment_ids) || !c.equipment_ids.every((id) => typeof id === "string" && /^[a-z0-9_]{1,60}$/.test(id)))) {
        throw new Error(`시연 개념 equipment_ids는 설비 id 배열이어야 합니다: ${c.id}`);
      }
      return { id: c.id, name: c.name.trim(), ...(c.equipment_ids?.length ? { equipment_ids: c.equipment_ids } : {}) };
    });
  }
  return result;
}

/** final 루브릭 섹션 + (final 루브릭이 없는 섹션의) 시연 목록. 섹션 순서는 SECTION_ORDER. */
export function statSections(rubrics: readonly Rubric[], demo: DemoSections): StatSection[] {
  return SECTION_ORDER.flatMap((section): StatSection[] => {
    const rubric = rubrics.find((r) => r.section === section);
    if (rubric) return [{ section, concepts: rubric.concepts.map(({ concept_id, name }) => ({ concept_id, name })), demo: false }];
    const list = demo[section] ?? [];
    return list.length ? [{ section, concepts: list.map(({ id, name }) => ({ concept_id: id, name })), demo: true }] : [];
  });
}
