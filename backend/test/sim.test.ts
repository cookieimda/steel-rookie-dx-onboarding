// 3D 시뮬레이션: What-if 원인별 효과·다음 공정 영향(lab/whatif.ts), 이상 상황 훈련(lab/faults.ts).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { deleteUserData } from "../src/db/user-data.js";
import { buildDeck } from "../src/lab/deck.js";
import { createLabExtrasRouter } from "../src/lab/extras-routes.js";
import { checkStep, faultScore, faultView, loadFaults, FAULTS_PATH } from "../src/lab/faults.js";
import { loadIncidents } from "../src/lab/incidents.js";
import { MeRepository } from "../src/me/repository.js";
import { BASELINE, downstreamOf, effectsOf, simulate, whatIf } from "../src/lab/whatif.js";
import { readFileSync } from "node:fs";

const ALL = new Set(["sinter_plant", "coke_oven", "blast_furnace", "hot_stove", "taphole_casthouse", "torpedo_car", "hot_metal_pretreatment", "bof_converter", "oxygen_lance_offgas",
  "tapping_ladle_crane", "secondary_refining", "ladle_transfer", "ladle_turret", "tundish", "cc_mold", "secondary_cooling", "withdrawal_straightener", "torch_cutter",
  "reheating_furnace", "descaler", "roughing_mill", "finishing_mill", "runout_table", "coiler"]);

test("What-if 원인별 효과: 바꾼 조건만, 원료 비율은 '원료 배합' 하나로, 효과 방향이 맞다", () => {
  assert.deepEqual(effectsOf({ ...BASELINE }), []);
  const coke = effectsOf({ ...BASELINE, coke_kg: 400 });
  assert.equal(coke.length, 1);
  assert.deepEqual([coke[0].label, coke[0].equipment_id], ["코크스", "coke_oven"]);
  assert.ok(coke[0].deltas.hot_metal_temp_c > 0 && coke[0].deltas.co2_kg > 0);
  const mix = effectsOf({ ...BASELINE, sinter_pct: 40, pellet_pct: 50, lump_pct: 10 });
  assert.deepEqual(mix.map((e) => e.label), ["원료 배합"]);
  assert.ok(mix[0].deltas.slag_kg < 0, "펠릿이 늘면 슬래그가 준다");
  const lime = effectsOf({ ...BASELINE, limestone_kg: 50 })[0];
  assert.ok(lime.deltas.basicity > 0 && lime.deltas.slag_kg > 0);
  assert.equal(whatIf({ coke_kg: 400, blast_temp_c: 1250 }).effects.length, 2);
});

test("What-if 다음 공정 영향: 용선이 식으면 전로 고철, 뜨거우면 규소·슬로핑, 염기도가 낮으면 탈황", () => {
  assert.deepEqual(downstreamOf(simulate(BASELINE)), []);
  const cold = downstreamOf(whatIf({ coke_kg: 280, pci_kg: 120 }).result);
  assert.ok(cold.some((d) => d.equipment_id === "bof_converter" && d.text.includes("고철")));
  const hot = downstreamOf(whatIf({ coke_kg: 450 }).result);
  assert.ok(hot.some((d) => d.text.includes("슬로핑")));
  const acid = downstreamOf(whatIf({ sinter_pct: 20, pellet_pct: 70, lump_pct: 10 }).result);
  assert.ok(acid.some((d) => d.text.includes("탈황")));
});

test("이상 상황: 파일 검사(신호 정답 = 정상 범위 밖, 조치 결과 수, 설비 id)와 단계 확인·점수", () => {
  const file = loadFaults(undefined, ALL);
  assert.equal(file.faults.length, 4);
  assert.deepEqual(file.faults.map((f) => f.section), ["ironmaking", "steelmaking", "continuous_casting", "rolling"]);
  assert.throws(() => loadFaults(undefined, new Set(["coiler"])), /없는 설비 id/);
  // 신호 정답이 범위 밖 값과 다르면 막는다
  const raw = JSON.parse(readFileSync(FAULTS_PATH, "utf8"));
  raw.faults[0].signal.answer = ["blast_pressure"];
  const dir = mkdtempSync(join(tmpdir(), "faults-"));
  writeFileSync(join(dir, "f.json"), JSON.stringify(raw));
  assert.throws(() => loadFaults(join(dir, "f.json")), /신호 정답/);

  const f = file.faults[0];
  const view = faultView(f, "u1");
  assert.ok(!JSON.stringify(view).includes(f.cause.explain), "보기 화면에는 해설이 없다");
  assert.ok(!("fixed" in view.readings[0]), "조치 후 값은 맞히기 전에는 없다");
  assert.equal(checkStep(f, "signal", "blast_pressure").correct, false);
  assert.deepEqual(checkStep(f, "signal", f.signal.answer[0]), { correct: true, explain: f.signal.explain, abnormal: f.signal.answer });
  const cause = checkStep(f, "cause", f.cause.answer) as { chain: string[] };
  assert.deepEqual(cause.chain, ["coke_oven", "blast_furnace", "taphole_casthouse"]);
  const wrong = checkStep(f, "action", 1) as { consequence: string };
  assert.match(wrong.consequence, /식어요/);
  const right = checkStep(f, "action", f.action.answer) as { fixed: Record<string, number>; downstream: { equipment_id: string }; whatif: unknown };
  assert.equal(right.fixed.hm_temp, 1505);
  assert.equal(right.downstream.equipment_id, "bof_converter");
  assert.ok(right.whatif);
  assert.equal(faultScore({ signal: 1, cause: 1, action: 1 }), 1);
  assert.equal(faultScore({ signal: 1, cause: 2, action: 4 }), 0.58);
});

// ── HTTP ──
const secret = new TextEncoder().encode("sim-test-secret-sim-test-secret-sim-test");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let kim: User;

before(async () => {
  const users = new UserRepository(db);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  const deck = buildDeck([{ id: "ironmaking", name: "제선", equipment: [{ id: "blast_furnace", name: "고로", role: "용선을 만든다." }] }], () => []);
  const app = express();
  app.use(createLabExtrasRouter({ db, auth: { users, secret }, deck, incidents: loadIncidents(), faults: loadFaults() }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${await signToken(kim, secret)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};

test("HTTP 이상 상황: 목록 → 보기 → 단계 확인 → 완료 기록·최고 점수, What-if는 원인별 효과와 다음 공정 영향을 준다", async () => {
  const list = await call("GET", "/api/lab/faults");
  assert.equal(list.json.faults.length, 4);
  const id = list.json.faults[1].id;
  const view = await call("GET", `/api/lab/faults/${id}`);
  assert.equal(view.json.fault.readings.length, 4);
  assert.equal((await call("POST", `/api/lab/faults/${id}/check`, { step: "cause", key: "x".repeat(50) })).status, 400);
  const answer = loadFaults().faults[1].cause.answer;
  const cause = await call("POST", `/api/lab/faults/${id}/check`, { step: "cause", key: answer });
  assert.ok(cause.json.chain.includes("bof_converter"));
  const done = await call("POST", `/api/lab/faults/${id}/complete`, { tries: { signal: 1, cause: 1, action: 2 } });
  assert.equal(done.json.score, 0.83);
  assert.equal((await call("GET", "/api/lab/faults")).json.faults[1].best, 0.83);
  assert.equal((await call("GET", "/api/lab/faults/nope")).status, 404);
  const wi = await call("POST", "/api/lab/whatif", { coke_kg: 290, pci_kg: 120 });
  assert.ok(wi.json.effects.length === 2 && wi.json.downstream.length >= 1);
  // 인과 퀴즈 칸 채점은 기록되고, 사원증 기록(cardEvents)에 맞힌 칸·끝낸 훈련이 들어간다
  await call("POST", "/api/lab/causal/quiz/check", { chain_id: "coke_rate>hm_temp>scrap_pct", dir: 1, hop: 1, choice: "up" });
  await call("POST", "/api/lab/causal/quiz/check", { chain_id: "coke_rate>hm_temp>scrap_pct", dir: 1, hop: 2, choice: "down" });
  const kinds = new MeRepository(db).cardEvents(kim.id).map((e) => e.kind);
  assert.deepEqual([kinds.filter((k) => k === "causal_correct").length, kinds.filter((k) => k === "fault_drill").length], [1, 1]);
  assert.ok(deleteUserData(db, kim.id, { origin: "live" }).operations >= 3, "이상 상황·퀴즈 기록도 지운다");
});

test("사고 사례 갈림길: 사례마다 1개 이상, 갈림길마다 실제 선택 하나와 다른 선택, 다른 선택의 결과는 실제와 다르다", () => {
  const file = loadIncidents();
  for (const s of file.scenarios) {
    const branches = s.timeline.filter((t) => t.branch);
    assert.ok(branches.length >= 1, s.id);
    for (const t of branches) {
      const opts = t.branch!.options;
      assert.equal(opts.filter((o) => o.actual).length, 1);
      assert.ok(opts.some((o) => !o.actual));
      assert.ok(opts.filter((o) => !o.actual).every((o) => !o.outcome.startsWith("실제로")));
    }
  }
});
