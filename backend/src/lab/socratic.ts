// 소크라테스 모드(학습 랩, Khanmigo 참고): 답을 바로 주지 않고 질문으로 학습자가 설비의 역할을 스스로 말하게 한다.
// LLM(llm/prompts/socratic.md)이 다음 질문과 '목표에 닿았는지'를 낸다. LLM을 쓸 수 없으면(키 없음·연결 실패) 정해 둔 질문 사다리와
// 글자 겹침으로 판단하는 오프라인 튜터로 이어 간다(mode: 'offline'). 점수에는 반영하지 않고, 닿으면 사원증 XP만 준다.
import { escapeDelimited, renderPrompt, type LlmClient } from "../../../llm/src/gemini.js";
import type { DeckCard } from "./deck.js";

export const MAX_HINT = 3;
/** 이만큼 답해도 닿지 못하면 [정답 보기]를 권한다. */
export const SUGGEST_REVEAL_AFTER = 6;

export interface Turn { role: "tutor" | "user"; text: string }
export interface SocraticReply { reply: string; understood: boolean; hint_level: number; mode: "llm" | "offline" }

const RESPONSE_SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" }, understood: { type: "boolean" }, hint_level: { type: "integer" } },
  required: ["reply", "understood", "hint_level"],
};

/** 받침이 있으면 '을', 없으면 '를'. */
const hasBatchim = (word: string) => { const c = word.charCodeAt(word.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; };
export const eulReul = (word: string) => (hasBatchim(word) ? "을" : "를");
/** 받침이 있으면 '은', 없으면 '는'. */
export const eunNeun = (word: string) => (hasBatchim(word) ? "은" : "는");
/** 받침이 있으면 '이', 없으면 '가'. */
export const iGa = (word: string) => (hasBatchim(word) ? "이" : "가");

export const openingQuestion = (card: DeckCard) =>
  `${card.equipment_name}${eulReul(card.equipment_name)} 처음 본다고 생각해 볼게요. 이 설비에는 무엇이 들어가고, 무엇이 되어 나올 것 같나요? 떠오르는 대로 말해 주세요.`;

// 두 글자 조각 겹침(검색 retrieval.ts와 같은 방식). 오프라인 판단에만 쓴다.
function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length === 1) continue;
    for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  }
  return out;
}
/** 목표 설명의 두 글자 조각 중 답에 나온 비율. */
export function coverage(answer: string, goal: string): number {
  const g = bigrams(goal), a = bigrams(answer);
  if (!g.size) return 0;
  let hit = 0;
  for (const b of g) if (a.has(b)) hit++;
  return hit / g.size;
}
export const OFFLINE_REACHED = 0.35;

/** 목표 설명에서 힌트로 쓸 낱말(가장 긴 낱말, 설비 이름 제외). */
function hintWord(card: DeckCard): string {
  const words = card.role.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !card.equipment_name.includes(w));
  return words.sort((a, b) => b.length - a.length)[0] ?? card.section_name;
}

export function offlineReply(card: DeckCard, answer: string, hintLevel: number): SocraticReply {
  const score = coverage(answer, `${card.role} ${card.memo?.text ?? ""}`) * 1.4; // 메모까지 합치면 분모가 커서 보정
  const understood = answer.trim().length >= 8 && (coverage(answer, card.role) >= OFFLINE_REACHED || score >= OFFLINE_REACHED);
  if (understood) {
    return { reply: `좋아요, 핵심을 스스로 말해 줬어요. 한 단계 더 생각해 볼까요? ${card.equipment_name}${iGa(card.equipment_name)} 없다면 다음 공정에서는 어떤 문제가 생길까요?`, understood: true, hint_level: hintLevel, mode: "offline" };
  }
  const next = Math.min(MAX_HINT, hintLevel + 1);
  const ladder = [
    `좋은 출발이에요. 그럼 ${card.section_name} 공정 전체에서 ${card.equipment_name}${eunNeun(card.equipment_name)} 앞 단계와 뒤 단계 중 어디에 더 가까울까요? 그 위치에서 해야 할 일을 떠올려 보세요.`,
    `조금 좁혀 볼게요. 이 설비를 지나기 전과 지난 뒤에, 재료의 모양이나 상태는 어떻게 달라질까요?`,
    `거의 다 왔어요. '${hintWord(card)}'라는 말이 이 설비와 어떤 관련이 있을까요?`,
    `마지막 힌트예요. '${hintWord(card)}' — 이 말을 넣어 ${card.equipment_name}${iGa(card.equipment_name)} 하는 일을 한 문장으로 말해 볼까요?`,
  ];
  // 지금 단계의 질문을 하고 다음 답부터 한 단계 더 좁힌다(0단계 질문부터 차례로)
  return { reply: ladder[Math.min(hintLevel, ladder.length - 1)], understood: false, hint_level: next, mode: "offline" };
}

export const revealText = (card: DeckCard) =>
  `${card.equipment_name}: ${card.role}${card.memo ? `\n\n근거 · ${card.memo.title}\n${card.memo.text}` : ""}`;

/** LLM으로 다음 말을 정한다. 실패하면 오프라인 튜터. */
export async function socraticReply(llm: LlmClient | null, card: DeckCard, history: readonly Turn[], answer: string, hintLevel: number): Promise<SocraticReply> {
  if (!llm) return offlineReply(card, answer, hintLevel);
  try {
    const prompt = renderPrompt("socratic", {
      equipment: card.equipment_name, section: card.section_name, goal: card.role, material: card.memo?.text ?? "(없음)",
      hint_level: String(hintLevel),
      history: history.slice(-10).map((t) => `${t.role === "tutor" ? "튜터" : "학습자"}: ${escapeDelimited(t.text)}`).join("\n") || "(없음)",
      answer: escapeDelimited(answer),
    });
    const raw = await llm.generate({ system: "소크라테스식 튜터. JSON만 출력한다.", prompt, temperature: 0.4, maxOutputTokens: 400, responseSchema: RESPONSE_SCHEMA });
    const parsed = JSON.parse(raw) as { reply?: unknown; understood?: unknown; hint_level?: unknown };
    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) throw new Error("reply 없음");
    const hint = Math.max(hintLevel, Math.min(MAX_HINT, Math.round(Number(parsed.hint_level) || 0)));
    return { reply: parsed.reply.trim(), understood: parsed.understood === true, hint_level: hint, mode: "llm" };
  } catch (e) {
    console.warn(`소크라테스 모드 LLM을 쓰지 못해 오프라인 튜터로 이어 갑니다: ${(e as Error).message}`);
    return offlineReply(card, answer, hintLevel);
  }
}
