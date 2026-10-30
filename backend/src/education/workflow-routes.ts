// 자료 검수 워크플로 API(workflow.ts). 관리자만. 등록(POST /api/admin/education/materials)과 승인·반려(…/review)는 routes.ts에 있다.
//   GET  /api/admin/education/materials/workflow?stage=  목록(단계 포함)
//   GET  /api/admin/education/materials/:id/workflow      자료·단계·기록·원본과의 차이
//   POST …/:id/submit · comment · request-changes · revise  검수 요청 · 의견 · 수정 요청 · 수정본 만들기
//   POST …/:id/check  검수 도우미(작업 대기열 'material-check'로 넣는다)
import { Router, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { CheckpointError, SECTION_NAMES, type Section } from "../checkpoint/types.js";
import { handle } from "../http/errors.js";
import type { Notifier } from "../notify/service.js";
import type { EducationJobs } from "./jobs.js";
import { checkMaterial, MaterialWorkflow, STAGE_LABEL, type Stage } from "./workflow.js";

const STAGES = ["draft", "in_review", "changes_requested", "approved", "rejected"] as const;
const Comment = z.object({ comment: z.string().trim().min(1, "의견을 적어 주세요.").max(1000) });
const OptionalComment = z.object({ comment: z.string().trim().max(1000).optional() });
const Revise = z.object({
  title: z.string().trim().min(1).max(100).optional(), body: z.string().trim().min(1).max(20000).optional(),
  source_url: z.string().url().refine((u) => u.startsWith("https://"), "출처는 HTTPS 주소를 사용해 주세요.").optional(),
  publisher: z.string().trim().min(1).max(80).optional(), comment: z.string().trim().max(1000).optional(),
});

export function createWorkflowRouter({ auth, jobs, notifier }: { auth: AuthDeps; jobs: EducationJobs; notifier?: Notifier }, workflow: MaterialWorkflow): Router {
  const router = Router(), admin = [requireUser(auth), requireAdmin];
  const me = (res: Response) => (res.locals.user as User).id;
  const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
    const r = schema.safeParse(input ?? {});
    if (!r.success) throw new CheckpointError(400, r.error.issues[0]?.message ?? "입력이 올바르지 않아요.");
    return r.data;
  };
  // 검수 알림: 검수 요청은 다른 관리자에게, 수정 요청·결과는 작성자에게
  const tell = (materialId: string, actor: string, kind: "submitted" | "changes" | "decided", decision?: string) => {
    if (!notifier) return;
    const m = workflow.material(materialId);
    if (!m) return;
    const link = `/login_ui/admin-ops.html#material=${materialId}`;
    if (kind === "submitted") for (const id of notifier.admins()) { if (id !== actor) notifier.notify(id, "material_review", `검수 요청 · ${m.title}`, `${SECTION_NAMES[m.section as Section] ?? m.section} 자료를 검수해 주세요.`, link, `material_submitted:${materialId}:${Date.now()}`); }
    else if (m.created_by !== actor) notifier.notify(m.created_by, "material_review", kind === "changes" ? `수정 요청 · ${m.title}` : `${decision === "approved" ? "승인" : "반려"} · ${m.title}`,
      kind === "changes" ? "검수 의견을 확인하고 수정본을 올려 주세요." : "검수 결과를 확인해 주세요.", link, `material_${kind}:${materialId}:${Date.now()}`);
  };

  router.get("/api/admin/education/materials/workflow", ...admin, handle((req, res) => {
    const stage = typeof req.query.stage === "string" && (STAGES as readonly string[]).includes(req.query.stage) ? req.query.stage as Stage : undefined;
    const list = workflow.list(stage);
    const counts = Object.fromEntries(STAGES.map((s) => [s, workflow.list(s).length]));
    res.json({ materials: list, counts, labels: STAGE_LABEL });
  }));
  router.get("/api/admin/education/materials/:id/workflow", ...admin, handle((req, res) => res.json(workflow.detail(String(req.params.id)))));
  router.post("/api/admin/education/materials/:id/submit", ...admin, handle((req, res) => {
    const { comment } = parse(OptionalComment, req.body), id = String(req.params.id);
    const out = workflow.submit(id, me(res), comment); tell(id, me(res), "submitted"); res.json(out);
  }));
  router.post("/api/admin/education/materials/:id/comment", ...admin, handle((req, res) => res.json(workflow.comment(String(req.params.id), me(res), parse(Comment, req.body).comment))));
  router.post("/api/admin/education/materials/:id/request-changes", ...admin, handle((req, res) => {
    const id = String(req.params.id), out = workflow.requestChanges(id, me(res), parse(Comment, req.body).comment); tell(id, me(res), "changes"); res.json(out);
  }));
  router.post("/api/admin/education/materials/:id/revise", ...admin, handle((req, res) => {
    const { comment, ...changes } = parse(Revise, req.body);
    res.status(201).json(workflow.revise(String(req.params.id), me(res), changes, comment));
  }));
  router.post("/api/admin/education/materials/:id/check", ...admin, handle((req, res) => {
    const id = String(req.params.id);
    if (!workflow.material(id)) throw new CheckpointError(404, "자료를 찾지 못했어요.");
    res.status(202).json(jobs.enqueue(me(res), "material-check", { material_id: id }));
  }));
  return router;
}

/** 작업 대기열 종류 'material-check': 검수 도우미 결과를 기록(checked)과 작업 결과로 남긴다. */
export function materialCheckJob(workflow: MaterialWorkflow) {
  return {
    role: "admin" as const, label: "자료 검수 도우미", priority: 1,
    parse: (p: unknown) => z.object({ material_id: z.string().min(1) }).parse(p),
    run: async (payload: unknown, ctx: { userId: string }) => {
      const { material_id } = payload as { material_id: string };
      const m = workflow.material(material_id);
      if (!m) throw new CheckpointError(404, "자료를 찾지 못했어요.");
      const result = checkMaterial(m, SECTION_NAMES[m.section as Section] ?? m.section);
      workflow.log(material_id, ctx.userId, "checked", result.notes.map((n) => `${n.level === "warn" ? "⚠" : "·"} ${n.text}`).join("\n"));
      return { material_id, ...result };
    },
  };
}
