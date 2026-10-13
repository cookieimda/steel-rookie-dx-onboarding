// 루브릭 파일 로드. 서버 실행 중에도 content/rubrics/schema.json으로 검증한다.
import { Ajv2020 } from "ajv/dist/2020.js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RubricConcept {
  concept_id: string;
  name: string;
  key_points: { point: string; quote: string }[];
  correct: string;
  partial: string;
  wrong: string;
  source: { file: string; ref?: string };
  /** 튜터 질문에 쓰면 안 되는 정답 용어(선택). */
  answer_terms?: string[];
  /** 질문 은행: 첫 질문 후보 2~3개(선택). 비어 있으면 LLM이 질문을 만든다. */
  questions?: string[];
  /** 질문 은행: 재확인 질문 후보 2개(선택). questions와 겹치지 않는다. */
  recheck_questions?: string[];
  /** LLM이 만든 질문이 유출 검사에 두 번 걸리면 쓰는 고정 질문(선택). */
  fallback_question?: string;
  /** 관련 3D 설비 id(선택, data_v2.js 기준). 보충학습 설명 때 화면에 보여 준다. */
  equipment_ids?: string[];
}

export interface GlossaryEntry {
  term: string;
  aliases: string[];
}

export interface Rubric {
  section: "ironmaking" | "steelmaking" | "continuous_casting" | "rolling";
  reviewed: boolean;
  /** 섹션 단위 용어집(선택). 평가자 프롬프트에 들어간다. */
  glossary?: GlossaryEntry[];
  concepts: RubricConcept[];
}

const RUBRIC_ROOT = join(process.cwd(), "content", "rubrics");

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const validate = new Ajv2020({ allErrors: true }).compile<Rubric>(readJson(join(RUBRIC_ROOT, "schema.json")) as object);

/** 루브릭을 읽고 검증한다. 형식이 틀리면 예외를 던지고, 팀 검수 전(reviewed: false)이면 경고를 남긴다. */
export function loadRubric(path: string): Rubric {
  const rubric = readJson(path);
  if (!validate(rubric)) {
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    throw new Error(`루브릭 형식 오류: ${path}: ${errors}`);
  }
  const ids = rubric.concepts.map((c) => c.concept_id);
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicated.length) throw new Error(`루브릭 concept_id 중복: ${path}: ${[...new Set(duplicated)].join(", ")}`);
  for (const c of rubric.concepts) {
    // 재확인 질문은 첫 질문으로 쓰지 않은 질문이어야 한다.
    const overlap = (c.recheck_questions ?? []).filter((q) => c.questions?.includes(q));
    if (overlap.length) throw new Error(`루브릭 질문 은행 중복(questions와 recheck_questions): ${path}: ${c.concept_id}`);
  }
  if (rubric.reviewed !== true) console.warn(`검수 전 루브릭을 사용합니다: ${path} (section=${rubric.section})`);
  return rubric;
}

/**
 * 평가자가 읽는 final/ 루브릭을 모두 읽는다. 서버 시작 시 호출해 잘못된 파일이 있으면 시작을 멈춘다.
 * concept_id는 섹션과 상관없이 전체에서 고유해야 한다. 오개념 해결·점수 기록이 concept_id로 이어지기 때문이다.
 */
export function loadFinalRubrics(dir = join(RUBRIC_ROOT, "final")): Rubric[] {
  const rubrics = readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => loadRubric(join(dir, name)));
  const owner = new Map<string, Rubric["section"]>();
  const duplicated: string[] = [];
  for (const r of rubrics) {
    for (const c of r.concepts) {
      const first = owner.get(c.concept_id);
      if (first && first !== r.section) duplicated.push(`${c.concept_id}(${first}, ${r.section})`);
      else owner.set(c.concept_id, r.section);
    }
  }
  if (duplicated.length) throw new Error(`루브릭 concept_id는 섹션이 달라도 겹치면 안 됩니다: ${dir}: ${duplicated.join(", ")}`);
  return rubrics;
}
