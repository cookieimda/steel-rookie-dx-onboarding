// 3D 모델 캐시(asset-version.ts): 해시 목록, ?v가 붙은 GLB만 1년 캐시
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { assetHashes, assetHashesScript, modelCdnBase } from "../src/asset-version.js";
import { CheckpointEngine } from "../src/checkpoint/engine.js";
import { CheckpointRepository } from "../src/checkpoint/repository.js";
import { openDatabase } from "../src/db/database.js";
import { LlmUsage } from "../src/usage.js";
import { FakeEvaluator, FakeTutor, IRONMAKING } from "./checkpoint-fakes.js";

function webRoot() {
  const root = mkdtempSync(join(tmpdir(), "asset-cache-"));
  mkdirSync(join(root, "models", "character"), { recursive: true });
  writeFileSync(join(root, "models", "rolling.glb"), "glb-a");
  writeFileSync(join(root, "models", "character", "tutor.glb"), "glb-b");
  writeFileSync(join(root, "page.js"), "console.log(1)");
  return root;
}

test("assetHashes: 하위 폴더까지 GLB마다 내용 해시(10자)를 만들고, 내용이 바뀌면 해시도 바뀐다", () => {
  const root = webRoot(), h = assetHashes(join(root, "models"));
  assert.deepEqual(Object.keys(h).sort(), ["character/tutor.glb", "rolling.glb"]);
  assert.match(h["rolling.glb"], /^[0-9a-f]{10}$/);
  writeFileSync(join(root, "models", "rolling.glb"), "glb-a2");
  assert.notEqual(assetHashes(join(root, "models"))["rolling.glb"], h["rolling.glb"]);
  assert.deepEqual(assetHashes(join(root, "없는 폴더")), {});
});

test("HTTP: 해시 목록은 매번 확인, ?v가 붙은 GLB만 1년 캐시(immutable), 나머지는 기본값", async (t) => {
  const db = openDatabase(":memory:"), usage = new LlmUsage(db, 150);
  const engine = new CheckpointEngine({ repo: new CheckpointRepository(db), evaluator: new FakeEvaluator(), tutor: new FakeTutor(), rubrics: [IRONMAKING] });
  const server = createApp({ engine, usage, webRoot: webRoot() }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const path of ["/3d-demo/asset-hashes.js", "/asset-hashes.js"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /javascript/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.match(await res.text(), /^export const V = \{"character\/tutor\.glb":"[0-9a-f]{10}","rolling\.glb":"[0-9a-f]{10}"\};\nexport const BASE = "";/);
  }
  assert.equal((await fetch(`${base}/3d-demo/models/rolling.glb?v=abc`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(`${base}/models/character/tutor.glb?v=abc`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(`${base}/3d-demo/models/rolling.glb`)).headers.get("cache-control"), "public, max-age=0");
  assert.equal((await fetch(`${base}/3d-demo/page.js?v=abc`)).headers.get("cache-control"), "public, max-age=0");
});

test("modelCdnBase: jsdelivr는 Render의 저장소·커밋으로 고정 주소를 만들고, 값이 없거나 이상하면 쓰지 않는다", () => {
  const render = { RENDER_GIT_REPO_SLUG: "cookieimda/steel-rookie-dx-onboarding", RENDER_GIT_COMMIT: "6cc32d7f146bc8937b593acdcf15c00cccdfa3cf" };
  assert.equal(modelCdnBase({ ...render, MODEL_CDN: "jsdelivr" }), "https://cdn.jsdelivr.net/gh/cookieimda/steel-rookie-dx-onboarding@6cc32d7f146bc8937b593acdcf15c00cccdfa3cf/frontend/3d-demo/models/");
  assert.equal(modelCdnBase({ MODEL_CDN: "jsdelivr" }), ""); // 로컬(Render 값 없음)
  assert.equal(modelCdnBase({ ...render, MODEL_CDN: "off" }), "");
  assert.equal(modelCdnBase({ ...render }), "");
  assert.equal(modelCdnBase({ RENDER_GIT_REPO_SLUG: "a/b\"; alert(1)//", RENDER_GIT_COMMIT: "abc1234", MODEL_CDN: "jsdelivr" }), "");
  assert.equal(modelCdnBase({ MODEL_CDN: "https://cdn.example.com/models" }), "https://cdn.example.com/models/");
  assert.equal(modelCdnBase({ MODEL_CDN: "http://insecure.example.com/" }), "");
  assert.equal(assetHashesScript({ "a.glb": "1" }, "https://x/"), 'export const V = {"a.glb":"1"};\nexport const BASE = "https://x/";\n');
});
