// 답변 근거 겹침 지표: 답의 문장마다 인용한 근거 조각과 글자가 얼마나 겹치는지 센다. 판정이 아니라 관찰용 지표다.
// - 해요체로 바꿔 쓴 답도 내용어(코크스, 환원제, 일산화탄소…)는 근거와 같은 글자를 쓰므로 글자 2-gram 겹침으로 본다.
// - 숫자·단위(1,200℃ 등)가 근거에 없으면 겹침이 낮아진다. 근거 없는 수치를 찾는 데 쓴다.
// - 답의 status는 바꾸지 않는다. trace(trace.ts)와 eval:learning 보고서에 남겨 기준선을 만든 뒤에 쓸지 정한다(docs/agent-observability.md).

/**
 * 문장 하나를 근거로 뒷받침된다고 보는 2-gram 겹침 비율. 2026-10-13 Gemini 답 95개(157문장)로 정했다(docs/agent-observability.md '근거 겹침'):
 * 0.4~0.5는 대부분 근거를 바꿔 쓴 문장이고, 0.4 아래는 근거에 없는 수식어·오개념 부정문("~은 아니에요")이 많다.
 */
export const SUPPORT_THRESHOLD = 0.4;
/** 이보다 짧은 문장(공백·문장부호 뺀 글자 수)은 세지 않는다("네.", "좋은 질문이에요." 같은 말). */
export const MIN_SENTENCE_CHARS = 8;

export interface GroundingSupport {
  /** 센 문장 수(짧은 문장 제외). */
  sentences: number;
  /** 겹침이 SUPPORT_THRESHOLD 이상인 문장 수. */
  supported: number;
  /** supported / sentences. 센 문장이 없으면 null. */
  rate: number | null;
  /** 겹침이 가장 낮은 문장과 그 비율(센 문장이 없으면 null). 보고서에서 근거 밖 문장을 찾을 때 본다. */
  weakest: { text: string; overlap: number } | null;
}

/** 공백·문장부호를 지운 글자열. 숫자의 쉼표(1,200)도 지운다. */
function compact(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, (ch) => (/[℃%]/.test(ch) ? ch : "")).toLowerCase();
}

function bigrams(text: string): string[] {
  const c = compact(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < c.length; i++) out.push(c.slice(i, i + 2));
  return out;
}

/** 문장 끝(. ! ? 와 줄바꿈)으로 나눈다. 숫자 사이 점(1.5)은 나누지 않는다. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])(?!\d)\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 문장의 2-gram 중 근거에 있는 비율. 2-gram이 없으면 0. */
export function overlapRatio(sentence: string, evidence: Set<string>): number {
  const grams = bigrams(sentence);
  if (!grams.length) return 0;
  return grams.filter((g) => evidence.has(g)).length / grams.length;
}

/** 답과 인용한 근거 조각 본문들로 겹침 지표를 만든다. 근거가 없으면 모든 문장이 뒷받침되지 않은 것으로 센다. */
export function groundingSupport(answer: string, evidenceTexts: string[]): GroundingSupport {
  const evidence = new Set(evidenceTexts.flatMap(bigrams));
  const scored = splitSentences(answer)
    .filter((s) => compact(s).length >= MIN_SENTENCE_CHARS)
    .map((text) => ({ text, overlap: Math.round(overlapRatio(text, evidence) * 1000) / 1000 }));
  if (!scored.length) return { sentences: 0, supported: 0, rate: null, weakest: null };
  const supported = scored.filter((s) => s.overlap >= SUPPORT_THRESHOLD).length;
  const weakest = scored.reduce((a, b) => (b.overlap < a.overlap ? b : a));
  return { sentences: scored.length, supported, rate: Math.round((supported / scored.length) * 1000) / 1000, weakest };
}
