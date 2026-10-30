import { Router } from "express";
import { z } from "zod";
import type { CheckpointEngine } from "./engine.js";
import { handle } from "../http/errors.js";
import { userIdOf } from "../request-user.js";
import { CheckpointError, SECTION_ORDER } from "./types.js";

const SectionParam = z.enum(SECTION_ORDER);
const StartRequest = z.object({ section: SectionParam });
const MessageRequest = z.object({ text: z.string().trim().min(1).max(1000) });

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CheckpointError(400, message);
  return parsed.data;
}

export function createCheckpointRouter(engine: CheckpointEngine): Router {
  const router = Router();

  router.post("/api/checkpoints", handle(async (req, res) => {
    const { section } = parse(StartRequest, req.body, "section이 올바르지 않아요.");
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

  router.get("/api/sections", handle((_req, res) => {
    res.json(engine.sections());
  }));

  router.get("/api/sections/:section/progress", handle((req, res) => {
    const section = parse(SectionParam, req.params.section, "section이 올바르지 않아요.");
    res.json(engine.sectionProgress(userIdOf(req), section));
  }));

  return router;
}
