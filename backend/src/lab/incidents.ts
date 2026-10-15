// 사고 사례 시나리오(학습 랩): 교육용 가상 사례를 시간순으로 재현하고 원인 분석 문제(직접 원인·근본 원인·대책)를 푼다.
// 내용은 content/scenarios/incidents.json(검수 대상 콘텐츠). 보기 순서는 사람마다 섞어서 보여 주고, 답은 보기 key(원래 순서)로 받는다.
// 점수는 이해도·통과와 상관없고, 사원증 XP에도 넣지 않는다(학습용 자가 점검).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";

const Question = z.object({ id: z.string(), prompt: z.string(), options: z.array(z.string()).min(2).max(6), answer: z.number().int().min(0), explain: z.string() })
  .refine((q) => q.answer < q.options.length, "정답 번호가 보기 수보다 커요.");
const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), section: z.enum(SECTION_ORDER as [Section, ...Section[]]), title: z.string(), hazard: z.string(), summary: z.string(),
  timeline: z.array(z.object({ time: z.string(), text: z.string(), equipment_id: z.string() })).min(1),
  questions: z.array(Question).min(1), reflection: z.string(),
});
const File = z.object({ disclaimer: z.string(), scenarios: z.array(Scenario).min(1) });
export type IncidentScenario = z.infer<typeof Scenario>;

export const INCIDENTS_PATH = join(process.cwd(), "content", "scenarios", "incidents.json");

/** 형식이 틀리거나 id가 겹치면 예외(서버 시작 때 막는다). 설비 id는 known(화면 설비 목록)에 있어야 한다. */
export function loadIncidents(path = INCIDENTS_PATH, known?: Set<string>) {
  const parsed = File.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const s of parsed.scenarios) {
    if (ids.has(s.id)) throw new Error(`사고 사례 id가 겹칩니다: ${s.id}`);
    ids.add(s.id);
    if (known) for (const t of s.timeline) if (!known.has(t.equipment_id)) throw new Error(`사고 사례 ${s.id}: 없는 설비 id ${t.equipment_id}`);
  }
  return parsed;
}

/** 사람·문항마다 같은 순서로 섞는다(새로고침해도 같다). */
export function shuffledKeys(userId: string, scenarioId: string, questionId: string, n: number): number[] {
  const keys = Array.from({ length: n }, (_, i) => i);
  const seed = createHash("sha256").update(`${userId}|${scenarioId}|${questionId}`).digest();
  for (let i = n - 1; i > 0; i--) { const j = seed[i % seed.length] % (i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  return keys;
}

/** 화면에 보낼 사례(정답·해설 제외, 보기는 섞은 순서와 key). */
export function scenarioView(s: IncidentScenario, userId: string) {
  return {
    id: s.id, section: s.section, title: s.title, hazard: s.hazard, summary: s.summary, timeline: s.timeline, reflection: s.reflection,
    questions: s.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: shuffledKeys(userId, s.id, q.id, q.options.length).map((key) => ({ key, text: q.options[key] })) })),
  };
}

/** 채점: 문항마다 맞았는지·정답·해설, 점수(맞힌 비율). 답하지 않은 문항은 틀림. */
export function gradeIncident(s: IncidentScenario, answers: Record<string, number>) {
  const results = s.questions.map((q) => ({ id: q.id, chosen: answers[q.id] ?? null, correct: answers[q.id] === q.answer, answer: q.answer, answer_text: q.options[q.answer], explain: q.explain }));
  return { results, score: results.filter((r) => r.correct).length / results.length };
}
