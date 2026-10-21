// 튜터가 만든 질문에 정답이 새어 나갔는지 검사한다.
// - 정답 용어: 루브릭 개념의 answer_terms와 그 용어집 동의어가 질문에 있으면 유출.
// - 근거 문장: quote와 4글자 이상 겹치는 구간 중 단어 경계 양쪽에 각각 2글자 이상 걸친 구(예: "산소를 떼어내는"의 "소를떼어")가 있으면 유출.
//   한 단어 안의 겹침("철광석을", "고로에서")이나 조사 한 글자가 붙은 겹침("는 철광석")은 질문 주제를 말하는 데 필요해서 보지 않는다.
// - 개념 이름은 검사에서 뺀다: 질문 속 개념 이름은 지우고 보고, 개념 이름 안에 있는 구간·용어도 유출로 보지 않는다.
import type { Rubric, RubricConcept } from "../../backend/src/rubrics.js";

export interface LeakResult {
  terms: string[];
  phrases: string[];
}

export const MIN_LEAK_CHARS = 4;
const isWordChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
const normalize = (text: string) => [...text].filter(isWordChar).join("").toLowerCase();

/** answer_terms와 그 용어집 동의어(개념 이름과 겹치는 말 포함). */
function expandedTerms(rubric: Rubric, concept: RubricConcept): string[] {
  const terms = new Set(concept.answer_terms ?? []);
  for (const entry of rubric.glossary ?? []) {
    const group = [entry.term, ...entry.aliases];
    if (group.some((t) => terms.has(t))) group.forEach((t) => terms.add(t));
  }
  return [...terms];
}

const inName = (concept: RubricConcept, term: string) => normalize(concept.name).includes(normalize(term));

/** 질문에 쓰면 안 되는 정답 용어(용어집 동의어 포함). 개념 이름에 들어 있는 말은 뺀다. */
export function answerTerms(rubric: Rubric, concept: RubricConcept): string[] {
  return expandedTerms(rubric, concept).filter((t) => !inName(concept, t));
}

/** answer_terms(용어집 동의어 포함) 중 개념 이름에 들어 있어 검사에서 빠지는 말. 루브릭 오류 확인용. */
export function answerTermsInName(rubric: Rubric, concept: RubricConcept): string[] {
  return expandedTerms(rubric, concept).filter((t) => inName(concept, t));
}

function containsTerm(question: string, term: string): boolean {
  // 영문 약어(CO 등)는 단어 경계로 본다. "COKE" 같은 다른 단어 안의 일치는 무시한다.
  if (/^[A-Za-z0-9]+$/.test(term)) return new RegExp(`(^|[^A-Za-z0-9])${term}([^A-Za-z0-9]|$)`, "i").test(question);
  return normalize(question).includes(normalize(term));
}

/** quote에서 길이 minLen의 구간을 뽑는다. crossWordOnly면 단어 경계 양쪽에 각각 2글자 이상 걸친 구간만. */
function quoteWindows(quote: string, minLen: number, crossWordOnly: boolean): string[] {
  const chars: string[] = [];
  const boundaryBefore: boolean[] = [];
  let sawGap = false;
  for (const ch of quote) {
    if (isWordChar(ch)) {
      chars.push(ch.toLowerCase());
      boundaryBefore.push(sawGap && chars.length > 1);
      sawGap = false;
    } else {
      sawGap = true;
    }
  }
  const windows: string[] = [];
  for (let i = 0; i + minLen <= chars.length; i++) {
    let crosses = false;
    for (let b = i + 2; b <= i + minLen - 2; b++) if (boundaryBefore[b]) crosses = true;
    if (!crossWordOnly || crosses) windows.push(chars.slice(i, i + minLen).join(""));
  }
  return windows;
}

export function findLeaks(
  question: string,
  rubric: Rubric,
  concept: RubricConcept,
  options: { minLen?: number; crossWordOnly?: boolean } = {},
): LeakResult {
  const minLen = options.minLen ?? MIN_LEAK_CHARS;
  const crossWordOnly = options.crossWordOnly ?? true;
  const name = normalize(concept.name);
  // 질문 속 개념 이름을 경계 문자로 바꿔, 이름과 그 앞뒤 말에 걸친 구간("…의 역할은 무엇"의 "할은무엇")도 잡지 않는다.
  const q = name ? normalize(question).split(name).join("|") : normalize(question);
  const terms = answerTerms(rubric, concept).filter((t) => containsTerm(question, t));
  const phrases = new Set<string>();
  for (const kp of concept.key_points) {
    for (const w of quoteWindows(kp.quote, minLen, crossWordOnly)) {
      if (q.includes(w) && !name.includes(w)) phrases.add(w);
    }
  }
  return { terms, phrases: [...phrases] };
}

export const hasLeak = (r: LeakResult) => r.terms.length > 0 || r.phrases.length > 0;
