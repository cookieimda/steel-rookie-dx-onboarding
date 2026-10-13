// 이해도 확인 캐릭터(frontend/3d-demo/cp-character.js)의 동작 선택과 몸 전체 움직임. 브라우저 없이 순수 함수만 확인한다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { MOTIONS, PROCEDURAL, MOTION_ALIAS, resolveMotion, poseAt, blendPose, CpCharacter } = await load("cp-character.js");
const { MOTION_BY_TYPE, motionFor } = await load("checkpoint-chat.js");

type Pose = { y: number; rx: number; ry: number; rz: number; sy: number };
const REST: Pose = { y: 0, rx: 0, ry: 0, rz: 0, sy: 1 };
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test("브라우저가 없어도 모듈을 불러오고, 엘리먼트 클래스는 있되 등록은 하지 않는다", () => {
  assert.equal(typeof CpCharacter, "function");
  assert.deepEqual(CpCharacter.observedAttributes, ["motion", "model", "fallback"]);
});

test("동작 선택: 같은 이름의 클립 → 그 이름의 몸 전체 움직임 → 대체 이름표 → idle", () => {
  assert.deepEqual(resolveMotion("praise", ["praise", "idle"]), { kind: "clip", name: "praise" });
  assert.deepEqual(resolveMotion("praise", ["idle"]), { kind: "procedural", name: "praise" });
  assert.deepEqual(resolveMotion("greet", []), { kind: "procedural", name: "praise" }, "몸 전체 움직임이 없으면 대체 이름표");
  assert.deepEqual(resolveMotion("greet", ["greet"]), { kind: "clip", name: "greet" }, "클립이 있으면 대체보다 클립");
  assert.deepEqual(resolveMotion("ask", []), { kind: "procedural", name: "idle" });
  assert.deepEqual(resolveMotion("unknown", []), { kind: "procedural", name: "idle" });
  assert.deepEqual(resolveMotion(undefined, []), { kind: "procedural", name: "idle" });
  assert.deepEqual(resolveMotion("", [""]), { kind: "procedural", name: "idle" }, "빈 이름은 클립으로 보지 않는다");
});

test("모든 이름표가 몸 전체 움직임으로 정의되거나 대체되고, 대체 대상은 정의된 움직임이다", () => {
  for (const motion of MOTIONS) {
    const r = resolveMotion(motion, []);
    assert.equal(r.kind, "procedural", motion);
    assert.ok(PROCEDURAL[r.name], motion);
    if (!PROCEDURAL[motion]) assert.equal(r.name, MOTION_ALIAS[motion], `${motion}은 대체 이름표를 쓴다`);
  }
  assert.deepEqual(Object.keys(PROCEDURAL).sort(), ["ask_again", "celebrate", "explain", "idle", "praise", "thinking"]);
  for (const target of Object.values(MOTION_ALIAS)) assert.ok(PROCEDURAL[target as string], String(target));
});

test("몸 전체 움직임: 대기는 작게 흔들리고, 튀기·점프는 땅에서 시작해 끝나면 대기로 돌아간다", () => {
  for (let t = 0; t < 5; t += 0.1) {
    const p: Pose = poseAt("idle", t);
    assert.ok(Math.abs(p.y) <= 0.015 + 1e-9, `idle y ${p.y}`);
    assert.equal(p.ry, 0);
  }
  for (const name of ["praise", "celebrate"]) {
    const { duration } = PROCEDURAL[name];
    assert.ok(close(poseAt(name, 0).y, 0), `${name} 시작은 바닥`);
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => poseAt(name, (duration * i) / 50).y));
    assert.ok(peak > 0.05, `${name} 동안 뜬다 ${peak}`);
    const after: Pose = poseAt(name, duration + 0.3), idle: Pose = poseAt("idle", 0.3);
    for (const k of Object.keys(REST) as (keyof Pose)[]) assert.ok(close(after[k], idle[k]), `${name}이 끝나면 대기(끝난 뒤 시간 기준): ${k}`);
  }
  assert.ok(close(poseAt("celebrate", PROCEDURAL.celebrate.duration - 1e-6).ry, Math.PI * 2, 1e-4), "점프하며 한 바퀴");
  assert.ok(close(poseAt("praise", PROCEDURAL.praise.duration / 2).y, 0), "통통 튀기는 두 번: 중간에 한 번 착지");
});

test("몸 전체 움직임: 갸웃은 기운 채 유지하고, 좌우 흔들기·천천히 기울기는 반복한다", () => {
  const tilt = poseAt("ask_again", PROCEDURAL.ask_again.duration);
  assert.ok(tilt.rz > 0.15);
  assert.deepEqual(poseAt("ask_again", 10), tilt, "끝난 뒤에도 기운 자세");
  const sway = [0.4, 1.2].map((t) => poseAt("explain", t).ry);
  assert.ok(sway[0]! > 0.1 && sway[1]! < -0.1, `좌우로 흔든다 ${sway}`);
  assert.ok(close(poseAt("explain", 0.4).ry, poseAt("explain", 2.0).ry), "주기 1.6초로 반복");
  assert.ok(close(poseAt("thinking", 0.8).rz, poseAt("thinking", 4.0).rz), "주기 3.2초로 반복");
  assert.ok(Math.abs(poseAt("thinking", 0.8).rz) <= 0.08 + 1e-9, "천천히·작게 기운다");
});

test("움직임 줄이기 설정이면 어떤 동작이든 기본 자세", () => {
  for (const name of Object.keys(PROCEDURAL)) assert.deepEqual(poseAt(name, 0.3, { reducedMotion: true }), REST, name);
});

test("동작 전환 보간: 시작은 이전 자세, 끝은 새 자세", () => {
  const a: Pose = { y: 0.3, rx: 0, ry: 1, rz: 0.2, sy: 1.1 };
  const b: Pose = { ...REST };
  assert.deepEqual(blendPose(a, b, 0), a);
  assert.deepEqual(blendPose(a, b, 1), b);
  const mid: Pose = blendPose(a, b, 0.5);
  assert.ok(mid.y < a.y && mid.y > b.y);
});

test("checkpoint-chat.js가 내는 이름표는 모두 MOTIONS에 있고, 몸 전체 움직임이나 대체 이름표로 해석된다", () => {
  // motionFor(발화 type) 결과 + characterMotion의 요청 중(thinking)·발화 없음(idle).
  const produced = new Set<string>([
    ...(Object.values(MOTION_BY_TYPE) as string[]),
    motionFor("result", { unlocked: true }),
    motionFor("result", { unlocked: false }),
    motionFor("unknown"),
    "thinking",
    "idle",
  ]);
  for (const motion of produced) {
    assert.ok(MOTIONS.includes(motion), `${motion}이 MOTIONS에 없다`);
    const r = resolveMotion(motion, []);
    assert.equal(r.kind, "procedural", motion);
    assert.ok(r.name === motion || r.name === MOTION_ALIAS[motion], `${motion} → ${r.name}: 같은 이름이거나 대체 이름표여야 한다`);
  }
  assert.deepEqual([...produced].sort(), [...MOTIONS].sort(), "두 모듈의 이름표 목록이 같다(한쪽에만 있는 이름표 없음)");
});
