// 공정 인과 지도(3D): 제선 → 제강 → 연주 → 압연을 잇는 대표 인과 사슬을 작은 선형 모델로 만든다.
// 조정할 수 있는 변수(control) 6개를 바꾸면 아래 공정 변수가 차례로 반응한다. 3D 화면이 바뀐 연결(edge)을 흐름으로, 범위를 벗어난 변수를 경고로 그린다.
// 계수는 방향과 크기 감을 주려고 정한 교육용 근사값이다(실제 조업 모델 아님). 화면에 그대로 밝힌다.

export type ProcessId = "ironmaking" | "steelmaking" | "continuous_casting" | "rolling";

export interface NodeDef {
  id: string; label: string; unit: string; process: ProcessId; equipment_id: string;
  /** 변수 설명 카드에 보여 줄 한두 문장. */
  desc?: string;
  base: number; normal: [number, number]; digits: number;
  /** 조정할 수 있는 변수면 범위와 간격. */
  control?: { min: number; max: number; step: number };
  /** 이보다 작아질 수 없는 값(위험 점수 0, 과열도 0℃). 선형 모델이 음수를 내지 않게 자른다. */
  floor?: number;
}
export interface EdgeDef { from: string; to: string; coef: number; why: string }

export const NODES: NodeDef[] = [
  { id: "coke_rate", desc: "용선 1톤을 만드는 데 넣는 코크스 양이에요. 열을 내는 연료이자 철광석에서 산소를 떼는 환원 가스(CO)의 원료이고, 노 안에서 원료를 받쳐 가스가 지나갈 길도 만들어요.", label: "코크스비", unit: "kg/t", process: "ironmaking", equipment_id: "coke_oven", base: 340, normal: [320, 380], digits: 0, control: { min: 280, max: 420, step: 10 } },
  { id: "basicity", desc: "고로 슬래그의 CaO를 SiO2로 나눈 값이에요. 슬래그가 얼마나 잘 흐르는지, 황을 얼마나 붙잡는지를 정해요.", label: "고로 슬래그 염기도", unit: "", process: "ironmaking", equipment_id: "blast_furnace", base: 1.2, normal: [1.1, 1.3], digits: 2, control: { min: 0.9, max: 1.4, step: 0.05 } },
  { id: "hm_temp", desc: "출선구에서 나오는 쇳물(용선)의 온도예요. 노 아래쪽이 얼마나 뜨거운지 보여 주는 대표 지표예요.", label: "용선 온도", unit: "℃", process: "ironmaking", equipment_id: "taphole_casthouse", base: 1500, normal: [1480, 1530], digits: 0 },
  { id: "hm_si", desc: "용선에 녹아 있는 규소 비율이에요. 노 아래가 뜨거울수록 오르는 경향이 있어 노의 열 상태를 함께 보여 줘요.", label: "용선 규소(Si)", unit: "%", process: "ironmaking", equipment_id: "taphole_casthouse", base: 0.45, normal: [0.3, 0.6], digits: 2 },
  { id: "hm_s", desc: "용선에 녹아 있는 황 비율이에요. 황이 많으면 강이 뜨거울 때 부서지기 쉬워져서 제강 전에 줄여야 해요.", label: "용선 황(S)", unit: "%", process: "ironmaking", equipment_id: "torpedo_car", base: 0.03, normal: [0.015, 0.04], digits: 3 },
  { id: "desulf_min", desc: "용선 예비처리에서 황을 빼는 데 걸리는 시간이에요. 길어지면 그만큼 다음 공정이 기다려요.", label: "예비처리 탈황 시간", unit: "분", process: "steelmaking", equipment_id: "hot_metal_pretreatment", base: 15, normal: [10, 22], digits: 0 },
  { id: "scrap_pct", desc: "전로에 용선과 함께 넣어 녹일 수 있는 고철 비율이에요. 용선이 가져온 열이 많을수록 늘릴 수 있어요.", label: "전로 고철 투입 여유", unit: "%", process: "steelmaking", equipment_id: "bof_converter", base: 18, normal: [14, 22], digits: 1 },
  { id: "bof_slag", desc: "전로에서 생기는 슬래그 양이에요(강 1톤당). 규소처럼 산화되는 성분이 많을수록 늘어요.", label: "전로 슬래그량", unit: "kg/t", process: "steelmaking", equipment_id: "bof_converter", base: 90, normal: [70, 110], digits: 0 },
  { id: "slopping", desc: "전로의 거품 슬래그가 노구로 넘칠 위험을 점수로 나타낸 교육용 지표예요.", label: "슬로핑(넘침) 위험", unit: "점", process: "steelmaking", equipment_id: "oxygen_lance_offgas", base: 20, normal: [0, 40], digits: 0, floor: 0 },
  { id: "tap_temp", desc: "전로에서 용강을 래들로 쏟아 낼 때의 온도예요. 정련·이송 중 식는 만큼을 생각해 정해요.", label: "출강 온도", unit: "℃", process: "steelmaking", equipment_id: "tapping_ladle_crane", base: 1640, normal: [1620, 1660], digits: 0, control: { min: 1600, max: 1690, step: 5 } },
  { id: "superheat", desc: "턴디시 용강 온도가 그 강이 굳기 시작하는 온도보다 얼마나 높은지예요. 높으면 굳는 데 시간이 더 걸려요.", label: "턴디시 과열도", unit: "℃", process: "continuous_casting", equipment_id: "tundish", base: 30, normal: [20, 35], digits: 0, floor: 0 },
  { id: "cast_speed", desc: "주형에서 주편을 뽑아내는 속도예요. 빠르면 생산량은 늘지만 주형 안에서 굳을 시간이 줄어요.", label: "주조 속도", unit: "m/분", process: "continuous_casting", equipment_id: "cc_mold", base: 1.2, normal: [1.0, 1.4], digits: 2, control: { min: 0.8, max: 1.8, step: 0.05 } },
  { id: "shell_mm", desc: "주형을 빠져나올 때 주편 바깥에 굳은 껍질 두께예요. 안쪽은 아직 녹아 있어 이 껍질이 쇳물을 버텨요.", label: "주형 출구 응고 껍질", unit: "mm", process: "continuous_casting", equipment_id: "cc_mold", base: 15, normal: [12, 20], digits: 1 },
  { id: "breakout", desc: "응고 껍질이 찢어져 용강이 새어 나올 위험을 점수로 나타낸 교육용 지표예요.", label: "브레이크아웃 위험", unit: "점", process: "continuous_casting", equipment_id: "secondary_cooling", base: 10, normal: [0, 30], digits: 0, floor: 0 },
  { id: "center_seg", desc: "슬래브 두께 가운데에 탄소·황 같은 성분이 몰리는 정도를 점수로 나타낸 교육용 지표예요.", label: "슬래브 중심 편석", unit: "점", process: "continuous_casting", equipment_id: "torch_cutter", base: 20, normal: [0, 35], digits: 0, floor: 0 },
  { id: "reheat_temp", desc: "슬래브를 압연하기 전에 데우는 재가열로 온도예요. 너무 낮으면 압연이 힘들고 너무 높으면 연료와 표면 손실이 커져요.", label: "재가열 온도", unit: "℃", process: "rolling", equipment_id: "reheating_furnace", base: 1200, normal: [1170, 1240], digits: 0, control: { min: 1150, max: 1260, step: 5 } },
  { id: "rolled_defect", desc: "압연 뒤 판 내부에 결함이 생길 위험을 점수로 나타낸 교육용 지표예요.", label: "압연 내부 결함 위험", unit: "점", process: "rolling", equipment_id: "roughing_mill", base: 10, normal: [0, 30], digits: 0, floor: 0 },
  { id: "fdt", desc: "사상압연 마지막 롤을 지날 때 판의 온도예요. 판의 결정 크기와 품질에 영향을 줘요.", label: "사상압연 출구 온도", unit: "℃", process: "rolling", equipment_id: "finishing_mill", base: 880, normal: [860, 900], digits: 0 },
  { id: "cool_banks", desc: "런아웃 테이블에서 판에 물을 뿌리는 냉각 장치를 몇 개 켰는지예요.", label: "런아웃 냉각 뱅크", unit: "개", process: "rolling", equipment_id: "runout_table", base: 10, normal: [8, 12], digits: 0, control: { min: 6, max: 16, step: 1 } },
  { id: "coiling_temp", desc: "판을 코일로 감을 때의 온도예요. 이때 온도가 강의 조직을 정해 강도·연신이 달라져요.", label: "권취 온도", unit: "℃", process: "rolling", equipment_id: "coiler", base: 600, normal: [580, 620], digits: 0 },
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
  story: { id: string; equipment_id: string; causes: string[]; process: ProcessId; text: string; status: "ok" | "warn"; arrive: string }[];
  note: string;
}

/** 마지막 글자의 받침: 0이면 없음, 8이면 ㄹ. 끝의 괄호(예: '용선 황(S)')는 빼고 본다. 한글이 아니면 L·M·N·R로 끝날 때만 받침으로 본다. */
function finalJong(word: string) {
  const w = word.replace(/\s*\([^)]*\)\s*$/, ""), c = w.charCodeAt(w.length - 1);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
  return /[LMNRlmnr]$/.test(w) ? (/[Ll]$/.test(w) ? 8 : 4) : 0;
}
/** 받침에 따라 조사를 붙인다: josa('연주', '이', '가') → '연주가'. '으로/로'는 ㄹ 받침도 '로'. */
export function josa(word: string, withFinal: string, withoutFinal: string) {
  const j = finalJong(word);
  const has = withFinal === "으로" ? j !== 0 && j !== 8 : j !== 0;
  return `${word}${has ? withFinal : withoutFinal}`;
}
export const eulReul = (word: string) => josa(word, "을", "를");

// ── 공정 사이 시간 지연: 바꾼 값의 영향은 물질이 다음 공정에 닿아야 나타난다(교육용 대략값, 실제 물류·일정마다 다르다) ──
const PROCESS_SEQ: ProcessId[] = ["ironmaking", "steelmaking", "continuous_casting", "rolling"];
/** 앞 공정 → 다음 공정까지 걸리는 시간(시간, [짧게, 길게]): 용선 운송·예비처리, 정련·주조 대기, 슬래브 야드·가열로. */
export const LAG_HOURS: [number, number][] = [[2, 4], [1, 2], [8, 24]];
export const LAG_NOTE = "공정 사이 시간은 물질이 옮겨 가는 데 걸리는 대략값이에요(교육용). 같은 공정 안에서는 거의 바로 나타나요.";

/** 원인 공정에서 이 공정까지 영향이 닿는 시간 문구. */
export function arrivalText(from: ProcessId, to: ProcessId) {
  const a = PROCESS_SEQ.indexOf(from), b = PROCESS_SEQ.indexOf(to);
  if (b <= a) return "바로";
  const [lo, hi] = LAG_HOURS.slice(a, b).reduce(([x, y], [p, q]) => [x + p, y + q], [0, 0]);
  return `약 ${lo}~${hi}시간 뒤`;
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
    value.set(id, n.floor === undefined ? v : Math.max(n.floor, v));
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
  // 시간 기준: 바꾼 조정 값 중 가장 앞 공정
  const start = PROCESS_SEQ.find((p) => nodes.some((m) => m.control && m.delta && m.process === p)) ?? "ironmaking";
  const story = topoOrder().flatMap((id) => {
    const n = nodeOf.get(id)!;
    if (!n.delta) return [];
    // id·설비·원인 변수: 3D '인과 따라가기'가 이 순서대로 카메라를 옮기고 원인 설비 → 이 설비로 흐름을 그린다
    const at = { id, equipment_id: n.equipment_id, process: n.process, status: n.status, arrive: arrivalText(start, n.process) };
    // 숫자 뒤 조사(으로/로)는 읽는 법에 따라 달라 피한다
    if (n.control) return [{ ...at, causes: [], text: `${eulReul(n.label)} 바꿨어요: ${fmt(n)}.` }];
    const active = edges.filter((e) => e.to === id && e.active);
    const causes = active.map((e) => nodeOf.get(e.from)!.label);
    const why = edges.filter((e) => e.to === id && e.active).map((e) => e.why).join(" ");
    return [{ ...at, causes: active.map((e) => e.from), text: `${causes.join("·")} → ${n.label} ${fmt(n)}. ${why}${n.status === "warn" ? " 정상 범위를 벗어났어요." : ""}` }];
  });
  return { nodes, edges, story, note: `${CAUSAL_NOTE} ${LAG_NOTE}` };
}

// ── 인과 퀴즈: "원인 → 결과 → 다음 공정 영향"을 한 칸씩 묻는 질문 틀 ──
// 연결 두 개를 잇는 길(노드 3개)을 골라, 첫 변수를 올리거나 내리면 다음 변수·그다음 변수가 어떻게 되는지 차례로 묻는다.
// 정답은 길 위 계수 부호의 곱(서버가 계산). 채점은 상태 없이 길 id·방향·몇 번째 칸으로 한다.

export interface Chain { id: string; nodes: string[]; cross: boolean }

/** 연결 두 개로 이어지는 모든 길. cross는 공정을 넘는 길인지. */
export function causalChains(length = 3): Chain[] {
  // length = 변수 수(3: 두 칸, 4: 세 칸). 연결을 이어 붙여 만든 모든 길.
  let paths: string[][] = EDGES.map((e) => [e.from, e.to]);
  while (paths[0] && paths[0].length < length) paths = paths.flatMap((p) => EDGES.filter((e) => e.from === p[p.length - 1]).map((e) => [...p, e.to]));
  return paths.map((nodes) => ({ id: nodes.join(">"), nodes, cross: new Set(nodes.map((id) => byId.get(id)!.process)).size > 1 }));
}

/** 세 칸 길이 지나는 공정 수(심화 퀴즈는 공정 3개 이상을 넘는 길을 먼저). */
const processCount = (c: Chain) => new Set(c.nodes.map((id) => byId.get(id)!.process)).size;

/** 퀴즈 n개: 공정을 넘는 길을 먼저, seed로 섞고 방향(올림/내림)을 정한다. process를 주면 그 공정 변수가 든 길을 먼저 낸다(오늘의 실습 경로). */
export function causalQuiz(seed = 1, n = 5, process?: string, level: 1 | 2 = 1) {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const rand = () => (x = (x * 48271) % 2147483647) / 2147483647;
  const has = (c: Chain) => !!process && c.nodes.some((id) => byId.get(id)!.process === process);
  // level 2(심화): 세 칸 길, 공정 3개 이상을 넘는 길을 먼저
  const pool = level === 2 ? causalChains(4) : causalChains();
  const chains = pool.map((c) => ({ c, k: rand() - (c.cross ? 1 : 0) - (has(c) ? 2 : 0) - (level === 2 && processCount(c) >= 3 ? 3 : 0) })).sort((a, b) => a.k - b.k).slice(0, n).map((o) => o.c);
  return chains.map((c) => ({
    id: c.id, dir: rand() < 0.5 ? 1 : -1, cross: c.cross, processes: processCount(c),
    nodes: c.nodes.map((id) => { const d = byId.get(id)!; return { id, label: d.label, process: d.process, equipment_id: d.equipment_id }; }),
  }));
}

/** 길의 hop번째(두 칸 길은 1·2, 세 칸 길은 1~3) 변수가 어떻게 되는지 채점. */
export function checkHop(chainId: string, dir: number, hop: number, choice: "up" | "down") {
  const nodes = chainId.split(">");
  if ((nodes.length !== 3 && nodes.length !== 4) || !Number.isInteger(hop) || hop < 1 || hop > nodes.length - 1 || (dir !== 1 && dir !== -1)) return null;
  const edges = nodes.slice(0, -1).map((id, i) => EDGES.find((e) => e.from === id && e.to === nodes[i + 1]));
  if (edges.some((e) => !e)) return null;
  const sign = edges.slice(0, hop).reduce((s, e) => s * Math.sign(e!.coef), dir);
  const answer = sign > 0 ? "up" : "down";
  const edge = edges[hop - 1]!;
  return { correct: choice === answer, answer, why: edge.why, from: edge.from, to: edge.to,
    sign_rule: Math.sign(edge.coef) > 0 ? "같은 방향(하나가 오르면 다른 것도 오름)" : "반대 방향(하나가 오르면 다른 것은 내림)" };
}

// ── 거꾸로 추론(진단형) 퀴즈: 결과(증상)를 보여 주고 원인(조정 변수와 방향)을 고르게 한다 ──
// 원인 하나를 정상 범위 쪽으로 크게 움직여 바뀐 하류 값 중 증상 2개(범위 밖·다른 공정 우선)를 고른다.
// 보기는 정답 + 같은 증상 방향을 만들지 않는 다른 원인 3개라서 답이 하나로 정해진다(헷갈리는 보기는 빼고 고른다).

/** 원인 키 "변수:방향"(방향 1·-1) → 조정 값(기준에서 끝 쪽으로 80%, 간격에 맞춤). */
export function diagnoseInput(key: string): Record<string, number> | null {
  const [id, d] = key.split(":"), n = byId.get(id), dir = Number(d);
  if (!n?.control || (dir !== 1 && dir !== -1)) return null;
  const { min, max, step } = n.control;
  const raw = n.base + (dir > 0 ? (max - n.base) : (n.base - min)) * 0.8 * dir;
  return { [id]: round(Math.round(raw / step) * step, 4) };
}

const signOf = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function diagnoseQuiz(seed = 1, n = 4) {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const rand = () => (x = (x * 48271) % 2147483647) / 2147483647;
  const keys = NODES.filter((c) => c.control).flatMap((c) => [`${c.id}:1`, `${c.id}:-1`]);
  const shuffle = <T,>(a: T[]) => a.map((v) => ({ v, k: rand() })).sort((p, q) => p.k - q.k).map((o) => o.v);
  const out = [];
  for (const key of shuffle(keys)) {
    if (out.length >= n) break;
    const r = simulateCausal(diagnoseInput(key)!), cause = key.split(":")[0];
    const moved = r.nodes.filter((m) => !m.control && m.delta);
    if (!moved.length) continue;
    const proc = byId.get(cause)!.process;
    // 증상: 범위 밖 > 다른 공정 > 원인에서 먼 순서(위상 순서 뒤쪽)
    const order = topoOrder();
    const symptoms = [...moved].sort((a, b) => (b.status === "warn" ? 1 : 0) - (a.status === "warn" ? 1 : 0) || (b.process !== proc ? 1 : 0) - (a.process !== proc ? 1 : 0) || order.indexOf(b.id) - order.indexOf(a.id)).slice(0, 2);
    const pattern = (res: CausalResult) => symptoms.map((s) => signOf(res.nodes.find((m) => m.id === s.id)!.delta)).join(",");
    const truth = pattern(r);
    const distractors = shuffle(keys.filter((k) => k !== key && pattern(simulateCausal(diagnoseInput(k)!)) !== truth)).slice(0, 3);
    if (distractors.length < 3) continue;
    out.push({
      id: key,
      symptoms: symptoms.map((s) => ({ id: s.id, label: s.label, process: s.process, equipment_id: s.equipment_id, dir: signOf(s.delta), warn: s.status === "warn", value: s.value, unit: s.unit, digits: s.digits })),
      options: shuffle([key, ...distractors]).map((k) => { const [id, d] = k.split(":"), c = byId.get(id)!; return { key: k, label: c.label, process: c.process, equipment_id: c.equipment_id, dir: Number(d) }; }),
    });
  }
  return out;
}

/** 고른 원인 채점: 맞았는지, 진짜 원인과 그 원인에서 번진 이야기. 고른 원인이 같은 증상을 만들면(보기 밖이라도) 맞음으로 본다. */
export function checkDiagnose(id: string, choice: string, symptomIds: string[]) {
  const truthIn = diagnoseInput(id), pickIn = diagnoseInput(choice);
  if (!truthIn || !pickIn) return null;
  const truth = simulateCausal(truthIn), pick = simulateCausal(pickIn);
  const pat = (r: CausalResult) => symptomIds.map((s) => signOf(r.nodes.find((m) => m.id === s)?.delta ?? 0)).join(",");
  const [cid, d] = id.split(":"), c = byId.get(cid)!;
  return {
    correct: choice === id || (symptomIds.length > 0 && pat(pick) === pat(truth)),
    answer: { key: id, label: c.label, dir: Number(d), process: c.process, equipment_id: c.equipment_id },
    story: truth.story, edges: truth.edges.filter((e) => e.active).map((e) => ({ from: e.from, to: e.to, effect: e.effect })),
    nodes: truth.nodes.filter((m) => m.delta).map((m) => ({ id: m.id, equipment_id: m.equipment_id })),
  };
}
