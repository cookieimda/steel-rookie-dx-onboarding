// 운영 API 묶음: 오답 패턴(관리자·본인)과 작업 대기열에 넣는 운영 작업 종류(보고서·알림·패턴·검수 도우미).
//   GET /api/admin/misconception-patterns  개념별 오답 유형(이름표·개수만)
//   GET /api/me/misconception-patterns     내 오답 유형(내 설명 포함)
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { traineeReportCsv } from "../admin/report.js";
import { defaultDemoSections, defaultRubrics, traineeStats } from "../admin/trainee-stats.js";
import { SECTION_NAMES, type Section } from "../checkpoint/types.js";
import { statSections } from "../demo-sections.js";
import { jobProgress, type EducationJobs } from "../education/jobs.js";
import { materialCheckJob } from "../education/workflow-routes.js";
import type { MaterialWorkflow } from "../education/workflow.js";
import type { Notifier } from "../notify/service.js";
import { misconceptionPatterns, myPatterns, type ConceptRef } from "./patterns.js";

/** 지금 루브릭 개념 + 루브릭이 없는 섹션은 시연 개념 목록(관리자 통계와 같은 기준). */
export const statConcepts = (): ConceptRef[] =>
  statSections(defaultRubrics(), defaultDemoSections()).flatMap((s) => s.concepts.map((c) => ({ section: s.section, concept_id: c.concept_id, name: c.name })));
const conceptName = (section: string, id: string) =>
  statConcepts().find((c) => c.section === section && c.concept_id === id)?.name ?? `${SECTION_NAMES[section as Section] ?? section} 관련 개념`;

export function createOpsRouter(auth: AuthDeps, db: DatabaseSync): express.Router {
  const router = express.Router(), login = requireUser(auth);
  router.get("/api/admin/misconception-patterns", login, requireAdmin, (_req, res) => res.json({ concepts: misconceptionPatterns(db, statConcepts()) }));
  router.get("/api/me/misconception-patterns", login, (_req, res) => res.json({ patterns: myPatterns(db, (res.locals.user as User).id, conceptName) }));
  return router;
}

/** 작업 대기열에 운영 작업 종류를 등록한다(서버 시작 때). */
export function registerOpsJobs(jobs: EducationJobs, deps: { db: DatabaseSync; notifier: Notifier; workflow: MaterialWorkflow }) {
  jobs.register("admin-report", {
    role: "admin", label: "학습 현황 보고서(CSV)", priority: 0, maxAttempts: 2,
    run: async () => {
      jobProgress(0.2);
      const stats = traineeStats(deps.db);
      jobProgress(0.8);
      const csv = traineeReportCsv(stats);
      return { filename: `st-rookie-report-${new Date().toISOString().slice(0, 10)}.csv`, rows: stats.trainees.length, csv };
    },
  });
  jobs.register("notifications-run", {
    role: "admin", label: "정기 알림 만들기·발송", priority: 2, maxAttempts: 3,
    run: async () => { const made = deps.notifier.generateAll(); jobProgress(0.5); return { made, delivery: await deps.notifier.deliverPending() }; },
  });
  jobs.register("misconception-patterns", {
    role: "admin", label: "오답 패턴 분류", priority: 0,
    run: async () => ({ concepts: misconceptionPatterns(deps.db, statConcepts()) }),
  });
  jobs.register("material-check", materialCheckJob(deps.workflow));
}
