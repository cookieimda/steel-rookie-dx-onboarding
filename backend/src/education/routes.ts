import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import type { CheckpointEngine } from "../checkpoint/engine.js";
import { CheckpointError, SECTION_ORDER, SECTION_NAMES, type CheckpointView, type Section } from "../checkpoint/types.js";
import { profileFor, providerInfo } from "../../../llm/src/provider.js";
import type { EducationJobs, EducationJob } from "./jobs.js";
import { EducationRepository, hashOf, koreanDay } from "./repository.js";

const Section = z.enum(SECTION_ORDER);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => {
  const date = new Date(day);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}, "날짜가 올바르지 않아요.");
const parse = <T>(schema: z.ZodType<T>, input: unknown) => {
  const value = schema.safeParse(input);
  if (!value.success) throw new CheckpointError(400, value.error.issues[0]?.message ?? "입력이 올바르지 않아요.");
  return value.data;
};
const handle = (fn: (req: Request, res: Response) => unknown | Promise<unknown>) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof CheckpointError) res.status(error.status).json({ error: error.message });
    else { console.error(error); res.status(500).json({ error: "요청을 처리하지 못했어요." }); }
  }
};
const owner = (res: Response) => (res.locals.user as User).id;
const idOf = (req: Request) => String(req.params.id);
export interface EducationDeps {
  auth: AuthDeps; engine: CheckpointEngine; jobs: EducationJobs; repo: EducationRepository;
  onMaterialsChanged?: (section: Section) => void; metadata?: () => Record<string, unknown>;
}
/**
 * 채점 이력에 남기는 모델 정보: 지금 provider·모델(llm/src/provider.ts)과 채점 보강을 켰는지, 프롬프트 해시.
 * Ollama로 채점한 기록이 Gemini로 남지 않게 한다. 채점 보강이 켜져 있으면 보강 프롬프트도 해시에 넣는다.
 */
function examMetadata(): Record<string, unknown> {
  const info = providerInfo();
  const guards = profileFor(info.provider).evaluatorGuards;
  const prompts = ["evaluator", "tutor-system", "tutor-polish", "tutor-explanation", "tutor-recheck", "tutor-correction", ...(guards ? ["evaluator-keypoints"] : [])];
  return { provider: info.provider, model: info.model, evaluator_guards: guards, prompt_hash: hashOf(prompts.map((name) => readFileSync(join(process.cwd(), "llm", "prompts", `${name}.md`), "utf8"))) };
}

export function createEducationRouter({ auth, engine, jobs, repo, onMaterialsChanged, metadata }: EducationDeps) {
  const router = Router(), login = requireUser(auth), db = repo.db;
  const currentMetadata = metadata ?? examMetadata;
  const submit = (req: Request, res: Response, kind: string, section: Section, payload: unknown, run: () => Promise<CheckpointView>) => {
    const userId = owner(res), info = { ...currentMetadata(), rubric_version: repo.rubricVersions.get(section) ?? null, section };
    let job: EducationJob;
    job = jobs.submit(userId, kind, req.get("Idempotency-Key") ?? "", payload, info, async () => {
      const view = await run();
      repo.recordExam(userId, job.id, view, info);
      return view;
    });
    res.setHeader("Location", `/api/exam-jobs/${job.id}`);
    res.setHeader("Retry-After", "1");
    res.status(202).json(job);
  };
  router.get("/api/exams/sections", login, handle((_req, res) => {
    res.json({ sections: engine.sections().sections.map((s) => ({ ...s,
      name: SECTION_NAMES[s.section], concept_count: repo.rubrics.find((r) => r.section === s.section)?.concepts.length ?? 0,
      last_attempt_id: db.prepare("SELECT id FROM attempts WHERE user_id=? AND section=? AND state='completed' ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(owner(res), s.section)?.id ?? null,
      progress: s.checkpoint ? engine.sectionProgress(owner(res), s.section) : null,
      rubric_version: repo.rubricVersions.get(s.section) ?? null,
    })) });
  }));
  router.post("/api/exams", login, handle((req, res) => {
    const body = parse(z.object({ section: Section }), req.body), userId = owner(res);
    if (!repo.rubricVersions.has(body.section)) throw new CheckpointError(404, "이 공정의 시험은 준비 중이에요.");
    submit(req, res, "exam-start", body.section, body, async () => (await engine.start(userId, body.section)).view);
  }));
  const Command = z.object({ action: z.enum(["answer", "resume", "retry-evaluation"]), text: z.string().trim().max(1000).optional() });
  router.post("/api/exams/:id/commands", login, handle((req, res) => {
    const body = parse(Command, req.body), userId = owner(res), id = idOf(req), current = engine.get(userId, id);
    if (body.action === "answer" && !body.text) throw new CheckpointError(400, "답안을 입력해 주세요.");
    submit(req, res, `exam-${body.action}`, current.section, { ...body, attempt_id: id }, () => {
      if (body.action === "resume") return engine.resume(userId, id);
      if (body.action === "retry-evaluation") return engine.retryEvaluation(userId, id);
      return engine.respond(userId, id, body.text!);
    });
  }));
  router.get("/api/exams/:id", login, handle((req, res) => {
    const current = engine.get(owner(res), idOf(req));
    const snapshot = current.state === "completed" ? repo.history(owner(res), idOf(req)).find((e) => e.view.state === "completed") : null;
    res.json(snapshot ? { ...snapshot.view, history: current.history } : current);
  }));
  router.post("/api/exams/:id/pause", login, handle(async (req, res) => {
    const view = engine.get(owner(res), idOf(req));
    const active = db.prepare("SELECT metadata_json FROM education_jobs WHERE user_id=? AND state IN ('queued','running')").all(owner(res));
    if (active.some((r) => JSON.parse(String(r.metadata_json)).section === view.section)) throw new CheckpointError(409, "처리 중인 요청을 먼저 취소해 주세요.");
    res.json(await engine.pause(owner(res), idOf(req)));
  }));
  router.get("/api/exam-jobs/:id", login, handle((req, res) => res.json(jobs.get(idOf(req), owner(res)))));
  router.delete("/api/exam-jobs/:id", login, handle((req, res) => res.json(jobs.cancel(idOf(req), owner(res)))));
  router.get("/api/me/exam-history", login, handle((req, res) => res.json({ events: repo.history(owner(res), typeof req.query.attempt === "string" ? req.query.attempt : undefined) })));
  router.get("/api/admin/exam-history/:id", login, requireAdmin, handle((req, res) => res.json({ events: repo.history(idOf(req), undefined, true) })));
  router.get("/api/me/reviews", login, handle((_req, res) => res.json({ today: koreanDay(), tasks: repo.reviews(owner(res)) })));
  router.post("/api/me/reviews/:id/complete", login, handle((req, res) => {
    if (!repo.completeReview(owner(res), idOf(req))) throw new CheckpointError(404, "복습 항목을 찾지 못했어요.");
    res.json({ completed: true });
  }));
  router.get("/api/admin/education/groups", login, requireAdmin, handle((_req, res) => res.json({ groups: db.prepare("SELECT g.*,COUNT(m.user_id) AS member_count FROM education_groups g LEFT JOIN education_members m ON g.id=m.group_id GROUP BY g.id ORDER BY g.created_at DESC").all() })));
  router.post("/api/admin/education/groups", login, requireAdmin, handle((req, res) => {
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(60) }), req.body), id = randomUUID();
    db.prepare("INSERT INTO education_groups(id,name,created_by,created_at) VALUES(?,?,?,?)").run(id, name, owner(res), new Date().toISOString());
    res.status(201).json({ id, name });
  }));
  router.put("/api/admin/education/groups/:id/members", login, requireAdmin, handle((req, res) => {
    const { users } = parse(z.object({ users: z.array(z.string().min(1)).max(200) }), req.body), groupId = idOf(req);
    if (!db.prepare("SELECT id FROM education_groups WHERE id=?").get(groupId)) throw new CheckpointError(404, "교육 그룹을 찾지 못했어요.");
    const ids = [...new Set(users)];
    for (const id of ids) if (auth.users.findById(id)?.role !== "trainee") throw new CheckpointError(400, "학습자 계정만 교육 그룹에 넣을 수 있어요.");
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM education_members WHERE group_id=?").run(groupId);
      for (const id of ids) db.prepare("INSERT INTO education_members(group_id,user_id) VALUES(?,?)").run(groupId, id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    res.json({ users: ids });
  }));
  router.post("/api/admin/education/assignments", login, requireAdmin, handle((req, res) => {
    const input = parse(z.object({ group_id: z.string(), section: Section, title: z.string().trim().min(1).max(100), due_date: Day }), req.body);
    if (!db.prepare("SELECT id FROM education_groups WHERE id=?").get(input.group_id)) throw new CheckpointError(404, "교육 그룹을 찾지 못했어요.");
    if (!repo.rubricVersions.has(input.section)) throw new CheckpointError(400, "시험 기준이 준비된 공정만 배정할 수 있어요.");
    const id = randomUUID();
    db.prepare("INSERT INTO education_assignments(id,group_id,section,title,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, input.group_id, input.section, input.title, input.due_date, owner(res), new Date().toISOString());
    res.status(201).json({ id, ...input });
  }));
  const assignmentsFor = (userId: string) => db.prepare("SELECT a.*,g.name AS group_name FROM education_assignments a JOIN education_members m ON a.group_id=m.group_id JOIN education_groups g ON g.id=a.group_id WHERE m.user_id=? ORDER BY a.due_date").all(userId).map((a) => ({
    ...a, status: engine.sectionProgress(userId, a.section as Section).unlocked ? "completed" : String(a.due_date) < koreanDay() ? "overdue" : "pending", section_name: SECTION_NAMES[a.section as Section],
  }));
  router.get("/api/me/assignments", login, handle((_req, res) => res.json({ assignments: assignmentsFor(owner(res)) })));
  router.get("/api/admin/education/assignments", login, requireAdmin, handle((_req, res) => {
    res.json({ learners: db.prepare("SELECT DISTINCT user_id FROM education_members").all().map((u) => ({ user: auth.users.findById(String(u.user_id)), assignments: assignmentsFor(String(u.user_id)) })) });
  }));
  router.get("/api/admin/education/materials", login, requireAdmin, handle((_req, res) => res.json({ materials: repo.materials() })));
  router.post("/api/admin/education/materials", login, requireAdmin, handle((req, res) => {
    const input = parse(z.object({ section: Section, title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(20000),
      source_url: z.string().url().refine((url) => url.startsWith("https://"), "출처는 HTTPS 주소를 사용해 주세요."), publisher: z.string().trim().min(1).max(80) }), req.body);
    res.status(201).json(repo.createMaterial(owner(res), input));
  }));
  router.post("/api/admin/education/materials/:id/review", login, requireAdmin, handle((req, res) => {
    const { decision } = parse(z.object({ decision: z.enum(["approved", "rejected"]) }), req.body), row = repo.materials().find((r) => r.id === idOf(req));
    if (!row) throw new CheckpointError(404, "자료를 찾지 못했어요.");
    if (!repo.reviewMaterial(owner(res), idOf(req), decision)) throw new CheckpointError(409, "이미 검수된 자료예요. 수정본은 새 자료로 등록해 주세요.");
    onMaterialsChanged?.(row.section as Section);
    res.json({ id: row.id, state: decision, version: row.version });
  }));
  return router;
}
