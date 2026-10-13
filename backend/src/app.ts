// Express 앱 구성. 실행(포트·DB·Gemini 연결)은 ironmaking-server.ts가 한다.
// 프론트(frontend/3d-demo)도 이 서버가 같은 출처로 서빙하고, 프론트는 API를 상대 경로(/api/...)로 부른다.
import express from "express";
import { join } from "node:path";
import { DEFAULT_GEMINI_MODEL } from "../../llm/src/gemini.js";
import type { CheckpointEngine } from "./checkpoint/engine.js";
import { createCheckpointRouter } from "./checkpoint/routes.js";
import { withRequestUser } from "./request-user.js";
import { passcodeGuard, passcodeRequired } from "./test-access.js";
import type { LlmUsage } from "./usage.js";

export interface AppDeps {
  engine: CheckpointEngine;
  usage: LlmUsage;
  webRoot?: string;
  /** 학습 모드 라우터(POST /api/chat, backend/src/learning/routes.ts). */
  learning?: express.Router;
}

export function createApp({ engine, usage, webRoot = join(process.cwd(), "frontend", "3d-demo"), learning }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  // 비밀번호 없이 열리는 유일한 API: 프론트가 첫 화면에서 비밀번호 입력창을 띄울지 정한다.
  app.get("/api/access", (_req, res) => {
    res.json({ passcode_required: passcodeRequired(), daily_limit: usage.dailyLimit });
  });
  app.use("/api", passcodeGuard, withRequestUser);

  app.use(createCheckpointRouter(engine));
  if (learning) app.use(learning);
  app.use(express.static(webRoot));

  app.get("/api/status", (_req, res) => {
    res.json({ connected: Boolean(process.env.GEMINI_API_KEY), provider: "Gemini", model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL });
  });

  // 첫 화면은 최종 페이지(v3).
  app.get("/", (_req, res) => res.sendFile(join(webRoot, "Steel Academy v4.dc.html")));
  return app;
}
