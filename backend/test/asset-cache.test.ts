// 3D 모델 캐시(asset-version.ts): 해시 목록, ?v가 붙은 GLB만 1년 캐시
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { assetHashes } from "../src/asset-version.js";
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
    assert.match(await res.text(), /^export const V = \{"character\/tutor\.glb":"[0-9a-f]{10}","rolling\.glb":"[0-9a-f]{10}"\};/);
  }
  assert.equal((await fetch(`${base}/3d-demo/models/rolling.glb?v=abc`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(`${base}/models/character/tutor.glb?v=abc`)).headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal((await fetch(`${base}/3d-demo/models/rolling.glb`)).headers.get("cache-control"), "public, max-age=0");
  assert.equal((await fetch(`${base}/3d-demo/page.js?v=abc`)).headers.get("cache-control"), "public, max-age=0");
});
