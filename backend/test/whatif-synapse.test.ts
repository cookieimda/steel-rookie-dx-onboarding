// What-if 시냅스(lab/whatif.ts의 synapseOf): 조건 → 성분 → 결과 그래프의 선 값이 What-if 계산(simulate)과 맞는지.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASELINE, normalizeInput, simulate, synapseOf, whatIf } from "../src/lab/whatif.js";

const near = (a: number, b: number, tol = 0.15) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const inflow = (s: ReturnType<typeof synapseOf>, to: string, filter = () => true) =>
  s.edges.filter((e) => e.to === to && filter()).reduce((a, e) => a + e.value, 0);

test("시냅스: 결과 노드 값은 simulate()와 같고, 선의 합이 슬래그량·CO2·연료비·철 원료를 이룬다", () => {
  for (const raw of [{}, { coke_kg: 450, limestone_kg: 60 }, { sinter_pct: 35, pellet_pct: 65, lump_pct: 40, coke_kg: 330 }]) {
    const input = normalizeInput(raw), r = simulate(input), s = synapseOf(input);
    const node = (id: string) => s.nodes.find((n) => n.id === id)!;
    for (const k of ["slag_kg", "basicity", "co2_kg", "fuel_rate_kg", "ore_kg", "hot_metal_temp_c"] as const) assert.equal(node(k).value, r[k]);
    near(inflow(s, "slag_kg"), r.slag_kg);
    near(inflow(s, "co2_kg"), r.co2_kg);
    near(inflow(s, "fuel_rate_kg"), r.fuel_rate_kg);
    if (r.hot_metal_temp_c > 1380 && r.hot_metal_temp_c < 1560) near(1500 + inflow(s, "hot_metal_temp_c"), r.hot_metal_temp_c, 0.6);
    near(s.edges.filter((e) => e.to === "ore_kg" && e.from !== "fe").reduce((a, e) => a + e.value, 0), r.ore_kg);
    // 슬래그로 가는 성분 양은 슬래그 성분 막대와 같다
    for (const x of ["sio2", "al2o3", "cao", "mgo"] as const) near(s.edges.find((e) => e.from === x && e.to === "slag_kg")!.value, r.slag_breakdown[x]);
  }
});

test("시냅스: 기준 조건이면 모든 선이 기준 값과 같고 열 항은 0이다", () => {
  const s = synapseOf(normalizeInput(BASELINE));
  for (const e of s.edges) assert.equal(e.value, e.base, `${e.from}→${e.to}`);
  // 슬래그 항은 simulate()처럼 반올림한 기준 슬래그량과 비교해 0.01℃쯤 남을 수 있다
  for (const e of s.edges.filter((x) => x.unit === "℃")) near(e.value, 0, 0.05);
});

test("시냅스: 석회석을 넣으면 석회석 → CaO → 슬래그·염기도 선만 늘고 SiO2 선은 그대로다", () => {
  const s = synapseOf(normalizeInput({ limestone_kg: 50 }));
  const edge = (from: string, to: string) => s.edges.find((e) => e.from === from && e.to === to)!;
  assert.ok(edge("limestone_kg", "cao").value > edge("limestone_kg", "cao").base);
  assert.ok(edge("cao", "slag_kg").value > edge("cao", "slag_kg").base);
  assert.ok(edge("cao", "basicity").value > edge("cao", "basicity").base);
  assert.equal(edge("sio2", "basicity").value, edge("sio2", "basicity").base);
  assert.equal(edge("sio2", "basicity").sign, -1);
});

test("시냅스: whatIf 응답에 함께 실리고, 선의 양 끝은 모두 있는 노드다", () => {
  const { synapse } = whatIf({ oxygen_pct: 7 });
  const ids = new Set(synapse.nodes.map((n) => n.id));
  for (const e of synapse.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from}→${e.to}`);
  assert.ok(synapse.edges.find((e) => e.from === "oxygen_pct" && e.to === "heat")!.value > 0);
});
