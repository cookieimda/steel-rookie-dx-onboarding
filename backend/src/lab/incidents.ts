// 사고 사례 시나리오(학습 랩): 교육용 가상 사례를 시간순으로 재현하고 원인 분석 문제(직접 원인·근본 원인·대책)를 푼다.
// 내용은 content/scenarios/incidents.json(검수 대상 콘텐츠). 보기 순서는 사람마다 섞어서 보여 주고, 답은 보기 key(원래 순서)로 받는다.
// 점수는 이해도·통과와 상관없고, 사원증 XP에도 넣지 않는다(학습용 자가 점검).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { NODES } from "./causal.js";

const Question = z.object({ id: z.string(), prompt: z.string(), options: z.array(z.string()).min(2).max(6), answer: z.number().int().min(0), explain: z.string() })
  .refine((q) => q.answer < q.options.length, "정답 번호가 보기 수보다 커요.");
/** 역할(사람·장비·통제): 사고 상황판이 얼굴 줄로 그린다. */
const Role = z.object({ id: z.string().regex(/^[a-z0-9_]+$/), name: z.string(), kind: z.enum(["person", "device", "control"]) });
/**
 * 관문: 지켰다면 사고를 막았을 안전 절차. at 장면에서 지켜져야 했고, 실제로는 actual(skipped 건너뜀·kept 지킴)이었다.
 * passed_by는 그 관문을 지키는 갈림길 선택(장면 at의 보기 option)이다. 내용은 대책 문제 정답·갈림길의 안전한 선택에서만 가져온다.
 */
const Gate = z.object({
  id: z.string(), label: z.string(), role: z.string(), at: z.number().int().min(0), actual: z.enum(["skipped", "kept"]),
  passed_by: z.array(z.object({ at: z.number().int().min(0), option: z.number().int().min(0) })).optional(),
});
const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), section: z.enum(SECTION_ORDER as [Section, ...Section[]]), title: z.string(), hazard: z.string(), summary: z.string(),
  /** 실제 공개 재해사례의 출처(사례집 이름·발간 기관·사례 번호·쪽·주소). 내용은 이 원문을 요약한 것이다. */
  source: z.object({ title: z.string(), publisher: z.string(), case: z.string(), page: z.number().int().min(1).optional(), url: z.string().url() }).optional(),
  roles: z.array(Role).optional(), gates: z.array(Gate).optional(),
  /** 역할·관문을 팀이 검수했는지. false면 화면에 '초안'으로 밝힌다. */
  gates_reviewed: z.boolean().optional(),
  timeline: z.array(z.object({
    time: z.string(), text: z.string(), equipment_id: z.string(),
    /** 이 장면에서 움직인 역할(roles의 id). */
    actor: z.string().optional(),
    /** 갈림길: "여기서 다르게 했다면?" 실제로 일어난 선택(actual) 하나와 다른 선택들, 고르면 결과(outcome)를 보여 준다. */
    branch: z.object({ prompt: z.string(), options: z.array(z.object({ text: z.string(), outcome: z.string(), actual: z.boolean().optional(),
      /** 이 선택을 인과 지도 조정 값으로(선택). 3D 갈림길 패널에서 [인과 지도에서 이 선택 보기]로 연다. */
      causal: z.record(z.string(), z.number()).optional() })).min(2) })
      .refine((b) => b.options.filter((o) => o.actual).length === 1, "갈림길에는 실제로 일어난 선택(actual)이 하나 있어야 해요").optional(),
  })).min(1),
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
    // 갈림길 선택의 인과 지도 조건: 조정할 수 있는 값이고 범위 안
    for (const t of s.timeline) for (const o of t.branch?.options ?? []) for (const [k, v] of Object.entries(o.causal ?? {})) {
      const n = NODES.find((x) => x.id === k);
      if (!n?.control) throw new Error(`사고 사례 ${s.id}: 인과 지도에 조정할 수 없는 값 ${k}`);
      if (v < n.control.min || v > n.control.max) throw new Error(`사고 사례 ${s.id}: ${k} = ${v}, 범위 밖이에요`);
    }
    checkRolesAndGates(s);
  }
  return parsed;
}

/** 역할·관문이 서로·타임라인과 맞는지: 역할 id, 장면 번호, 관문을 지키는 선택은 실제로 일어난 선택이 아닌 갈림길 보기여야 한다. */
export function checkRolesAndGates(s: IncidentScenario) {
  const roles = new Set((s.roles ?? []).map((r) => r.id));
  if (roles.size !== (s.roles ?? []).length) throw new Error(`사고 사례 ${s.id}: 역할 id가 겹쳐요`);
  s.timeline.forEach((t, i) => { if (t.actor && !roles.has(t.actor)) throw new Error(`사고 사례 ${s.id}: 장면 ${i}의 없는 역할 ${t.actor}`); });
  for (const g of s.gates ?? []) {
    if (!roles.has(g.role)) throw new Error(`사고 사례 ${s.id}: 관문 ${g.id}의 없는 역할 ${g.role}`);
    if (g.at >= s.timeline.length) throw new Error(`사고 사례 ${s.id}: 관문 ${g.id}의 장면 ${g.at}가 없어요`);
    for (const p of g.passed_by ?? []) {
      const opt = s.timeline[p.at]?.branch?.options[p.option];
      if (!opt) throw new Error(`사고 사례 ${s.id}: 관문 ${g.id}를 지키는 갈림길 보기(${p.at}, ${p.option})가 없어요`);
      if (opt.actual) throw new Error(`사고 사례 ${s.id}: 관문 ${g.id}는 실제로 일어난 선택으로 지킬 수 없어요`);
    }
  }
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
    roles: s.roles ?? [], gates: s.gates ?? [], gates_reviewed: s.gates_reviewed ?? false, source: s.source ?? null,
    questions: s.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: shuffledKeys(userId, s.id, q.id, q.options.length).map((key) => ({ key, text: q.options[key] })) })),
  };
}

/** 채점: 문항마다 맞았는지·정답·해설, 점수(맞힌 비율). 답하지 않은 문항은 틀림. */
export function gradeIncident(s: IncidentScenario, answers: Record<string, number>) {
  const results = s.questions.map((q) => ({ id: q.id, chosen: answers[q.id] ?? null, correct: answers[q.id] === q.answer, answer: q.answer, answer_text: q.options[q.answer], explain: q.explain }));
  return { results, score: results.filter((r) => r.correct).length / results.length };
}
