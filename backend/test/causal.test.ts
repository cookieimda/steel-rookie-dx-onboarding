// 공정 인과 지도(lab/causal.ts): 위상 순서, 기준 조건, 공정을 넘는 전파, 범위 밖 경고, 설명.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGES, NODES, simulateCausal, topoOrder } from "../src/lab/causal.js";

const node = (r: ReturnType<typeof simulateCausal>, id: string) => r.nodes.find((n) => n.id === id)!;

test("인과 지도: 고리 없이 부모가 먼저, 모든 연결의 끝이 있는 변수, 조정 변수는 부모가 없다", () => {
  const order = topoOrder();
  assert.equal(order.length, NODES.length);
  const ids = new Set(NODES.map((n) => n.id));
  for (const e of EDGES) { assert.ok(ids.has(e.from) && ids.has(e.to)); assert.ok(order.indexOf(e.from) < order.indexOf(e.to)); }
  for (const n of NODES.filter((x) => x.control)) assert.ok(!EDGES.some((e) => e.to === n.id), n.id);
  for (const n of NODES) assert.ok(n.base >= n.normal[0] && n.base <= n.normal[1], `${n.id} 기준값이 정상 범위 안`);
});

test("인과 지도: 기준 조건은 모두 정상·변화 없음, 설명도 없다", () => {
  const r = simulateCausal();
  assert.ok(r.nodes.every((n) => n.status === "ok" && n.delta === 0));
  assert.ok(r.edges.every((e) => !e.active));
  assert.deepEqual(r.story, []);
});

test("인과 지도: 코크스를 줄이면 제선 → 제강으로 이어진다(용선 온도·규소↓ → 고철 여유·전로 슬래그↓)", () => {
  const r = simulateCausal({ coke_rate: 290 });
  assert.equal(node(r, "hm_temp").value, 1470);
  assert.equal(node(r, "hm_temp").status, "warn");
  assert.ok(node(r, "hm_si").delta < 0 && node(r, "scrap_pct").delta < 0 && node(r, "bof_slag").delta < 0);
  assert.equal(node(r, "superheat").delta, 0, "출강 온도는 따로 조정하므로 연주에는 안 간다");
  assert.ok(r.story[0].text.startsWith("코크스비를"));
  assert.ok(r.story.some((s) => s.process === "steelmaking"));
});

test("인과 지도: 출강 온도↑·주조 속도↑ → 껍질↓ → 브레이크아웃·중심 편석 → 압연 결함까지", () => {
  const r = simulateCausal({ tap_temp: 1670, cast_speed: 1.6 });
  assert.equal(node(r, "superheat").value, 57);
  assert.ok(node(r, "shell_mm").value < 12 && node(r, "breakout").status === "warn");
  assert.ok(node(r, "center_seg").status === "warn" && node(r, "rolled_defect").status === "warn");
  const active = r.edges.filter((e) => e.active).map((e) => `${e.from}>${e.to}`);
  assert.ok(active.includes("center_seg>rolled_defect"));
  // 범위를 벗어난 조정값은 자른다
  assert.equal(node(simulateCausal({ cool_banks: 99 }), "cool_banks").value, 16);
});
