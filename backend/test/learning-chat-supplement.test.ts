// 학습 채팅의 보충학습 흐름(frontend/3d-demo/learning-chat.js): 후보 칩 → 시작 → 입력을 답으로 보냄 → 끝나면 칩이 돌아온다.
// 포석호(튜터 캐릭터) 동작(tutorMotionFor)과 효과음(반응·결과마다 한 번)도 여기서 확인한다.
// 브라우저 없이 가짜 페이지 컴포넌트와 가짜 fetch로 돌린다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

(globalThis as { location?: unknown }).location = { search: "" };
const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { createLearningChat, supplementMessages, supplementWaiting, supplementReaction, tutorMotionFor, reactionSfx, TONE_TYPE, TUTOR_NAME, SUPPLEMENT_STOP_CHIP } = await load("learning-chat.js");
const { MOTION_BY_TYPE } = await load("checkpoint-chat.js");
const { MOTIONS } = await load("cp-character.js");
const { SFX_NAMES, sfxFor } = await load("tutor-sfx.js");

type Chip = { text: string; onClick: () => Promise<void> | void };

function fakePage() {
  const page = {
    state: { processId: "ironmaking", selectedId: null, messages: [] as { role: string; text: string; evidence?: string }[], pending: false, input: "", supplement: null as unknown, supplementCandidates: [] as unknown[] } as Record<string, any>,
    data: { findProcess: () => null, findEquipment: () => null },
    chatRef: null,
    // 테스트가 상태 변화마다 들여다볼 수 있는 훅(예: 그 순간의 포석호 동작)
    afterSet: null as null | (() => void),
    setState(u: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) { Object.assign(page.state, typeof u === "function" ? u(page.state) : u); page.afterSet?.(); },
    scrollChat() {},
    goProcess() {},
    scene: () => null,
  };
  return page;
}

/** 포석호 가짜: 효과음은 이름만 모으고, 타이머는 flush()로 흘린다(explain → idle, greet → ask 전환). */
function fakeTutor() {
  const played: { name: string; force: boolean }[] = [];
  let on = true;
  const sfx = { playSfx: (name: string, { force = false }: { force?: boolean } = {}) => { played.push({ name, force }); }, sfxOn: () => on, setSfxOn: (v: boolean) => { on = v; }, sfxSupported: () => true };
  const timers = {
    queue: [] as { id: number; fn: () => void }[], seq: 0,
    setTimeout(fn: () => void) { const id = ++timers.seq; timers.queue.push({ id, fn }); return id; },
    clearTimeout(id: number | null) { timers.queue = timers.queue.filter((t) => t.id !== id); },
    flush() { const q = timers.queue; timers.queue = []; for (const t of q) t.fn(); },
  };
  return { sfx, timers, played, options: { sfx, timers, holdMs: 2500 } };
}

const view = (over: Record<string, unknown>) => ({ id: "s1", section: "ironmaking", concept_id: "sinter_purpose", concept_name: "소결의 목적", outcome: null, scene_actions: [], ...over });

test("supplementMessages·supplementWaiting: 튜터 말만 채팅 메시지로, 출처는 근거로", () => {
  const msgs = supplementMessages({ messages: [{ role: "user", type: "answer", text: "a" }, { role: "tutor", type: "explanation", text: "설명", sources: [{ id: "x", title: "T", url: "u" }] }] });
  assert.deepEqual(msgs, [{ role: "assistant", text: "설명", mode: "free_question", evidence: "supplement", citations: [{ title: "T", document_id: "x", url: "u" }], followUp: null, keywordCard: null }]);
  assert.equal(supplementWaiting({ state: "awaiting_recheck" }), true);
  assert.equal(supplementWaiting({ state: "completed" }), false);
  assert.equal(supplementWaiting(null), false);
});

test("학습 채팅 보충학습: 후보 칩으로 시작 → 입력은 답으로 → 다시 설명 → 끝나면 후보 칩과 추천 질문이 돌아옴. 포석호는 greet→ask, encourage(효과음 almost), celebrate(효과음 celebrate)", async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  let candidates = [{ concept_id: "sinter_purpose", name: "소결의 목적", reason: "misconception", summary: "s" }];
  const replies: Record<string, () => unknown> = {
    "GET /api/learning/supplements?section=ironmaking": () => ({ candidates, active: null }),
    "POST /api/learning/supplements": () => view({ state: "awaiting_answer", question: "Q1", messages: [{ role: "tutor", type: "intro", text: "다시 짚어 볼게요" }, { role: "tutor", type: "question", text: "확인 문제예요. Q1" }] }),
    "POST /api/learning/supplements/s1/answer": () => (sent.filter((x) => x.url.endsWith("/answer")).length === 1
      ? view({ state: "awaiting_recheck", question: "Q2", messages: [{ role: "tutor", type: "reaction", tone: "almost", text: "아쉬워요" }, { role: "tutor", type: "question", text: "Q2" }] })
      : (candidates = [], view({ state: "completed", outcome: "resolved", question: null, messages: [{ role: "tutor", type: "reaction", tone: "correct", text: "정답이에요!" }] }))),
  };
  const D = { SUGGESTED: ["고로는 무슨 일을 해?"] };
  let chatRef: any = null;
  let motionWhileAnswering: string | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/answer") && chatRef) motionWhileAnswering = chatRef.vals(D).tutorMotion;
    const reply = replies[`${method} ${url}`];
    if (!reply) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply()), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const page = fakePage();
  const tutor = fakeTutor();
  const chat = chatRef = await createLearningChat(page, tutor.options);
  await chat.refreshSupplements();
  let chips: Chip[] = chat.vals(D).chips;
  assert.equal(chips[0]!.text, "보충학습 · 소결의 목적");
  assert.ok(chips.length > 1, "추천 질문도 뒤에 있음");
  assert.equal(chat.vals(D).tutorMotion, "idle", "시작 전에는 대기");

  await chips[0]!.onClick();
  assert.deepEqual(sent.find((x) => x.method === "POST")!.body, { section: "ironmaking", concept_id: "sinter_purpose", screen: { process_id: "ironmaking" } });
  assert.equal(page.state.supplement.state, "awaiting_answer");
  assert.deepEqual(page.state.messages.map((m: { text: string }) => m.text), ["'소결의 목적' 보충학습을 할게요.", "다시 짚어 볼게요", "확인 문제예요. Q1"]);
  chips = chat.vals(D).chips;
  assert.deepEqual(chips.map((c) => c.text), [SUPPLEMENT_STOP_CHIP], "진행 중에는 그만하기 칩만");
  assert.equal(chat.vals(D).tutorMotion, "greet", "보충학습 시작은 인사");
  assert.equal(tutor.timers.queue.length, 1, "인사 뒤 확인 문제 동작으로 넘어갈 예약");
  tutor.timers.flush();
  assert.equal(chat.vals(D).tutorMotion, "ask", "인사 뒤에는 확인 문제를 묻는 동작");
  assert.equal(tutor.played.length, 0, "시작·확인 문제에는 효과음 없음");

  await chat.ask("소결로 쇳물을 만들어요");
  assert.deepEqual(sent.at(-1)!.body, { answer: "소결로 쇳물을 만들어요" }, "입력은 확인 문제의 답으로");
  assert.ok(!sent.some((x) => x.url === "/api/chat"), "학습 채팅 API는 부르지 않음");
  assert.equal(page.state.supplement.state, "awaiting_recheck");
  assert.equal(motionWhileAnswering, "thinking", "채점을 기다리는 동안은 생각하는 동작");
  assert.equal(chat.vals(D).tutorMotion, "encourage", "거의 맞음(almost) 반응");
  chat.vals(D); chat.vals(D);
  assert.deepEqual(tutor.played.map((p) => p.name), ["almost"], "반응 효과음은 한 번만(다시 그려도 늘지 않음)");
  assert.equal(tutor.timers.queue.length, 0, "반응 동작은 다음 답을 보낼 때까지 유지(예약 없음)");

  await chat.ask("덩어리로 만들어 고로에 넣어요");
  assert.equal(page.state.supplement, null);
  assert.equal(chat.vals(D).tutorMotion, "celebrate", "해결하면 축하");
  assert.deepEqual(tutor.played.map((p) => p.name), ["almost", "celebrate"], "끝난 결과 효과음도 한 번");
  await new Promise((r) => setTimeout(r, 10));
  chips = chat.vals(D).chips;
  assert.ok(chips.length > 0 && chips.every((c) => !c.text.startsWith("보충학습")), "해결한 개념 칩은 빠지고 추천 질문만");
  assert.equal(page.state.messages.at(-1).text, "정답이에요!");
  assert.equal(chat.vals(D).tutorMotion, "celebrate", "후보를 다시 읽어도 반응은 유지");
});

test("학습 채팅 보충학습: 새로고침 뒤 풀던 보충학습을 한 번 알려 주고, 시작이 409(이해도 확인 중)면 오류 말풍선만", async () => {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify({ candidates: [{ concept_id: "coke_reduction", name: "고로에서 코크스의 역할" }], active: view({ state: "awaiting_answer", question: "Q1", concept_name: "소결의 목적" }) }), { status: 200 });
    return new Response(JSON.stringify({ error: "이해도 확인을 푸는 중에는 보충학습을 할 수 없어요.", code: "CHECKPOINT_IN_PROGRESS" }), { status: 409 });
  }) as typeof fetch;
  const page = fakePage();
  const chat = await createLearningChat(page);
  const D = { SUGGESTED: [] as string[] };
  await chat.refreshSupplements();
  await chat.refreshSupplements(true);
  assert.equal(page.state.messages.filter((m: { text: string }) => m.text.startsWith("풀던 보충학습이 있어요")).length, 1, "한 번만 알림");
  assert.equal(page.state.supplement.id, "s1");
  assert.equal(chat.vals(D).tutorMotion, "ask", "풀던 확인 문제를 다시 보여 주면 묻는 동작");
  await chat.answerSupplement("답");
  assert.equal(page.state.messages.at(-1).evidence, "error");
  assert.equal(page.state.supplement.id, "s1", "이해도 확인 중 409면 보충학습은 그대로");
  assert.equal(chat.vals(D).tutorMotion, "sorry", "답을 보내지 못하면 아쉬운 표정");
  assert.equal(chat.vals(D).tutorSfxSupported, false, "AudioContext가 없는 곳(Node)에서는 효과음 버튼을 숨김");
});

test("tutorMotionFor: 기다리면 thinking, 글자가 오면 explain, 반응은 체크포인트 발화 type의 동작(motionFor), 없으면 idle", () => {
  assert.equal(tutorMotionFor({ pending: true, partial: "" }), "thinking");
  assert.equal(tutorMotionFor({ pending: true, partial: "제선은" }), "explain");
  assert.equal(tutorMotionFor({ pending: true, partial: "", reaction: { kind: "reaction", tone: "miss" } }), "thinking", "답을 기다리는 중에는 지난 반응보다 생각하는 동작");
  const r = (reaction: Record<string, unknown> | null) => tutorMotionFor({ pending: false, partial: "", reaction });
  assert.equal(r({ kind: "reaction", tone: "correct" }), "praise");
  assert.equal(r({ kind: "reaction", tone: "almost" }), "encourage");
  assert.equal(r({ kind: "reaction", tone: "miss" }), "sorry");
  assert.equal(r({ kind: "result", outcome: "resolved" }), "celebrate");
  assert.equal(r({ kind: "result", outcome: "not_resolved" }), "cheer_retry");
  assert.equal(r({ kind: "intro" }), "greet");
  assert.equal(r({ kind: "question", recheck: false }), "ask");
  assert.equal(r({ kind: "question", recheck: true }), "ask_again");
  assert.equal(r({ kind: "explanation", then: null }), "explain");
  assert.equal(r({ kind: "error" }), "sorry");
  assert.equal(r(null), "idle");
  assert.equal(r({ kind: "closing" }), "idle", "모르는 반응은 대기");
  assert.equal(r({ kind: "reaction", tone: "weird" }), "idle", "모르는 tone도 대기");
  assert.equal(tutorMotionFor({}), "idle");
  // 동작 이름표는 cp-character.js가 아는 것만, tone → 발화 type은 checkpoint-chat.js의 MOTION_BY_TYPE에 있는 것만 쓴다.
  const reactions = [{ kind: "reaction", tone: "correct" }, { kind: "reaction", tone: "almost" }, { kind: "reaction", tone: "miss" }, { kind: "result", outcome: "resolved" }, { kind: "result", outcome: "not_resolved" }, { kind: "intro" }, { kind: "question", recheck: false }, { kind: "question", recheck: true }, { kind: "explanation", then: null }, { kind: "error" }];
  for (const reaction of reactions) assert.ok(MOTIONS.includes(r(reaction)), `${JSON.stringify(reaction)} → ${r(reaction)}`);
  for (const type of Object.values(TONE_TYPE as Record<string, string>)) assert.ok(type in MOTION_BY_TYPE, `${type}는 MOTION_BY_TYPE에 있어야 함`);
});

test("reactionSfx: 보충학습 반응(tone)·결과(outcome)에만 효과음(tutor-sfx.js 이름), 시작·질문·설명·오류는 없음", () => {
  assert.equal(reactionSfx({ kind: "reaction", tone: "correct" }), "correct");
  assert.equal(reactionSfx({ kind: "reaction", tone: "almost" }), "almost");
  assert.equal(reactionSfx({ kind: "reaction", tone: "miss" }), "miss");
  assert.equal(reactionSfx({ kind: "result", outcome: "resolved" }), "celebrate");
  assert.equal(reactionSfx({ kind: "result", outcome: "not_resolved" }), "cheer");
  for (const reaction of [{ kind: "intro" }, { kind: "question", recheck: true }, { kind: "explanation", then: null }, { kind: "error" }, null]) assert.equal(reactionSfx(reaction), null);
  for (const name of ["correct", "almost", "miss", "celebrate", "cheer"]) assert.ok(SFX_NAMES.includes(name), `${name}는 tutor-sfx.js에 있어야 함`);
  assert.equal(reactionSfx({ kind: "result", outcome: "resolved" }), sfxFor("result", { unlocked: true }), "이해도 확인 통과와 같은 소리");
});

test("supplementReaction: 끝남(outcome) > 반응(tone) > 시작(intro, 뒤에 확인 문제) > 확인 문제. 그만두기·없음은 null", () => {
  const tutor = (type: string, extra: Record<string, unknown> = {}) => ({ role: "tutor", type, text: "", ...extra });
  assert.deepEqual(supplementReaction(view({ state: "awaiting_answer", messages: [tutor("intro"), tutor("explanation"), tutor("question")] })), { kind: "intro", then: { kind: "question", recheck: false } });
  assert.deepEqual(supplementReaction(view({ state: "awaiting_recheck", messages: [tutor("reaction", { tone: "miss" }), tutor("explanation"), tutor("question")] })), { kind: "reaction", tone: "miss" });
  assert.deepEqual(supplementReaction(view({ state: "completed", outcome: "resolved", messages: [tutor("reaction", { tone: "correct" }), tutor("closing")] })), { kind: "result", outcome: "resolved" }, "맞혀서 끝나면 반응보다 결과");
  assert.deepEqual(supplementReaction(view({ state: "completed", outcome: "not_resolved", messages: [tutor("key_points"), tutor("closing")] })), { kind: "result", outcome: "not_resolved" });
  assert.deepEqual(supplementReaction(view({ state: "awaiting_recheck", messages: [tutor("question")] })), { kind: "question", recheck: true }, "재확인 문제만 있으면 갸웃");
  assert.equal(supplementReaction(view({ state: "stopped", messages: [tutor("closing")] })), null);
  assert.deepEqual(supplementReaction(view({ state: "awaiting_answer", messages: [{ role: "user", type: "answer", text: "a" }] })), { kind: "question", recheck: false }, "답을 기다리는 중이면 튜터 말이 없어도 묻는 동작");
  assert.equal(supplementReaction(null), null);
});

test("학습 채팅 포석호: 일반 질문은 thinking → 글자가 오면 explain → 답이 끝나면 explain을 잠깐 유지한 뒤 idle. 새 질문은 예약을 지우고 효과음은 없음", async () => {
  const D = { SUGGESTED: ["고로는 무슨 일을 해?"] };
  const motions: string[] = [];
  let chatRef: any = null;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if ((init.method ?? "GET") === "GET") return new Response(JSON.stringify({ candidates: [], active: null }), { status: 200 });
    assert.equal(url, "/api/chat");
    motions.push("요청 중:" + chatRef.vals(D).tutorMotion);
    // 스트리밍(NDJSON): 답을 받는 대로 글자가 오고 마지막에 done
    const body = '{"type":"answer","text":"고로는"}\n{"type":"done","status":200,"body":{"answer":"고로는 쇳물을 만들어요","status":"answered","session_id":"s1","sources":[]}}\n';
    return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }) as typeof fetch;
  const page = fakePage();
  const tutor = fakeTutor();
  const chat = chatRef = await createLearningChat(page, tutor.options);
  page.afterSet = () => motions.push(chat.vals(D).tutorMotion);

  await chat.ask("고로는 무슨 일을 해?");
  assert.ok(motions.includes("요청 중:thinking"), `답을 기다리는 동안 생각하는 동작: ${motions.join(",")}`);
  assert.ok(motions.includes("explain"), "글자가 오는 동안 설명하는 동작");
  assert.equal(page.state.messages.at(-1).text, "고로는 쇳물을 만들어요");
  assert.equal(chat.vals(D).tutorMotion, "explain", "답이 끝나면 잠깐 설명하는 동작을 유지");
  assert.equal(tutor.timers.queue.length, 1, "유지 시간 뒤 대기로 돌아갈 예약");

  await chat.ask("또 질문");
  assert.equal(tutor.timers.queue.length, 1, "새 질문을 보내면 이전 예약은 지우고 마지막 답의 것만");
  tutor.timers.flush();
  assert.equal(chat.vals(D).tutorMotion, "idle");
  assert.equal(tutor.played.length, 0, "일반 답에는 효과음 없음");
});

test("학습 채팅 포석호: 이름은 포석호, 효과음 토글은 끄면 조용히·켜면 한 번 들려줌(force)", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [], active: null }), { status: 200 })) as typeof fetch;
  const page = fakePage();
  const tutor = fakeTutor();
  const chat = await createLearningChat(page, tutor.options);
  const D = { SUGGESTED: [] as string[] };
  let v = chat.vals(D);
  assert.equal(v.tutorName, "포석호");
  assert.equal(v.tutorName, TUTOR_NAME);
  assert.equal(v.tutorSfxSupported, true);
  assert.equal(v.tutorSfxLabel, "🔊 효과음 켜짐");
  v.onToggleTutorSfx();
  v = chat.vals(D);
  assert.equal(v.tutorSfxLabel, "🔈 효과음 꺼짐");
  assert.equal(tutor.played.length, 0, "끌 때는 소리 없음");
  assert.equal(tutor.sfx.sfxOn(), false);
  v.onToggleTutorSfx();
  assert.deepEqual(tutor.played, [{ name: "correct", force: true }], "켤 때 한 번 들려줌");
  assert.equal(chat.vals(D).tutorSfxLabel, "🔊 효과음 켜짐");
});
