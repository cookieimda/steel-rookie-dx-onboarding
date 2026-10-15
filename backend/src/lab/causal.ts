// 공정 인과 지도(3D): 제선 → 제강 → 연주 → 압연을 잇는 대표 인과 사슬을 작은 선형 모델로 만든다.
// 조정할 수 있는 변수(control) 6개를 바꾸면 아래 공정 변수가 차례로 반응한다. 3D 화면이 바뀐 연결(edge)을 흐름으로, 범위를 벗어난 변수를 경고로 그린다.
// 계수는 방향과 크기 감을 주려고 정한 교육용 근사값이다(실제 조업 모델 아님). 화면에 그대로 밝힌다.

export type ProcessId = "ironmaking" | "steelmaking" | "continuous_casting" | "rolling";

export interface NodeDef {
  id: string; label: string; unit: string; process: ProcessId; equipment_id: string;
  base: number; normal: [number, number]; digits: number;
  /** 조정할 수 있는 변수면 범위와 간격. */
  control?: { min: number; max: number; step: number };
}
export interface EdgeDef { from: string; to: string; coef: number; why: string }

export const NODES: NodeDef[] = [
  { id: "coke_rate", label: "코크스비", unit: "kg/t", process: "ironmaking", equipment_id: "coke_oven", base: 340, normal: [320, 380], digits: 0, control: { min: 280, max: 420, step: 10 } },
  { id: "basicity", label: "고로 슬래그 염기도", unit: "", process: "ironmaking", equipment_id: "blast_furnace", base: 1.2, normal: [1.1, 1.3], digits: 2, control: { min: 0.9, max: 1.4, step: 0.05 } },
  { id: "hm_temp", label: "용선 온도", unit: "℃", process: "ironmaking", equipment_id: "taphole_casthouse", base: 1500, normal: [1480, 1530], digits: 0 },
  { id: "hm_si", label: "용선 규소(Si)", unit: "%", process: "ironmaking", equipment_id: "taphole_casthouse", base: 0.45, normal: [0.3, 0.6], digits: 2 },
  { id: "hm_s", label: "용선 황(S)", unit: "%", process: "ironmaking", equipment_id: "torpedo_car", base: 0.03, normal: [0.015, 0.04], digits: 3 },
  { id: "desulf_min", label: "예비처리 탈황 시간", unit: "분", process: "steelmaking", equipment_id: "hot_metal_pretreatment", base: 15, normal: [10, 22], digits: 0 },
  { id: "scrap_pct", label: "전로 고철 투입 여유", unit: "%", process: "steelmaking", equipment_id: "bof_converter", base: 18, normal: [14, 22], digits: 1 },
  { id: "bof_slag", label: "전로 슬래그량", unit: "kg/t", process: "steelmaking", equipment_id: "bof_converter", base: 90, normal: [70, 110], digits: 0 },
  { id: "slopping", label: "슬로핑(넘침) 위험", unit: "점", process: "steelmaking", equipment_id: "oxygen_lance_offgas", base: 20, normal: [0, 40], digits: 0 },
  { id: "tap_temp", label: "출강 온도", unit: "℃", process: "steelmaking", equipment_id: "tapping_ladle_crane", base: 1640, normal: [1620, 1660], digits: 0, control: { min: 1600, max: 1690, step: 5 } },
  { id: "superheat", label: "턴디시 과열도", unit: "℃", process: "continuous_casting", equipment_id: "tundish", base: 30, normal: [20, 35], digits: 0 },
  { id: "cast_speed", label: "주조 속도", unit: "m/분", process: "continuous_casting", equipment_id: "cc_mold", base: 1.2, normal: [1.0, 1.4], digits: 2, control: { min: 0.8, max: 1.8, step: 0.05 } },
  { id: "shell_mm", label: "주형 출구 응고 껍질", unit: "mm", process: "continuous_casting", equipment_id: "cc_mold", base: 15, normal: [12, 20], digits: 1 },
  { id: "breakout", label: "브레이크아웃 위험", unit: "점", process: "continuous_casting", equipment_id: "secondary_cooling", base: 10, normal: [0, 30], digits: 0 },
  { id: "center_seg", label: "슬래브 중심 편석", unit: "점", process: "continuous_casting", equipment_id: "torch_cutter", base: 20, normal: [0, 35], digits: 0 },
  { id: "reheat_temp", label: "재가열 온도", unit: "℃", process: "rolling", equipment_id: "reheating_furnace", base: 1200, normal: [1170, 1240], digits: 0, control: { min: 1150, max: 1260, step: 5 } },
  { id: "rolled_defect", label: "압연 내부 결함 위험", unit: "점", process: "rolling", equipment_id: "roughing_mill", base: 10, normal: [0, 30], digits: 0 },
  { id: "fdt", label: "사상압연 출구 온도", unit: "℃", process: "rolling", equipment_id: "finishing_mill", base: 880, normal: [860, 900], digits: 0 },
  { id: "cool_banks", label: "런아웃 냉각 뱅크", unit: "개", process: "rolling", equipment_id: "runout_table", base: 10, normal: [8, 12], digits: 0, control: { min: 6, max: 16, step: 1 } },
  { id: "coiling_temp", label: "권취 온도", unit: "℃", process: "rolling", equipment_id: "coiler", base: 600, normal: [580, 620], digits: 0 },
];

/** 위에서 아래로(정렬된 순서로) 계산한다. coef는 부모가 1단위 바뀔 때 자식이 바뀌는 양. */
export const EDGES: EdgeDef[] = [
  { from: "coke_rate", to: "hm_temp", coef: 0.6, why: "코크스는 노 안 열의 주원료라 많을수록 용선이 뜨거워요." },
  { from: "hm_temp", to: "hm_si", coef: 0.008, why: "노 아래가 뜨거우면 SiO2가 더 환원돼 용선 규소가 올라가요." },
  { from: "basicity", to: "hm_s", coef: -0.04, why: "염기도가 높은 슬래그가 황을 더 많이 붙잡아 용선 황이 줄어요." },
  { from: "hm_s", to: "desulf_min", coef: 400, why: "들어온 용선에 황이 많으면 예비처리에서 탈황에 시간이 더 들어요." },
  { from: "hm_temp", to: "scrap_pct", coef: 0.1, why: "용선이 뜨거울수록 전로에서 함께 녹일 수 있는 고철이 늘어요." },
  { from: "hm_si", to: "scrap_pct", coef: 6, why: "규소는 산화하면서 열을 내 고철을 조금 더 녹일 수 있게 해요." },
  { from: "hm_si", to: "bof_slag", coef: 120, why: "규소가 산화돼 SiO2가 되고, 이를 맞추려 석회를 더 넣어 슬래그가 늘어요." },
  { from: "bof_slag", to: "slopping", coef: 1.2, why: "슬래그가 많을수록 거품이 부풀어 노구로 넘칠 위험이 커져요." },
  { from: "tap_temp", to: "superheat", coef: 0.9, why: "출강 온도가 높으면 턴디시에 도착한 용강도 뜨거워 과열도가 올라가요." },
  { from: "superheat", to: "shell_mm", coef: -0.15, why: "과열도가 높으면 주형에서 껍질이 늦게 굳어 얇아져요." },
  { from: "cast_speed", to: "shell_mm", coef: -8, why: "빨리 뽑을수록 주형에 머무는 시간이 짧아 껍질이 얇아져요." },
  { from: "shell_mm", to: "breakout", coef: -6, why: "껍질이 얇으면 찢어져 쇳물이 새는 브레이크아웃 위험이 커져요." },
  { from: "superheat", to: "center_seg", coef: 1.0, why: "과열도가 높으면 슬래브 가운데에 성분이 몰리는 중심 편석이 커지기 쉬워요." },
  { from: "center_seg", to: "rolled_defect", coef: 0.8, why: "슬래브 중심 편석은 압연 뒤 내부 결함·균열의 씨앗이 돼요." },
  { from: "reheat_temp", to: "fdt", coef: 0.6, why: "재가열 온도가 높으면 사상압연을 마칠 때 온도도 올라가요." },
  { from: "fdt", to: "coiling_temp", coef: 0.5, why: "사상압연 출구가 뜨거우면 권취 온도도 따라 올라가요." },
  { from: "cool_banks", to: "coiling_temp", coef: -12, why: "냉각 뱅크를 많이 열수록 판이 더 식어 권취 온도가 내려가요." },
];

export const CAUSAL_NOTE = "계수는 공정 사이 영향의 방향과 크기 감을 주려고 정한 교육용 근사값이에요. 실제 조업 모델이 아니에요.";

const byId = new Map(NODES.map((n) => [n.id, n]));
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** 위상 정렬(부모가 먼저). 고리가 있으면 예외. */
export function topoOrder(nodes = NODES, edges = EDGES): string[] {
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id), out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!; out.push(id);
    for (const e of edges.filter((x) => x.from === id)) { indeg.set(e.to, indeg.get(e.to)! - 1); if (!indeg.get(e.to)) queue.push(e.to); }
  }
  if (out.length !== nodes.length) throw new Error("인과 지도에 고리가 있어요");
  return out;
}

export interface CausalResult {
  nodes: (NodeDef & { value: number; delta: number; status: "ok" | "warn" })[];
  edges: (EdgeDef & { effect: number; active: boolean })[];
  /** 바뀐 변수를 위에서 아래로 따라간 설명(조정 변수 → 영향받은 변수). */
  story: { process: ProcessId; text: string; status: "ok" | "warn" }[];
  note: string;
}

export function simulateCausal(raw: Record<string, number> = {}): CausalResult {
  const value = new Map<string, number>();
  for (const id of topoOrder()) {
    const n = byId.get(id)!;
    if (n.control) {
      const v = Number(raw[id]);
      value.set(id, Number.isFinite(v) ? Math.min(n.control.max, Math.max(n.control.min, v)) : n.base);
      continue;
    }
    let v = n.base;
    for (const e of EDGES.filter((x) => x.to === id)) v += e.coef * (value.get(e.from)! - byId.get(e.from)!.base);
    value.set(id, v);
  }
  const nodes = NODES.map((n) => {
    const v = round(value.get(n.id)!, n.digits);
    return { ...n, value: v, delta: round(v - n.base, n.digits), status: (v < n.normal[0] || v > n.normal[1] ? "warn" : "ok") as "ok" | "warn" };
  });
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const edges = EDGES.map((e) => {
    const effect = e.coef * (value.get(e.from)! - byId.get(e.from)!.base), to = byId.get(e.to)!;
    return { ...e, effect: round(effect, to.digits + 1), active: Math.abs(effect) >= 0.5 * 10 ** -to.digits };
  });
  const fmt = (n: { value: number; delta: number; unit: string; digits: number }) => `${n.value.toFixed(n.digits)}${n.unit} (${n.delta > 0 ? "+" : ""}${n.delta.toFixed(n.digits)})`;
  const story = topoOrder().flatMap((id) => {
    const n = nodeOf.get(id)!;
    if (!n.delta) return [];
    if (n.control) return [{ process: n.process, text: `${n.label}를 ${fmt(n)}로 바꿨어요.`, status: n.status }];
    const causes = edges.filter((e) => e.to === id && e.active).map((e) => nodeOf.get(e.from)!.label);
    const why = edges.filter((e) => e.to === id && e.active).map((e) => e.why).join(" ");
    return [{ process: n.process, text: `${causes.join("·")} → ${n.label} ${fmt(n)}. ${why}${n.status === "warn" ? " 정상 범위를 벗어났어요." : ""}`, status: n.status }];
  });
  return { nodes, edges, story, note: CAUSAL_NOTE };
}

// ── 인과 퀴즈: "원인 → 결과 → 다음 공정 영향"을 한 칸씩 묻는 질문 틀 ──
// 연결 두 개를 잇는 길(노드 3개)을 골라, 첫 변수를 올리거나 내리면 다음 변수·그다음 변수가 어떻게 되는지 차례로 묻는다.
// 정답은 길 위 계수 부호의 곱(서버가 계산). 채점은 상태 없이 길 id·방향·몇 번째 칸으로 한다.

export interface Chain { id: string; nodes: string[]; cross: boolean }

/** 연결 두 개로 이어지는 모든 길. cross는 공정을 넘는 길인지. */
export function causalChains(): Chain[] {
  const out: Chain[] = [];
  for (const a of EDGES) for (const b of EDGES.filter((e) => e.from === a.to)) {
    const nodes = [a.from, a.to, b.to];
    out.push({ id: nodes.join(">"), nodes, cross: new Set(nodes.map((id) => byId.get(id)!.process)).size > 1 });
  }
  return out;
}

/** 퀴즈 n개: 공정을 넘는 길을 먼저, seed로 섞고 방향(올림/내림)을 정한다. */
export function causalQuiz(seed = 1, n = 5) {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const rand = () => (x = (x * 48271) % 2147483647) / 2147483647;
  const chains = causalChains().map((c) => ({ c, k: rand() - (c.cross ? 1 : 0) })).sort((a, b) => a.k - b.k).slice(0, n).map((o) => o.c);
  return chains.map((c) => ({
    id: c.id, dir: rand() < 0.5 ? 1 : -1, cross: c.cross,
    nodes: c.nodes.map((id) => { const d = byId.get(id)!; return { id, label: d.label, process: d.process, equipment_id: d.equipment_id }; }),
  }));
}

/** 길의 hop번째(1·2) 변수가 어떻게 되는지 채점. */
export function checkHop(chainId: string, dir: number, hop: number, choice: "up" | "down") {
  const nodes = chainId.split(">");
  if (nodes.length !== 3 || (hop !== 1 && hop !== 2) || (dir !== 1 && dir !== -1)) return null;
  const edges = [0, 1].map((i) => EDGES.find((e) => e.from === nodes[i] && e.to === nodes[i + 1]));
  if (edges.some((e) => !e)) return null;
  const sign = edges.slice(0, hop).reduce((s, e) => s * Math.sign(e!.coef), dir);
  const answer = sign > 0 ? "up" : "down";
  const edge = edges[hop - 1]!;
  return { correct: choice === answer, answer, why: edge.why, from: edge.from, to: edge.to,
    sign_rule: Math.sign(edge.coef) > 0 ? "같은 방향(하나가 오르면 다른 것도 오름)" : "반대 방향(하나가 오르면 다른 것은 내림)" };
}
