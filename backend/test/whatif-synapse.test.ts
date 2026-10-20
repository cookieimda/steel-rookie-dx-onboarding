// What-if 시냅스(lab/whatif.ts의 synapseOf): 조건 → 성분·반응 → 결과 그래프의 선 값이 What-if 계산(simulate)과 맞는지,
// 문헌에서 가져온 값(석회석 CO2 0.44, 풍구 앞 화염 온도 계수, 용선 C 4.2~4.8%)이 계산에 그대로 들어갔는지.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASELINE, normalizeInput, simulate, synapseOf, whatIf } from "../src/lab/whatif.js";

const near = (a: number, b: number, tol = 0.15) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const inflow = (s: ReturnType<typeof synapseOf>, to: string) => s.edges.filter((e) => e.to === to).reduce((a, e) => a + e.value, 0);

test("시냅스: 결과 노드 값은 simulate()와 같고, 선의 합이 슬래그량·CO2·연료비·철 원료·화염 온도를 이룬다", () => {
  for (const raw of [{}, { coke_kg: 450, limestone_kg: 60 }, { sinter_pct: 35, pellet_pct: 65, lump_pct: 40, coke_kg: 330, blast_temp_c: 1250, oxygen_pct: 6, pci_kg: 150 }]) {
    const input = normalizeInput(raw), r = simulate(input), s = synapseOf(input);
    const node = (id: string) => s.nodes.find((n) => n.id === id)!;
    for (const k of ["slag_kg", "basicity", "co2_kg", "fuel_rate_kg", "ore_kg", "raft_c"] as const) assert.equal(node(k).value, r[k]);
    near(inflow(s, "slag_kg"), r.slag_kg);
    near(inflow(s, "co2_kg"), r.co2_kg);
    near(inflow(s, "fuel_rate_kg"), r.fuel_rate_kg);
    near(2200 + inflow(s, "raft_c"), r.raft_c, 0.6);
    near(s.edges.filter((e) => e.to === "ore_kg" && e.from !== "fe").reduce((a, e) => a + e.value, 0), r.ore_kg);
    for (const x of ["sio2", "al2o3", "cao", "mgo"] as const) near(s.edges.find((e) => e.from === x && e.to === "slag_kg")!.value, r.slag_breakdown[x]);
  }
});

test("시냅스: 기준 조건이면 모든 선이 기준 값과 같고 화염 온도 변화는 0, 화염 온도는 대표값 2,200℃", () => {
  const s = synapseOf(normalizeInput(BASELINE));
  for (const e of s.edges) assert.equal(e.value, e.base, `${e.from}→${e.to}`);
  for (const e of s.edges.filter((x) => x.unit === "℃")) assert.equal(e.value, 0);
  assert.equal(simulate(normalizeInput(BASELINE)).raft_c, 2200);
});

test("문헌값: 풍구 앞 화염 온도는 송풍 +100℃ → +60~80℃, 산소 +1% → +45~50℃, 미분탄 +100kg/t → −80~120℃(저휘발분), 코크스는 영향 없음", () => {
  const base = simulate(normalizeInput(BASELINE)).raft_c;
  const d = (raw: Record<string, number>) => simulate(normalizeInput(raw)).raft_c - base;
  const within = (v: number, lo: number, hi: number, what: string) => assert.ok(v >= lo && v <= hi, `${what}: ${v}`);
  within(d({ blast_temp_c: 1250 }), 60, 80, "송풍 +100℃");
  within(d({ oxygen_pct: 5 }), 45, 50, "산소 +1%");
  within(-d({ pci_kg: 200 }), 80, 120, "미분탄 +100kg/t");
  assert.equal(d({ coke_kg: 450 }), 0);
  assert.ok(whatIf({ pci_kg: 250, blast_temp_c: 900 }).result.warnings.some((w) => w.includes("화염 온도")), "2,000℃ 아래면 경고");
});

test("문헌값: 석회석은 CaCO3 → CaO + CO2로 CO2를 석회석 1kg당 약 0.42kg(화학양론 0.44 × 순도 95%) 더하고, 그 선은 '석회석 분해' 반응이다", () => {
  const add = simulate(normalizeInput({ limestone_kg: 100 })).co2_kg - simulate(normalizeInput(BASELINE)).co2_kg;
  near(add, 100 * 0.95 * (44.01 / 100.09), 0.2);
  const s = synapseOf(normalizeInput({ limestone_kg: 100 }));
  const e = s.edges.find((x) => x.from === "limestone_kg" && x.to === "co2_kg")!;
  assert.equal(e.reaction, "calcination");
  assert.ok(e.value > e.base);
});

test("문헌값: 용선 탄소는 45kg/t(기본 용선 C 4.2~4.8% 안쪽)이라 연료 탄소 중 그만큼은 CO2에서 빠진다", () => {
  const r = simulate(normalizeInput(BASELINE));
  near(r.co2_kg, (r.carbon_kg - 45) * (44.01 / 12.01), 0.2);
});

test("시냅스: 반응마다 식·설명·근거 문헌(제목·주소)이 있고, 선이 가리키는 반응은 모두 목록에 있다. whatIf 응답에 함께 실린다", () => {
  const { synapse } = whatIf({ oxygen_pct: 7 });
  const ids = new Set(synapse.reactions.map((r) => r.id));
  for (const r of synapse.reactions) {
    assert.ok(r.name && r.eq && r.note, r.id);
    assert.ok(r.sources.length && r.sources.every((x) => x.title && /^https:\/\//.test(x.url)), r.id);
  }
  for (const e of synapse.edges) if (e.reaction) assert.ok(ids.has(e.reaction), `${e.from}→${e.to}: ${e.reaction}`);
  const nodeIds = new Set(synapse.nodes.map((n) => n.id));
  for (const e of synapse.edges) assert.ok(nodeIds.has(e.from) && nodeIds.has(e.to), `${e.from}→${e.to}`);
  assert.ok(synapse.edges.find((e) => e.from === "oxygen_pct" && e.to === "raceway")!.value > 0);
  assert.ok(!synapse.nodes.some((n) => n.id === "hot_metal_temp_c"), "문헌 계수가 없는 용선 온도는 시냅스에 없다");
});
