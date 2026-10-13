// 학습 채팅의 보충학습 흐름(frontend/3d-demo/learning-chat.js): 후보 칩 → 시작 → 입력을 답으로 보냄 → 끝나면 칩이 돌아온다.
// 브라우저 없이 가짜 페이지 컴포넌트와 가짜 fetch로 돌린다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

(globalThis as { location?: unknown }).location = { search: "" };
const { createLearningChat, supplementMessages, supplementWaiting, SUPPLEMENT_STOP_CHIP } = await import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", "learning-chat.js")).href);

type Chip = { text: string; onClick: () => Promise<void> | void };

function fakePage() {
  const page = {
    state: { processId: "ironmaking", selectedId: null, messages: [] as { role: string; text: string; evidence?: string }[], pending: false, input: "", supplement: null as unknown, supplementCandidates: [] as unknown[] } as Record<string, any>,
    data: { findProcess: () => null, findEquipment: () => null },
    chatRef: null,
    setState(u: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) { Object.assign(page.state, typeof u === "function" ? u(page.state) : u); },
    scrollChat() {},
    goProcess() {},
    scene: () => null,
  };
  return page;
}

const view = (over: Record<string, unknown>) => ({ id: "s1", section: "ironmaking", concept_id: "sinter_purpose", concept_name: "소결의 목적", outcome: null, scene_actions: [], ...over });

test("supplementMessages·supplementWaiting: 튜터 말만 채팅 메시지로, 출처는 근거로", () => {
  const msgs = supplementMessages({ messages: [{ role: "user", type: "answer", text: "a" }, { role: "tutor", type: "explanation", text: "설명", sources: [{ id: "x", title: "T", url: "u" }] }] });
  assert.deepEqual(msgs, [{ role: "assistant", text: "설명", mode: "free_question", evidence: "supplement", citations: [{ title: "T", document_id: "x", url: "u" }], followUp: null, keywordCard: null }]);
  assert.equal(supplementWaiting({ state: "awaiting_recheck" }), true);
  assert.equal(supplementWaiting({ state: "completed" }), false);
  assert.equal(supplementWaiting(null), false);
});

test("학습 채팅 보충학습: 후보 칩으로 시작 → 입력은 답으로 → 다시 설명 → 끝나면 후보 칩과 추천 질문이 돌아옴", async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  let candidates = [{ concept_id: "sinter_purpose", name: "소결의 목적", reason: "misconception", summary: "s" }];
  const replies: Record<string, () => unknown> = {
    "GET /api/learning/supplements?section=ironmaking": () => ({ candidates, active: null }),
    "POST /api/learning/supplements": () => view({ state: "awaiting_answer", question: "Q1", messages: [{ role: "tutor", type: "intro", text: "다시 짚어 볼게요" }, { role: "tutor", type: "question", text: "확인 문제예요. Q1" }] }),
    "POST /api/learning/supplements/s1/answer": () => (sent.filter((x) => x.url.endsWith("/answer")).length === 1
      ? view({ state: "awaiting_recheck", question: "Q2", messages: [{ role: "tutor", type: "reaction", text: "아쉬워요" }, { role: "tutor", type: "question", text: "Q2" }] })
      : (candidates = [], view({ state: "completed", outcome: "resolved", question: null, messages: [{ role: "tutor", type: "reaction", text: "정답이에요!" }] }))),
  };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    const reply = replies[`${method} ${url}`];
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const page = fakePage();
  const chat = await createLearningChat(page);
  const D = { SUGGESTED: ["고로는 무슨 일을 해?"] };
  await chat.refreshSupplements();
  let chips: Chip[] = chat.vals(D).chips;
  assert.equal(chips[0]!.text, "보충학습 · 소결의 목적");
  assert.ok(chips.length > 1, "추천 질문도 뒤에 있음");

  await chips[0]!.onClick();
  assert.deepEqual(sent.find((x) => x.method === "POST")!.body, { section: "ironmaking", concept_id: "sinter_purpose", screen: { process_id: "ironmaking" } });
  assert.equal(page.state.supplement.state, "awaiting_answer");
  assert.deepEqual(page.state.messages.map((m: { text: string }) => m.text), ["'소결의 목적' 보충학습을 할게요.", "다시 짚어 볼게요", "확인 문제예요. Q1"]);
  chips = chat.vals(D).chips;
  assert.deepEqual(chips.map((c) => c.text), [SUPPLEMENT_STOP_CHIP], "진행 중에는 그만하기 칩만");

  await chat.ask("소결로 쇳물을 만들어요");
  assert.deepEqual(sent.at(-1)!.body, { answer: "소결로 쇳물을 만들어요" }, "입력은 확인 문제의 답으로");
  assert.ok(!sent.some((x) => x.url === "/api/chat"), "학습 채팅 API는 부르지 않음");
  assert.equal(page.state.supplement.state, "awaiting_recheck");

  await chat.ask("덩어리로 만들어 고로에 넣어요");
  assert.equal(page.state.supplement, null);
  await new Promise((r) => setTimeout(r, 10));
  chips = chat.vals(D).chips;
  assert.ok(chips.length > 0 && chips.every((c) => !c.text.startsWith("보충학습")), "해결한 개념 칩은 빠지고 추천 질문만");
  assert.equal(page.state.messages.at(-1).text, "정답이에요!");
});

test("학습 채팅 보충학습: 새로고침 뒤 풀던 보충학습을 한 번 알려 주고, 시작이 409(이해도 확인 중)면 오류 말풍선만", async () => {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify({ candidates: [{ concept_id: "coke_reduction", name: "고로에서 코크스의 역할" }], active: view({ state: "awaiting_answer", question: "Q1", concept_name: "소결의 목적" }) }), { status: 200 });
    return new Response(JSON.stringify({ error: "이해도 확인을 푸는 중에는 보충학습을 할 수 없어요.", code: "CHECKPOINT_IN_PROGRESS" }), { status: 409 });
  }) as typeof fetch;
  const page = fakePage();
  const chat = await createLearningChat(page);
  await chat.refreshSupplements();
  await chat.refreshSupplements(true);
  assert.equal(page.state.messages.filter((m: { text: string }) => m.text.startsWith("풀던 보충학습이 있어요")).length, 1, "한 번만 알림");
  assert.equal(page.state.supplement.id, "s1");
  await chat.answerSupplement("답");
  assert.equal(page.state.messages.at(-1).evidence, "error");
  assert.equal(page.state.supplement.id, "s1", "이해도 확인 중 409면 보충학습은 그대로");
});
