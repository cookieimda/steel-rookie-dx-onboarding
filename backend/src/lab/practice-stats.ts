// 3D 실습 통계(관리자 운영 콘솔): 이상 상황 훈련(013)·인과 퀴즈(014) 기록을 묶어 어디서 막히는지 보여 준다.
// 사람별 내용은 내지 않고 문항·단계 단위 개수와 비율만 낸다. 점수는 이해도·통과와 상관없는 자가 훈련 점수다.
// includeDemo: false면 시연 계정(users.is_demo = 1)을 뺀다(?include_demo=false).
import type { DatabaseSync } from "node:sqlite";
import { NODES, controlAncestorsOf } from "./causal.js";
import type { FaultDrill, Step } from "./faults.js";
import type { LessonDef } from "./lessons.js";

const STEPS: Step[] = ["signal", "cause", "action"];
export const STEP_LABEL: Record<Step, string> = { signal: "이상 신호 찾기", cause: "원인 고르기", action: "조치 고르기" };
/** 인과 퀴즈 칸 하나가 "가장 헷갈리는 연결"에 들려면 답이 이만큼은 쌓여야 한다. */
export const MIN_LINK_ANSWERS = 2;

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const label = new Map(NODES.map((n) => [n.id, n.label]));
const proc = new Map(NODES.map((n) => [n.id, n.process]));

function tableExists(db: DatabaseSync, name: string) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

export function practiceStats(db: DatabaseSync, content: { faults: FaultDrill[]; lessons?: LessonDef[] }, { includeDemo = true } = {}) {
  const who = includeDemo ? "" : " AND user_id IN (SELECT id FROM users WHERE is_demo = 0)";
  const rows = (table: string, cols: string) => (tableExists(db, table) ? db.prepare(`SELECT ${cols} FROM ${table} WHERE 1 = 1${who}`).all() : []);

  // ── 이상 상황 훈련: 평균 점수, 단계별 평균 시도 횟수, 가장 오래 걸린 단계 ──
  const faultRows = rows("fault_attempts", "user_id, fault_id, tries_json, score");
  const faults = content.faults.map((f) => {
    const mine = faultRows.filter((r) => r.fault_id === f.id);
    const tries = STEPS.map((s) => {
      const list = mine.map((r) => Number((JSON.parse(String(r.tries_json)) as Record<Step, number>)[s]) || 1);
      return { step: s, label: STEP_LABEL[s], avg_tries: list.length ? round(list.reduce((a, b) => a + b, 0) / list.length, 1) : null };
    });
    const hardest = mine.length ? [...tries].sort((a, b) => (b.avg_tries ?? 0) - (a.avg_tries ?? 0))[0] : null;
    return {
      id: f.id, section: f.section, title: f.title, equipment_id: f.equipment_id,
      attempts: mine.length, learners: new Set(mine.map((r) => r.user_id)).size,
      avg_score: mine.length ? round(mine.reduce((a, r) => a + Number(r.score), 0) / mine.length) : null,
      first_try_rate: mine.length ? round(mine.filter((r) => Number(r.score) === 1).length / mine.length) : null,
      steps: tries, hardest_step: hardest && (hardest.avg_tries ?? 0) > 1 ? hardest.step : null,
    };
  });

  // ── 인과 퀴즈: 한 칸(바로 다음 값)과 두 칸(다음 공정까지 이어진 값), 같은 공정·공정 넘기 정답률, 헷갈리는 연결 ──
  const quizRows = rows("causal_quiz_answers", "user_id, chain_id, hop, correct");
  const rate = (list: Record<string, unknown>[]) => (list.length ? round(list.filter((r) => Number(r.correct) === 1).length / list.length) : null);
  const crosses = (r: Record<string, unknown>) => {
    const ids = String(r.chain_id).split(">").slice(0, Number(r.hop) + 1);
    return new Set(ids.map((id) => proc.get(id))).size > 1;
  };
  const byLink = new Map<string, Record<string, unknown>[]>();
  for (const r of quizRows) {
    const key = `${r.chain_id}#${r.hop}`;
    byLink.set(key, [...(byLink.get(key) ?? []), r]);
  }
  const links = [...byLink.entries()]
    .map(([key, list]) => {
      const [chain, hop] = key.split("#"), ids = chain.split(">").slice(0, Number(hop) + 1);
      return { key, hop: Number(hop), path: ids.map((id) => label.get(id) ?? id).join(" → "), cross: crosses(list[0]), answers: list.length, rate: rate(list)! };
    })
    .filter((l) => l.answers >= MIN_LINK_ANSWERS)
    .sort((a, b) => a.rate - b.rate || b.answers - a.answers);
  const causal = {
    answers: quizRows.length, learners: new Set(quizRows.map((r) => r.user_id)).size, rate: rate(quizRows),
    one_hop: rate(quizRows.filter((r) => Number(r.hop) === 1)), two_hop: rate(quizRows.filter((r) => Number(r.hop) === 2)),
    same_process: rate(quizRows.filter((r) => !crosses(r))), cross_process: rate(quizRows.filter(crosses)),
    confusing: links.filter((l) => l.rate < 1).slice(0, 5),
  };

  // ── 수업 모드: 단계를 연 기록(xAPI 3D 살펴봄, object_id practice:lesson:<수업>_<단계>)으로 수업별 사람 수 ──
  const opened = rows("xapi_statements", "user_id, object_id").filter((r) => String(r.object_id).startsWith("practice:lesson:"));
  const lessons = (content.lessons ?? []).map((l) => {
    const mine = opened.map((r) => ({ u: String(r.user_id), m: /^practice:lesson:([a-z0-9-]+)_(\d+)$/.exec(String(r.object_id)) })).filter((x) => x.m && x.m[1] === l.id);
    const steps = l.steps.map((s, i) => ({ title: s.title, learners: new Set(mine.filter((x) => Number(x.m![2]) === i + 1).map((x) => x.u)).size }));
    // 끝까지 간 사람: [수업 마치기]를 누른 사람(practice:lesson:<id>_done)
    const finished = new Set(opened.filter((r) => String(r.object_id) === `practice:lesson:${l.id}_done`).map((r) => String(r.user_id))).size;
    return { id: l.id, title: l.title, steps: l.steps.length, learners: new Set(mine.map((x) => x.u)).size, reached_last: steps[steps.length - 1]?.learners ?? 0, finished, by_step: steps };
  });
  // ── 거꾸로 추론: 정답률과 헷갈리는 원인(가장 많이 틀린 문제와 그때 가장 많이 고른 다른 원인) ──
  const diagRows = rows("diagnose_answers", "user_id, question, choice, correct");
  const causeLabel = (key: string) => { const [id, d] = key.split(":"); return `${label.get(id) ?? id} ${Number(d) > 0 ? "▲" : "▼"}`; };
  const byQ = new Map<string, Record<string, unknown>[]>();
  for (const r of diagRows) byQ.set(String(r.question), [...(byQ.get(String(r.question)) ?? []), r]);
  const confusingCauses = [...byQ.entries()].map(([q, list]) => {
    const wrong = list.filter((r) => Number(r.correct) !== 1), picks = new Map<string, number>();
    for (const r of wrong) picks.set(String(r.choice), (picks.get(String(r.choice)) ?? 0) + 1);
    const top = [...picks.entries()].sort((a, b) => b[1] - a[1])[0];
    return { cause: causeLabel(q), answers: list.length, rate: rate(list)!, mistaken_for: top ? causeLabel(top[0]) : null };
  }).filter((x) => x.answers >= MIN_LINK_ANSWERS && x.rate < 1).sort((a, b) => a.rate - b.rate || b.answers - a.answers).slice(0, 5);
  const diagnose = { answers: diagRows.length, learners: new Set(diagRows.map((r) => r.user_id)).size, rate: rate(diagRows), confusing: confusingCauses };
  // ── 되돌리기 퍼즐: 퍼즐별 시도·푼 비율·부작용 없이 푼 비율, 자주 고른 닿지 않는 값(목표까지 이어지지 않는 조정 값) ──
  const rbRows = rows("rebalance_attempts", "user_id, puzzle, control, solved, clean");
  const byPuzzle = new Map<string, Record<string, unknown>[]>();
  for (const r of rbRows) byPuzzle.set(String(r.puzzle), [...(byPuzzle.get(String(r.puzzle)) ?? []), r]);
  const rebalance = [...byPuzzle.entries()].map(([id, list]) => {
    const [head, target] = id.split(">"), [dv] = head.split("@"), [did, dir] = dv.split(":");
    const reach = new Set(controlAncestorsOf(target));
    const far = new Map<string, number>();
    for (const r of list) if (!reach.has(String(r.control))) far.set(String(r.control), (far.get(String(r.control)) ?? 0) + 1);
    const topFar = [...far.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      id, puzzle: `${label.get(did) ?? did} ${Number(dir) > 0 ? "▲" : "▼"} → ${label.get(target) ?? target}`, attempts: list.length, learners: new Set(list.map((r) => r.user_id)).size,
      solved_rate: round(list.filter((r) => Number(r.solved) === 1).length / list.length), clean_rate: round(list.filter((r) => Number(r.clean) === 1).length / list.length),
      common_far: topFar ? { control: label.get(topFar[0]) ?? topFar[0], times: topFar[1] } : null,
    };
  }).sort((a, b) => b.attempts - a.attempts);
  return { faults, causal, lessons, diagnose, rebalance, min_link_answers: MIN_LINK_ANSWERS };
}
