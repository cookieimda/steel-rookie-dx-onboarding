// 학습 모드 오개념 확인(로컬 모델 compact 프로필만): 학습자가 틀린 내용을 단정했는데 학습 튜터가 detected_misconception을 비워 둔 경우,
// 짧은 호출 한 번으로 루브릭의 '틀린 생각'(criteria.wrong) 가운데 어디에 해당하는지 개념 id 하나만 고르게 한다.
// - 2026-10-16 로컬 측정 세션에서 qwen2.5:3b가 오개념 단정 3개("코크스는 불순물을…", "소결은 쇳물을…", "열풍로는 식히는…")를 하나도 기록하지 못했다.
// - 답을 만드는 프롬프트에 틀린 생각을 넣지 않는다. 그렇게 했던 실험(오개념 힌트)은 맞는 말에도 "아니에요"로 정정해서 되돌렸다.
//   그래서 답은 그대로 두고 기록(학습자 메모)만 채운다. 점수와는 상관없다.
// - 단정하는 말("~죠?", "~잖아요", "맞죠?", "~다.")일 때만 부른다. 열린 질문("~가 뭐예요?")에는 호출하지 않는다.
import { escapeDelimited, renderPrompt, type LlmClient } from "./gemini.js";

/**
 * 학습자가 내용을 단정하는 말. 열린 질문("뭐예요?", "왜 넣어?")과 확인을 구하는 질문("~게 맞나요?")은 아니다.
 * '맞나요?'를 넣었더니(2026-10-16 평가) 맞는 내용을 묻는 mis-check까지 오개념으로 골랐다.
 */
const ASSERTION = /(죠|잖아요?|맞(죠|지)|거지|이지|하지|겠지)\s*[?？.!~]*\s*$|[^?？]다\s*[.!]?\s*$/;

export function isAssertion(question: string): boolean {
  return ASSERTION.test(question.trim());
}

/** 튜터 답이 학습자 말을 맞다고 받았는지("네, …", "맞아요."). 그러면 확인하지 않는다(맞는 단정 3개를 모두 오개념으로 골랐던 문제). */
const AFFIRMATION = /^\s*(네|예|맞아요|맞습니다|맞아|그렇습니다|그래요)(?=[\s,.!]|$)/;

export function affirms(answer: string): boolean {
  return AFFIRMATION.test(answer);
}

/** 개념 이름에서 주제어로 보지 않는 말. */
const GENERIC = new Set(["역할", "목적", "과정", "원리", "방법", "이유", "만들어지는"]);
const PARTICLE = /(에서|으로|로|의|이|가|을|를|은|는|과|와)$/;

/** 개념 이름의 주제어("고로에서 코크스의 역할" → 고로·코크스). */
export function topicWords(name: string): string[] {
  return name.split(/\s+/).filter((w) => !GENERIC.has(w)).map((w) => w.replace(PARTICLE, "")).filter((w) => w.length >= 2 && !GENERIC.has(w));
}

/**
 * 확인할 후보 개념: 질문에 주제어가 나오는 개념 중 가장 앞에 나온 주제어를 가진 개념들(같은 말을 여러 개념이 쓰면 모두).
 * "소결기는 석탄을 구워서 코크스를 만드는 설비죠?"는 소결(앞)·코크스(뒤) 가운데 소결 개념만 본다. 주제어가 없으면 빈 배열(부르지 않는다).
 */
export function topicCandidates(question: string, ideas: WrongIdea[]): WrongIdea[] {
  const first = (idea: WrongIdea) => Math.min(...topicWords(idea.name).map((w) => question.indexOf(w)).filter((i) => i >= 0), Infinity);
  const at = ideas.map((idea) => ({ idea, at: first(idea) })).filter((x) => x.at !== Infinity);
  if (!at.length) return [];
  const earliest = Math.min(...at.map((x) => x.at));
  return at.filter((x) => x.at === earliest).map((x) => x.idea);
}

/** 확인할 개념(루브릭 concept_id·이름·criteria.wrong). */
export interface WrongIdea {
  concept_id: string;
  name: string;
  wrong: string;
}

/** 확인 호출의 출력 상한. 개념 id 하나만 받는다. */
const OUTPUT_TOKENS = 40;

/**
 * 학습자의 말이 틀린 생각 가운데 하나면 그 concept_id, 아니면 null. 호출이 실패하거나 모르는 id를 내면 null(기록하지 않는다).
 * 오개념 요약은 모델이 쓰지 않고 서버가 정한다(misconceptionSummary).
 */
export async function checkMisconception(llm: LlmClient, question: string, ideas: WrongIdea[]): Promise<string | null> {
  if (!ideas.length) return null;
  const ids = ideas.map((i) => i.concept_id);
  const raw = await llm.generate({
    system: renderPrompt("learning-misconception", { wrong_ideas: ideas.map((i) => `- ${i.concept_id} (${i.name}): ${i.wrong}`).join("\n") }),
    prompt: `<statement>${escapeDelimited(question)}</statement>`,
    temperature: 0,
    maxOutputTokens: OUTPUT_TOKENS,
    responseSchema: { type: "OBJECT", properties: { concept_id: { type: "STRING", enum: [...ids, "none"] } }, required: ["concept_id"] },
  });
  let picked: unknown;
  try {
    picked = (JSON.parse(raw) as { concept_id?: unknown }).concept_id;
  } catch {
    return null;
  }
  return typeof picked === "string" && ids.includes(picked) ? picked : null;
}

/** 학습자 메모에 남길 오개념 요약. 학습자의 말을 그대로 옮긴다(80자까지). */
export function misconceptionSummary(question: string, name: string): string {
  const said = question.trim().length > 80 ? `${question.trim().slice(0, 80)}…` : question.trim();
  return `${name}: "${said}"라고 단정함`;
}
