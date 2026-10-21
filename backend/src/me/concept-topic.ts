// 오개념·복습을 '공정 › 소단원(설비) › 개념'과 '다시 볼 핵심' 한 줄로 보여 주기 위한 표시 정보.
// - 루브릭 개념: 개념 이름, 소단원은 그 개념의 첫 설비(equipment_ids, 같은 공정), 핵심은 처음 놓친 핵심 요소(explain_from, 없으면 첫 요소) 문장.
// - 시연 개념 목록(content/demo/sections.json): 이름만 있다(소단원·핵심 없음).
// - 설비 id로 남은 기록(시연 기록 일부): 소단원이 그 설비이고 개념은 '○○의 역할'. 예전에는 '제강 관련 개념'으로만 보였다.
// 표시 정보만 만든다. 점수·오개념 해결 규칙과는 상관없다.
import type { SceneCatalog } from "../../../llm/src/learning-agent.js";
import { SECTION_NAMES, type Section } from "../checkpoint/types.js";
import type { DemoSections } from "../demo-sections.js";
import type { Rubric } from "../rubrics.js";

export interface ConceptTopic {
  /** 대단원: 공정 이름(제선·제강…). */
  unit: string;
  /** 소단원: 설비 짧은 이름(소결기·래들 이송…). 모르면 null. */
  subunit: string | null;
  /** 개념 이름. 모르면 null. */
  concept: string | null;
  /** 화면에 보여 줄 경로. 예: "제선 › 소결기 › 소결의 목적". */
  label: string;
  /** 다시 볼 핵심 한 줄(루브릭 핵심 요소). 없으면 null. */
  point: string | null;
}

/** 설비 이름을 소단원 이름으로 줄인다: 괄호를 빼고 '·' 앞부분만("고로·장입 장치" → 고로, "전로 (BOF·LD)" → 전로). */
export function shortEquipmentName(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").split("·")[0]!.trim();
}

/** 핵심 요소 문장 끝의 서술격 '이다'와 마침표를 떼어 한 줄로 줄인다("…전처리 공정이다." → "…전처리 공정"). 동사 끝("만든다")은 둔다. */
function compactPoint(point: string): string {
  return point.trim().replace(/\.$/, "").replace(/이다$/, "").trim();
}

export interface TopicSources {
  rubrics: Rubric[];
  demo?: DemoSections;
  scene?: SceneCatalog;
}

/** (공정, 개념 id, 처음 놓친 핵심 요소 번호) → 표시 정보. */
export function createTopicResolver({ rubrics, demo, scene }: TopicSources) {
  const equipmentOf = (section: string, id: string) =>
    scene?.processes.find((p) => p.id === section)?.equipment.find((e) => e.id === id) ?? null;
  return (section: string, conceptId: string, explainFrom: number | null = null): ConceptTopic => {
    const unit = SECTION_NAMES[section as Section] ?? "학습";
    const build = (subunit: string | null, concept: string | null, point: string | null): ConceptTopic => {
      // 개념 이름에 소단원 이름이 이미 들어 있으면 경로에서 소단원을 빼지 않고 그대로 두되, 같은 말을 두 번 쓰지 않는다.
      const parts = [unit, subunit && !(concept ?? "").startsWith(subunit) ? subunit : null, concept ?? (subunit ? null : "개념")].filter(Boolean) as string[];
      return { unit, subunit, concept, label: parts.join(" › "), point };
    };
    const rubricConcept = rubrics.find((r) => r.section === section)?.concepts.find((c) => c.concept_id === conceptId);
    if (rubricConcept) {
      const eq = (rubricConcept.equipment_ids ?? []).map((id) => equipmentOf(section, id)).find(Boolean);
      const points = rubricConcept.key_points.map((k) => k.point);
      const missed = explainFrom != null && points[explainFrom] ? points[explainFrom]! : points[0];
      return build(eq ? shortEquipmentName(eq.name) : null, rubricConcept.name, missed ? compactPoint(missed) : null);
    }
    const demoConcept = demo?.[section as Section]?.find((c) => c.id === conceptId);
    if (demoConcept) {
      const eq = (demoConcept.equipment_ids ?? []).map((id) => equipmentOf(section, id)).find(Boolean);
      return build(eq ? shortEquipmentName(eq.name) : null, demoConcept.name, null);
    }
    const eq = equipmentOf(section, conceptId);
    if (eq) {
      const short = shortEquipmentName(eq.name);
      return build(short, `${short}의 역할`, null);
    }
    return build(null, null, null);
  };
}
