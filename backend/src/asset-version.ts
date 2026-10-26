// 3D 모델(GLB) 캐시: 서버가 시작할 때 models/ 아래 GLB마다 내용 해시를 계산해 /3d-demo/asset-hashes.js로 내려준다.
// 화면(frontend/3d-demo/asset-version.js)은 GLB 주소 뒤에 ?v=해시를 붙여 받고, 서버는 ?v가 붙은 GLB를 1년 동안 다시 묻지 않게(immutable) 보낸다.
// 모델 내용이 바뀌면 해시가 바뀌어 주소가 달라지므로 새 모델을 바로 받는다. 해시 목록 자체는 매번 확인(no-cache, ETag)한다.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Response } from "express";

/** models 폴더 아래 GLB의 { "ironmaking.glb": "1a2b3c4d5e", "character/tutor.glb": … }. 폴더가 없으면 빈 객체 */
export function assetHashes(modelsDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".glb")) out[relative(modelsDir, full).split(sep).join("/")] = createHash("sha256").update(readFileSync(full)).digest("hex").slice(0, 10);
    }
  };
  walk(modelsDir);
  return out;
}

/** 화면이 import하는 모듈 본문 */
export const assetHashesScript = (hashes: Record<string, string>) => `export const V = ${JSON.stringify(hashes)};\n`;

/** express.static의 setHeaders: ?v=가 붙은 GLB만 1년 캐시. 나머지(HTML·JS·CSS)는 기본값(매번 ETag로 확인) */
export function cacheVersionedGlb(res: Response, path: string): void {
  if (path.endsWith(".glb") && typeof res.req.query.v === "string" && res.req.query.v) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}
