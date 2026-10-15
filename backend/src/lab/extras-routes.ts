// 학습 랩 추가 기능 API(012): 사고 사례 시나리오, What-if 계산, 설비 주석 공유.
//   GET  /api/lab/incidents · GET /api/lab/incidents/:id · POST /api/lab/incidents/:id/submit {answers: {문항 id: 보기 key}}
//   POST /api/lab/whatif {입력}  (저장하지 않는 계산)
//   GET  /api/lab/notes?equipment_id=   설비 메모(공개 + 내 비공개) · GET /api/lab/notes/summary  설비별 공개 메모 수
//   POST /api/lab/notes · DELETE /api/lab/notes/:id · POST …/:id/vote · …/:id/replies · …/:id/report
//   GET  /api/admin/notes/reported · POST /api/admin/notes/:id/hide {hidden}
//   GET  /api/admin/practice-stats?include_demo=  3D 실습 통계(관리자) · GET /api/lab/practice-path  오늘의 실습 경로
//   GET  /api/lab/causal/quiz?seed=&process=  인과 퀴즈(process를 주면 그 공정 변수가 든 길 먼저)
//   GET  /api/lab/lessons · GET /api/lab/lessons/:id  수업 모드(3D 실습 단계 묶음)
//   GET  /api/lab/faults · GET /api/lab/faults/:id · POST /api/lab/faults/:id/check {step, key} · POST /api/lab/faults/:id/complete {tries}  (이상 상황 훈련)
import { randomUUID } from "node:crypto";
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import type { Notifier } from "../notify/service.js";
import type { DeckCard } from "./deck.js";
import { checkStep, faultScore, faultView, type FaultDrill } from "./faults.js";
import { gradeIncident, scenarioView, type IncidentScenario } from "./incidents.js";
import { maskName } from "./league.js";
import { whatIf } from "./whatif.js";
import { NODES, causalQuiz, checkDiagnose, checkHop, checkLag, checkRebalance, conceptVars, diagnoseQuiz, lagQuiz, rebalancePuzzles, simulateCausal } from "./causal.js";
import { loadFinalRubrics, type Rubric } from "../rubrics.js";
import { loadDemoSections, type DemoSections } from "../demo-sections.js";

/** final 루브릭(개념·설비). 읽지 못하면 빈 목록(이 API만 비고 다른 기능은 그대로). */
let rubricCache: readonly Rubric[] | null = null, demoCache: DemoSections | null = null;
const demoConcepts = () => { if (!demoCache) { try { demoCache = loadDemoSections(); } catch { demoCache = {}; } } return demoCache; };
const conceptRubrics = () => { if (!rubricCache) { try { rubricCache = loadFinalRubrics(); } catch { rubricCache = []; } } return rubricCache; };
import { practiceStats } from "./practice-stats.js";
import type { LessonDef } from "./lessons.js";
import { practicePath } from "./practice-path.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";

/** 신고가 이만큼 쌓이면 자동으로 숨긴다(관리자가 다시 열 수 있다). */
export const AUTO_HIDE_REPORTS = 3;

export interface ExtrasDeps {
  db: DatabaseSync; auth: AuthDeps; deck: DeckCard[];
  incidents: { disclaimer: string; scenarios: IncidentScenario[] };
  /** 이상 상황 훈련(content/faults/faults.json). 없으면 그 API만 빈 목록. */
  faults?: { disclaimer: string; faults: FaultDrill[] };
  /** 수업 모드(content/lessons/lessons.json). 없으면 빈 목록. */
  lessons?: LessonDef[];
  notifier?: Notifier;
}

const NoteBody = z.object({ equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/), kind: z.enum(["question", "memo", "tip"]), text: z.string().trim().min(2, "두 글자 이상 적어 주세요.").max(500), visibility: z.enum(["public", "private"]) });
const Reply = z.object({ text: z.string().trim().min(1).max(300) });
const Report = z.object({ reason: z.string().trim().min(1).max(200) });

export function createLabExtrasRouter({ db, auth, deck, incidents, faults = { disclaimer: "", faults: [] }, notifier, lessons = [] }: ExtrasDeps): express.Router {
  const router = express.Router(), login = requireUser(auth);
  const me = (res: express.Response) => res.locals.user as User;
  const bad = (res: express.Response, status: number, error: string) => res.status(status).json({ error });
  const byEquipment = new Map(deck.map((c) => [c.equipment_id, c]));
  const scenario = (id: string) => incidents.scenarios.find((s) => s.id === id);
  const nameOf = (userId: string) => String(db.prepare("SELECT name FROM users WHERE id=?").get(userId)?.name ?? "학습자");

  // ── 사고 사례 ──
  router.get("/api/lab/incidents", login, (_req, res) => {
    const best = new Map(db.prepare("SELECT scenario_id, MAX(score) AS best, COUNT(*) AS n FROM incident_attempts WHERE user_id=? GROUP BY scenario_id").all(me(res).id)
      .map((r) => [String(r.scenario_id), { best: Number(r.best), attempts: Number(r.n) }]));
    res.json({ disclaimer: incidents.disclaimer, scenarios: incidents.scenarios.map((s) => ({ id: s.id, section: s.section, title: s.title, hazard: s.hazard, questions: s.questions.length, ...(best.get(s.id) ?? { best: null, attempts: 0 }) })) });
  });
  router.get("/api/lab/incidents/:id", login, (req, res) => {
    const s = scenario(String(req.params.id));
    if (!s) return bad(res, 404, "없는 사례예요.");
    res.json({ disclaimer: incidents.disclaimer, scenario: scenarioView(s, me(res).id) });
  });
  router.post("/api/lab/incidents/:id/submit", login, express.json(), (req, res) => {
    const s = scenario(String(req.params.id));
    if (!s) return bad(res, 404, "없는 사례예요.");
    const body = z.object({ answers: z.record(z.string(), z.number().int().min(0).max(10)), reflection: z.string().max(1000).optional() }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "답안 형식이 올바르지 않아요.");
    const graded = gradeIncident(s, body.data.answers);
    db.prepare("INSERT INTO incident_attempts(id,user_id,scenario_id,answers_json,score,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), me(res).id, s.id, JSON.stringify(body.data), graded.score, new Date().toISOString());
    res.json(graded);
  });

  // 갈림길 탐험: 고른 선택을 남긴다(같은 선택은 한 번만). 응답은 이 사례에서 골라 본 선택 수와 전체 선택 수.
  router.post("/api/lab/incidents/:id/branch", login, express.json(), (req, res) => {
    const s = scenario(String(req.params.id));
    if (!s) return bad(res, 404, "없는 사례예요.");
    const body = z.object({ at: z.number().int().min(0).max(50), pick: z.number().int().min(0).max(10) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "장면과 선택을 보내 주세요.");
    const option = s.timeline[body.data.at]?.branch?.options[body.data.pick];
    if (!option) return bad(res, 404, "없는 갈림길 선택이에요.");
    const uid = me(res).id;
    const seen = db.prepare("SELECT 1 FROM branch_explorations WHERE user_id=? AND scenario_id=? AND at_step=? AND pick=?").get(uid, s.id, body.data.at, body.data.pick);
    if (!seen) db.prepare("INSERT INTO branch_explorations(id,user_id,scenario_id,at_step,pick,actual,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), uid, s.id, body.data.at, body.data.pick, option.actual ? 1 : 0, new Date().toISOString());
    const explored = Number(db.prepare("SELECT COUNT(*) AS n FROM branch_explorations WHERE user_id=? AND scenario_id=?").get(uid, s.id)?.n ?? 0);
    const total = s.timeline.reduce((n, t) => n + (t.branch?.options.length ?? 0), 0);
    res.status(seen ? 200 : 201).json({ explored, total, new: !seen });
  });

  // ── 수업 모드: 수업 목록(단계 수만)과 수업 하나(단계 전체) ──
  router.get("/api/lab/lessons", login, (_req, res) => res.json({ lessons: lessons.map(({ steps, ...l }) => ({ ...l, steps: steps.length })) }));
  router.get("/api/lab/lessons/:id", login, (req, res) => {
    const l = lessons.find((x) => x.id === String(req.params.id));
    if (!l) return bad(res, 404, "없는 수업이에요.");
    res.json({ lesson: l });
  });

  // ── 이상 상황 훈련 ──
  const fault = (id: string) => faults.faults.find((f) => f.id === id);
  router.get("/api/lab/faults", login, (_req, res) => {
    const best = new Map(db.prepare("SELECT fault_id, MAX(score) AS best, COUNT(*) AS n FROM fault_attempts WHERE user_id=? GROUP BY fault_id").all(me(res).id)
      .map((r) => [String(r.fault_id), { best: Number(r.best), attempts: Number(r.n) }]));
    res.json({ disclaimer: faults.disclaimer, faults: faults.faults.map((f) => ({ id: f.id, section: f.section, title: f.title, equipment_id: f.equipment_id, causal: f.causal ?? null, ...(best.get(f.id) ?? { best: null, attempts: 0 }) })) });
  });
  router.get("/api/lab/faults/:id", login, (req, res) => {
    const f = fault(String(req.params.id));
    if (!f) return bad(res, 404, "없는 이상 상황이에요.");
    res.json({ disclaimer: faults.disclaimer, fault: faultView(f, me(res).id) });
  });
  router.post("/api/lab/faults/:id/check", login, express.json(), (req, res) => {
    const f = fault(String(req.params.id));
    if (!f) return bad(res, 404, "없는 이상 상황이에요.");
    const body = z.object({ step: z.enum(["signal", "cause", "action"]), key: z.union([z.string().max(40), z.number().int().min(0).max(10)]) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "단계와 고른 답을 보내 주세요.");
    res.json(checkStep(f, body.data.step, body.data.key));
  });
  router.post("/api/lab/faults/:id/complete", login, express.json(), (req, res) => {
    const f = fault(String(req.params.id));
    if (!f) return bad(res, 404, "없는 이상 상황이에요.");
    const body = z.object({ tries: z.object({ signal: z.number().int().min(1).max(20), cause: z.number().int().min(1).max(20), action: z.number().int().min(1).max(20) }) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "단계별 시도 횟수를 보내 주세요.");
    const score = faultScore(body.data.tries);
    db.prepare("INSERT INTO fault_attempts(id,user_id,fault_id,tries_json,score,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), me(res).id, f.id, JSON.stringify(body.data.tries), score, new Date().toISOString());
    res.json({ score });
  });

  // ── 공정 인과 지도: 조정 변수 → 공정 사이 반응(저장하지 않는 계산) ──
  router.post("/api/lab/causal", login, express.json(), (req, res) => {
    const body = z.record(z.string(), z.number()).safeParse(req.body ?? {});
    if (!body.success) return bad(res, 400, "입력은 숫자만 받아요.");
    const known = new Set(NODES.filter((n) => n.control).map((n) => n.id));
    const unknown = Object.keys(body.data).find((k) => !known.has(k));
    if (unknown) return bad(res, 400, `조정할 수 없는 변수예요: ${unknown}`);
    res.json(simulateCausal(body.data));
  });

  router.get("/api/lab/causal/quiz", login, (req, res) => {
    const process = SECTION_ORDER.includes(req.query.process as Section) ? String(req.query.process) : undefined;
    res.json({ chains: causalQuiz(Number(req.query.seed) || Date.now() % 100000, 5, process, req.query.level === "2" ? 2 : 1) });
  });
  // 개념 → 인과 지도 변수(학습 기록 '내 오개념'의 [인과 지도에서 보기]). final 루브릭 개념만.
  router.get("/api/lab/causal/concepts", login, (_req, res) => {
    const out: Record<string, { section: string; vars: string[] }> = {};
    for (const r of conceptRubrics()) for (const c of r.concepts) {
      const vars = conceptVars(c.concept_id, c.equipment_ids ?? []);
      if (vars.length) out[c.concept_id] = { section: r.section, vars };
    }
    // 시연 개념(final 루브릭이 없는 공정): id·이름만 있으므로 표에 있는 것만
    for (const [section, list] of Object.entries(demoConcepts())) for (const c of list ?? []) {
      if (!out[c.id] && conceptVars(c.id).length) out[c.id] = { section, vars: conceptVars(c.id) };
    }
    res.json({ concepts: out });
  });
  // 되돌리기 퍼즐: 무작위 하나(흔든 값·목표·쓸 수 있는 조정 값), 채점은 조정 값 하나만
  router.get("/api/lab/causal/rebalance", login, (req, res) => {
    // ?level=easy면 부작용 없이 풀리는 퍼즐 중에서
    const every = rebalancePuzzles(), easy = every.filter((x) => x.clean), all = req.query.level === "easy" && easy.length ? easy : every;
    const seed = Number(req.query.seed) || Date.now();
    // ?id=로 특정 퍼즐(변수 카드의 관련 실습에서 연다)
    const p = (typeof req.query.id === "string" && every.find((x) => x.id === req.query.id)) || all[Math.abs(Math.floor(seed)) % all.length];
    const node = (id: string) => { const n = NODES.find((x) => x.id === id)!; return { id, label: n.label, unit: n.unit, process: n.process, equipment_id: n.equipment_id, normal: n.normal, digits: n.digits, ...(n.control ? { control: n.control, base: n.base } : {}) }; };
    const before = simulateCausal(p.disturb).nodes.find((n) => n.id === p.target)!;
    res.json({ id: p.id, total: all.length, clean: p.clean, disturb: Object.entries(p.disturb).map(([k, v]) => ({ ...node(k), value: v })), target: { ...node(p.target), value: before.value }, controls: p.controls.map(node) });
  });
  router.post("/api/lab/causal/rebalance/check", login, express.json(), (req, res) => {
    const body = z.object({ id: z.string().max(80), input: z.record(z.string(), z.number()) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "퍼즐과 조정 값을 보내 주세요.");
    const out = checkRebalance(body.data.id, body.data.input);
    if (!out) return bad(res, 400, "이 퍼즐에서 쓸 수 있는 조정 값 하나만 보내 주세요.");
    res.json(out);
  });
  // 변수 → 관련 실습(인과 지도 변수 카드): 그 변수를 원인 조건으로 쓰는 이상 상황 훈련·갈림길 선택·수업 단계, 흔들거나 되돌리는 퍼즐
  router.get("/api/lab/causal/related", login, (req, res) => {
    const v = String(req.query.var ?? "");
    if (!NODES.some((n) => n.id === v)) return bad(res, 404, "없는 변수예요.");
    const faultsOut = faults.faults.filter((f) => f.causal && v in f.causal).map((f) => ({ id: f.id, section: f.section, title: f.title }));
    const puzzles = rebalancePuzzles().filter((p) => p.target === v || v in p.disturb).map((p) => ({ id: p.id, role: p.target === v ? "목표" : "흔들림", clean: p.clean }));
    const branches = incidents.scenarios.flatMap((s) => s.timeline.flatMap((t, at) => (t.branch?.options ?? []).flatMap((o, pick) => (o.causal && v in o.causal ? [{ scenario: s.id, section: s.section, title: s.title, at, pick, text: o.text }] : []))));
    const lessonSteps = lessons.flatMap((l) => l.steps.flatMap((s, i) => (s.set && v in s.set ? [{ lesson: l.id, title: l.title, step: i + 1, step_title: s.title }] : [])));
    res.json({ faults: faultsOut, puzzles, branches, lessons: lessonSteps });
  });
  // '언제 나타날까?' 시간 질문(인과 퀴즈 끝): 기록하지 않는 자가 점검
  router.get("/api/lab/causal/lag-quiz", login, (req, res) => res.json(lagQuiz(Number(req.query.seed) || Date.now() % 100000)));
  router.post("/api/lab/causal/lag-quiz/check", login, express.json(), (req, res) => {
    const id = z.string().regex(/^[a-z0-9_]{1,40}$/);
    const body = z.object({ from: id, to: id, choice: z.string().max(40) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "변수와 고른 답을 보내 주세요.");
    const out = checkLag(body.data.from, body.data.to, body.data.choice);
    if (!out) return bad(res, 404, "없는 변수예요.");
    res.json(out);
  });
  // 거꾸로 추론 퀴즈(진단형): 증상 → 원인 고르기. 답은 기록해 관리자 통계에 쓴다(017, 사원증 XP 없음).
  router.get("/api/lab/causal/diagnose", login, (req, res) => res.json({ questions: diagnoseQuiz(Number(req.query.seed) || Date.now() % 100000, 4) }));
  router.post("/api/lab/causal/diagnose/check", login, express.json(), (req, res) => {
    const key = z.string().regex(/^[a-z0-9_]{1,40}:-?1$/);
    const body = z.object({ id: key, choice: key, symptoms: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(4) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "문제·고른 원인·증상을 보내 주세요.");
    const out = checkDiagnose(body.data.id, body.data.choice, body.data.symptoms);
    if (!out) return bad(res, 404, "없는 원인이에요.");
    db.prepare("INSERT INTO diagnose_answers(id,user_id,question,choice,correct,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), me(res).id, body.data.id, body.data.choice, out.correct ? 1 : 0, new Date().toISOString());
    res.json(out);
  });
  // 오늘의 실습 경로: 내 3D 실습 기록으로 가장 약한 공정을 골라 인과 지도 → 인과 퀴즈 → 이상 상황 훈련을 권한다.
  router.get("/api/lab/practice-path", login, (_req, res) => res.json(practicePath(db, me(res).id, faults.faults, incidents.scenarios)));
  router.post("/api/lab/causal/quiz/check", login, express.json(), (req, res) => {
    const body = z.object({ chain_id: z.string().max(160), dir: z.union([z.literal(1), z.literal(-1)]), hop: z.union([z.literal(1), z.literal(2), z.literal(3)]), choice: z.enum(["up", "down"]) }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "길·방향·칸·답을 보내 주세요.");
    const out = checkHop(body.data.chain_id, body.data.dir, body.data.hop, body.data.choice);
    if (!out) return bad(res, 404, "없는 인과 길이에요.");
    db.prepare("INSERT INTO causal_quiz_answers(id,user_id,chain_id,hop,correct,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), me(res).id, body.data.chain_id, body.data.hop, out.correct ? 1 : 0, new Date().toISOString());
    res.json(out);
  });

  // ── What-if ──
  router.post("/api/lab/whatif", login, express.json(), (req, res) => {
    const body = z.record(z.string(), z.number()).safeParse(req.body ?? {});
    if (!body.success) return bad(res, 400, "입력은 숫자만 받아요.");
    res.json(whatIf(body.data));
  });

  // ── 설비 주석 공유 ──
  const noteView = (r: Record<string, unknown>, viewer: User) => {
    const id = String(r.id), mine = r.user_id === viewer.id;
    const replies = db.prepare("SELECT id,user_id,text,created_at FROM equipment_note_replies WHERE note_id=? ORDER BY created_at").all(id)
      .map((x) => ({ id: String(x.id), author: x.user_id === viewer.id ? "나" : maskName(nameOf(String(x.user_id))), text: String(x.text), created_at: String(x.created_at), mine: x.user_id === viewer.id }));
    return {
      id, equipment_id: String(r.equipment_id), process_id: String(r.process_id), kind: String(r.kind), text: String(r.text), visibility: String(r.visibility),
      hidden: Number(r.hidden) === 1, author: mine ? "나" : maskName(nameOf(String(r.user_id))), mine, created_at: String(r.created_at),
      votes: Number(db.prepare("SELECT COUNT(*) AS n FROM equipment_note_votes WHERE note_id=?").get(id)?.n ?? 0),
      voted: !!db.prepare("SELECT 1 FROM equipment_note_votes WHERE note_id=? AND user_id=?").get(id, viewer.id),
      replies,
    };
  };
  const ownNote = (id: string, user: User) => {
    const r = db.prepare("SELECT * FROM equipment_notes WHERE id=?").get(id);
    if (!r) return null;
    // 숨긴 메모와 남의 비공개 메모는 작성자·관리자만
    if ((r.visibility === "private" || Number(r.hidden) === 1) && r.user_id !== user.id && user.role !== "admin") return null;
    return r;
  };
  router.get("/api/lab/notes/summary", login, (_req, res) => {
    res.json({ counts: Object.fromEntries(db.prepare("SELECT equipment_id, COUNT(*) AS n FROM equipment_notes WHERE visibility='public' AND hidden=0 GROUP BY equipment_id").all().map((r) => [String(r.equipment_id), Number(r.n)])) });
  });
  router.get("/api/lab/notes", login, (req, res) => {
    const eq = typeof req.query.equipment_id === "string" ? req.query.equipment_id : "";
    if (!byEquipment.has(eq)) return bad(res, 404, "없는 설비예요.");
    const user = me(res);
    const rows = db.prepare("SELECT * FROM equipment_notes WHERE equipment_id=? AND ((visibility='public' AND hidden=0) OR user_id=?) ORDER BY created_at DESC LIMIT 100").all(eq, user.id);
    const notes = rows.map((r) => noteView(r, user)).sort((a, b) => b.votes - a.votes || b.created_at.localeCompare(a.created_at));
    res.json({ equipment: { id: eq, name: byEquipment.get(eq)!.equipment_name, section: byEquipment.get(eq)!.section }, notes });
  });
  router.post("/api/lab/notes", login, express.json(), (req, res) => {
    const body = NoteBody.safeParse(req.body);
    if (!body.success) return bad(res, 400, body.error.issues[0]?.message ?? "메모 형식이 올바르지 않아요.");
    const card = byEquipment.get(body.data.equipment_id);
    if (!card) return bad(res, 404, "없는 설비예요.");
    const id = randomUUID(), at = new Date().toISOString(), user = me(res);
    db.prepare("INSERT INTO equipment_notes(id,user_id,process_id,equipment_id,kind,text,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, user.id, card.section, card.equipment_id, body.data.kind, body.data.text, body.data.visibility, at, at);
    res.status(201).json(noteView(db.prepare("SELECT * FROM equipment_notes WHERE id=?").get(id)!, user));
  });
  router.delete("/api/lab/notes/:id", login, (req, res) => {
    const user = me(res), r = ownNote(String(req.params.id), user);
    if (!r || (r.user_id !== user.id && user.role !== "admin")) return bad(res, 404, "메모를 찾지 못했어요.");
    const id = String(r.id);
    for (const t of ["equipment_note_votes", "equipment_note_replies", "equipment_note_reports"]) db.prepare(`DELETE FROM ${t} WHERE note_id=?`).run(id);
    db.prepare("DELETE FROM equipment_notes WHERE id=?").run(id);
    res.json({ ok: true });
  });
  router.post("/api/lab/notes/:id/vote", login, (req, res) => {
    const user = me(res), r = ownNote(String(req.params.id), user);
    if (!r) return bad(res, 404, "메모를 찾지 못했어요.");
    const id = String(r.id);
    if (db.prepare("SELECT 1 FROM equipment_note_votes WHERE note_id=? AND user_id=?").get(id, user.id)) db.prepare("DELETE FROM equipment_note_votes WHERE note_id=? AND user_id=?").run(id, user.id);
    else db.prepare("INSERT INTO equipment_note_votes(note_id,user_id) VALUES(?,?)").run(id, user.id);
    res.json(noteView(r, user));
  });
  router.post("/api/lab/notes/:id/replies", login, express.json(), (req, res) => {
    const user = me(res), r = ownNote(String(req.params.id), user);
    if (!r) return bad(res, 404, "메모를 찾지 못했어요.");
    const body = Reply.safeParse(req.body);
    if (!body.success) return bad(res, 400, "답글은 300자 안으로 적어 주세요.");
    db.prepare("INSERT INTO equipment_note_replies(id,note_id,user_id,text,created_at) VALUES(?,?,?,?,?)").run(randomUUID(), String(r.id), user.id, body.data.text, new Date().toISOString());
    if (r.user_id !== user.id) notifier?.notify(String(r.user_id), "note_reply", `내 설비 메모에 답글 · ${byEquipment.get(String(r.equipment_id))?.equipment_name ?? ""}`,
      body.data.text.slice(0, 80), "/login", `note_reply:${r.id}:${Date.now()}`);
    res.status(201).json(noteView(r, user));
  });
  router.post("/api/lab/notes/:id/report", login, express.json(), (req, res) => {
    const user = me(res), r = ownNote(String(req.params.id), user);
    if (!r) return bad(res, 404, "메모를 찾지 못했어요.");
    if (r.user_id === user.id) return bad(res, 400, "내 메모는 신고할 수 없어요.");
    const body = Report.safeParse(req.body);
    if (!body.success) return bad(res, 400, "신고 이유를 적어 주세요.");
    db.prepare("INSERT OR IGNORE INTO equipment_note_reports(note_id,user_id,reason,created_at) VALUES(?,?,?,?)").run(String(r.id), user.id, body.data.reason, new Date().toISOString());
    const n = Number(db.prepare("SELECT COUNT(*) AS n FROM equipment_note_reports WHERE note_id=?").get(String(r.id))?.n ?? 0);
    if (n >= AUTO_HIDE_REPORTS) db.prepare("UPDATE equipment_notes SET hidden=1, updated_at=? WHERE id=?").run(new Date().toISOString(), String(r.id));
    res.json({ reports: n, hidden: n >= AUTO_HIDE_REPORTS });
  });
  // 3D 실습 통계(이상 상황 훈련·사고 사례·인과 퀴즈). ?include_demo=false면 시연 계정을 뺀다.
  router.get("/api/admin/practice-stats", login, requireAdmin, (req, res) => {
    const v = req.query.include_demo;
    if (v !== undefined && v !== "true" && v !== "false") return bad(res, 400, "include_demo는 true 또는 false여야 해요.");
    res.json(practiceStats(db, { faults: faults.faults, scenarios: incidents.scenarios, lessons }, { includeDemo: v !== "false" }));
  });
  router.get("/api/admin/notes/reported", login, requireAdmin, (_req, res) => {
    const rows = db.prepare(`SELECT n.*, COUNT(r.user_id) AS reports, GROUP_CONCAT(r.reason, ' / ') AS reasons FROM equipment_notes n JOIN equipment_note_reports r ON r.note_id=n.id
                              GROUP BY n.id ORDER BY reports DESC, n.created_at DESC`).all();
    res.json({ notes: rows.map((r) => ({ ...noteView(r, me(res)), reports: Number(r.reports), reasons: String(r.reasons ?? "") })) });
  });
  router.post("/api/admin/notes/:id/hide", login, requireAdmin, express.json(), (req, res) => {
    const body = z.object({ hidden: z.boolean() }).safeParse(req.body);
    if (!body.success) return bad(res, 400, "hidden은 true·false예요.");
    const changed = db.prepare("UPDATE equipment_notes SET hidden=?, updated_at=? WHERE id=?").run(body.data.hidden ? 1 : 0, new Date().toISOString(), String(req.params.id)).changes;
    if (!changed) return bad(res, 404, "메모를 찾지 못했어요.");
    res.json({ ok: true, hidden: body.data.hidden });
  });
  return router;
}
