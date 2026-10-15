// 오늘의 실습 경로(학습 기록 → 3D 실습): 내 3D 실습 기록(인과 퀴즈 014·이상 상황 훈련 013)으로 공정별 약한 정도를 재고,
// 가장 약한 공정 하나에 대해 ① 인과 지도에서 변수 살펴보기 → ② 그 공정 위주의 인과 퀴즈 → ③ 그 공정 이상 상황 훈련을 권한다.
// 점수·통과와 상관없는 추천이다. 링크는 3D 화면(v4)의 ?p=공정&lab=…로 바로 연다(sim-lab.js가 읽는다).
import type { DatabaseSync } from "node:sqlite";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { NODES } from "./causal.js";
import type { FaultDrill } from "./faults.js";

const NAME: Record<Section, string> = { ironmaking: "제선", steelmaking: "제강", continuous_casting: "연주", rolling: "열간압연" };
/** 한 번도 안 해 본 실습은 이만큼 약하다고 본다(해 본 실습에서 반쯤 틀린 것보다 조금 앞에 둔다). */
export const UNTRIED_WEAKNESS = 0.6;
const PAGE = "/3d-demo/Steel%20Academy%20v4.dc.html";
const proc = new Map(NODES.map((n) => [n.id, n.process as Section]));
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface PathStep { kind: "map" | "quiz" | "fault"; title: string; why: string; href: string; done?: boolean }

function tableExists(db: DatabaseSync, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function practicePath(db: DatabaseSync, userId: string, faults: FaultDrill[]) {
  const quiz = tableExists(db, "causal_quiz_answers") ? db.prepare("SELECT chain_id, hop, correct FROM causal_quiz_answers WHERE user_id = ?").all(userId) : [];
  const tries = tableExists(db, "fault_attempts") ? db.prepare("SELECT fault_id, MAX(score) AS best FROM fault_attempts WHERE user_id = ? GROUP BY fault_id").all(userId) : [];
  const best = new Map(tries.map((r) => [String(r.fault_id), Number(r.best)]));
  // 칸 하나가 지나는 변수들(원인 ~ 그 칸의 결과). 그 변수가 속한 공정마다 이 칸을 센다.
  const touched = (r: Record<string, unknown>) => String(r.chain_id).split(">").slice(0, Number(r.hop) + 1);

  const processes = SECTION_ORDER.map((p) => {
    const mine = quiz.filter((r) => touched(r).some((id) => proc.get(id) === p));
    const rate = mine.length ? mine.filter((r) => Number(r.correct) === 1).length / mine.length : null;
    const fault = faults.find((f) => f.section === p);
    const faultBest = fault ? best.get(fault.id) ?? null : null;
    const parts = [rate == null ? UNTRIED_WEAKNESS : 1 - rate, ...(fault ? [faultBest == null ? UNTRIED_WEAKNESS : 1 - faultBest] : [])];
    // 틀린 칸이 지난 이 공정 변수(인과 지도에서 먼저 볼 것)
    const missed = mine.filter((r) => Number(r.correct) !== 1).flatMap(touched).filter((id) => proc.get(id) === p);
    return {
      process: p, name: NAME[p], quiz_answers: mine.length, quiz_rate: rate == null ? null : Math.round(rate * 100) / 100,
      fault_id: fault?.id ?? null, fault_title: fault?.title ?? null, fault_best: faultBest,
      weakness: Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100, missed,
    };
  });
  // 가장 약한 공정(같으면 공정 순서가 앞인 것)
  const pick = [...processes].sort((a, b) => b.weakness - a.weakness || SECTION_ORDER.indexOf(a.process) - SECTION_ORDER.indexOf(b.process))[0];
  const p = pick.process;
  const counts = new Map<string, number>();
  for (const id of pick.missed) counts.set(id, (counts.get(id) ?? 0) + 1);
  const variable = NODES.find((n) => n.id === [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]) ?? NODES.find((n) => n.process === p && !n.control) ?? NODES.find((n) => n.process === p)!;

  const reason = pick.quiz_rate == null && pick.fault_best == null
    ? `${pick.name}의 3D 실습을 아직 안 해 봤어요.`
    : [pick.quiz_rate != null && pick.quiz_rate < 1 ? `${pick.name}이 걸린 인과 퀴즈 정답률이 ${pct(pick.quiz_rate)}` : null,
       pick.fault_best != null && pick.fault_best < 1 ? `이상 상황 훈련 최고 점수가 ${pct(pick.fault_best)}` : null,
       pick.quiz_rate == null ? "인과 퀴즈는 아직 안 풀었어요" : null,
       pick.fault_id && pick.fault_best == null ? "이상 상황 훈련은 아직 안 해 봤어요" : null].filter(Boolean).join(", ") + ".";
  const url = (q: string) => `${PAGE}?p=${p}&${q}`;
  const steps: PathStep[] = [
    { kind: "map", title: `인과 지도에서 '${variable.label}' 살펴보기`, why: counts.size ? "틀린 칸이 가장 많이 지난 변수예요. 무엇과 이어져 있는지 먼저 봐요." : `${pick.name}의 대표 변수예요. 무엇과 이어져 있는지 먼저 봐요.`, href: url(`lab=map&var=${variable.id}`) },
    { kind: "quiz", title: `${pick.name} 인과 퀴즈 5문제`, why: `${pick.name} 변수가 들어간 원인 → 결과 → 다음 공정 사슬을 한 칸씩 맞혀요.`, href: url(`lab=quiz&process=${p}`), done: pick.quiz_rate === 1 },
  ];
  if (pick.fault_id) steps.push({
    kind: "fault", title: `이상 상황 훈련: ${pick.fault_title}`, why: pick.fault_best == null ? "이상 신호 → 원인 → 조치를 직접 골라 봐요." : `최고 점수 ${pct(pick.fault_best)}. 한 번에 맞히면 100%예요.`,
    href: url(`lab=fault&fault=${pick.fault_id}`), done: pick.fault_best === 1,
  });
  return { process: p, name: pick.name, reason, steps, processes: processes.map(({ missed: _m, ...rest }) => rest) };
}
