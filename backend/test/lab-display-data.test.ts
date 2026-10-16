import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { whatIf } from "../src/lab/whatif.js";
import { simulateCausal } from "../src/lab/causal.js";

// Browser-independent display adapter; the server remains the only calculator.
const code = readFileSync(join(process.cwd(), "frontend/3d-demo/lab-display-data.js"), "utf8");
const { displayRows, tempPosition } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("What-if board preserves the real model values, units, baseline and direction", () => {
  const reply = whatIf({ coke_kg: 450 });
  const rows = displayRows(reply, "ironmaking");
  assert.equal(rows.length, 6);
  const temperature = rows.find((r: any) => r.id === "hot_metal_temp_c");
  assert.equal(temperature.value, reply.result.hot_metal_temp_c);
  assert.equal(temperature.base, reply.baseline.hot_metal_temp_c);
  assert.equal(temperature.unit, "℃");
  assert.equal(temperature.direction, "up");
  assert.equal(rows.find((r: any) => r.id === "fuel_rate_kg").unit, "kg/t");
  assert.equal(rows.find((r: any) => r.id === "basicity").digits, 2);
});

test("causal output uses only the selected process and never presents a control as a result", () => {
  const reply = simulateCausal({ cast_speed: 1.8 });
  const rows = displayRows(reply, "continuous_casting");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r: any) => reply.nodes.some(n => n.id === r.id && n.process === "continuous_casting" && !n.control)));
  assert.ok(!rows.some((r: any) => r.id === "cast_speed"));
});

test("missing model values cannot paint plausible zero quotes; temperature marker stays in its scale", () => {
  const reply = whatIf({});
  assert.ok(displayRows(reply, "ironmaking").every((r: any) => r.direction === "flat"));
  assert.throws(() => displayRows({ ...reply, result: { ...reply.result, hot_metal_temp_c: NaN } }, "ironmaking"));
  assert.equal(tempPosition(1100, 1380, 1560), 0);
  assert.equal(tempPosition(1900, 1380, 1560), 100);
});
