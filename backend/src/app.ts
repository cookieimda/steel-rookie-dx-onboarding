// Express 앱 구성. 실행(포트·DB·LLM 연결)은 ironmaking-server.ts가 한다.
// 프론트(frontend/3d-demo)도 이 서버가 같은 출처로 서빙하고, 프론트는 API를 상대 경로(/api/...)로 부른다.
import compression from "compression";
import express from "express";
import { join } from "node:path";
import { OllamaClient } from "../../llm/src/ollama.js";
import { providerInfo } from "../../llm/src/provider.js";
import { traceMiddleware, type TraceSink } from "../../llm/src/trace.js";
import type { CheckpointEngine } from "./checkpoint/engine.js";
import { createCheckpointRouter } from "./checkpoint/routes.js";
import { assetHashes, assetHashesScript, cacheVersionedGlb, modelCdnBase } from "./asset-version.js";
import { withRequestUser } from "./request-user.js";
import { passcodeGuard, passcodeRequired } from "./test-access.js";
import type { LlmUsage } from "./usage.js";

export interface AppDeps {
  engine: CheckpointEngine;
  usage: LlmUsage;
  webRoot?: string;
  /** 학습 모드 라우터(POST /api/chat, backend/src/learning/routes.ts). */
  learning?: express.Router;
  /** 체크포인트 요청 trace(kind checkpoint, llm/src/trace.ts)를 받는 곳. 없으면 남기지 않는다. */
  traceSink?: TraceSink;
}

export function createApp({ engine, usage, webRoot = join(process.cwd(), "frontend", "3d-demo"), learning, traceSink }: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // 화면 파일(HTML·JS·3D 모델)은 gzip으로 줄여 보낸다. /api는 빼다: 학습 모드 답변 스트리밍(NDJSON)을 압축하면 버퍼에 쌓여 한꺼번에 도착한다.
  app.use(compression({ filter: (req, res) => !req.path.startsWith("/api/") && compression.filter(req, res) }));
  // 요청 본문은 16kb까지. 마이페이지 펜 필기 저장(PUT /api/me/sketches)만 획이 많아 자기 라우트에서 400kb로 따로 읽는다(me/routes.ts).
  const json16 = express.json({ limit: "16kb" });
  const materialJson = express.json({ limit: "128kb" });
  app.use((req, res, next) => {
    if (req.method === "PUT" && req.path.startsWith("/api/me/sketches/")) return next();
    if (req.method === "POST" && req.path === "/api/admin/education/materials") return materialJson(req, res, next);
    return json16(req, res, next);
  });

  // 비밀번호 없이 열리는 유일한 API: 프론트가 첫 화면에서 비밀번호 입력창을 띄울지 정한다.
  app.get("/api/access", (_req, res) => {
    res.json({ passcode_required: passcodeRequired(), daily_limit: usage.dailyLimit });
  });
  app.use("/api", passcodeGuard, withRequestUser);

  // 체크포인트(이해도 확인) 요청마다 trace: 질문·채점·설명 호출의 시간·모델·토큰(docs/agent-observability.md).
  app.use("/api/checkpoints", traceMiddleware("checkpoint", traceSink));
  app.use(createCheckpointRouter(engine));
  if (learning) app.use(learning);
  // GLB 내용 해시(asset-version.ts). /?p=…처럼 3D 화면을 주소 맨 앞에서 열 때도 상대 경로로 찾으므로 두 자리에 둔다
  const hashesJs = assetHashesScript(assetHashes(join(webRoot, "models")), modelCdnBase());
  app.get(["/asset-hashes.js", "/3d-demo/asset-hashes.js"], (_req, res) => { res.type("text/javascript").setHeader("Cache-Control", "no-cache"); res.send(hashesJs); });
  app.use(express.static(webRoot, { setHeaders: cacheVersionedGlb }));

  // 지금 쓰는 LLM(LLM_PROVIDER). Ollama는 서버가 켜져 있고 모델을 받아 두었는지까지 본다(모델은 부르지 않음).
  app.get("/api/status", async (_req, res) => {
    const info = providerInfo();
    if (info.provider === "ollama") {
      const { connected, reason } = await new OllamaClient().checkConnection();
      res.json({ connected, reason, provider: "Ollama", model: info.model });
      return;
    }
    res.json({ connected: Boolean(process.env.GEMINI_API_KEY), provider: "Gemini", model: info.model });
  });

  // 로그인·마이페이지(frontend/login_ui)는 ../3d-demo/를 상대 경로로 읽으므로 두 폴더를 같은 깊이에 둔다.
  const loginRoot = join(webRoot, "..", "login_ui");
  app.use("/3d-demo", express.static(webRoot, { setHeaders: cacheVersionedGlb }));
  app.use("/login_ui", express.static(loginRoot));
  app.get("/login", (_req, res) => res.redirect("/login_ui/My%20Page.dc.html"));
  app.get("/exam", (_req, res) => res.sendFile(join(loginRoot, "exam.html")));

  // 첫 화면은 홈(로그인). 3D 학습 화면(공정 지도 steel-intro)은 로그인한 뒤에 연다.
  // 쿼리가 있는 주소(예: /?p=ironmaking&tutor=1)는 3D 화면으로 바로 들어가는 링크라 공정 인덱스 3D(steel-index.html)를 준다.
  app.get("/", (req, res) => {
    if (Object.keys(req.query).length) res.sendFile(join(webRoot, "steel-index.html"));
    else res.redirect("/login_ui/home-sleek.html");
  });
  return app;
}
