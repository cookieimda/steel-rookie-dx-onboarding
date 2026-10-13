// 메인 페이지 체크포인트 채팅(frontend/3d-demo/checkpoint-chat.js)과 공용 요청(api-client.js).
// 브라우저 없이 가짜 fetch·저장소·페이지 컴포넌트로 돌리고 vals() 값만 확인한다.
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = (file: string) => import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", file)).href);
const { createCheckpointChat, motionFor, MOTION_BY_TYPE, SECTIONS: SECTION_IDS } = await load("checkpoint-chat.js");
const { createApiClient, ApiError } = await load("api-client.js");
const { TEXT } = await load("tutor-text.js");

type Json = Record<string, unknown>;
type Reply = { status?: number; body?: unknown } | ((body: Json | undefined) => { status?: number; body?: unknown });

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

/** "METHOD /path" → 응답(배열이면 차례대로). 받은 요청을 calls에 남긴다. */
function fakeFetch(routes: Record<string, Reply | Reply[]>) {
  const calls: { key: string; headers: Record<string, string>; body: Json | undefined }[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const fetch = async (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const key = `${init.method} ${path}`;
    const body = init.body ? (JSON.parse(init.body) as Json) : undefined;
    calls.push({ key, headers: init.headers, body });
    const entry = queues.get(key);
    if (entry === undefined) throw new Error(`예상하지 않은 요청: ${key}`);
    const next = Array.isArray(entry) ? entry.shift() : entry;
    if (next === undefined) throw new Error(`응답을 다 썼음: ${key}`);
    const reply = typeof next === "function" ? next(body) : next;
    const status = reply.status ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => reply.body ?? {} };
  };
  return { fetch, calls, keys: () => calls.map((c) => c.key) };
}

/** 페이지 컴포넌트 흉내: state를 바로 합친다(함수 갱신 포함). v2처럼 체크포인트 키(cp...)를 미리 적지 않는다. */
function fakePage(processId: string) {
  const c = {
    state: { processId } as Json & { processId: string },
    setState(update: Json | ((s: Json) => Json)) {
      c.state = { ...c.state, ...(typeof update === "function" ? update(c.state) : update) };
    },
    data: { findProcess: (id: string) => ({ ironmaking: { name: "제선" }, steelmaking: { name: "제강" } } as Record<string, { name: string }>)[id] },
  };
  return c;
}

function setup(routes: Record<string, Reply | Reply[]>, { processId = "ironmaking", token = "tok", passcode = "" } = {}) {
  const local = memoryStorage({ ...(token ? { "st-rookie-token": token } : {}), ...(passcode ? { "st-rookie:passcode": passcode } : {}) });
  const session = memoryStorage();
  const net = fakeFetch(routes);
  const api = createApiClient({ fetch: net.fetch, local, session });
  const page = fakePage(processId);
  const chat = createCheckpointChat(page, { api });
  return { chat, page, net, local, vals: () => chat.vals() };
}

const progress = (section: string, extra: Json = {}) => ({
  body: { section, open: true, unlocked: false, understanding: null, retry_concept_ids: [], unconfirmed_concept_ids: [], in_progress_attempt_id: null, ...extra },
});
const notFound = { status: 404, body: { error: "루브릭이 없는 섹션입니다" } };
const otherSections = {
  "GET /api/sections/steelmaking/progress": notFound,
  "GET /api/sections/continuous_casting/progress": notFound,
  "GET /api/sections/rolling/progress": notFound,
};
const progressList = (statuses: string[]) => statuses.map((status, i) => ({ concept_id: `c${i + 1}`, status }));
const view = (state: string, extra: Json = {}) => ({
  attempt_id: "a1", section: "ironmaking", kind: "first", state, concept: null, tutor: [], progress: progressList(["pending", "pending", "pending"]), result: null, ...extra,
});
const concept = (index: number, name = `개념${index}`) => ({ id: `c${index}`, name, index, total: 3 });

test("시작 → 답변 → 재확인 → 결과: 섹션 버튼, 단계 표시, 학습 잠금, 결과 막대, 배지", async () => {
  const { chat, net, vals } = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking"), progress("ironmaking", { unlocked: true, understanding: 1 })],
    ...otherSections,
    "POST /api/checkpoints": { status: 201, body: view("awaiting_ready", { tutor: [{ type: "intro", text: "제선 질문 시작할게요, 준비됐나요?" }] }) },
    "POST /api/checkpoints/a1/messages": [
      { body: view("awaiting_answer", { concept: concept(1, "소결의 목적"), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "question", text: "Q1" }] }) },
      { body: view("awaiting_recheck", { concept: concept(1, "소결의 목적"), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "explanation", text: "설명" }, { type: "recheck_question", text: "R1" }] }) },
      { body: view("completed", {
        progress: progressList(["done", "done", "done"]),
        tutor: [{ type: "feedback", text: "맞아요" }, { type: "result", text: "결과" }],
        result: { understanding: 1, unlocked: true, threshold: 0.8, retry_concept_ids: [], concepts: [
          { concept_id: "c1", name: "소결의 목적", score: 1, final_verdict: "correct" },
          { concept_id: "c2", name: "코크스", score: 0.5, final_verdict: "partial" },
          { concept_id: "c3", name: "고로", score: 0, final_verdict: "wrong" },
        ] },
      }) },
    ],
  });

  await chat.refreshAll();
  let b = chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.notStarted);
  assert.equal(b.cpSectionCanStart, true);
  assert.equal(b.cpSectionStartLabel, TEXT.buttons.startQuench);
  assert.deepEqual(SECTION_IDS.map((id: string) => chat.sectionBadge(id).cpBadge), [TEXT.badges.notPassed, "", "", ""]);
  let v = vals();
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpShowResult, false);

  await chat.start();
  v = vals();
  assert.equal(v.cpState, "awaiting_ready");
  assert.equal(v.cpStageLabel, TEXT.stage.ready);
  assert.equal(v.cpOverlayShowReady, true);
  assert.equal(v.cpLearningLocked, true);
  assert.equal(v.cpMessages[0].label, TEXT.messageLabels.intro);

  await chat.ready();
  v = vals();
  assert.equal(v.cpStageLabel, "개념 1/3");
  assert.equal(v.cpOverlayShowReady, false);

  v.onCpInput({ target: { value: "  몰라  " } });
  await vals().onCpSend({ preventDefault() {} });
  v = vals();
  assert.equal(v.cpStageLabel, "개념 1/3 · 재확인");
  assert.equal(v.cpInput, "", "보낸 뒤 입력창을 비운다");
  const recheck = v.cpMessages.at(-1);
  assert.equal(recheck.isRecheck, true);
  assert.equal(recheck.label, TEXT.messageLabels.recheck_question);
  assert.deepEqual(v.cpMessages.slice(-3).map((m: Json) => m.isUser), [true, false, false]);
  assert.equal(v.cpMessages.at(-3).text, "몰라", "앞뒤 공백을 지우고 보낸다");

  await chat.send("소결광으로 만든다");
  v = vals();
  assert.equal(v.cpShowResult, true);
  assert.equal(v.cpShowComposer, false);
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpStageLabel, TEXT.stage.done);
  assert.equal(v.cpResult.percent, 100);
  assert.equal(v.cpResult.thresholdPercent, 80);
  assert.equal(v.cpResult.passed, true);
  assert.equal(v.cpResult.passLabel, TEXT.result.nextNotReady, "제강 루브릭이 없으면(404) 준비 중");
  assert.deepEqual(v.cpResult.bars.map((x: Json) => [x.verdictLabel, x.widthPercent, x.tone]), [["맞음", 100, "ok"], ["부분", 50, "warn"], ["틀림", 3, "danger"]]);
  b = chat.sectionBadge("ironmaking");
  assert.equal(b.cpBadge, TEXT.badges.passed, "끝나면 진입 상태를 다시 읽어 배지를 바꾼다");
  assert.equal(b.cpSectionPassed, true);

  assert.deepEqual(net.calls.filter((c) => c.key.startsWith("POST")).map((c) => c.body), [
    { section: "ironmaking" }, { text: TEXT.buttons.ready }, { text: "몰라" }, { text: "소결광으로 만든다" },
  ]);

  chat.close();
  assert.equal(vals().cpShowResult, false);
  b = chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.passed(100));
  assert.equal(b.cpSectionShowStart, false, "통과한 섹션은 다시 시작하지 않는다");
});

test("새로고침 복원: 진행 중인 시도를 기록과 함께 불러 두고, 오버레이는 열지 않고 [이어 풀기] 안내를 띄운다", async () => {
  const { chat, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    ...otherSections,
    "GET /api/checkpoints/a1": { body: view("awaiting_recheck", {
      concept: concept(2), progress: progressList(["done", "current", "pending"]),
      history: [
        { role: "tutor", type: "question", text: "Q2" },
        { role: "user", type: null, text: "답" },
        { role: "tutor", type: "recheck_question", text: "R2" },
      ],
    }) },
  }, { processId: "site" });

  await chat.refreshAll();
  const v = vals();
  assert.equal(v.cpState, "awaiting_recheck", "전체 보기(site)여도 진행 중인 시도는 불러 둔다");
  assert.equal(v.cpStageLabel, "개념 2/3 · 재확인");
  assert.deepEqual(v.cpMessages.map((m: Json) => m.text), ["Q2", "답", "R2"]);
  assert.deepEqual(v.cpDots.map((d: Json) => d.status), ["done", "current", "pending"]);
  assert.equal(v.cpLearningLocked, true);
  assert.equal(v.cpTitle, "이해도 확인 · 제선");
  assert.equal(v.cpShowOverlay, false, "오버레이를 자동으로 열지 않는다");
  assert.equal(v.cpShowResumeBanner, true);
  assert.equal(v.cpResumeBannerText, TEXT.resumeBanner("제선", 1, 3));
});

test("채점 오류 → 다시 채점하기", async () => {
  const { chat, net, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [{ role: "tutor", type: "question", text: "Q1" }] }) },
    "POST /api/checkpoints/a1/messages": { body: view("error", { concept: concept(1), tutor: [{ type: "error", text: "채점하지 못했어요" }] }) },
    "POST /api/checkpoints/a1/retry-evaluation": { body: view("awaiting_recheck", { concept: concept(1), tutor: [{ type: "explanation", text: "설명" }, { type: "recheck_question", text: "R1" }] }) },
  });

  await chat.refresh();
  await chat.send("답변");
  let v = vals();
  assert.equal(v.cpState, "error");
  assert.equal(v.cpStageLabel, `개념 1/3 · ${TEXT.stage.error}`);
  assert.equal(v.cpShowRetryButton, true);
  assert.equal(v.cpOverlayInputDisabled, true);
  assert.equal(v.cpOverlayPlaceholder, TEXT.placeholder.error);
  assert.equal(v.cpCharacterMotion, "sorry");
  assert.equal(v.cpMessages.at(-1).isError, true);

  await v.onCpRetry();
  v = vals();
  assert.equal(v.cpState, "awaiting_recheck");
  assert.equal(v.cpShowRetryButton, false);
  assert.equal(net.calls.at(-1)!.key, "POST /api/checkpoints/a1/retry-evaluation");
  assert.deepEqual(net.calls.at(-1)!.body, {});
});

test("401 로그인 만료: 토큰을 지우고 로그인 안내, 입력은 남긴다", async () => {
  const { chat, page, local, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
    "POST /api/checkpoints/a1/messages": { status: 401, body: { error: "만료", code: "TOKEN_INVALID" } },
  });
  await chat.refresh();
  page.setState({ cpInput: "내 답변" });
  await chat.send("내 답변");
  const v = vals();
  assert.equal(v.cpNotice, TEXT.errors.tokenInvalid);
  assert.equal(v.cpHasNotice, true);
  assert.equal(local.has("st-rookie-token"), false);
  assert.equal(chat.sectionBadge("ironmaking").cpSectionShowStart, false, "로그인이 풀리면 섹션 버튼을 숨긴다");
  assert.equal(v.cpInput, "내 답변");
  assert.equal(v.cpMessages.length, 0, "실패한 답변은 메시지에 붙이지 않는다");
  assert.equal(v.cpPending, false);
});

test("429 사용량 초과: 통일된 안내, 다시 보낼 수 있다", async () => {
  const { chat, local, vals } = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
    "POST /api/checkpoints/a1/messages": [
      { status: 429, body: { error: "오늘 쓸 수 있는 튜터 호출(150회)을 다 썼어요.", code: "USAGE_LIMIT" } },
      { body: view("awaiting_answer", { concept: concept(2), tutor: [{ type: "feedback", text: "맞아요" }, { type: "question", text: "Q2" }] }) },
    ],
  });
  await chat.refresh();
  await chat.send("답");
  assert.equal(vals().cpNotice, TEXT.errors.usageLimit);
  assert.equal(local.has("st-rookie-token"), true, "사용량 초과는 로그인을 풀지 않는다");
  await chat.send("답");
  assert.equal(vals().cpNotice, "");
  assert.equal(vals().cpStageLabel, "개념 2/3");
});

test("전체 보기(site)와 로그인 전에는 시작하지 않고 요청도 보내지 않는다", async () => {
  const site = setup({}, { processId: "site" });
  await site.chat.refresh();
  await site.chat.start();
  assert.equal(site.vals().cpShowOverlay, false);
  assert.deepEqual(site.net.keys(), []);

  const guest = setup({}, { token: "" });
  await guest.chat.refreshAll();
  await guest.chat.start();
  const b = guest.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.login);
  assert.equal(b.cpSectionShowStart, false);
  assert.equal(b.cpSectionCanStart, false);
  assert.deepEqual(guest.net.keys(), []);
});

test("진입 상태: 준비 중(404), 잠김, 재도전, 연결 안 됨, 409는 서버 문장", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking", { retry_concept_ids: ["c2", "c3"] }), progress("ironmaking", { unlocked: true, understanding: 0.83 })],
    "GET /api/sections/steelmaking/progress": progress("steelmaking", { open: false }),
    "GET /api/sections/continuous_casting/progress": notFound,
    "GET /api/sections/rolling/progress": { status: 500, body: {} },
    "POST /api/checkpoints": { status: 409, body: { error: "이미 통과한 섹션입니다." } },
  });
  await s.chat.refreshAll();
  assert.equal(s.chat.sectionBadge("ironmaking").cpSectionStatus, TEXT.entry.retry(2));
  assert.equal(s.chat.sectionBadge("ironmaking").cpSectionStartLabel, TEXT.buttons.retryAttempt);
  assert.equal(s.chat.tabLocked("steelmaking"), false, "LOCK_PROCESS_TABS 기본값은 꺼짐");
  assert.deepEqual(SECTION_IDS.map((id: string) => s.chat.sectionBadge(id).cpBadge), [TEXT.badges.notPassed, TEXT.badges.notPassed, "", ""]);
  assert.equal(s.chat.sectionBadge("steelmaking").cpSectionStatus, TEXT.sectionLocked);
  assert.equal(s.chat.sectionBadge("steelmaking").cpSectionCanStart, false);
  assert.equal(s.chat.sectionBadge("continuous_casting").cpSectionStatus, TEXT.entry.notReady);
  assert.equal(s.chat.sectionBadge("rolling").cpSectionStatus, TEXT.entry.offline);

  await s.chat.start();
  assert.equal(s.vals().cpNotice, "이미 통과한 섹션입니다.");
  assert.equal(s.vals().cpShowOverlay, false, "시작에 실패하면 오버레이를 닫는다");
  assert.equal(s.chat.sectionBadge("ironmaking").cpSectionStatus, TEXT.entry.passed(83), "실패하면 진입 상태를 다시 읽는다");
});

test("튜터 패널은 학습 전용: 머리글은 늘 학습 모드, 새로고침 복원은 오버레이를 열지 않는다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
  });
  assert.equal(s.vals().cpHeaderMode, TEXT.header.learning);
  await s.chat.refresh();
  const v = s.vals();
  assert.equal(v.cpHeaderMode, TEXT.header.learning);
  assert.equal(v.cpShowOverlay, false);
  assert.equal(s.page.state.tutorMode, undefined, "tutorMode는 쓰지 않는다");
  for (const key of ["cpTabs", "cpIsLearningTab", "cpIsCheckpointTab", "cpShowTabs", "cpShowEntry", "cpShowRunning", "onCpStart"]) {
    assert.equal(key in v, false, `${key}는 지웠다`);
  }
  assert.equal("setMode" in s.chat, false);
});

test("학습 잠금: 답하는 중에는 학습 보내기·추천 질문·생각해 보기를 끄고 ask를 막은 뒤 [멈추고 질문하기]를 안내한다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_answer", { concept: concept(1), history: [] }) },
  });
  let sent = 0;
  const learning = { chips: [{ text: "추천" }], send: () => { sent++; }, messages: [{ text: "답", hasFollowUp: true }], input: "" };
  assert.equal(s.chat.lockLearning(learning), learning, "진행 중이 아니면 그대로");
  assert.equal(s.chat.runLearning(() => "보냄"), "보냄");

  await s.chat.refresh(); // 진행 중인 시도를 불러 둔다
  const locked = s.chat.lockLearning(learning);
  assert.deepEqual(locked.chips, []);
  assert.equal(locked.messages[0].hasFollowUp, false);
  let prevented = false;
  locked.send({ preventDefault() { prevented = true; } });
  assert.equal(sent, 0);
  assert.equal(prevented, true);
  assert.equal(s.chat.runLearning(() => "보냄"), undefined, "답하는 중에는 학습 질문을 보내지 않는다");
  const v = s.vals();
  assert.equal(v.cpShowPauseOffer, true);
  assert.equal(v.cpPauseOfferText, TEXT.pauseOffer);
  assert.equal(v.cpPauseOfferLabel, TEXT.buttons.pauseForLearning);
  assert.equal(v.cpShowResumeBanner, false, "멈추고 질문하기 안내가 뜨면 이어 풀기 안내는 숨긴다");
  assert.equal(v.cpLearningLocked, true);
});

test("공정 배지(sectionBadge): 통과·미통과·루브릭 없음, 전체 보기에서도 섹션 버튼은 누를 수 있다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { unlocked: true, understanding: 0.9 }),
    "GET /api/sections/steelmaking/progress": progress("steelmaking"),
    "GET /api/sections/continuous_casting/progress": notFound,
    "GET /api/sections/rolling/progress": notFound,
  }, { processId: "site" });
  await s.chat.refreshAll();
  const { cpHasBadge, cpBadge, cpBadgeColor, cpTabLocked } = s.chat.sectionBadge("ironmaking");
  assert.deepEqual({ cpHasBadge, cpBadge, cpBadgeColor, cpTabLocked }, { cpHasBadge: true, cpBadge: TEXT.badges.passed, cpBadgeColor: "var(--ok, #2f9e44)", cpTabLocked: false });
  assert.equal(s.chat.sectionBadge("ironmaking").cpSectionShowStart, false, "통과한 공정은 버튼을 숨긴다");
  const steel = s.chat.sectionBadge("steelmaking");
  assert.equal(steel.cpBadge, TEXT.badges.notPassed);
  assert.equal(steel.cpSectionShowStart, true);
  assert.equal(steel.cpSectionCanStart, true, "섹션 버튼은 그 공정으로 옮긴 뒤 시작하므로 전체 보기에서도 누를 수 있다");
  assert.equal(s.chat.sectionBadge("rolling").cpHasBadge, false);
});

test("api-client: 토큰·접속 비밀번호 헤더, X-User-Id 없음, 오류 문장 통일", async () => {
  const net = fakeFetch({
    "GET /ok": { body: { a: 1 } },
    "POST /bad": [{ status: 502, body: { error: "x" } }, { status: 503, body: {} }, { status: 401, body: { code: "PASSCODE_REQUIRED" } }, { status: 401, body: {} }],
  });
  const local = memoryStorage({ "st-rookie:passcode": "비번 1" });
  const session = memoryStorage({ "st-rookie-token": "sess" });
  const api = createApiClient({ fetch: net.fetch, local, session });

  assert.equal(api.hasToken(), true, "sessionStorage 토큰도 읽는다");
  assert.deepEqual(await api.request("GET", "/ok"), { a: 1 });
  assert.deepEqual(net.calls[0]!.headers, { Authorization: "Bearer sess", "X-Test-Passcode": encodeURIComponent("비번 1") });

  const messages = [];
  for (let i = 0; i < 4; i++) {
    const error = await api.request("POST", "/bad", {}).catch((e: Error) => e);
    assert.ok(error instanceof ApiError);
    messages.push(error.message);
  }
  assert.deepEqual(messages, [TEXT.errors.server, TEXT.errors.server, TEXT.errors.passcode, TEXT.errors.loginRequired]);
  assert.equal(net.calls[1]!.headers["Content-Type"], "application/json");
  assert.equal(api.hasToken(), true, "TOKEN_INVALID가 아니면 토큰을 지우지 않는다");

  const offline = createApiClient({ fetch: async () => { throw new TypeError("fetch failed"); }, local: memoryStorage(), session: memoryStorage() });
  const error = await offline.request("GET", "/x").catch((e: Error) => e);
  assert.equal(error.status, 0);
  assert.equal(error.message, TEXT.errors.network);

  api.setPasscode("새 비번");
  assert.equal(local.getItem("st-rookie:passcode"), "새 비번");
  api.setPasscode("");
  assert.equal(local.has("st-rookie:passcode"), false);
});

// --- 나중에 이어 풀기 ---

const answering = (extra: Json = {}) => view("awaiting_answer", { concept: concept(2), progress: progressList(["done", "current", "pending"]), ...extra });
const pausedView = (extra: Json = {}) => view("paused", { concept: concept(2), progress: progressList(["done", "current", "pending"]), ...extra });
const learningVals = () => ({ chips: [{ text: "추천" }], send: () => undefined, messages: [], input: "" });

test("이어 풀기: [나가기] → 확인창 → 멈춤, 멈춘 동안 학습 잠금 해제, [이어 풀기] → 새 질문", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: answering({ history: [{ role: "tutor", type: "question", text: "Q2" }] }) },
    "POST /api/checkpoints/a1/pause": { body: pausedView({ tutor: [{ type: "intro", text: "여기서 멈출게요." }] }) },
    "POST /api/checkpoints/a1/resume": { body: answering({ tutor: [{ type: "intro", text: "이어서 할게요." }, { type: "question", text: "Q2-다른 질문" }] }) },
  });
  await s.chat.refresh();
  await s.chat.resume(); // 멈추지 않은 시도: 요청 없이 오버레이만 연다
  let v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.equal(v.cpConfirmPause, false);

  v.onCpExit();
  v = s.vals();
  assert.equal(v.cpConfirmPause, true, "답하는 중 [나가기]는 확인창");
  assert.equal(v.cpConfirmPauseText, TEXT.pauseConfirm(false, 1, 3));
  v.onCpCancelPause();
  assert.equal(s.vals().cpConfirmPause, false, "[계속 풀기]는 확인창만 닫는다");
  assert.deepEqual(s.net.keys().filter((k) => k.includes("pause")), []);

  s.vals().onCpExit();
  await s.vals().onCpConfirmPause();
  v = s.vals();
  assert.equal(v.cpState, "paused");
  assert.equal(v.cpShowOverlay, false, "멈추면 오버레이를 닫는다");
  assert.equal(v.cpStageLabel, TEXT.stage.paused(1, 3));
  assert.equal(v.cpShowComposer, false);
  assert.equal(v.cpLearningLocked, false, "멈춘 동안에는 학습 채팅을 쓸 수 있다");
  const learning = learningVals();
  assert.equal(s.chat.lockLearning(learning), learning);
  assert.equal(s.chat.runLearning(() => "보냄"), "보냄");
  assert.equal(s.vals().cpShowResumeBanner, true);
  assert.equal(s.chat.sectionBadge("ironmaking").cpSectionStartLabel, TEXT.buttons.resumeShort);

  await s.vals().onCpResume();
  v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.equal(v.cpState, "awaiting_answer");
  assert.deepEqual(v.cpMessages.map((m: Json) => m.text), ["Q2", "여기서 멈출게요.", "이어서 할게요.", "Q2-다른 질문"]);
  assert.equal(v.cpLearningLocked, true);
  assert.deepEqual(s.net.keys().slice(-2), ["POST /api/checkpoints/a1/pause", "POST /api/checkpoints/a1/resume"]);
});

test("이어 풀기: 재확인 대기 중 확인창은 판정이 저장되고 다른 재확인 질문으로 묻는다고 안내한다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: view("awaiting_recheck", { concept: concept(1), progress: progressList(["current", "pending", "pending"]), history: [] }) },
  });
  await s.chat.refresh();
  s.vals().onCpExit();
  assert.equal(s.vals().cpConfirmPauseText, TEXT.pauseConfirm(true, 0, 3));
});

test("이어 풀기: 로그인·새로고침 때 멈춘 시도는 튜터 패널에 [이어 풀기] 안내만 띄우고, 누르면 오버레이에서 이어 푼다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1", in_progress: { attempt_id: "a1", state: "paused", done: 1, total: 3 } }),
    ...otherSections,
    "GET /api/checkpoints/a1": { body: pausedView({ history: [{ role: "tutor", type: "intro", text: "여기서 멈출게요." }] }) },
    "POST /api/checkpoints/a1/resume": { body: answering({ tutor: [{ type: "question", text: "새 질문" }] }) },
  });
  await s.chat.refreshAll();
  let v = s.vals();
  assert.equal(v.cpShowOverlay, false);
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpShowResumeBanner, true);
  assert.equal(v.cpResumeBannerText, "풀던 이해도 확인이 있어요 · 제선 1/3 완료");
  assert.equal(v.cpResumeBannerLabel, TEXT.buttons.resumeShort);
  assert.deepEqual(s.net.keys().filter((k) => k.startsWith("POST")), [], "불러올 때는 이어 풀지 않는다");

  await v.onCpResume();
  v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.equal(v.cpState, "awaiting_answer");
  assert.equal(v.cpShowResumeBanner, false);
});

test("이어 풀기: 멈추지 않은 시도를 다시 열면 [이어 풀기]는 요청 없이 오버레이만 연다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: answering({ history: [] }) },
  });
  await s.chat.refresh();
  await s.vals().onCpResume();
  assert.equal(s.vals().cpShowOverlay, true);
  assert.deepEqual(s.net.keys(), ["GET /api/sections/ironmaking/progress", "GET /api/checkpoints/a1"]);
});

test("멈추고 질문하기: 답하는 중 학습 질문은 들고 있다가, 누르면 멈춘 뒤 그 질문을 보낸다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: answering({ history: [] }) },
    "POST /api/checkpoints/a1/pause": [
      { status: 409, body: { error: "이전 요청을 처리하는 중입니다." } },
      { body: pausedView({ tutor: [{ type: "intro", text: "여기서 멈출게요." }] }) },
    ],
  });
  await s.chat.refresh();
  const sent: string[] = [];
  assert.equal(s.chat.runLearning(() => sent.push("고로가 뭐예요?")), undefined);
  assert.deepEqual(sent, []);
  assert.equal(s.vals().cpShowPauseOffer, true);

  await s.vals().onCpPauseForLearning(); // 멈추기 실패(409): 질문을 보내지 않고 안내를 남긴다
  assert.deepEqual(sent, []);
  assert.equal(s.vals().cpShowPauseOffer, true);
  assert.equal(s.vals().cpNotice, "이전 요청을 처리하는 중입니다.");

  await s.vals().onCpPauseForLearning();
  const v = s.vals();
  assert.deepEqual(sent, ["고로가 뭐예요?"], "멈춘 뒤 들고 있던 질문을 한 번 보낸다");
  assert.equal(v.cpState, "paused");
  assert.equal(v.cpShowOverlay, false);
  assert.equal(v.cpShowPauseOffer, false);
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpShowResumeBanner, true);
});

test("학습 입력창 전송(lockLearning의 send)도 답하는 중에는 [멈추고 질문하기]를 띄우고, 이어 풀면 안내를 접는다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/checkpoints/a1": { body: answering({ history: [] }) },
  });
  await s.chat.refresh();
  assert.equal(s.vals().cpShowPauseOffer, false);
  s.chat.lockLearning(learningVals()).send({ preventDefault() {} });
  assert.equal(s.vals().cpShowPauseOffer, true);
  await s.chat.resume();
  assert.equal(s.vals().cpShowPauseOffer, false, "오버레이로 돌아가면 안내를 접는다");
});

// ---- 이해도 확인 오버레이(docs/checkpoint-overlay.md) ----

test("캐릭터 동작 이름표: 발화 type → 동작, result는 통과 여부로 나뉘고 모르는 type은 idle", () => {
  assert.deepEqual(
    ["intro", "question", "recheck_question", "feedback", "explanation", "key_points", "error"].map((t) => motionFor(t)),
    ["greet", "ask", "ask_again", "praise", "explain", "encourage", "sorry"],
  );
  assert.equal(motionFor("result", { unlocked: true }), "celebrate");
  assert.equal(motionFor("result", { unlocked: false }), "cheer_retry");
  assert.equal(motionFor("result"), "cheer_retry");
  assert.equal(motionFor("unknown"), "idle");
  assert.equal(motionFor(undefined), "idle");
  assert.equal(Object.keys(MOTION_BY_TYPE).length, 7);
});

/** 오버레이 테스트용 페이지: goProcess·openTutor 훅을 기록한다. */
function withHooks(s: ReturnType<typeof setup>) {
  const hooks = { gone: [] as string[], tutorOpened: 0 };
  Object.assign(s.page, {
    goProcess: (id: string) => { hooks.gone.push(id); s.page.setState({ processId: id }); },
    openTutor: () => { hooks.tutorOpened++; },
  });
  return hooks;
}

test("오버레이: 섹션 버튼으로 시작 → 말풍선이 이번 응답의 발화를 차례로 보여 주고 동작이 바뀐다 → 결과 → 나가기", async () => {
  let duringStart: Json | null = null;
  let duringAnswer: Json | null = null;
  const s = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking"), progress("ironmaking", { unlocked: true, understanding: 1 })],
    ...otherSections,
    "POST /api/checkpoints": () => {
      duringStart = s.vals();
      return { status: 201, body: view("awaiting_ready", { tutor: [{ type: "intro", text: "제선 질문 시작할게요, 준비됐나요?" }] }) };
    },
    "POST /api/checkpoints/a1/messages": [
      { body: view("awaiting_answer", { concept: concept(1), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "question", text: "Q1" }] }) },
      () => {
        duringAnswer = s.vals();
        return { body: view("awaiting_recheck", { concept: concept(1), progress: progressList(["current", "pending", "pending"]), tutor: [{ type: "explanation", text: "설명" }, { type: "recheck_question", text: "R1" }] }) };
      },
      { body: view("completed", {
        progress: progressList(["done", "done", "done"]),
        tutor: [{ type: "feedback", text: "맞아요, 이번에는 정확해요." }, { type: "result", text: "결과" }],
        result: { understanding: 1, unlocked: true, threshold: 0.8, retry_concept_ids: [], concepts: [] },
      }) },
    ],
  }, { processId: "site" });
  const hooks = withHooks(s);

  await s.chat.refreshAll();
  let b = s.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.notStarted);
  assert.equal(b.cpSectionShowStart, true);
  assert.equal(b.cpSectionCanStart, true);
  assert.equal(b.cpSectionStartLabel, TEXT.buttons.startQuench);
  assert.equal(b.cpSectionHasResume, false);
  const steel = s.chat.sectionBadge("steelmaking");
  assert.equal(steel.cpSectionStatus, TEXT.entry.notReady);
  assert.equal(steel.cpSectionShowStart, false, "준비 중인 공정은 버튼 없이 상태 문구만");
  assert.equal(s.vals().cpShowOverlay, false);

  await b.onCpSectionStart();
  assert.equal(duringStart!.cpShowOverlay, true, "시작 요청 중에도 오버레이를 연다");
  assert.equal(duringStart!.cpCharacterMotion, "thinking");
  assert.deepEqual(hooks.gone, ["ironmaking"], "전체 보기에서 누르면 그 공정으로 옮긴다");
  assert.deepEqual(s.net.calls.find((c) => c.key === "POST /api/checkpoints")?.body, { section: "ironmaking" });
  let v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.equal(v.cpBubbleText, "제선 질문 시작할게요, 준비됐나요?");
  assert.equal(v.cpBubbleLabel, TEXT.messageLabels.intro);
  assert.equal(v.cpCharacterMotion, "greet");
  assert.equal(v.cpBubbleHasNext, false);
  assert.equal(v.cpCanAnswer, true);
  assert.equal(v.cpLearningLocked, true, "답하는 중에는 학습을 잠근다");
  b = s.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.inProgress, "시작한 시도를 진입 상태보다 먼저 본다");
  assert.equal(b.cpSectionStartLabel, TEXT.buttons.resumeShort);
  assert.equal(b.cpSectionHasResume, false, "오버레이가 열려 있으면 이어 풀기 안내를 숨긴다");

  await s.chat.ready();
  v = s.vals();
  assert.equal(v.cpBubbleText, "Q1");
  assert.equal(v.cpCharacterMotion, "ask");

  await s.chat.send("답");
  assert.equal(duringAnswer!.cpCharacterMotion, "thinking");
  assert.equal(duringAnswer!.cpCanAnswer, false);
  v = s.vals();
  assert.equal(v.cpBubbleText, "설명");
  assert.equal(v.cpCharacterMotion, "explain");
  assert.equal(v.cpBubbleHasNext, true);
  assert.equal(v.cpCanAnswer, false, "질문까지 보기 전에는 답할 수 없다");
  assert.equal(v.cpOverlayInputDisabled, true);
  v.onCpBubbleNext();
  v = s.vals();
  assert.equal(v.cpBubbleText, "R1");
  assert.equal(v.cpCharacterMotion, "ask_again");
  assert.equal(v.cpBubbleColor, "var(--warn, #e8590c)");
  assert.equal(v.cpBubbleHasNext, false);
  assert.equal(v.cpCanAnswer, true);
  v.onCpBubbleNext();
  assert.equal(s.vals().cpBubbleText, "R1", "마지막 발화에서 [다음]은 그대로");

  await s.chat.send("다시 답");
  v = s.vals();
  assert.equal(v.cpCharacterMotion, "praise");
  v.onCpBubbleNext();
  v = s.vals();
  assert.equal(v.cpBubbleText, "결과");
  assert.equal(v.cpCharacterMotion, "celebrate");
  assert.equal(v.cpCanAnswer, false);
  assert.equal(v.cpShowResult, true);
  assert.equal(v.cpLearningLocked, false);
  assert.equal(v.cpShowHistory, false);
  v.onCpToggleHistory();
  assert.equal(s.vals().cpShowHistory, true);
  assert.equal(s.vals().cpHistoryLabel, TEXT.buttons.hideHistory);
  b = s.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionPassed, true);
  assert.equal(b.cpSectionShowStart, false, "통과한 공정은 버튼을 숨긴다");

  s.vals().onCpExit();
  v = s.vals();
  assert.equal(v.cpShowOverlay, false);
  assert.equal(v.cpState, null, "끝난 시도에서 나가면 결과를 닫는다");
  assert.equal(v.cpBubbleText, "");
});

test("오버레이: 새로고침 복원은 열지 않고 마지막 응답을 말풍선에 둔다, [나가기]는 확인창 → 멈춤 → 닫기, 섹션 버튼으로 이어 푼다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    ...otherSections,
    "GET /api/checkpoints/a1": { body: answering({ history: [
      { role: "tutor", type: "question", text: "Q1" },
      { role: "user", type: null, text: "답" },
      { role: "tutor", type: "feedback", text: "맞아요." },
      { role: "tutor", type: "question", text: "Q2" },
    ] }) },
    "POST /api/checkpoints/a1/pause": { body: pausedView({ tutor: [{ type: "intro", text: "여기서 멈출게요." }] }) },
    "POST /api/checkpoints/a1/resume": { body: answering({ tutor: [{ type: "intro", text: "이어서 할게요." }, { type: "question", text: "Q2-다른 질문" }] }) },
  });
  await s.chat.refreshAll();
  let v = s.vals();
  assert.equal(v.cpShowOverlay, false, "로그인·새로고침 복원 때는 열지 않는다");
  assert.equal(v.cpLearningLocked, true);
  let b = s.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionHasResume, true);
  assert.equal(b.cpSectionResumeText, TEXT.resumeBanner("제선", 1, 3));
  assert.equal(b.cpSectionStartLabel, TEXT.buttons.resumeShort);

  await b.onCpSectionStart();
  v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.deepEqual(s.net.keys().filter((k) => k.startsWith("POST")), [], "멈추지 않은 시도는 요청 없이 열기만 한다");
  assert.equal(v.cpBubbleText, "맞아요.", "말풍선은 마지막 사용자 답 뒤의 발화부터");
  assert.equal(v.cpBubbleHasNext, true);
  v.onCpBubbleNext();
  assert.equal(s.vals().cpBubbleText, "Q2");

  s.vals().onCpExit();
  v = s.vals();
  assert.equal(v.cpConfirmPause, true, "답하는 중 [나가기]는 멈춤 확인창");
  assert.equal(v.cpShowOverlay, true);
  v.onCpCancelPause();
  assert.equal(s.vals().cpShowOverlay, true, "[계속 풀기]는 확인창만 닫는다");
  s.vals().onCpExit();
  await s.vals().onCpConfirmPause();
  v = s.vals();
  assert.equal(v.cpState, "paused");
  assert.equal(v.cpShowOverlay, false, "멈추면 오버레이를 닫는다");
  assert.equal(v.cpLearningLocked, false);
  b = s.chat.sectionBadge("ironmaking");
  assert.equal(b.cpSectionStatus, TEXT.entry.paused(1, 3));
  assert.equal(b.cpSectionHasResume, true);

  await b.onCpSectionStart();
  v = s.vals();
  assert.equal(v.cpShowOverlay, true);
  assert.equal(v.cpBubbleText, "이어서 할게요.");
  assert.equal(v.cpCharacterMotion, "greet");
  v.onCpBubbleNext();
  assert.equal(s.vals().cpCharacterMotion, "ask");
  assert.deepEqual(s.net.keys().filter((k) => k.startsWith("POST")), ["POST /api/checkpoints/a1/pause", "POST /api/checkpoints/a1/resume"]);
});

test("오버레이: 시작했더니 멈춘 시도를 받으면 이어 풀고, 시작 실패면 닫는다, 다른 섹션의 풀던 시도가 있으면 시작 버튼을 막는다", async () => {
  const resumed = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1", in_progress: { attempt_id: "a1", state: "paused", done: 1, total: 3 } }),
    ...otherSections,
    "GET /api/checkpoints/a1": { status: 500, body: {} },
    "POST /api/checkpoints": { body: pausedView({ history: [{ role: "tutor", type: "question", text: "Q2" }] }) },
    "POST /api/checkpoints/a1/resume": { body: answering({ tutor: [{ type: "intro", text: "이어서 할게요." }, { type: "question", text: "Q2-다른 질문" }] }) },
  });
  await resumed.chat.refreshAll(); // 시도를 불러오지 못해 열린 시도가 없다
  assert.equal(resumed.vals().cpState, null);
  await resumed.chat.sectionBadge("ironmaking").onCpSectionStart();
  assert.deepEqual(resumed.net.keys().filter((k) => k.startsWith("POST")), ["POST /api/checkpoints", "POST /api/checkpoints/a1/resume"]);
  assert.equal(resumed.vals().cpState, "awaiting_answer");
  assert.equal(resumed.vals().cpShowOverlay, true);

  const failed = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking"),
    ...otherSections,
    "POST /api/checkpoints": { status: 403, body: { error: "앞 섹션을 먼저 통과해야 합니다." } },
  });
  await failed.chat.refreshAll();
  await failed.chat.sectionBadge("ironmaking").onCpSectionStart();
  assert.equal(failed.vals().cpShowOverlay, false);
  assert.equal(failed.vals().cpNotice, "앞 섹션을 먼저 통과해야 합니다.");

  const blocked = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    "GET /api/sections/steelmaking/progress": progress("steelmaking"),
    "GET /api/sections/continuous_casting/progress": notFound,
    "GET /api/sections/rolling/progress": notFound,
    "GET /api/checkpoints/a1": { body: answering({ history: [] }) },
  });
  await blocked.chat.refreshAll();
  const steel = blocked.chat.sectionBadge("steelmaking");
  assert.equal(steel.cpSectionShowStart, true);
  assert.equal(steel.cpSectionCanStart, false);
  assert.equal(steel.cpSectionStartOpacity, ".45");
  await steel.onCpSectionStart();
  assert.deepEqual(blocked.net.keys().filter((k) => k.startsWith("POST")), []);
});

test("오버레이: [멈추고 질문하기]는 멈추고 오버레이를 닫은 뒤 튜터 패널을 연다(openTutor)", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking", { in_progress_attempt_id: "a1" }),
    ...otherSections,
    "GET /api/checkpoints/a1": { body: answering({ history: [{ role: "tutor", type: "question", text: "Q2" }] }) },
    "POST /api/checkpoints/a1/pause": { body: pausedView({ tutor: [{ type: "intro", text: "여기서 멈출게요." }] }) },
  });
  const hooks = withHooks(s);
  await s.chat.refreshAll();
  await s.chat.resume();
  assert.equal(s.vals().cpShowOverlay, true);
  const sent: string[] = [];
  s.chat.runLearning(() => sent.push("고로가 뭐예요?"));
  await s.vals().onCpPauseForLearning();
  const v = s.vals();
  assert.equal(v.cpShowOverlay, false);
  assert.equal(hooks.tutorOpened, 1);
  assert.deepEqual(sent, ["고로가 뭐예요?"]);
});

test("v3 오버레이: 잠긴 공정은 비활성 버튼과 '이전 공정 통과 필요', 준비·결과는 마지막 말풍선을 본 뒤에 보인다", async () => {
  let s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking"),
    "GET /api/sections/steelmaking/progress": progress("steelmaking", { open: false }),
    "GET /api/sections/continuous_casting/progress": notFound,
    "GET /api/sections/rolling/progress": notFound,
  });
  await s.chat.refreshAll();
  const locked = s.chat.sectionBadge("steelmaking");
  assert.equal(locked.cpSectionLocked, true);
  assert.equal(locked.cpSectionStatus, TEXT.sectionLocked);
  assert.equal(locked.cpSectionShowStart, true, "잠긴 공정도 버튼은 보인다");
  assert.equal(locked.cpSectionCanStart, false);
  assert.equal(locked.cpSectionCursor, "not-allowed");
  assert.equal(locked.cpSectionStatusColor, "var(--warn, #e8590c)");
  const open = s.chat.sectionBadge("ironmaking");
  assert.equal(open.cpSectionLocked, false);
  assert.equal(open.cpSectionCursor, "pointer");
  assert.equal(s.chat.sectionBadge("rolling").cpSectionLocked, false, "준비 중(404)은 잠김이 아니다");

  s = setup({
    "GET /api/sections/ironmaking/progress": [progress("ironmaking"), progress("ironmaking", { unlocked: true, understanding: 1 })],
    ...otherSections,
    "POST /api/checkpoints": { status: 201, body: view("awaiting_ready", { tutor: [{ type: "intro", text: "이어서 할게요." }, { type: "intro", text: "제선 질문 시작할게요, 준비됐나요?" }] }) },
    "POST /api/checkpoints/a1/messages": { body: view("completed", {
      progress: progressList(["done", "done", "done"]),
      tutor: [{ type: "feedback", text: "맞아요." }, { type: "result", text: "결과" }],
      result: { understanding: 1, unlocked: true, threshold: 0.8, retry_concept_ids: [], concepts: [] },
    }) },
  });
  await s.chat.refreshAll();
  await s.chat.sectionBadge("ironmaking").onCpSectionStart();
  let v = s.vals();
  assert.equal(v.cpOverlayShowReady, false, "인사를 다 보기 전에는 '준비됐어요'를 숨긴다");
  assert.equal(v.cpOverlayPlaceholder, TEXT.placeholder.readNext);
  assert.equal(v.cpOverlayInputOpacity, ".5");
  v.onCpBubbleNext();
  v = s.vals();
  assert.equal(v.cpOverlayShowReady, true);
  assert.equal(v.cpOverlayPlaceholder, TEXT.placeholder.ready);
  assert.equal(v.cpOverlayInputOpacity, "1");

  await s.chat.ready();
  v = s.vals();
  assert.equal(v.cpShowResult, true);
  assert.equal(v.cpOverlayShowResult, false, "결과 발화 전(feedback)에는 결과를 숨긴다");
  assert.equal(v.cpCharacterMotion, "praise");
  v.onCpBubbleNext();
  v = s.vals();
  assert.equal(v.cpOverlayShowResult, true);
  assert.equal(v.cpCharacterMotion, "celebrate");
});

test("오버레이 잠금 값: 오버레이가 떠 있는 동안만 공정 메뉴·하단 바를 흐리게 하고 누를 수 없게 한다", async () => {
  const s = setup({
    "GET /api/sections/ironmaking/progress": progress("ironmaking"),
    ...otherSections,
    "POST /api/checkpoints": { status: 201, body: view("awaiting_ready", { tutor: [{ type: "intro", text: "시작" }] }) },
  });
  await s.chat.refreshAll();
  let v = s.vals();
  assert.deepEqual([v.cpOverlayLockPointer, v.cpOverlayLockOpacity, v.cpOverlayLockFilter], ["auto", "1", "none"]);
  await s.chat.sectionBadge("ironmaking").onCpSectionStart();
  v = s.vals();
  assert.deepEqual([v.cpOverlayLockPointer, v.cpOverlayLockOpacity, v.cpOverlayLockFilter], ["none", ".4", "grayscale(1)"]);
  assert.equal(v.cpOverlayLockNotice, TEXT.overlayLocked);
  assert.equal(v.cpShowResumeBanner, false, "오버레이에서 풀고 있으면 튜터 패널의 [이어 풀기] 배너를 숨긴다");
});
