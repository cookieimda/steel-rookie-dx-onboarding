// 학습 채팅의 화면 조작 실행(frontend/3d-demo/learning-chat.js의 runSceneActions)과 추천 질문 고르기(learning-suggestions.js).
// 브라우저 없이 가짜 페이지 컴포넌트·3D 장면으로 돌린다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { runSceneActions } = await load("learning-chat.js");
const { suggestionsFor, SUGGESTIONS } = await load("learning-suggestions.js");

/** 공정을 옮기면 몇 번 기다린 뒤에야 그 공정을 띄우는 3D 장면(전체 화면 → 제선). 띄우기 전에는 설비를 못 찾는다. */
function fakePage(loadTicks: number) {
  const scene = {
    localName: "steel-scene",
    process: undefined as { id: string } | undefined, // 전체 화면에서는 아직 공정이 없다
    pending: null as string | null,
    ticks: 0,
    focused: [] as string[],
    focus(id: string) { if (this.process?.id !== "ironmaking") return false; this.focused.push(id); return true; },
  };
  const page = {
    state: { processId: "site", selectedId: null as string | null, speed: 1 },
    data: { findProcess: (id: string) => (id === "ironmaking" ? { id } : null), findEquipment: (p: string, id: string) => (p === "ironmaking" && id === "torpedo_car" ? { id } : null) },
    setState(u: Record<string, unknown>) { Object.assign(page.state, u); },
    goProcess(id: string) { page.state.processId = id; scene.pending = id; },
    scene: () => scene,
  };
  // 가짜 시계: 기다릴 때마다 한 칸씩 흐르고, loadTicks가 지나면 장면이 그 공정을 띄운다.
  const wait = async () => { if (scene.pending && ++scene.ticks >= loadTicks) { scene.process = { id: scene.pending }; scene.pending = null; } };
  return { page, scene, wait };
}

test("runSceneActions: 전체 화면에서 공정을 옮기면 3D가 그 공정을 띄울 때까지 기다린 뒤 설비로 이동한다", async () => {
  const { page, scene, wait } = fakePage(5);
  const actions = [{ type: "goto_process", target_id: "ironmaking" }, { type: "focus", target_id: "torpedo_car" }, { type: "highlight", target_id: "torpedo_car" }];
  const results = await runSceneActions(page, actions, { wait, stepMs: 1, timeoutMs: 50 });
  assert.deepEqual(results.map((r: { status: string }) => r.status), ["succeeded", "succeeded", "succeeded"]);
  assert.deepEqual(scene.focused, ["torpedo_car"]);
  assert.equal(page.state.selectedId, "torpedo_car");
});

test("runSceneActions: 3D가 끝내 띄우지 못하면 focus는 실패로 남기고 멈추지 않는다, 2D 화면(steel-scene이 아님)은 기다리지 않는다", async () => {
  const { page, wait } = fakePage(Infinity);
  const results = await runSceneActions(page, [{ type: "goto_process", target_id: "ironmaking" }, { type: "focus", target_id: "torpedo_car" }], { wait, stepMs: 1, timeoutMs: 10 });
  assert.deepEqual(results.map((r: { status: string }) => r.status), ["succeeded", "failed"]);

  let waits = 0;
  const flat = { ...page, scene: () => ({ focus: () => true }) };
  await runSceneActions(flat, [{ type: "goto_process", target_id: "ironmaking" }], { wait: async () => void waits++, stepMs: 1, timeoutMs: 50 });
  assert.equal(waits, 1, "공정 이동 뒤 한 번만 쉬고 3D를 기다리지 않는다");
});

test("suggestionsFor: 전체 공정 화면은 제선 질문(설비 없이 '이 설비의 역할은?'을 내지 않음), 정해 둔 것이 없는 공정은 null", () => {
  assert.deepEqual(suggestionsFor("site", null), SUGGESTIONS.ironmaking.process);
  assert.ok(!suggestionsFor("site", null).some((q: string) => q.startsWith("이 설비")));
  assert.equal(suggestionsFor("rolling", null), null);
});

test("pendingText: 기다리는 동안 경과 시간을 보여 주고, 20초가 넘으면 조금 더 걸린다고 알린다", async () => {
  const { pendingText } = await load("learning-chat.js");
  const t0 = 1_000_000;
  assert.equal(pendingText(t0, t0 + 1000), "튜터가 답을 쓰고 있어요…");
  assert.equal(pendingText(t0, t0 + 7400), "튜터가 답을 쓰고 있어요… 7초");
  assert.match(pendingText(t0, t0 + 45_000), /45초 · .*조금 더 걸려요/);
  assert.equal(pendingText(null), "튜터가 답을 쓰고 있어요…");
});
