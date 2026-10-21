// 학습 모드 키워드 카드: 튜터가 고른 개념의 핵심 용어를 루브릭에서 그대로 꺼낸다(LLM이 내용을 만들지 않음). 설계는 docs/learning-mode.md '키워드 카드'.
// - 용어는 개념의 answer_terms, 같은 말은 섹션 용어집(glossary)에서 붙인다.
// - answer_terms는 원래 "질문에 쓰면 안 되는 말" 목록이라 유출을 막으려고 다른 공정 용어를 넣어 둔 개념이 있다(이슈 #67).
//   그래서 루브릭 담당과 확인한 개념만 카드로 보여 준다. 개념을 늘릴 때 KEYWORD_CARD_CONCEPTS에 더한다.
import type { Rubric } from "../rubrics.js";

/** 카드를 보여 줄 수 있는 개념. answer_terms가 그 개념의 키워드로 맞는지 루브릭 담당과 확인한 것만 둔다. */
export const KEYWORD_CARD_CONCEPTS: readonly string[] = ["coke_reduction"];

export interface KeywordCard {
  concept_id: string;
  name: string;
  keywords: { term: string; aliases: string[] }[];
  /** 루브릭이 근거로 든 자료 id(ironmaking-sources). 없으면 null. */
  source_id: string | null;
}

/** 섹션 루브릭에서 카드를 만들 수 있는 개념(허용 목록에 있고 answer_terms가 있는 것). 튜터가 고를 수 있는 목록이다. */
export function keywordCardConcepts(rubric: Rubric | undefined, allowed: readonly string[] = KEYWORD_CARD_CONCEPTS): { concept_id: string; name: string }[] {
  return (rubric?.concepts ?? [])
    .filter((c) => allowed.includes(c.concept_id) && (c.answer_terms?.length ?? 0) > 0)
    .map((c) => ({ concept_id: c.concept_id, name: c.name }));
}

/** 개념의 키워드 카드. 고를 수 없는 개념이면 null. */
export function keywordCard(rubric: Rubric | undefined, conceptId: string, allowed: readonly string[] = KEYWORD_CARD_CONCEPTS): KeywordCard | null {
  if (!keywordCardConcepts(rubric, allowed).some((c) => c.concept_id === conceptId)) return null;
  const concept = rubric!.concepts.find((c) => c.concept_id === conceptId)!;
  const glossary = rubric!.glossary ?? [];
  const keywords = concept.answer_terms!.map((term) => {
    // 용어집에서 용어 자체나 그 동의어로 올라 있는 항목을 찾아, 용어를 뺀 나머지 이름을 같은 말로 붙인다.
    const entry = glossary.find((g) => g.term === term || g.aliases.includes(term));
    const aliases = entry ? [entry.term, ...entry.aliases].filter((a) => a !== term) : [];
    return { term, aliases };
  });
  return { concept_id: concept.concept_id, name: concept.name, keywords, source_id: concept.source.ref ?? null };
}
