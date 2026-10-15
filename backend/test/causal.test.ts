// 공정 인과 지도(lab/causal.ts): 위상 순서, 기준 조건, 공정을 넘는 전파, 범위 밖 경고, 설명.
import assert from "node:assert/strict";
import { test } from "node:test";
import { EDGES, NODES, causalChains, causalQuiz, checkHop, simulateCausal, topoOrder } from "../src/lab/causal.js";

const node = (r: ReturnType<typeof simulateCausal>, id: string) => r.nodes.find((n) => n.id === id)!;

test("인과 지도: 고리 없이 부모가 먼저, 모든 연결의 끝이 있는 변수, 조정 변수는 부모가 없다", () => {
  const order = topoOrder();
  assert.equal(order.length, NODES.length);
  const ids = new Set(NODES.map((n) => n.id));
  for (const e of EDGES) { assert.ok(ids.has(e.from) && ids.has(e.to)); assert.ok(order.indexOf(e.from) < order.indexOf(e.to)); }
  for (const n of NODES.filter((x) => x.control)) assert.ok(!EDGES.some((e) => e.to === n.id), n.id);
  for (const n of NODES) assert.ok(n.base >= n.normal[0] && n.base <= n.normal[1], `${n.id} 기준값이 정상 범위 안`);
  for (const n of NODES) assert.ok((n.desc ?? "").length >= 20, `${n.id} 설명 카드 문장`);
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
  // 인과 따라가기: 이야기 줄마다 변수·설비·원인 변수(앞 줄에 먼저 나온 변수)
  assert.deepEqual([r.story[0].id, r.story[0].causes], ["coke_rate", []]);
  const seen = new Set<string>();
  for (const s of r.story) { assert.ok(s.equipment_id); for (const c of s.causes) assert.ok(seen.has(c), `${s.id}의 원인 ${c}가 먼저 나온다`); seen.add(s.id); }
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

test("인과 퀴즈: 길은 연결 두 개, 공정을 넘는 길이 먼저, 같은 seed는 같은 퀴즈", () => {
  const chains = causalChains();
  assert.ok(chains.length >= 8);
  assert.ok(chains.some((c) => c.id === "superheat>center_seg>rolled_defect" && c.cross));
  const q = causalQuiz(7);
  assert.equal(q.length, 5);
  assert.ok(q.every((c) => c.cross), "공정을 넘는 길이 충분하면 모두 공정을 넘는다");
  assert.deepEqual(causalQuiz(7), q);
});

test("인과 퀴즈 채점: 부호의 곱으로 방향을 정한다(코크스↑ → 용선 온도↑ → 고철 여유↑, 출강 온도↓ → 과열도↓ → 껍질↑)", () => {
  assert.equal(checkHop("coke_rate>hm_temp>scrap_pct", 1, 1, "up")?.correct, true);
  assert.equal(checkHop("coke_rate>hm_temp>scrap_pct", 1, 2, "up")?.correct, true);
  assert.equal(checkHop("tap_temp>superheat>shell_mm", -1, 1, "down")?.correct, true);
  const r = checkHop("tap_temp>superheat>shell_mm", -1, 2, "down")!;
  assert.deepEqual([r.correct, r.answer], [false, "up"]);
  assert.match(r.sign_rule, /반대 방향/);
  assert.equal(checkHop("coke_rate>bof_slag>slopping", 1, 1, "up"), null, "없는 연결");
});

test("을/를: 받침과 끝 괄호", async () => {
  const { eulReul } = await import("../src/lab/causal.js");
  assert.deepEqual(["코크스비", "용선 황(S)", "출강 온도", "송풍량", "CO"].map(eulReul), ["코크스비를", "용선 황(S)을", "출강 온도를", "송풍량을", "CO를"]);
});

test("거꾸로 추론 퀴즈: 증상 2개, 보기 4개 중 정답만 같은 증상을 만들고(답이 하나), 조정 값은 범위 안", async () => {
  const { diagnoseQuiz, checkDiagnose, diagnoseInput, NODES } = await import("../src/lab/causal.js");
  for (const seed of [1, 7, 42, 99, 12345]) {
    const qs = diagnoseQuiz(seed, 4);
    assert.equal(qs.length, 4, `seed ${seed}`);
    for (const q of qs) {
      assert.ok(q.symptoms.length >= 1 && q.symptoms.length <= 2);
      assert.equal(new Set(q.options.map((o) => o.key)).size, 4);
      assert.ok(q.options.some((o) => o.key === q.id));
      const ids = q.symptoms.map((s) => s.id);
      for (const o of q.options) assert.equal(checkDiagnose(q.id, o.key, ids)!.correct, o.key === q.id, `${q.id} vs ${o.key}`);
      assert.ok(q.symptoms.every((s) => s.dir !== 0));
    }
  }
  for (const c of NODES.filter((n) => n.control)) for (const d of [1, -1]) {
    const v = diagnoseInput(`${c.id}:${d}`)![c.id];
    assert.ok(v >= c.control!.min && v <= c.control!.max && (v - c.base) * d > 0, `${c.id}:${d} → ${v}`);
  }
  assert.equal(diagnoseInput("hm_temp:1"), null, "조정할 수 없는 변수");
  const r = checkDiagnose("coke_rate:-1", "coke_rate:-1", ["hm_temp"])!;
  assert.ok(r.correct && r.story.length > 0 && r.edges.length > 0);
});

test("인과 지도 값의 바닥: 위험 점수·과열도는 조정 값을 어느 끝으로 보내도 0 아래로 내려가지 않는다", async () => {
  const { NODES, simulateCausal } = await import("../src/lab/causal.js");
  const ctrls = NODES.filter((n) => n.control);
  const floored = NODES.filter((n) => n.floor !== undefined).map((n) => n.id).sort();
  assert.deepEqual(floored, ["breakout", "center_seg", "rolled_defect", "slopping", "superheat"]);
  for (let mask = 0; mask < 3 ** ctrls.length; mask++) {
    let m = mask; const input: Record<string, number> = {};
    for (const c of ctrls) { const k = m % 3; m = Math.floor(m / 3); if (k) input[c.id] = k === 1 ? c.control!.min : c.control!.max; }
    for (const n of simulateCausal(input).nodes) if (n.floor !== undefined) assert.ok(n.value >= n.floor, `${n.id} ${n.value} (${JSON.stringify(input)})`);
  }
});

test("공정 사이 시간 지연: 같은 공정은 바로, 뒤 공정일수록 늦게 닿고, 기준은 바꾼 값 중 가장 앞 공정", async () => {
  const { arrivalText, simulateCausal } = await import("../src/lab/causal.js");
  assert.equal(arrivalText("ironmaking", "ironmaking"), "바로");
  assert.equal(arrivalText("ironmaking", "steelmaking"), "약 2~4시간 뒤");
  assert.equal(arrivalText("ironmaking", "rolling"), "약 11~30시간 뒤");
  assert.equal(arrivalText("continuous_casting", "rolling"), "약 8~24시간 뒤");
  const r = simulateCausal({ coke_rate: 290 });
  const lows = r.story.map((s) => (s.arrive === "바로" ? 0 : Number(/약 (\d+)~/.exec(s.arrive)![1])));
  assert.deepEqual([...lows].sort((a, b) => a - b), lows, "이야기 줄은 도착 순서대로");
  assert.ok(r.story.some((s) => s.process === "steelmaking" && s.arrive === "약 2~4시간 뒤"));
  assert.ok(simulateCausal({ tap_temp: 1690 }).story.every((s) => s.arrive === "바로" || s.arrive.startsWith("약 1~2시간") || s.arrive.startsWith("약 9~26시간")));
  assert.match(r.note, /대략값/);
});

test("세 칸 인과 퀴즈(심화): 길은 변수 4개, 공정 3개 이상을 넘는 길이 먼저, 칸 3의 방향은 세 연결 부호의 곱", async () => {
  const { causalChains, causalQuiz, checkHop, EDGES } = await import("../src/lab/causal.js");
  const deep = causalChains(4);
  assert.ok(deep.length > 0 && deep.every((c) => c.nodes.length === 4));
  const qs = causalQuiz(3, 5, undefined, 2);
  assert.equal(qs.length, 5);
  assert.ok(qs.every((q) => q.nodes.length === 4));
  assert.ok(qs[0].processes >= 3, "공정 3개 이상을 넘는 길 먼저");
  for (const q of qs) {
    const sign = q.nodes.slice(0, -1).reduce((s, n, i) => s * Math.sign(EDGES.find((e) => e.from === n.id && e.to === q.nodes[i + 1].id)!.coef), q.dir);
    assert.equal(checkHop(q.id, q.dir, 3, sign > 0 ? "up" : "down")!.correct, true, q.id);
  }
  assert.equal(checkHop(qs[0].id, 1, 4, "up"), null, "칸 4는 없다");
  assert.equal(checkHop("coke_rate>hm_temp>scrap_pct", 1, 3, "up"), null, "두 칸 길에 칸 3은 없다");
  assert.equal(causalQuiz(3, 5).every((q) => q.nodes.length === 3), true, "기본은 두 칸");
});

test("마이그레이션 016: 인과 퀴즈 답이 칸 3을 받고 예전 답은 그대로", async () => {
  const { openDatabase } = await import("../src/db/database.js");
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run("a", "u", "a>b>c>d", 3, 1, "2026-10-16T00:00:00Z");
  assert.throws(() => db.prepare("INSERT INTO causal_quiz_answers VALUES(?,?,?,?,?,?)").run("b", "u", "a>b>c>d", 4, 1, "2026-10-16T00:00:00Z"));
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM causal_quiz_answers").get()!.n), 1);
});

test("조사 함수: 받침 유무와 ㄹ 받침('으로/로'), 끝 괄호는 빼고 본다", async () => {
  const { josa } = await import("../src/lab/causal.js");
  assert.deepEqual(["제선", "제강", "연주", "열간압연"].map((w) => josa(w, "이", "가")), ["제선이", "제강이", "연주가", "열간압연이"]);
  assert.deepEqual(["제선", "연주", "레일", "용선 황(S)"].map((w) => josa(w, "으로", "로")), ["제선으로", "연주로", "레일로", "용선 황(S)으로"]);
  assert.equal(josa("BOF", "은", "는"), "BOF는");
});
