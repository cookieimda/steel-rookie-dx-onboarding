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
/** 용선 1톤(kg). 탄소 40kg은 BREF '용선 탄소 약 4%', 규소 5kg(0.5%)은 가정, 나머지는 철. */
const HOT_METAL = { fe: 955, c: 40, si: 5 };
/** 석회석의 CaO 비율. CaCO3의 CaO 질량비 0.56에 순도 약 95%를 둔 가정. */
const LIMESTONE_CAO = 0.53;

export const ASSUMPTIONS = [
  "소결광 성분은 EU 소결광 평균(EU JRC BREF 그림 3.9, 2004년)이에요: Fe 57.8%, SiO2 5.3%, CaO 9.4%. 펠릿 Fe 65%·괴광 Fe 62%는 'Fe 최대 약 65%'(JFE 21세기재단) 안에서 정한 가정이에요.",
  "기준 조건: 원료 비율 소결광 67·펠릿 22·괴광 11%(EU 평균, BREF 표 6.1), 코크스 380kg·미분탄 100kg/t(JFE), 송풍 1,150℃(JFE 1,150~1,250℃). 산소 부화 4%p는 가정이에요.",
  "용선 1톤에는 철 955kg, 탄소 40kg(약 4%, BREF), 규소 5kg(가정)이 들어 있다고 봐요. 철은 모두 용선으로 간다고 단순화했어요.",
  "코크스 탄소 90%(JFE)로 두었어요. 코크스 회분 10%, 미분탄 탄소 78%·회분 9%는 출처 없는 가정이에요.",
  "슬래그량 = 원료 맥석 + 연료 회분 + 석회석의 CaO − 용선으로 간 규소만큼의 SiO2. 실제 고로 슬래그는 용선 1톤당 175~350kg이에요(BREF).",
  "CO2는 연료 탄소 중 용선에 녹은 탄소를 뺀 나머지가 모두 CO2가 된다고 본 단순 상한이에요.",
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
  const co2 = Math.max(0, carbon - HOT_METAL.c) * (44.01 / 12.01);
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
  return {
    ore_kg: r1(ore), slag_kg: r1(slag), basicity: Math.round(basicity * 100) / 100, fuel_rate_kg: r1(fuel), carbon_kg: r1(carbon), co2_kg: r1(co2),
    hot_metal_temp_c: Math.round(Math.min(1560, Math.max(1380, temp))),
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

export function whatIf(raw: Partial<WhatIfInput>) {
  const input = normalizeInput(raw);
  const result = simulate(input);
  return { input, result, baseline: simulate(BASELINE), effects: effectsOf(input), downstream: downstreamOf(result), assumptions: ASSUMPTIONS };
}
