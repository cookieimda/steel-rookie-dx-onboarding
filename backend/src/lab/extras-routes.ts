// 학습 랩 추가 기능 API(012): 사고 사례 시나리오, What-if 계산, 설비 주석 공유.
//   GET  /api/lab/incidents · GET /api/lab/incidents/:id · POST /api/lab/incidents/:id/submit {answers: {문항 id: 보기 key}}
//   POST /api/lab/whatif {입력}  (저장하지 않는 계산)
//   GET  /api/lab/notes?equipment_id=   설비 메모(공개 + 내 비공개) · GET /api/lab/notes/summary  설비별 공개 메모 수
//   POST /api/lab/notes · DELETE /api/lab/notes/:id · POST …/:id/vote · …/:id/replies · …/:id/report
//   GET  /api/admin/notes/reported · POST /api/admin/notes/:id/hide {hidden}
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
import { NODES, simulateCausal } from "./causal.js";

/** 신고가 이만큼 쌓이면 자동으로 숨긴다(관리자가 다시 열 수 있다). */
export const AUTO_HIDE_REPORTS = 3;

export interface ExtrasDeps {
  db: DatabaseSync; auth: AuthDeps; deck: DeckCard[];
  incidents: { disclaimer: string; scenarios: IncidentScenario[] };
  /** 이상 상황 훈련(content/faults/faults.json). 없으면 그 API만 빈 목록. */
  faults?: { disclaimer: string; faults: FaultDrill[] };
  notifier?: Notifier;
}

const NoteBody = z.object({ equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/), kind: z.enum(["question", "memo", "tip"]), text: z.string().trim().min(2, "두 글자 이상 적어 주세요.").max(500), visibility: z.enum(["public", "private"]) });
const Reply = z.object({ text: z.string().trim().min(1).max(300) });
const Report = z.object({ reason: z.string().trim().min(1).max(200) });

export function createLabExtrasRouter({ db, auth, deck, incidents, faults = { disclaimer: "", faults: [] }, notifier }: ExtrasDeps): express.Router {
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

  // ── 이상 상황 훈련 ──
  const fault = (id: string) => faults.faults.find((f) => f.id === id);
  router.get("/api/lab/faults", login, (_req, res) => {
    const best = new Map(db.prepare("SELECT fault_id, MAX(score) AS best, COUNT(*) AS n FROM fault_attempts WHERE user_id=? GROUP BY fault_id").all(me(res).id)
      .map((r) => [String(r.fault_id), { best: Number(r.best), attempts: Number(r.n) }]));
    res.json({ disclaimer: faults.disclaimer, faults: faults.faults.map((f) => ({ id: f.id, section: f.section, title: f.title, equipment_id: f.equipment_id, ...(best.get(f.id) ?? { best: null, attempts: 0 }) })) });
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
