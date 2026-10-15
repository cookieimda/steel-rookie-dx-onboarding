// 학습 랩 API(학습 기록 화면의 '학습 랩' 탭). 로그인한 본인 기록만 읽고 쓴다(사용자는 토큰으로만 정한다).
//   간격 반복  GET /api/me/lab/review, POST /api/me/lab/review/:cardId
//   주간 리그  GET /api/me/lab/league
//   xAPI 기록  GET /api/me/lab/xapi, POST /api/me/lab/xapi, GET /api/me/lab/xapi/export
//   리플레이   POST /api/me/lab/replays, POST /api/me/lab/replays/:id/events, GET /api/me/lab/replays(/:id), DELETE /api/me/lab/replays/:id
//   소크라테스 GET·POST /api/me/lab/socratic, GET /api/me/lab/socratic/:id, POST /api/me/lab/socratic/:id/turns·reveal
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { LlmClient } from "../../../llm/src/gemini.js";
import { requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { defaultDemoSections, defaultRubrics } from "../admin/trainee-stats.js";
import { statSections } from "../demo-sections.js";
import { kstDay } from "../me/employee-card.js";
import { MeRepository } from "../me/repository.js";
import type { DeckCard } from "./deck.js";
import { computeLeague } from "./league.js";
import { LabRepository } from "./repository.js";
import { eunNeun, openingQuestion, revealText, socraticReply, SUGGEST_REVEAL_AFTER } from "./socratic.js";
import { addDays, GRADES, MATURE_DAYS, NEW_PER_DAY, nextReview, type Grade, type SrState } from "./spaced.js";
import { actorOf, PRACTICE_KINDS, statementFor, storedStatement, XAPI_VERSION, type PracticeKind, type Statement, type VerbKey } from "./xapi.js";
import { NODES } from "./causal.js";
import { loadIncidents } from "./incidents.js";
import { loadLessons, type LessonDef } from "./lessons.js";

/** 수업 단계 이름(수업 열람 문장 이름). object_id는 "<수업 id>_<단계 번호>". */
let lessonCache: LessonDef[] | null = null;
const lessonStepTitle = (id: string) => {
  if (!lessonCache) { try { lessonCache = loadLessons(); } catch { lessonCache = []; } }
  // "<수업 id>_done": 수업을 끝까지 마침
  const done = /^([a-z0-9-]+)_done$/.exec(id);
  if (done) { const l = lessonCache.find((x) => x.id === done[1]); return l ? `${l.title} · 마침` : undefined; }
  const m = /^([a-z0-9-]+)_(\d{1,2})$/.exec(id);
  if (!m) return undefined;
  const l = lessonCache.find((x) => x.id === m[1]), s = l?.steps[Number(m[2]) - 1];
  return l && s ? `${l.title} · ${m[2]}/${l.steps.length} ${s.title}` : undefined;
};

/** 사고 사례 제목(3D 갈림길 문장 이름). 처음 쓸 때 한 번 읽는다. */
let incidentTitles: Map<string, string> | null = null;
const incidentTitle = (id: string) => {
  if (!incidentTitles) { try { incidentTitles = new Map(loadIncidents().scenarios.map((s) => [s.id, s.title])); } catch { incidentTitles = new Map(); } }
  return incidentTitles.get(id);
};

export interface LabDeps {
  db: DatabaseSync;
  auth: AuthDeps;
  deck: DeckCard[];
  /** 소크라테스 모드 LLM. 없으면 오프라인 튜터만 쓴다. */
  llm?: LlmClient | null;
  now?: () => Date;
}

/** 리플레이로 받는 화면 조작 종류. data는 짧은 값만(종류마다 문자열 몇 개). */
export const REPLAY_TYPES = ["start", "tab", "lab", "select", "ask", "answer", "theme", "card", "visible", "hidden"] as const;
const ReplayEvent = z.object({ t: z.number().min(0).max(24 * 3600_000), type: z.enum(REPLAY_TYPES), data: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null()])).optional() });
const ReplayBody = z.object({ events: z.array(ReplayEvent).min(1).max(200) });
const ReviewBody = z.object({ grade: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)]) });
const XapiBody = z.object({
  verb: z.literal("experienced"), object_id: z.string().regex(/^[a-z0-9_-]{1,60}$/),
  /** 3D 실습 살펴봄: 인과 따라가기·조건 링크(object_id = 인과 지도 변수), 사고 사례 갈림길 3D(object_id = 사례 id). 없으면 설비 살펴봄. */
  practice: z.enum(Object.keys(PRACTICE_KINDS) as [PracticeKind, ...PracticeKind[]]).optional(),
});
const SocraticStart = z.object({ equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/) });
const SocraticTurn = z.object({ text: z.string().trim().min(1).max(500) });

export function createLabRouter({ db, auth, deck, llm = null, now = () => new Date() }: LabDeps): express.Router {
  const router = express.Router();
  const repo = new LabRepository(db);
  const me = new MeRepository(db);
  const byCard = new Map(deck.map((c) => [c.card_id, c]));
  const byEquipment = new Map(deck.map((c) => [c.equipment_id, c]));
  const login = requireUser(auth);
  const userOf = (res: express.Response) => res.locals.user as User;
  const bad = (res: express.Response, error: string, code: string, status = 400) => res.status(status).json({ error, code });

  // ── 간격 반복 ──
  const intervalLabel = (days: number) => (days === 0 ? "오늘 다시" : days === 1 ? "내일" : days < 30 ? `${days}일 뒤` : `${Math.round(days / 30)}달 뒤`);
  const reviewView = (userId: string) => {
    const t = now(), today = kstDay(t);
    const todayStart = new Date(Date.parse(`${today}T00:00:00+09:00`)).toISOString();
    const states = new Map(repo.srCards(userId).map((s) => [s.card_id, s]));
    const introducedToday = [...states.values()].filter((s) => kstDay(s.created_at) === today).length;
    const newLeft = Math.max(0, NEW_PER_DAY - introducedToday);
    const due = deck.filter((c) => states.get(c.card_id) && states.get(c.card_id)!.due_date <= today)
      .sort((a, b) => states.get(a.card_id)!.due_date.localeCompare(states.get(b.card_id)!.due_date) || states.get(b.card_id)!.lapses - states.get(a.card_id)!.lapses);
    const fresh = deck.filter((c) => !states.has(c.card_id)).slice(0, newLeft);
    const cardView = (c: DeckCard) => {
      const s = states.get(c.card_id) ?? null;
      return { card_id: c.card_id, section: c.section, section_name: c.section_name, equipment_id: c.equipment_id, equipment_name: c.equipment_name,
        front: `${c.equipment_name}${eunNeun(c.equipment_name)} 어떤 일을 하나요?`, back: { role: c.role, memo: c.memo }, is_new: !s,
        state: s && { reps: s.reps, interval_days: s.interval_days, due_date: s.due_date, lapses: s.lapses, ease: s.ease },
        options: GRADES.map((g) => ({ grade: g, after: intervalLabel(nextReview(s, g, today).interval_days) })) };
    };
    const reviews30 = repo.srReviews(userId, new Date(t.getTime() - 30 * 86_400_000).toISOString());
    const reviewedToday = reviews30.filter((r) => r.reviewed_at >= todayStart).length;
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      return { date, count: [...states.values()].filter((s) => (i === 0 ? s.due_date <= date : s.due_date === date)).length };
    });
    return {
      today,
      queue: [...due, ...fresh].map(cardView),
      stats: { total: deck.length, learned: states.size, mature: [...states.values()].filter((s) => s.interval_days >= MATURE_DAYS).length,
        due_today: due.length, new_left: fresh.length, reviewed_today: reviewedToday,
        retention_30d: reviews30.length ? Math.round((reviews30.filter((r) => r.grade >= 3).length / reviews30.length) * 100) / 100 : null,
        forecast },
    };
  };
  router.get("/api/me/lab/review", login, (_req, res) => res.json(reviewView(userOf(res).id)));
  router.post("/api/me/lab/review/:cardId", login, express.json(), (req, res) => {
    const body = ReviewBody.safeParse(req.body);
    const cardId = String(req.params.cardId);
    if (!body.success) return bad(res, "기억 정도는 0·3·4·5 중 하나예요.", "INVALID_GRADE");
    if (!byCard.has(cardId)) return bad(res, "없는 카드예요.", "UNKNOWN_CARD", 404);
    const user = userOf(res), t = now();
    const prev: SrState | null = repo.srCards(user.id).find((s) => s.card_id === cardId) ?? null;
    const next = nextReview(prev, body.data.grade as Grade, kstDay(t));
    repo.saveReview(user.id, cardId, next, body.data.grade as Grade, t.toISOString());
    res.json({ card_id: cardId, state: next, review: reviewView(user.id) });
  });

  // ── 주간 리그 ──
  router.get("/api/me/lab/league", login, (_req, res) => {
    const user = userOf(res);
    res.json(computeLeague(repo.trainees(), (id) => me.cardEvents(id), user.id, now()));
  });

  // ── xAPI ──
  const conceptName = (section: string, id: string) =>
    statSections(defaultRubrics(), defaultDemoSections()).find((s) => s.section === section)?.concepts.find((c) => c.concept_id === id)?.name;
  const names = { equipment: (id: string) => byEquipment.get(id)?.equipment_name, concept: conceptName };
  const allStatements = (user: User): (Statement & { verbKey: VerbKey })[] => {
    const actor = actorOf(user);
    const derived = me.cardEvents(user.id).flatMap((e) => {
      const s = statementFor(e, actor, names);
      return s ? [{ ...s, stored: s.timestamp, version: XAPI_VERSION }] : [];
    });
    const sent = repo.statements(user.id).map((r) => storedStatement(r, actor));
    return [...derived, ...sent].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  };
  const strip = ({ verbKey: _v, ...s }: Statement & { verbKey: VerbKey }) => s;
  router.get("/api/me/lab/xapi", login, (req, res) => {
    const verb = typeof req.query.verb === "string" ? req.query.verb : "";
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const all = allStatements(userOf(res));
    // 활동 종류: 활동 id의 /activities/<종류>/ (설비·개념·인과 퀴즈·이상 상황 훈련·갈림길·3D 살펴봄 …). 동사와 함께 거를 수 있다.
    const kindOf = (s: Statement) => /\/activities\/([a-z0-9-]+)\//.exec(s.object.id)?.[1] ?? "other";
    const counts: Record<string, number> = {}, kinds: Record<string, number> = {};
    for (const s of all) counts[s.verbKey] = (counts[s.verbKey] ?? 0) + 1;
    const byVerb = verb ? all.filter((s) => s.verbKey === verb) : all;
    for (const s of byVerb) kinds[kindOf(s)] = (kinds[kindOf(s)] ?? 0) + 1;
    const list = kind ? byVerb.filter((s) => kindOf(s) === kind) : byVerb;
    res.set("X-Experience-API-Version", XAPI_VERSION).json({ statements: list.slice(0, limit).map((s) => ({ ...strip(s), verb_key: s.verbKey, kind: kindOf(s) })), total: list.length, counts, kinds, more: null });
  });
  router.get("/api/me/lab/xapi/export", login, (_req, res) => {
    const user = userOf(res);
    res.set("X-Experience-API-Version", XAPI_VERSION)
      .set("Content-Disposition", `attachment; filename="st-rookie-xapi-${user.username}-${kstDay(now())}.json"`)
      .type("application/json").send(JSON.stringify(allStatements(user).map(strip), null, 2));
  });
  router.post("/api/me/lab/xapi", login, express.json(), (req, res) => {
    const body = XapiBody.safeParse(req.body);
    if (!body.success) return bad(res, "문장 형식이 올바르지 않아요.", "INVALID_STATEMENT");
    if (body.data.practice) {
      const kind = body.data.practice, id = body.data.object_id;
      const what = kind === "incident-3d" ? incidentTitle(id) : kind === "lesson" ? lessonStepTitle(id) : NODES.find((n) => n.id === id)?.label;
      if (!what) return bad(res, "없는 실습 대상이에요.", "UNKNOWN_PRACTICE", 404);
      const user = userOf(res), stamp = now().toISOString();
      const row = repo.addStatement(user.id, { verb: "experienced", object_id: `practice:${kind}:${id}`, object_name: `${PRACTICE_KINDS[kind]} · ${what}`, timestamp: stamp }, stamp);
      return void res.status(201).set("X-Experience-API-Version", XAPI_VERSION).json(strip(storedStatement(row, actorOf(user))));
    }
    if (!/^[a-z0-9_]{1,40}$/.test(body.data.object_id)) return bad(res, "문장 형식이 올바르지 않아요.", "INVALID_STATEMENT");
    const card = byEquipment.get(body.data.object_id);
    if (!card) return bad(res, "없는 설비예요.", "UNKNOWN_EQUIPMENT", 404);
    const user = userOf(res), stamp = now().toISOString();
    const row = repo.addStatement(user.id, { verb: body.data.verb, object_id: card.equipment_id, object_name: card.equipment_name, timestamp: stamp }, stamp);
    res.status(201).set("X-Experience-API-Version", XAPI_VERSION).json(strip(storedStatement(row, actorOf(user))));
  });

  // ── 세션 리플레이 ──
  router.post("/api/me/lab/replays", login, (_req, res) => res.status(201).json({ id: repo.startReplay(userOf(res).id, now().toISOString()) }));
  router.post("/api/me/lab/replays/:id/events", login, express.json({ limit: "200kb" }), (req, res) => {
    const id = String(req.params.id);
    if (repo.replayOwner(id) !== userOf(res).id) return bad(res, "없는 리플레이예요.", "UNKNOWN_REPLAY", 404);
    const body = ReplayBody.safeParse(req.body);
    if (!body.success) return bad(res, "기록 형식이 올바르지 않아요.", "INVALID_EVENTS");
    res.json({ added: repo.appendReplay(id, body.data.events, now().toISOString()) });
  });
  router.get("/api/me/lab/replays", login, (_req, res) => res.json({ sessions: repo.replays(userOf(res).id) }));
  router.get("/api/me/lab/replays/:id", login, (req, res) => {
    const session = repo.replaySession(userOf(res).id, String(req.params.id));
    if (!session) return bad(res, "없는 리플레이예요.", "UNKNOWN_REPLAY", 404);
    res.json({ session, events: repo.replayEvents(session.id) });
  });
  router.delete("/api/me/lab/replays/:id", login, (req, res) => {
    if (!repo.deleteReplay(userOf(res).id, String(req.params.id))) return bad(res, "없는 리플레이예요.", "UNKNOWN_REPLAY", 404);
    res.json({ ok: true });
  });

  // ── 소크라테스 모드 ──
  const socraticView = (userId: string, id: string, extra: Record<string, unknown> = {}) => {
    const s = repo.socratic(userId, id)!;
    const card = byEquipment.get(s.equipment_id);
    const turns = repo.turns(id);
    const answered = turns.filter((t) => t.role === "user").length;
    return { session: { ...s, equipment_name: card?.equipment_name ?? s.equipment_id, section_name: card?.section_name ?? s.section },
      turns, answered, suggest_reveal: s.state === "active" && answered >= SUGGEST_REVEAL_AFTER, ...extra };
  };
  router.get("/api/me/lab/socratic", login, (_req, res) => {
    const list = repo.socraticList(userOf(res).id).map((s) => ({ ...s, equipment_name: byEquipment.get(s.equipment_id)?.equipment_name ?? s.equipment_id, section_name: byEquipment.get(s.equipment_id)?.section_name ?? s.section }));
    res.json({ sessions: list, equipment: deck.map((c) => ({ id: c.equipment_id, name: c.equipment_name, section: c.section, section_name: c.section_name })), llm: !!llm });
  });
  router.post("/api/me/lab/socratic", login, express.json(), (req, res) => {
    const body = SocraticStart.safeParse(req.body);
    if (!body.success) return bad(res, "설비를 골라 주세요.", "INVALID_EQUIPMENT");
    const card = byEquipment.get(body.data.equipment_id);
    if (!card) return bad(res, "없는 설비예요.", "UNKNOWN_EQUIPMENT", 404);
    const user = userOf(res);
    const id = repo.startSocratic(user.id, card.section, card.equipment_id, openingQuestion(card), now().toISOString());
    res.status(201).json(socraticView(user.id, id));
  });
  router.get("/api/me/lab/socratic/:id", login, (req, res) => {
    const user = userOf(res), id = String(req.params.id);
    if (!repo.socratic(user.id, id)) return bad(res, "없는 대화예요.", "UNKNOWN_SOCRATIC", 404);
    res.json(socraticView(user.id, id));
  });
  router.post("/api/me/lab/socratic/:id/turns", login, express.json(), async (req, res) => {
    const user = userOf(res), id = String(req.params.id);
    const s = repo.socratic(user.id, id);
    if (!s) return bad(res, "없는 대화예요.", "UNKNOWN_SOCRATIC", 404);
    if (s.state === "revealed") return bad(res, "정답을 본 대화는 끝났어요. 새 대화를 시작해 주세요.", "SOCRATIC_CLOSED", 409);
    const body = SocraticTurn.safeParse(req.body);
    if (!body.success) return bad(res, "답을 500자 안으로 적어 주세요.", "INVALID_TEXT");
    const card = byEquipment.get(s.equipment_id);
    if (!card) return bad(res, "없는 설비예요.", "UNKNOWN_EQUIPMENT", 404);
    const history = repo.turns(id).map(({ role, text }) => ({ role, text }));
    const reply = await socraticReply(llm, card, history, body.data.text, s.hint_level);
    const stamp = now().toISOString();
    repo.addTurn(id, "user", body.data.text, stamp);
    repo.addTurn(id, "tutor", reply.reply, stamp);
    const reached = s.state === "active" && reply.understood;
    repo.updateSocratic(id, reached ? "reached" : s.state, reply.hint_level, stamp);
    res.json(socraticView(user.id, id, { mode: reply.mode, understood: reply.understood, just_reached: reached }));
  });
  router.post("/api/me/lab/socratic/:id/reveal", login, (req, res) => {
    const user = userOf(res), id = String(req.params.id);
    const s = repo.socratic(user.id, id);
    if (!s) return bad(res, "없는 대화예요.", "UNKNOWN_SOCRATIC", 404);
    const card = byEquipment.get(s.equipment_id);
    const stamp = now().toISOString();
    if (card) repo.addTurn(id, "tutor", `정답을 정리해 드릴게요.\n${revealText(card)}`, stamp);
    repo.updateSocratic(id, s.state === "reached" ? "reached" : "revealed", s.hint_level, stamp);
    res.json(socraticView(user.id, id));
  });

  return router;
}
