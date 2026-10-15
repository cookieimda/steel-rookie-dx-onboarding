// 이상 상황 훈련(3D 화면): 설비에 이상 징후를 걸고, 학습자가 ① 정상 범위를 벗어난 값을 찾고 ② 원인을 고르고 ③ 조치를 고른다.
// 원인을 맞히면 3D에 원인 → 결과 사슬(chain)을, 조치를 맞히면 정상화된 값과 다음 공정 영향(downstream)을 보여 준다.
// 내용은 content/faults/faults.json(검수 대상 콘텐츠). 보기 순서는 사람마다 섞고, 정답·해설은 단계마다 맞힌 뒤에만 준다.
// 점수는 이해도·통과와 상관없다(자가 훈련). 단계마다 몇 번 만에 맞혔는지로 점수를 낸다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { shuffledKeys } from "./incidents.js";

const Reading = z.object({ id: z.string(), name: z.string(), unit: z.string(), value: z.number(), normal: z.tuple([z.number(), z.number()]), fixed: z.number() });
const Choice = z.object({ options: z.array(z.string()).min(2).max(6), answer: z.number().int().min(0), explain: z.string() });
const Fault = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), section: z.enum(SECTION_ORDER as [Section, ...Section[]]), title: z.string(), equipment_id: z.string(), situation: z.string(),
  readings: z.array(Reading).min(2),
  signal: z.object({ answer: z.array(z.string()).min(1), explain: z.string() }),
  cause: Choice.extend({ chain: z.array(z.string()).min(2), chain_text: z.string() }),
  action: Choice.extend({ consequences: z.array(z.string().nullable()) }),
  downstream: z.object({ equipment_id: z.string(), text: z.string() }),
  whatif: z.record(z.string(), z.number()).optional(),
});
const File = z.object({ disclaimer: z.string(), faults: z.array(Fault).min(1) });
export type FaultDrill = z.infer<typeof Fault>;
export type Step = "signal" | "cause" | "action";

export const FAULTS_PATH = join(process.cwd(), "content", "faults", "faults.json");
const outOfRange = (r: z.infer<typeof Reading>) => r.value < r.normal[0] || r.value > r.normal[1];

/**
 * 형식·내용 검사(서버 시작 때 막는다): id 중복, 설비 id(known), 신호 정답 = 정상 범위를 벗어난 값,
 * 정답 번호 범위, 조치 보기마다 결과(consequences, 정답 자리는 null).
 */
export function loadFaults(path = FAULTS_PATH, known?: Set<string>) {
  const parsed = File.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const f of parsed.faults) {
    const where = `이상 상황 ${f.id}`;
    if (ids.has(f.id)) throw new Error(`${where}: id가 겹칩니다`);
    ids.add(f.id);
    const out = f.readings.filter(outOfRange).map((r) => r.id).sort();
    if (JSON.stringify(out) !== JSON.stringify([...f.signal.answer].sort())) throw new Error(`${where}: 신호 정답(${f.signal.answer})이 정상 범위를 벗어난 값(${out})과 다릅니다`);
    if (f.cause.answer >= f.cause.options.length || f.action.answer >= f.action.options.length) throw new Error(`${where}: 정답 번호가 보기 수보다 커요`);
    if (f.action.consequences.length !== f.action.options.length || f.action.consequences[f.action.answer] !== null) throw new Error(`${where}: 조치 결과는 보기마다 하나씩, 정답 자리는 null이어야 해요`);
    for (const r of f.readings) if (r.fixed < r.normal[0] || r.fixed > r.normal[1]) {
      // 조치로 바로 고칠 수 없는 값(앞 공정에서 온 값)은 고친 뒤에도 범위 밖에 남을 수 있다. 신호 정답이어야 한다.
      if (!f.signal.answer.includes(r.id)) throw new Error(`${where}: ${r.id}의 조치 후 값이 정상 범위 밖인데 신호가 아니에요`);
    }
    if (known) for (const id of [f.equipment_id, f.downstream.equipment_id, ...f.cause.chain]) if (!known.has(id)) throw new Error(`${where}: 없는 설비 id ${id}`);
  }
  return parsed;
}

/** 화면에 보낼 이상 상황(정답·해설·조치 후 값 제외). 원인·조치 보기는 섞은 순서와 key. */
export function faultView(f: FaultDrill, userId: string) {
  const shuffle = (step: string, options: string[]) => shuffledKeys(userId, f.id, step, options.length).map((key) => ({ key, text: options[key] }));
  return {
    id: f.id, section: f.section, title: f.title, equipment_id: f.equipment_id, situation: f.situation,
    readings: f.readings.map(({ id, name, unit, value, normal }) => ({ id, name, unit, value, normal })),
    cause_options: shuffle("cause", f.cause.options), action_options: shuffle("action", f.action.options),
    has_whatif: !!f.whatif,
  };
}

/** 단계 하나 확인. 맞히면 해설과 그 단계의 보상(원인 사슬·정상화 값·다음 공정 영향)을 준다. 틀리면 그 보기의 결과(조치)만. */
export function checkStep(f: FaultDrill, step: Step, key: string | number) {
  if (step === "signal") {
    const correct = typeof key === "string" && f.signal.answer.includes(key);
    return correct ? { correct, explain: f.signal.explain, abnormal: f.signal.answer } : { correct, hint: "정상 범위와 지금 값을 나란히 비교해 보세요." };
  }
  if (step === "cause") {
    const correct = key === f.cause.answer;
    return correct ? { correct, explain: f.cause.explain, chain: f.cause.chain, chain_text: f.cause.chain_text }
      : { correct, hint: "범위를 벗어난 값이 무엇을 뜻하는지, 그 값을 만드는 앞 단계 설비를 떠올려 보세요." };
  }
  const k = typeof key === "number" ? key : -1;
  const correct = k === f.action.answer;
  return correct
    ? { correct, explain: f.action.explain, fixed: Object.fromEntries(f.readings.map((r) => [r.id, r.fixed])), downstream: f.downstream, whatif: f.whatif ?? null }
    : { correct, consequence: f.action.consequences[k] ?? "그 조치로는 원인이 해결되지 않아요." };
}

/** 점수: 단계마다 1/시도 횟수의 평균(한 번에 모두 맞히면 1). */
export const faultScore = (tries: Record<Step, number>) =>
  Math.round(((1 / Math.max(1, tries.signal) + 1 / Math.max(1, tries.cause) + 1 / Math.max(1, tries.action)) / 3) * 100) / 100;
