// 일반 작업 대기열 API(jobs.ts의 register·enqueue). 시험 작업은 /api/exams·/api/exam-jobs 그대로다.
//   GET    /api/jobs/kinds          넣을 수 있는 작업 종류(내 역할 기준)
//   POST   /api/jobs {kind, payload}  작업 넣기(Idempotency-Key가 있으면 같은 요청을 다시 받지 않는다)
//   GET    /api/jobs/:id · DELETE /api/jobs/:id   내 작업 보기·취소(관리자는 모든 작업)
//   GET    /api/me/jobs              내 작업 목록
//   GET    /api/admin/jobs?state=&kind=   전체 목록과 상태·종류별 통계
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { CheckpointError } from "../checkpoint/types.js";
import type { EducationJobs } from "./jobs.js";

const Body = z.object({ kind: z.string().regex(/^[a-z0-9-]{2,40}$/), payload: z.unknown().optional() });

export function createJobRouter(auth: AuthDeps, jobs: EducationJobs): Router {
  const router = Router(), login = requireUser(auth);
  const user = (res: Response) => res.locals.user as User;
  const handle = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    try { fn(req, res); }
    catch (error) {
      if (error instanceof CheckpointError) res.status(error.status).json({ error: error.message });
      else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues[0]?.message ?? "입력이 올바르지 않아요." });
      else { console.error(error); res.status(500).json({ error: "요청을 처리하지 못했어요." }); }
    }
  };
  /** 작업 주인이면 그대로, 관리자면 주인 id로 다시 읽는다. */
  const visible = (id: string, u: User) => {
    try { return jobs.get(id, u.id); }
    catch (e) {
      if (u.role !== "admin") throw e;
      const found = jobs.list({ limit: 500 }).find((j) => j.id === id);
      if (!found) throw e;
      return found;
    }
  };
  router.get("/api/jobs/kinds", login, handle((_req, res) => res.json({ kinds: jobs.registeredKinds().filter((k) => k.role === "any" || user(res).role === "admin") })));
  router.post("/api/jobs", login, handle((req, res) => {
    const body = Body.safeParse(req.body);
    if (!body.success) throw new CheckpointError(400, "작업 종류가 올바르지 않아요.");
    const def = jobs.kind(body.data.kind);
    if (!def) throw new CheckpointError(404, "알 수 없는 작업 종류예요.");
    if (def.role === "admin" && user(res).role !== "admin") throw new CheckpointError(403, "관리자만 넣을 수 있는 작업이에요.");
    const job = jobs.enqueue(user(res).id, body.data.kind, body.data.payload ?? {}, req.get("Idempotency-Key") ?? undefined);
    res.setHeader("Location", `/api/jobs/${job.id}`);
    res.status(202).json(job);
  }));
  router.get("/api/me/jobs", login, handle((_req, res) => res.json({ jobs: jobs.list({ userId: user(res).id, limit: 50 }).filter((j) => !j.kind.startsWith("exam")) })));
  router.get("/api/admin/jobs", login, requireAdmin, handle((req, res) => {
    const q = (k: string) => (typeof req.query[k] === "string" ? String(req.query[k]) : undefined);
    res.json({ jobs: jobs.list({ state: q("state"), kind: q("kind"), limit: 200 }), stats: jobs.stats(), kinds: jobs.registeredKinds() });
  }));
  router.get("/api/jobs/:id", login, handle((req, res) => res.json(visible(String(req.params.id), user(res)))));
  router.delete("/api/jobs/:id", login, handle((req, res) => {
    const job = visible(String(req.params.id), user(res));
    res.json(jobs.cancel(job.id, job.user_id));
  }));
  return router;
}
