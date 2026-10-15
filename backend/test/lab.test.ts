// 학습 랩(backend/src/lab/): 간격 반복(SM-2), 주간 리그, xAPI 문장, 세션 리플레이, 소크라테스 모드.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { signToken } from "../src/auth/tokens.js";
import { UserRepository, type User } from "../src/auth/users.js";
import { openDatabase } from "../src/db/database.js";
import { deleteUserData } from "../src/db/user-data.js";
import { buildDeck, type DeckCard } from "../src/lab/deck.js";
import { computeLeague, maskName, weekStart } from "../src/lab/league.js";
import { createLabRouter } from "../src/lab/routes.js";
import { coverage, offlineReply, openingQuestion } from "../src/lab/socratic.js";
import { nextReview, NEW_PER_DAY } from "../src/lab/spaced.js";
import { actorOf, statementFor } from "../src/lab/xapi.js";
import type { CardEvent } from "../src/me/employee-card.js";

const NOW = new Date("2026-10-15T03:00:00Z"); // 목요일, 한국 시간 12:00
const deck: DeckCard[] = buildDeck(
  [
    { id: "ironmaking", name: "제선", equipment: [
      { id: "sinter_plant", name: "소결기", role: "가루 철광석을 구워 덩어리(소결광)로 만듭니다." },
      { id: "coke_oven", name: "코크스 오븐", role: "석탄을 공기 없이 구워 코크스로 만듭니다." },
      { id: "blast_furnace", name: "고로", role: "원료를 위에서 넣고 열풍으로 철광석을 환원·용융해 용선을 만듭니다." },
    ] },
    { id: "rolling", name: "열간압연", equipment: [
      { id: "reheating_furnace", name: "재가열로", role: "슬래브를 압연할 수 있는 온도로 고르게 데웁니다." },
      { id: "roughing_mill", name: "조압연기", role: "슬래브 두께를 크게 줄입니다." },
      { id: "finishing_mill", name: "사상압연기", role: "목표 두께로 얇게 폅니다." },
    ] },
    { id: "not_a_section", name: "기타", equipment: [{ id: "x", name: "x" }] },
  ],
  (s) => (s === "ironmaking" ? [{ id: "m1", section: "ironmaking", title: "메모", text: "소결기는 가루 원료를 덩어리로 만든다.", source_ids: [], tags: ["sinter_plant"] }] : []) as never,
);

test("카드 묶음: 섹션이 아닌 공정은 빼고, 설비 메모는 그 설비 태그 조각", () => {
  assert.equal(deck.length, 6);
  assert.equal(deck[0].card_id, "eq:sinter_plant");
  assert.equal(deck[0].memo?.text, "소결기는 가루 원료를 덩어리로 만든다.");
  assert.equal(deck[1].memo, null);
});

test("SM-2: 1일 → 6일 → 간격×쉬움, '다시'는 오늘 다시·실수 횟수 +1, 쉬움 정도는 1.3 아래로 안 내려간다", () => {
  const a = nextReview(null, 4, "2026-10-15");
  assert.deepEqual([a.interval_days, a.due_date, a.reps], [1, "2026-10-16", 1]);
  const b = nextReview(a, 4, "2026-10-16");
  assert.deepEqual([b.interval_days, b.due_date], [6, "2026-10-22"]);
  const c = nextReview(b, 4, "2026-10-22");
  assert.equal(c.interval_days, Math.round(6 * c.ease));
  const lapse = nextReview(c, 0, "2026-11-07");
  assert.deepEqual([lapse.interval_days, lapse.due_date, lapse.reps, lapse.lapses], [0, "2026-11-07", 0, 1]);
  let s = lapse;
  for (let i = 0; i < 10; i++) s = nextReview(s, 0, "2026-11-07");
  assert.equal(s.ease, 1.3);
  assert.ok(nextReview(b, 5, "2026-10-22").interval_days > nextReview(b, 3, "2026-10-22").interval_days);
});

test("주간 리그: 주는 월요일 시작, 이름은 가운데를 가린다", () => {
  assert.equal(weekStart("2026-10-15"), "2026-10-12");
  assert.equal(weekStart("2026-10-12"), "2026-10-12");
  assert.equal(weekStart("2026-10-18"), "2026-10-12");
  assert.equal(maskName("정다은"), "정*은");
  assert.equal(maskName("김철"), "김*");
  assert.equal(maskName("남궁민수"), "남**수");
});

test("주간 리그: 지난 주 위쪽은 승급, 이번 주는 같은 리그끼리 겨루고 승급 구역까지 필요한 XP를 준다", () => {
  const members = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ id, name: `학습자${i}` }));
  const q = (day: string, n: number): CardEvent[] => Array.from({ length: n }, (_, i) => ({ kind: "question", at: `${day}T01:${String(i).padStart(2, "0")}:00Z`, section: "ironmaking" }));
  const events: Record<string, CardEvent[]> = {
    a: [...q("2026-10-06", 5), ...q("2026-10-13", 1)], // 지난 주 1등 → 실버
    b: [...q("2026-10-06", 3), ...q("2026-10-14", 4)],
    c: [...q("2026-10-06", 1), ...q("2026-10-14", 2)],
    d: q("2026-10-14", 3), e: [], f: [],
  };
  const view = computeLeague(members, (id) => events[id], "b", NOW);
  assert.equal(view.week.start, "2026-10-12");
  assert.equal(view.week.end, "2026-10-18");
  assert.equal(view.week.ends_at, "2026-10-18T15:00:00.000Z");
  assert.equal(view.league.name, "브론즈"); // 6명 중 승급은 1명(a)
  assert.equal(view.history.at(-1)?.result, "stay");
  assert.ok(!view.board.some((r) => r.name === "학습자0"), "a는 실버로 올라가 다른 리그");
  assert.deepEqual(view.board.map((r) => [r.name, r.xp, r.zone]), [["학습자1", 40, "promote"], ["학**3", 30, "stay"], ["학**2", 20, "stay"], ["학**4", 0, "stay"], ["학**5", 0, "stay"]]);
  assert.deepEqual(view.me, { rank: 1, xp: 40, zone: "promote", to_promote: null });
  const aView = computeLeague(members, (id) => events[id], "a", NOW);
  assert.equal(aView.league.name, "실버");
  assert.equal(aView.history.at(-1)?.result, "up");
  const dView = computeLeague(members, (id) => events[id], "d", NOW);
  assert.equal(dView.me?.to_promote, 11);
});

test("xAPI: 기록 종류별 동사·대상·결과, 같은 기록은 같은 id", () => {
  const actor = actorOf({ name: "김신입", username: "trainee01" });
  const names = { equipment: (id: string) => ({ blast_furnace: "고로" } as Record<string, string>)[id], concept: () => "소결의 목적" };
  const ask = statementFor({ kind: "question", at: "2026-10-15T01:00:00Z", section: "ironmaking", object_id: "blast_furnace" }, actor, names)!;
  assert.equal(ask.verb.id, "http://adlnet.gov/expapi/verbs/asked");
  assert.equal(ask.object.definition.name["ko-KR"], "고로");
  assert.match(ask.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(statementFor({ kind: "question", at: "2026-10-15T01:00:00Z", section: "ironmaking", object_id: "blast_furnace" }, actor, names)!.id, ask.id);
  const done = statementFor({ kind: "checkpoint_done", at: "2026-10-15T01:00:00Z", section: "ironmaking", understanding: 0.8333333 }, actor, names)!;
  assert.deepEqual(done.result, { completion: true, score: { scaled: 0.833 } });
  const partial = statementFor({ kind: "concept_partial", at: "2026-10-15T01:00:00Z", section: "ironmaking", object_id: "sinter_purpose" }, actor, names)!;
  assert.deepEqual([partial.verb.display["ko-KR"], partial.object.definition.name["ko-KR"], partial.result?.score?.scaled], ["답함", "소결의 목적", 0.5]);
  assert.equal(statementFor({ kind: "sr_review", at: "2026-10-15T01:00:00Z", object_id: "eq:blast_furnace", grade: 0 }, actor, names)!.result?.success, false);
});

test("소크라테스(오프라인): 첫 질문, 핵심을 말하면 닿음, 아니면 힌트 단계가 오른다", () => {
  const card = deck[0];
  assert.match(openingQuestion(card), /^소결기를 처음 본다고/);
  assert.match(openingQuestion(deck[2]), /^고로를/);
  assert.ok(coverage("가루 철광석을 구워서 덩어리로 만들어요", card.role) >= 0.35);
  const hit = offlineReply(card, "가루 철광석을 구워서 덩어리로 만들어요", 0);
  assert.equal(hit.understood, true);
  const miss = offlineReply(card, "잘 모르겠어요", 0);
  assert.deepEqual([miss.understood, miss.hint_level], [false, 1]);
  assert.equal(offlineReply(card, "모름", 3).hint_level, 3);
});

// ── HTTP ──
const secret = new TextEncoder().encode("lab-test-secret-lab-test-secret-lab-test");
const db = openDatabase(":memory:");
let server: ReturnType<express.Express["listen"]>;
let base = "";
let kim: User;
let lee: User;
let clock = new Date(NOW);

before(async () => {
  const users = new UserRepository(db);
  kim = await users.create({ username: "trainee01", password: "password123", name: "김신입", employee_no: "T1" });
  lee = await users.create({ username: "trainee02", password: "password123", name: "이신입", employee_no: "T2" });
  const app = express();
  app.use(createLabRouter({ db, auth: { users, secret }, deck, llm: null, now: () => clock }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const call = async (method: string, path: string, user?: User, body?: unknown) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (user) headers.authorization = `Bearer ${await signToken(user, secret)}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
};

test("HTTP 간격 반복: 새 카드는 하루 상한까지, 복습하면 내일로 밀리고 '다시'는 오늘 줄에 남는다", async () => {
  assert.equal((await call("GET", "/api/me/lab/review")).status, 401);
  const first = await call("GET", "/api/me/lab/review", kim);
  assert.equal(first.json.queue.length, NEW_PER_DAY);
  assert.ok(first.json.queue.every((c: any) => c.is_new));
  assert.deepEqual(first.json.queue[0].options.map((o: any) => o.after), ["오늘 다시", "내일", "내일", "2일 뒤"]);
  const r1 = await call("POST", "/api/me/lab/review/eq:sinter_plant", kim, { grade: 4 });
  assert.equal(r1.json.state.due_date, "2026-10-16");
  assert.equal(r1.json.review.queue.length, NEW_PER_DAY - 1); // 오늘 새 카드 1장을 썼다
  const r2 = await call("POST", "/api/me/lab/review/eq:coke_oven", kim, { grade: 0 });
  assert.equal(r2.json.review.queue[0].card_id, "eq:coke_oven");
  assert.equal(r2.json.review.stats.reviewed_today, 2);
  assert.equal(r2.json.review.stats.retention_30d, 0.5);
  assert.equal((await call("POST", "/api/me/lab/review/eq:nope", kim, { grade: 4 })).status, 404);
  assert.equal((await call("POST", "/api/me/lab/review/eq:sinter_plant", kim, { grade: 2 })).status, 400);
  // 다른 사람 상태와 섞이지 않는다
  assert.equal((await call("GET", "/api/me/lab/review", lee)).json.stats.learned, 0);
});

test("HTTP 리플레이: 본인 세션만 쓰고 읽고 지운다, 형식이 틀리면 400", async () => {
  const { json: { id } } = await call("POST", "/api/me/lab/replays", kim);
  assert.equal((await call("GET", "/api/me/lab/replays", kim)).json.sessions.length, 0, "이벤트 없는 세션은 목록에 없다");
  const add = await call("POST", `/api/me/lab/replays/${id}/events`, kim, { events: [{ t: 0, type: "start", data: { tab: "steps" } }, { t: 1200, type: "select", data: { process: "ironmaking", equipment: "blast_furnace" } }] });
  assert.equal(add.json.added, 2);
  assert.equal((await call("POST", `/api/me/lab/replays/${id}/events`, lee, { events: [{ t: 1, type: "tab", data: {} }] })).status, 404);
  assert.equal((await call("POST", `/api/me/lab/replays/${id}/events`, kim, { events: [{ t: 1, type: "keylog", data: {} }] })).status, 400);
  const got = await call("GET", `/api/me/lab/replays/${id}`, kim);
  assert.deepEqual(got.json.events.map((e: any) => [e.seq, e.type]), [[1, "start"], [2, "select"]]);
  assert.equal((await call("GET", `/api/me/lab/replays/${id}`, lee)).status, 404);
  assert.equal((await call("DELETE", `/api/me/lab/replays/${id}`, kim)).status, 200);
  assert.equal((await call("GET", `/api/me/lab/replays/${id}`, kim)).status, 404);
});

test("HTTP 소크라테스(LLM 없음): 시작 → 힌트 → 닿음 → 정답 보기, 본 뒤에는 더 답할 수 없다", async () => {
  const start = await call("POST", "/api/me/lab/socratic", kim, { equipment_id: "sinter_plant" });
  assert.equal(start.status, 201);
  assert.equal(start.json.turns.length, 1);
  const id = start.json.session.id;
  const miss = await call("POST", `/api/me/lab/socratic/${id}/turns`, kim, { text: "잘 모르겠어요" });
  assert.deepEqual([miss.json.mode, miss.json.understood, miss.json.session.hint_level, miss.json.session.state], ["offline", false, 1, "active"]);
  const hit = await call("POST", `/api/me/lab/socratic/${id}/turns`, kim, { text: "가루 철광석을 구워서 덩어리로 만들어요" });
  assert.deepEqual([hit.json.understood, hit.json.just_reached, hit.json.session.state], [true, true, "reached"]);
  assert.equal((await call("GET", `/api/me/lab/socratic/${id}`, lee)).status, 404);
  const other = await call("POST", "/api/me/lab/socratic", kim, { equipment_id: "coke_oven" });
  const reveal = await call("POST", `/api/me/lab/socratic/${other.json.session.id}/reveal`, kim);
  assert.equal(reveal.json.session.state, "revealed");
  assert.match(reveal.json.turns.at(-1).text, /석탄을 공기 없이/);
  assert.equal((await call("POST", `/api/me/lab/socratic/${other.json.session.id}/turns`, kim, { text: "다시" })).status, 409);
  const list = await call("GET", "/api/me/lab/socratic", kim);
  assert.equal(list.json.sessions.length, 2);
  assert.equal(list.json.llm, false);
});

test("HTTP xAPI: 복습·소크라테스·화면 문장이 모두 문장이 되고 동사로 거른다, 내려받기는 첨부 파일", async () => {
  const sent = await call("POST", "/api/me/lab/xapi", kim, { verb: "experienced", object_id: "blast_furnace" });
  assert.equal(sent.status, 201);
  assert.equal(sent.headers.get("x-experience-api-version"), "1.0.3");
  assert.equal(sent.json.object.definition.name["ko-KR"], "고로");
  assert.equal((await call("POST", "/api/me/lab/xapi", kim, { verb: "experienced", object_id: "nope" })).status, 404);
  const all = await call("GET", "/api/me/lab/xapi", kim);
  assert.equal(all.json.counts.reviewed, 2);
  assert.equal(all.json.counts.mastered, 1);
  assert.equal(all.json.counts.experienced, 1);
  assert.ok(all.json.statements.every((s: any) => s.actor.account.name === "trainee01"));
  const only = await call("GET", "/api/me/lab/xapi?verb=reviewed", kim);
  assert.equal(only.json.statements.length, 2);
  const exp = await fetch(`${base}/api/me/lab/xapi/export`, { headers: { authorization: `Bearer ${await signToken(kim, secret)}` } });
  assert.match(exp.headers.get("content-disposition") ?? "", /attachment; filename="st-rookie-xapi-trainee01-2026-10-15.json"/);
  assert.equal((await exp.json()).length, all.json.total);
  assert.equal((await call("GET", "/api/me/lab/xapi", lee)).json.total, 0);
});

test("HTTP 리그: 이번 주 XP(복습 5·소크라테스 25)로 순위, 나는 실명·다른 사람은 가린 이름", async () => {
  const { json } = await call("GET", "/api/me/lab/league", kim);
  assert.equal(json.league.name, "브론즈");
  const mine = json.board.find((r: any) => r.me);
  assert.deepEqual([mine.name, mine.xp], ["김신입", 2 * 5 + 25]);
  assert.ok(json.board.some((r: any) => r.name === "이*입"));
});

test("사용자 기록 지우기에 학습 랩 기록도 들어간다(시연 기록만 지울 때는 빼고)", () => {
  assert.equal(deleteUserData(db, kim.id, { origin: "seed" }).learning_lab, 0);
  const n = deleteUserData(db, kim.id, { origin: "live" }).learning_lab;
  assert.ok(n > 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM sr_cards WHERE user_id = ?").get(kim.id)?.n), 0);
});
