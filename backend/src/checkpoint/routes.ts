import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { CheckpointEngine } from "./engine.js";
import { userIdOf } from "../request-user.js";
import { UsageLimitError } from "../usage.js";
import { CheckpointError, LlmUnavailableError, SECTION_ORDER } from "./types.js";

const SectionParam = z.enum(SECTION_ORDER);
const StartRequest = z.object({ section: SectionParam });
const MessageRequest = z.object({ text: z.string().trim().min(1).max(1000) });

function sendError(res: Response, error: unknown): void {
  if (error instanceof CheckpointError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof UsageLimitError) {
    res.status(429).json({ error: `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요. 내일 다시 하거나 진행자에게 알려 주세요.`, code: "USAGE_LIMIT" });
  } else if (error instanceof LlmUnavailableError) {
    res.status(error.status).json({ error: "튜터에 연결하지 못했습니다. 잠시 후 같은 내용을 다시 보내 주세요.", code: "LLM_UNAVAILABLE" });
  } else {
    console.error(error);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
}

const handle = (fn: (req: Request, res: Response) => Promise<void> | void) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendError(res, error);
  }
};

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CheckpointError(400, message);
  return parsed.data;
}

export function createCheckpointRouter(engine: CheckpointEngine): Router {
  const router = Router();

  router.post("/api/checkpoints", handle(async (req, res) => {
    const { section } = parse(StartRequest, req.body, "section이 올바르지 않습니다.");
    const { created, view } = await engine.start(userIdOf(req), section);
    res.status(created ? 201 : 200).json(view);
  }));

  router.post("/api/checkpoints/:id/messages", handle(async (req, res) => {
    const { text } = parse(MessageRequest, req.body, "답변은 1~1000자로 입력해 주세요.");
    res.json(await engine.respond(userIdOf(req), String(req.params.id), text));
  }));

  router.get("/api/checkpoints/:id", handle((req, res) => {
    res.json(engine.get(userIdOf(req), String(req.params.id)));
  }));

  router.post("/api/checkpoints/:id/retry-evaluation", handle(async (req, res) => {
    res.json(await engine.retryEvaluation(userIdOf(req), String(req.params.id)));
  }));

  // 나중에 이어 풀기: 멈추기(LLM 호출 없음)와 이어 풀기(풀던 개념의 새 질문).
  router.post("/api/checkpoints/:id/pause", handle(async (req, res) => {
    res.json(await engine.pause(userIdOf(req), String(req.params.id)));
  }));

  router.post("/api/checkpoints/:id/resume", handle(async (req, res) => {
    res.json(await engine.resume(userIdOf(req), String(req.params.id)));
  }));

  router.get("/api/sections/:section/progress", handle((req, res) => {
    const section = parse(SectionParam, req.params.section, "section이 올바르지 않습니다.");
    res.json(engine.sectionProgress(userIdOf(req), section));
  }));

  return router;
}
