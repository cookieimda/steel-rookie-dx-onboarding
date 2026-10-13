// 관리자 전용 API. 로그인한 사용자의 role이 admin일 때만 연다.
// 신입사원·개념 통계는 실제 계정과 시연 계정(users.is_demo = 1)을 섞어서 낸다. ?include_demo=false면 시연 계정을 뺀다.
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { AdminSummaryFormatError, type AdminSummarizer } from "../../../llm/src/admin-summary.js";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import { LlmUnavailableError, SECTION_ORDER, type Section } from "../checkpoint/types.js";
import type { Rubric } from "../rubrics.js";
import { UsageLimitError } from "../usage.js";
import { AiSummaryService } from "./ai-summary.js";
import { conceptStats } from "./concept-stats.js";
import { traineeDetail } from "./trainee-detail.js";
import { traineeStats } from "./trainee-stats.js";

export interface AdminOptions {
  /** 관리자 대시보드 AI 요약. 없으면 GET /api/admin/ai-summary가 503(LLM_UNAVAILABLE)을 준다. */
  summarizer?: AdminSummarizer;
  /** 테스트용. 기본은 final 루브릭. */
  rubrics?: () => readonly Rubric[];
}

/** ?section=을 확인한다. 틀리면 400을 보내고 null. */
function sectionParam(req: express.Request, res: express.Response): Section | undefined | null {
  const section = req.query.section;
  if (section !== undefined && !SECTION_ORDER.includes(section as Section)) {
    res.status(400).json({ error: `section은 ${SECTION_ORDER.join(", ")} 중 하나여야 해요.`, code: "INVALID_SECTION" });
    return null;
  }
  return section as Section | undefined;
}

/** ?include_demo=을 확인한다. 없거나 true면 포함, false면 제외. 그 밖의 값이면 400을 보내고 null. */
function includeDemoParam(req: express.Request, res: express.Response): boolean | null {
  const value = req.query.include_demo;
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  res.status(400).json({ error: "include_demo는 true 또는 false여야 해요.", code: "INVALID_INCLUDE_DEMO" });
  return null;
}

export function createAdminRouter(db: DatabaseSync, auth: AuthDeps, options: AdminOptions = {}): express.Router {
  const router = express.Router();
  const summaries = options.summarizer ? new AiSummaryService(db, options.summarizer, options.rubrics) : null;
  router.get("/api/admin/trainees", requireUser(auth), requireAdmin, (req, res) => {
    const includeDemo = includeDemoParam(req, res);
    if (includeDemo === null) return;
    res.json(traineeStats(db, undefined, { includeDemo }));
  });
  // 신입사원 한 명 상세(표에서 사람을 누르면). 오개념은 개수만 낸다.
  router.get("/api/admin/trainees/:id", requireUser(auth), requireAdmin, (req, res) => {
    const detail = traineeDetail(db, String(req.params.id), options.rubrics?.());
    if (!detail) {
      res.status(404).json({ error: "신입사원을 찾지 못했어요.", code: "TRAINEE_NOT_FOUND" });
      return;
    }
    res.json(detail);
  });
  router.get("/api/admin/concepts", requireUser(auth), requireAdmin, (req, res) => {
    const section = sectionParam(req, res);
    if (section === null) return;
    const includeDemo = includeDemoParam(req, res);
    if (includeDemo === null) return;
    res.json(conceptStats(db, section, options.rubrics?.(), { includeDemo }));
  });
  router.get("/api/admin/ai-summary", requireUser(auth), requireAdmin, async (req, res) => {
    const section = sectionParam(req, res);
    if (section === null) return;
    const unavailable = { error: "AI 요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", code: "LLM_UNAVAILABLE" };
    if (!summaries) {
      res.status(503).json(unavailable);
      return;
    }
    try {
      res.json(await summaries.summarize(section));
    } catch (error) {
      if (error instanceof UsageLimitError) {
        res.status(429).json({ error: `오늘 쓸 수 있는 LLM 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      } else if (error instanceof LlmUnavailableError) {
        res.status(error.status).json(unavailable);
      } else if (error instanceof AdminSummaryFormatError) {
        console.error(error.message);
        res.status(502).json(unavailable);
      } else {
        console.error(error);
        res.status(500).json({ error: "서버 오류가 생겼어요." });
      }
    }
  });
  return router;
}
