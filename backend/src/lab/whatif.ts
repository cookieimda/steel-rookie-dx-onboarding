// What-if 계산(학습 랩): 고로 원료 배합·연료·송풍 조건을 바꾸면 용선 1톤당 슬래그량·염기도·연료 탄소·CO2·용선 온도가 어떻게 달라지는지
// 보여 주는 교육용 간이 모델이다. 실제 조업 계산(물질·열 수지 전체)이 아니다. 화면에 가정(ASSUMPTIONS)을 그대로 보여 준다.
// - 슬래그·염기도·CO2는 성분 질량 수지로 계산한다.
// - 용선 온도는 기준 조건(1,500℃) 주변의 선형 근사다(계수는 경향을 보여 주려고 정한 값).
// - 숫자의 출처(2026-10-16 정리): 공개 자료 메모(backend/data/ironmaking-sources.json)에 있는 두 자료에서 가져오고, 없는 값은 '가정'으로 밝힌다.
//   JFE = jfe-21st-cf-bf-operation·jfe-21st-cf-iron-ore·jfe-21st-cf-coke(JFE 21세기재단), BREF = eu-jrc-bref-iron-steel(EU JRC, 2012).

export interface WhatIfInput {
  /** 철 원료 비율(%): 소결광·펠릿·괴광, 합이 100이 되게 맞춘다. */
  sinter_pct: number; pellet_pct: number; lump_pct: number;
  /** 연료(kg/용선 t): 코크스, 미분탄(PCI) */
  coke_kg: number; pci_kg: number;
  /** 송풍 온도(℃), 산소 부화(%p) */
  blast_temp_c: number; oxygen_pct: number;
  /** 석회석 플럭스(kg/용선 t) */
  limestone_kg: number;
}
/**
 * 기준 조건. 원료 비율은 BREF Table 6.1(EU 2004 가중 평균 소결광 1,088·펠릿 358·괴광 180kg/t)을 비율로 바꾼 값,
 * 코크스 380·미분탄 100kg/t은 JFE('코크스 약 380kg/t', '미분탄 보통 90~120kg/t'), 송풍 1,150℃는 JFE('1,423~1,523K')의 하한이다.
 * 산소 부화 4%p와 석회석 0kg은 가정이다(BREF 석회석 범위 0~80kg/t 안).
 */
export const BASELINE: WhatIfInput = { sinter_pct: 67, pellet_pct: 22, lump_pct: 11, coke_kg: 380, pci_kg: 100, blast_temp_c: 1150, oxygen_pct: 4, limestone_kg: 0 };
export const LIMITS: Record<keyof WhatIfInput, [number, number]> = {
  sinter_pct: [0, 100], pellet_pct: [0, 100], lump_pct: [0, 100], coke_kg: [250, 550], pci_kg: [0, 250], blast_temp_c: [900, 1300], oxygen_pct: [0, 10], limestone_kg: [0, 150],
};
/** 기준 조건의 용선 온도(℃). BREF·공개 자료 메모 '출선 용선 약 1,440~1,500℃'의 상한. */
const BASE_TEMP_C = 1500;

/**
 * 원료 성분(질량 %).
 * - 소결광: BREF Figure 3.9(EU 소결광 가중 평균을 그래프에서 읽음. 원료 비율과 같은 2004년 값) Fe 57.8·SiO2 5.3·Al2O3 1.2·MgO 1.65·CaO/SiO2 1.78 → CaO 9.4.
 * - 펠릿·괴광 Fe 65·62: JFE '실제 광석의 철 함량은 최대 약 65%' 이내의 가정. SiO2·Al2O3는 JFE '실리카 2~6%, 알루미나 1~3%' 범위 안의 값.
 * - 펠릿·괴광 CaO·MgO: 가정(출처 없음).
 */
const ORES = {
  sinter: { fe: 57.8, sio2: 5.3, al2o3: 1.2, cao: 9.4, mgo: 1.65 },
  pellet: { fe: 65, sio2: 3.5, al2o3: 1.0, cao: 0.6, mgo: 0.4 },
  lump: { fe: 62, sio2: 4.0, al2o3: 2.3, cao: 0.1, mgo: 0.1 },
};
/** 코크스 탄소 90%: JFE '고정탄소 약 90%'. 회분 10%와 미분탄 탄소 78%·회분 9%, 회분 성분은 가정(출처 없음). */
const COKE = { c: 90, ash: 10 }, PCI = { c: 78, ash: 9 };
const ASH = { sio2: 0.5, al2o3: 0.3, cao: 0.05, mgo: 0.02 };
/**
 * 용선 1톤(kg). 기본 용선 성분 C 4.2~4.8%·Si 0.4~0.8%(Babich & Senk 2015, 『Iron Ore』 17장 표 17.4)에서 탄소 45kg(4.5%)·규소 5kg(0.5%), 나머지는 철.
 * (2026-10-20 문헌 대조로 탄소 40kg(BREF '약 4%') → 45kg)
 */
const HOT_METAL = { fe: 950, c: 45, si: 5 };
/** 석회석의 CaO 비율. CaCO3의 CaO 질량비 0.56에 순도 약 95%를 둔 가정. */
const LIMESTONE_CAO = 0.53;
/** 석회석 분해 CaCO3 → CaO + CO2의 CO2(kg/kg 석회석): 화학양론 44.01/100.09 ≈ 0.44(IPCC 2006 지침 3권 2장)에 같은 순도 95%. */
const LIMESTONE_CO2 = 0.95 * (44.01 / 100.09);
/**
 * 풍구 앞 화염 온도(RAFT, 단열 화염 온도). 보통 2,000~2,300℃이고 대표값 약 2,200℃(Carpenter 2006, IEA CCC/116).
 * 요인별 변화(Babich & Senk 2015 표 17.3, Babich 외 2008 수정): 송풍 온도 +100℃ → +60~80℃, 산소 부화 +1% → +45~50℃,
 * 미분탄 +100kg/t → 저휘발분 −0~130℃ · 고휘발분 −150~220℃(Carpenter는 저휘발분 −80~120℃). 범위의 가운데 값을 쓰고, 미분탄은 저휘발분 탄으로 본다.
 * 코크스 투입량은 풍구 앞 연소 온도를 정하는 항목이 아니라 넣지 않는다(위 표에 없음).
 */
const RAFT = { base: 2200, per_blast_c: 0.7, per_oxygen_pct: 47.5, per_pci_kg: -1.0 };

export const ASSUMPTIONS = [
  "소결광 성분은 EU 소결광 평균(EU JRC BREF 그림 3.9, 2004년)이에요: Fe 57.8%, SiO2 5.3%, CaO 9.4%. 펠릿 Fe 65%·괴광 Fe 62%는 'Fe 최대 약 65%'(JFE 21세기재단) 안에서 정한 가정이에요.",
  "기준 조건: 원료 비율 소결광 67·펠릿 22·괴광 11%(EU 평균, BREF 표 6.1), 코크스 380kg·미분탄 100kg/t(JFE), 송풍 1,150℃(JFE 1,150~1,250℃). 산소 부화 4%p는 가정이에요.",
  "용선 1톤에는 철 950kg, 탄소 45kg(4.5%), 규소 5kg(0.5%)이 들어 있다고 봐요. 기본 용선 성분 C 4.2~4.8%·Si 0.4~0.8%(Babich & Senk 2015, 『Iron Ore』 17장)의 안쪽 값이에요. 철은 모두 용선으로 간다고 단순화했어요.",
  "코크스 탄소 90%(JFE)로 두었어요. 코크스 회분 10%, 미분탄 탄소 78%·회분 9%는 출처 없는 가정이에요.",
  "슬래그량 = 원료 맥석 + 연료 회분 + 석회석의 CaO − 용선으로 간 규소만큼의 SiO2. 실제 고로 슬래그는 용선 1톤당 175~350kg이에요(BREF).",
  "CO2는 연료 탄소 중 용선에 녹은 탄소를 뺀 나머지가 모두 CO2가 된다고 본 단순 상한에, 석회석이 분해되며 나오는 CO2(CaCO3 → CaO + CO2, 석회석 1kg당 약 0.42kg = 화학양론 0.44 × 순도 95%, IPCC 2006)를 더했어요.",
  "풍구 앞 화염 온도(RAFT)는 기준 2,200℃(Carpenter 2006)에서 송풍 온도 100℃당 +70℃, 산소 부화 1%당 +47.5℃, 미분탄 100kg/t당 −100℃(저휘발분)로 계산해요. Babich & Senk(2015) 표 17.3의 범위 가운데 값이고, 실제 값은 회사마다 계산 방식이 달라요.",
  "용선 온도는 기준 조건(1,500℃, BREF 1,440~1,500℃) 주변의 선형 근사예요. 계수는 출처 없이 방향을 보여 주려고 정한 값이라 실제 조업 값이 아니에요.",
];

export function normalizeInput(raw: Partial<WhatIfInput>): WhatIfInput {
  const v = { ...BASELINE, ...raw } as WhatIfInput;
  for (const k of Object.keys(LIMITS) as (keyof WhatIfInput)[]) {
    const [lo, hi] = LIMITS[k];
    const n = Number(v[k]);
    v[k] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : BASELINE[k];
  }
  const sum = v.sinter_pct + v.pellet_pct + v.lump_pct;
  if (sum <= 0) { v.sinter_pct = 100; v.pellet_pct = 0; v.lump_pct = 0; }
  else { v.sinter_pct = (v.sinter_pct / sum) * 100; v.pellet_pct = (v.pellet_pct / sum) * 100; v.lump_pct = (v.lump_pct / sum) * 100; }
  return v;
}

export interface WhatIfResult {
  ore_kg: number; slag_kg: number; basicity: number; fuel_rate_kg: number; carbon_kg: number; co2_kg: number; hot_metal_temp_c: number;
  /** 풍구 앞 화염 온도(℃, 문헌 계수, 위 RAFT). */
  raft_c: number;
  slag_breakdown: { sio2: number; al2o3: number; cao: number; mgo: number };
  warnings: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function simulate(input: WhatIfInput): WhatIfResult {
  const share = { sinter: input.sinter_pct / 100, pellet: input.pellet_pct / 100, lump: input.lump_pct / 100 };
  const mix = (key: keyof typeof ORES.sinter) => share.sinter * ORES.sinter[key] + share.pellet * ORES.pellet[key] + share.lump * ORES.lump[key];
  const feRate = mix("fe") / 100;
  const ore = HOT_METAL.fe / feRate; // kg 원료/용선 t
  const ash = (input.coke_kg * COKE.ash + input.pci_kg * PCI.ash) / 100;
  const oxides = {
    sio2: (ore * mix("sio2")) / 100 + ash * ASH.sio2 - HOT_METAL.si * (60.08 / 28.09),
    al2o3: (ore * mix("al2o3")) / 100 + ash * ASH.al2o3,
    cao: (ore * mix("cao")) / 100 + ash * ASH.cao + input.limestone_kg * LIMESTONE_CAO,
    mgo: (ore * mix("mgo")) / 100 + ash * ASH.mgo,
  };
  const slag = oxides.sio2 + oxides.al2o3 + oxides.cao + oxides.mgo;
  const basicity = oxides.cao / Math.max(1, oxides.sio2);
  const fuel = input.coke_kg + input.pci_kg;
  const carbon = (input.coke_kg * COKE.c + input.pci_kg * PCI.c) / 100;
  const co2 = Math.max(0, carbon - HOT_METAL.c) * (44.01 / 12.01) + input.limestone_kg * LIMESTONE_CO2;
  const raft = RAFT.base + RAFT.per_blast_c * (input.blast_temp_c - BASELINE.blast_temp_c) + RAFT.per_oxygen_pct * (input.oxygen_pct - BASELINE.oxygen_pct)
    + RAFT.per_pci_kg * (input.pci_kg - BASELINE.pci_kg);
  const base = simulateBaseSlag();
  // 용선 온도 근사(계수는 출처 없는 교육용 가정): 기준 조건과의 차이마다 연료 +0.6℃/kg, 송풍 온도 +0.15℃/℃, 산소 부화 +6℃/%p,
  // 슬래그가 기준보다 많으면 −0.12℃/kg, 미분탄은 코크스보다 반응열 기여가 작아 −0.2℃/kg. 기준 조건이면 BASE_TEMP_C가 나온다.
  const temp = BASE_TEMP_C + 0.6 * (fuel - (BASELINE.coke_kg + BASELINE.pci_kg)) + 0.15 * (input.blast_temp_c - BASELINE.blast_temp_c)
    + 6 * (input.oxygen_pct - BASELINE.oxygen_pct) - 0.12 * (slag - base) - 0.2 * (input.pci_kg - BASELINE.pci_kg);
  // 경고 기준: 염기도 1.0·1.2는 BREF Table 6.15(고로 슬래그 CaO/SiO2 1.0 아래·위 구분, 높은 쪽 1.1~1.2), 슬래그 350kg은 BREF '175~350kg/t',
  // 연료 450kg은 BREF 'EU 환원제 453~514kg/t', 1,440℃는 BREF '출선 용선 약 1,440~1,500℃'의 하한.
  const warnings: string[] = [];
  if (basicity < 1.0) warnings.push("염기도(CaO/SiO2)가 1.0보다 낮아요. 슬래그가 산성이라 황 제거가 약해질 수 있어요.");
  if (basicity > 1.2) warnings.push("염기도가 1.2보다 높아요(보통 고로 슬래그는 1.2까지, BREF). 슬래그 녹는점이 올라가 잘 흐르지 않을 수 있어요.");
  if (slag > 350) warnings.push("슬래그가 많아요(350kg/t 초과, 보통 175~350kg/t). 녹이는 데 열이 더 들어 연료가 늘어나요.");
  if (fuel < 450) warnings.push("연료비가 낮아요(450kg/t 미만, EU 고로 453~514kg/t). 노 안이 식어 용선 온도가 떨어질 위험이 있어요.");
  if (temp < 1440) warnings.push("용선 온도가 보통 범위(1,440~1,500℃)보다 낮게 나왔어요. 실제라면 출선·이송 중 굳는 문제가 생길 수 있어요.");
  // 화염 온도 보통 범위 2,000~2,300℃(Babich & Senk 2015)
  if (raft < 2000) warnings.push("풍구 앞 화염 온도가 2,000℃보다 낮아요(보통 2,000~2,300℃). 노 아래쪽 열이 모자라 녹이는 힘이 약해져요. 송풍 온도·산소 부화로 보충해요.");
  if (raft > 2300) warnings.push("풍구 앞 화염 온도가 2,300℃보다 높아요(보통 2,000~2,300℃). 너무 뜨거우면 슬래그가 일찍 생겨 가스가 잘 안 통할 수 있어요(Carpenter 2006)."); 
  return {
    ore_kg: r1(ore), slag_kg: r1(slag), basicity: Math.round(basicity * 100) / 100, fuel_rate_kg: r1(fuel), carbon_kg: r1(carbon), co2_kg: r1(co2),
    hot_metal_temp_c: Math.round(Math.min(1560, Math.max(1380, temp))),
    raft_c: Math.round(raft),
    slag_breakdown: { sio2: r1(oxides.sio2), al2o3: r1(oxides.al2o3), cao: r1(oxides.cao), mgo: r1(oxides.mgo) },
    warnings,
  };
}

let baseSlag: number | null = null;
/** 기준 조건의 슬래그량(온도 근사의 기준점). */
function simulateBaseSlag(): number {
  if (baseSlag !== null) return baseSlag;
  baseSlag = 0; // 재귀 중 기준 계산이 다시 기준을 찾지 않게
  baseSlag = simulate(BASELINE).slag_kg;
  return baseSlag;
}

/**
 * 바꾼 조건마다 원인 설비와 그 조건 하나만 바꿨을 때의 효과(기준 대비). 3D 화면이 '원인 설비 → 고로 → 출선구' 흐름으로 그린다.
 * 철 원료 세 비율은 함께 움직이므로 '원료 배합' 하나로 묶는다.
 */
export const CAUSES: { keys: (keyof WhatIfInput)[]; label: string; equipment_id: string; why: string }[] = [
  { keys: ["sinter_pct", "pellet_pct", "lump_pct"], label: "원료 배합", equipment_id: "sinter_plant", why: "원료마다 철·맥석(SiO2 등) 함량이 달라 슬래그량과 염기도가 바뀌어요" },
  { keys: ["coke_kg"], label: "코크스", equipment_id: "coke_oven", why: "코크스는 노 안의 열과 환원 가스(CO)를 만드는 주 연료라 온도와 CO2에 바로 영향을 줘요" },
  { keys: ["pci_kg"], label: "미분탄(PCI)", equipment_id: "hot_stove", why: "풍구로 불어 넣는 보조 연료예요. 코크스 일부를 대신하지만 풍구 앞을 식히는 효과도 있어요" },
  { keys: ["blast_temp_c"], label: "송풍 온도", equipment_id: "hot_stove", why: "열풍로가 데운 바람이 뜨거울수록 노에 들어가는 열이 늘어요" },
  { keys: ["oxygen_pct"], label: "산소 부화", equipment_id: "hot_stove", why: "바람에 산소를 더하면 연료가 더 세게 타서 풍구 앞 온도가 올라가요" },
  { keys: ["limestone_kg"], label: "석회석", equipment_id: "blast_furnace", why: "석회석의 CaO가 슬래그로 가서 염기도와 슬래그량을 올려요" },
];
const OUTPUT_KEYS = ["hot_metal_temp_c", "slag_kg", "basicity", "co2_kg"] as const;

export function effectsOf(input: WhatIfInput) {
  const base = simulate(BASELINE);
  return CAUSES.flatMap((c) => {
    if (c.keys.every((k) => Math.abs(input[k] - BASELINE[k]) < 1e-9)) return [];
    const only = { ...BASELINE };
    for (const k of c.keys) only[k] = input[k];
    const r = simulate(only);
    const deltas = Object.fromEntries(OUTPUT_KEYS.map((k) => [k, Math.round((r[k] - base[k]) * 100) / 100])) as Record<(typeof OUTPUT_KEYS)[number], number>;
    return [{ label: c.label, equipment_id: c.equipment_id, why: c.why, changes: c.keys.map((k) => ({ key: k, from: BASELINE[k], to: Math.round(input[k] * 10) / 10 })), deltas }];
  });
}

/** 다음 공정에 미치는 영향(용선을 받는 제강 쪽). 결과가 기준 범위를 벗어날 때만. 온도 기준 1,480·1,520℃는 기준 온도 ±20℃로 둔 가정이다. */
export function downstreamOf(r: WhatIfResult) {
  const out: { process: string; equipment_id: string; text: string }[] = [];
  if (r.hot_metal_temp_c < 1480) out.push({ process: "steelmaking", equipment_id: "bof_converter", text: "용선이 식어 들어오면 전로에서 쓸 수 있는 열이 줄어, 함께 녹일 수 있는 고철(스크랩) 양이 줄어요." });
  if (r.hot_metal_temp_c > 1520) out.push({ process: "steelmaking", equipment_id: "hot_metal_pretreatment", text: "노 안이 뜨거우면 용선의 규소(Si)가 함께 오르기 쉬워, 전로 슬래그가 늘고 넘침(슬로핑) 위험이 커져요." });
  if (r.basicity < 1.0) out.push({ process: "steelmaking", equipment_id: "hot_metal_pretreatment", text: "슬래그 염기도가 낮으면 고로에서 황(S)이 덜 빠져, 용선 예비처리(탈황)의 부담이 커져요." });
  if (r.slag_kg > 350) out.push({ process: "ironmaking", equipment_id: "taphole_casthouse", text: "슬래그가 많으면 출선할 때 빼내야 할 양이 늘고, 녹이는 데 연료가 더 들어요." });
  return out;
}

/**
 * What-if 시냅스(학습 랩): 같은 계산을 '조건 → 성분·반응 → 결과' 그래프로 펼친다. 선(edge)마다 흐르는 양을 지금 조건과 기준 조건으로 같이 주고,
 * 그 선이 어떤 고로 반응에 해당하는지(reaction)와 근거 문헌(SYN_SOURCES)을 붙인다(2026-10-20 문헌 대조).
 * - kg 선: 원료·연료·석회석이 성분(Fe·SiO2·Al2O3·CaO·MgO·탄소)으로 보내는 양, 성분이 결과(슬래그량·CO2 등)로 보내는 양(용선 1톤당 kg).
 * - ℃ 선: 풍구 앞 화염 온도(RAFT)의 요인별 변화(기준 조건과의 차이, Babich & Senk 2015 표 17.3). 기준이면 0이다.
 * - 염기도 선은 양이 아니라 몫(CaO ÷ SiO2)이라 성분 양을 그대로 싣고 sign으로 분자(+)·분모(−)를 표시한다.
 * 결과 노드 값은 simulate()와 같고(테스트로 확인), 화면은 지금 값과 기준 값의 차이로 늘어남·줄어듦을 그린다.
 * 용선 온도(hot_metal_temp_c)는 문헌 계수가 없는 가정이라 시냅스에서는 빼고 What-if 탭에만 둔다.
 */
export type SynapseKind = "ore" | "fuel" | "air" | "flux" | "element" | "heat" | "output";
export type SynapseReactionId = "raceway" | "reduction" | "boudouard" | "calcination" | "slag" | "carburize";
export interface SynapseNode { id: string; label: string; kind: SynapseKind; unit: string; value: number; base: number; desc: string }
export interface SynapseEdge { from: string; to: string; unit: "kg" | "℃"; value: number; base: number; sign: 1 | -1; why: string; reaction: SynapseReactionId | null; /** 같은 선이 함께 거치는 반응(예: 연료 탄소는 풍구 연소·부두아르를 거친다). */ also?: SynapseReactionId[] }

/** 근거 문헌. 화면의 반응 설명에 이름과 주소를 단다. */
export const SYN_SOURCES = {
  babich: { title: "Babich & Senk (2015), Recent developments in blast furnace iron-making technology, 『Iron Ore』 17장(Elsevier)", url: "https://www.sciencedirect.com/topics/engineering/reduction-process" },
  carpenter: { title: "Carpenter (2006), Use of PCI in blast furnaces, IEA Clean Coal Centre CCC/116", url: "https://www.sustainable-carbon.org/wp-content/uploads/dlm_uploads/reports/Combustion/use-of-pci-in-blast-furnaces-ccc-116.pdf" },
  ipcc: { title: "IPCC (2006), 2006 IPCC Guidelines, 3권 2장 광물 산업 배출", url: "https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/3_Volume3/V3_2_Ch2_Mineral_Industry.pdf" },
} as const;

/** 고로 안에서 실제로 일어나는 반응(식과 반응열은 문헌 그대로). */
export const SYN_REACTIONS: { id: SynapseReactionId; name: string; eq: string; note: string; sources: (keyof typeof SYN_SOURCES)[] }[] = [
  { id: "raceway", name: "풍구 연소", eq: "C + O₂ → CO₂ → (CO₂ + C → 2CO)  합치면 2C + O₂ → 2CO", note: "풍구로 들어온 뜨거운 바람의 산소가 코크스·미분탄의 탄소를 태워요. 풍구 앞 연소대에는 CO₂·H₂O가 남지 않고 N₂·CO·H₂ 가스가 위로 올라가요. 화염 온도는 보통 2,000~2,300℃이고, 송풍 온도·산소 부화를 올리면 오르고 미분탄을 늘리면 내려가요.", sources: ["babich", "carpenter"] },
  { id: "reduction", name: "철광석 환원", eq: "Fe₂O₃ → Fe₃O₄ → FeO → Fe  (CO·H₂가 산소를 떼어 냄: 간접 환원)", note: "올라가는 CO 가스가 철광석의 산소를 떼어 내고 CO₂가 돼요. 노 아래쪽 뜨거운 곳에서는 탄소가 직접 떼어 내기도 해요(직접 환원 FeO + C → Fe + CO, +155 kJ/mol 흡열). 연료 탄소가 결국 CO₂로 나가는 길이에요.", sources: ["babich"] },
  { id: "boudouard", name: "부두아르(용해 손실) 반응", eq: "CO₂ + C → 2CO  (+172 kJ/mol 흡열, 약 900~1,000℃ 위)", note: "환원에서 생긴 CO₂가 뜨거운 코크스와 만나 다시 CO가 돼요. 열을 먹는 반응이라 직접 환원이 많아지면 연료가 더 들어요. 이 모델은 직접·간접 환원의 비율은 나누지 않아요.", sources: ["babich"] },
  { id: "calcination", name: "석회석 분해", eq: "CaCO₃ → CaO + CO₂  (석회석 1t당 CO₂ 0.44t)", note: "석회석이 열을 받아 생석회(CaO)와 CO₂로 나뉘어요. CaO는 슬래그로 가 염기도를 올리고, CO₂는 연료와 상관없이 따로 나와요.", sources: ["ipcc"] },
  { id: "slag", name: "슬래그 형성", eq: "CaO·MgO·Al₂O₃ → 모두 슬래그,  SiO₂ → 대부분 슬래그(일부만 용선 [Si])", note: "CaO·MgO·Al₂O₃는 고로 온도에서도 환원되지 않아 전부 슬래그로 가요. SiO₂는 노 아래 뜨거운 곳에서 일부만 환원돼 용선의 규소가 되고 나머지는 슬래그로 가요.", sources: ["babich"] },
  { id: "carburize", name: "침탄", eq: "3Fe + C → Fe₃C  (용선 C 4.2~4.8%)", note: "철이 탄소를 녹여 녹는점이 낮은 쇳물(용선)이 돼요. 이 탄소는 CO₂로 나가지 않아 CO₂ 계산에서 빼요.", sources: ["babich"] },
];

const SYN_NODES: Omit<SynapseNode, "value" | "base">[] = [
  { id: "sinter_pct", label: "소결광", kind: "ore", unit: "kg/t", desc: "가루 철광석을 구워 덩어리로 만든 원료예요. CaO가 많이 들어 있어 슬래그 염기도를 올려요." },
  { id: "pellet_pct", label: "펠릿", kind: "ore", unit: "kg/t", desc: "고운 철광석을 구슬처럼 빚어 구운 원료예요. 철 함량이 높고 맥석(SiO2 등)이 적어요." },
  { id: "lump_pct", label: "괴광", kind: "ore", unit: "kg/t", desc: "캐낸 그대로의 덩어리 철광석이에요. Al2O3가 상대적으로 많아요." },
  { id: "coke_kg", label: "코크스", kind: "fuel", unit: "kg/t", desc: "노 안의 열과 환원 가스(CO)를 만드는 주 연료예요. 탄소 90%, 나머지는 회분이에요. 풍구 앞 화염 온도를 정하는 항목은 아니에요." },
  { id: "pci_kg", label: "미분탄", kind: "fuel", unit: "kg/t", desc: "풍구로 불어 넣는 보조 연료예요. 열을 먹는 반응을 늘려 풍구 앞 화염 온도를 낮춰요(100kg/t당 저휘발분 약 80~120℃)." },
  { id: "blast_temp_c", label: "송풍 온도", kind: "air", unit: "℃", desc: "열풍로가 데운 바람의 온도예요. 100℃ 올리면 풍구 앞 화염 온도가 약 60~80℃ 올라요." },
  { id: "oxygen_pct", label: "산소 부화", kind: "air", unit: "%p", desc: "바람에 산소를 더한 정도예요. 1% 늘리면 풍구 앞 화염 온도가 약 45~50℃ 올라요." },
  { id: "limestone_kg", label: "석회석", kind: "flux", unit: "kg/t", desc: "CaCO3예요. 분해되며 CaO는 슬래그로, CO2는 가스로 나가요." },
  { id: "fe", label: "Fe 철", kind: "element", unit: "kg/t", desc: "원료 속 철이에요. 환원되어 모두 용선(950kg/t)으로 간다고 단순화했어요." },
  { id: "sio2", label: "SiO2 실리카", kind: "element", unit: "kg/t", desc: "원료 맥석과 연료 회분의 실리카예요. 일부만 환원되어 용선 규소가 되고 나머지는 슬래그로 가요. 염기도의 분모예요." },
  { id: "al2o3", label: "Al2O3 알루미나", kind: "element", unit: "kg/t", desc: "원료와 회분의 알루미나예요. 고로에서 환원되지 않아 모두 슬래그로 가요." },
  { id: "cao", label: "CaO 석회", kind: "element", unit: "kg/t", desc: "소결광과 석회석에서 오는 석회예요. 환원되지 않아 슬래그로 가고 염기도의 분자예요." },
  { id: "mgo", label: "MgO 마그네시아", kind: "element", unit: "kg/t", desc: "원료와 회분의 마그네시아예요. 환원되지 않아 모두 슬래그로 가요." },
  { id: "c", label: "C 탄소", kind: "element", unit: "kg/t", desc: "연료 속 탄소예요. 45kg/t는 용선에 녹고(침탄) 나머지는 연소·환원을 거쳐 CO2가 된다고 본 단순 상한이에요." },
  { id: "raceway", label: "풍구 연소", kind: "heat", unit: "℃", desc: "풍구 앞에서 탄소가 뜨거운 바람의 산소와 타는 곳이에요. 값은 기준 조건보다 화염 온도가 얼마나 달라졌는지예요(Babich & Senk 2015 표 17.3)." },
  { id: "ore_kg", label: "철 원료", kind: "output", unit: "kg/t", desc: "용선 1톤을 만드는 데 드는 철 원료 양이에요. 원료의 철 함량이 낮을수록 늘어요." },
  { id: "slag_kg", label: "슬래그량", kind: "output", unit: "kg/t", desc: "슬래그 = SiO2 + Al2O3 + CaO + MgO. 보통 150~300kg/t(Babich & Senk 2015), EU 고로 175~350kg/t(BREF)예요." },
  { id: "basicity", label: "염기도", kind: "output", unit: "", desc: "CaO ÷ SiO2. 1.0보다 낮으면 황 제거가 약해지고 1.2보다 높으면 슬래그가 잘 흐르지 않아요." },
  { id: "fuel_rate_kg", label: "연료비", kind: "output", unit: "kg/t", desc: "코크스 + 미분탄. EU 고로는 453~514kg/t예요(BREF)." },
  { id: "co2_kg", label: "CO2", kind: "output", unit: "kg/t", desc: "연료 탄소 중 용선에 녹은 45kg을 뺀 나머지 + 석회석 분해 CO2. 연료 쪽은 모두 CO2가 된다고 본 상한이에요." },
  { id: "raft_c", label: "풍구 앞 화염 온도", kind: "output", unit: "℃", desc: "풍구 앞 단열 화염 온도(RAFT). 보통 2,000~2,300℃, 대표값 약 2,200℃예요(Carpenter 2006, Babich & Senk 2015)." },
];

const OXIDE_NAME = { sio2: "SiO2", al2o3: "Al2O3", cao: "CaO", mgo: "MgO" };

function synapseParts(input: WhatIfInput) {
  const ore = HOT_METAL.fe / ((input.sinter_pct * ORES.sinter.fe + input.pellet_pct * ORES.pellet.fe + input.lump_pct * ORES.lump.fe) / 10000);
  const oreKg = { sinter_pct: ore * input.sinter_pct / 100, pellet_pct: ore * input.pellet_pct / 100, lump_pct: ore * input.lump_pct / 100 };
  const oreSrc = { sinter_pct: ORES.sinter, pellet_pct: ORES.pellet, lump_pct: ORES.lump };
  const ash = { coke_kg: input.coke_kg * COKE.ash / 100, pci_kg: input.pci_kg * PCI.ash / 100 };
  const e: Omit<SynapseEdge, "base">[] = [];
  const add = (from: string, to: string, unit: SynapseEdge["unit"], value: number, why: string, reaction: SynapseReactionId | null = null, sign: 1 | -1 = 1, also?: SynapseReactionId[]) =>
    e.push({ from, to, unit, value, sign, why, reaction, ...(also ? { also } : {}) });
  for (const k of ["sinter_pct", "pellet_pct", "lump_pct"] as const) {
    const o = oreSrc[k], kg = oreKg[k];
    add(k, "fe", "kg", kg * o.fe / 100, `철 ${o.fe}%`);
    for (const x of ["sio2", "al2o3", "cao", "mgo"] as const) add(k, x, "kg", kg * o[x] / 100, `맥석 ${OXIDE_NAME[x]} ${o[x]}%`);
    add(k, "ore_kg", "kg", kg, "넣는 원료 양");
  }
  for (const k of ["coke_kg", "pci_kg"] as const) {
    add(k, "c", "kg", input[k] * (k === "coke_kg" ? COKE.c : PCI.c) / 100, `탄소 ${k === "coke_kg" ? COKE.c : PCI.c}%`, null, 1, ["raceway", "boudouard"]);
    for (const x of ["sio2", "al2o3", "cao", "mgo"] as const) add(k, x, "kg", ash[k] * ASH[x], "회분 속 성분");
    add(k, "fuel_rate_kg", "kg", input[k], "연료 양");
  }
  add("limestone_kg", "cao", "kg", input.limestone_kg * LIMESTONE_CAO, "CaCO3 → CaO + CO2 중 CaO(석회석의 약 53%)", "calcination");
  add("limestone_kg", "co2_kg", "kg", input.limestone_kg * LIMESTONE_CO2, "CaCO3 → CaO + CO2 중 CO2(석회석의 약 42%)", "calcination");
  // 풍구 앞 화염 온도의 요인별 변화(simulate()와 같은 계수, 기준 조건과의 차이)
  add("blast_temp_c", "raceway", "℃", RAFT.per_blast_c * (input.blast_temp_c - BASELINE.blast_temp_c), "송풍 100℃당 +60~80℃(가운데 +70℃)", "raceway");
  add("oxygen_pct", "raceway", "℃", RAFT.per_oxygen_pct * (input.oxygen_pct - BASELINE.oxygen_pct), "산소 1%당 +45~50℃(가운데 +47.5℃)", "raceway");
  add("pci_kg", "raceway", "℃", RAFT.per_pci_kg * (input.pci_kg - BASELINE.pci_kg), "미분탄 100kg/t당 −80~120℃(저휘발분, 가운데 −100℃)", "raceway", -1);
  // 성분 → 결과
  const sum = (to: string) => e.filter((x) => x.to === to).reduce((a, x) => a + x.value, 0);
  const siToMetal = HOT_METAL.si * (60.08 / 28.09);
  const oxide = { sio2: sum("sio2") - siToMetal, al2o3: sum("al2o3"), cao: sum("cao"), mgo: sum("mgo") };
  add("fe", "ore_kg", "kg", sum("fe"), "환원되어 모두 용선으로(950kg/t)", "reduction", 1, ["carburize"]);
  for (const x of ["sio2", "al2o3", "cao", "mgo"] as const) add(x, "slag_kg", "kg", oxide[x], x === "sio2" ? "용선 규소(5kg)만큼 빼고 슬래그로" : "환원되지 않아 모두 슬래그로", "slag");
  add("cao", "basicity", "kg", oxide.cao, "분자(CaO)", "slag", 1);
  add("sio2", "basicity", "kg", oxide.sio2, "분모(SiO2) — 늘면 염기도가 내려가요", "slag", -1);
  const carbon = sum("c");
  add("c", "co2_kg", "kg", Math.max(0, carbon - HOT_METAL.c) * (44.01 / 12.01), "연소·환원을 거쳐 CO2로. 용선에 녹는 45kg(침탄)은 빼요 × 44/12", "reduction", 1, ["boudouard", "carburize"]);
  add("raceway", "raft_c", "℃", sum("raceway"), "기준 2,200℃에 더해지는 변화", "raceway");
  return { edges: e, ore, oxide, carbon };
}

export function synapseOf(input: WhatIfInput) {
  const now = synapseParts(input), base = synapseParts(BASELINE);
  const r = simulate(input), b = simulate(BASELINE);
  const inflow = (parts: ReturnType<typeof synapseParts>, id: string) => parts.edges.filter((x) => x.to === id).reduce((a, x) => a + x.value, 0);
  const valueOf = (parts: ReturnType<typeof synapseParts>, res: WhatIfResult, inp: WhatIfInput, n: (typeof SYN_NODES)[number]) => {
    if (n.kind === "output") return res[n.id as keyof WhatIfResult] as number;
    if (n.kind === "element" || n.kind === "heat") return n.id === "sio2" ? parts.oxide.sio2 : inflow(parts, n.id);
    if (n.kind === "ore") return parts.edges.find((x) => x.from === n.id && x.to === "ore_kg")!.value;
    return inp[n.id as keyof WhatIfInput];
  };
  const rd = (x: number) => Math.round(x * 100) / 100 || 0; // -0을 0으로
  return {
    nodes: SYN_NODES.map((n) => ({ ...n, value: rd(valueOf(now, r, input, n)), base: rd(valueOf(base, b, BASELINE, n)) })),
    edges: now.edges.map((x, i) => ({ ...x, value: rd(x.value), base: rd(base.edges[i].value) })),
    reactions: SYN_REACTIONS.map((x) => ({ ...x, sources: x.sources.map((k) => SYN_SOURCES[k]) })),
  };
}

export function whatIf(raw: Partial<WhatIfInput>) {
  const input = normalizeInput(raw);
  const result = simulate(input);
  return { input, result, baseline: simulate(BASELINE), effects: effectsOf(input), downstream: downstreamOf(result), assumptions: ASSUMPTIONS, synapse: synapseOf(input) };
}
