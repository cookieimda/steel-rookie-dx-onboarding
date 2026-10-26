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

/**
 * 공정 모델을 CDN에서 받을 주소(끝이 /). MODEL_CDN이 비었거나 off면 '' = 이 서버에서 받는다.
 * - jsdelivr: GitHub 공개 저장소를 그대로 내주는 jsDelivr(계정 불필요). Render가 넣어 주는 저장소 이름·커밋(RENDER_GIT_REPO_SLUG·RENDER_GIT_COMMIT)으로
 *   커밋을 고정한 주소를 만든다(바뀌지 않는 주소라 CDN·브라우저가 오래 캐시한다). 두 값이 없으면(로컬) 쓰지 않는다.
 * - https://로 시작하는 주소: 그 주소를 그대로 앞에 붙인다(다른 CDN을 쓸 때).
 */
export function modelCdnBase(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.MODEL_CDN || "").trim();
  if (!v || v === "off") return "";
  if (v === "jsdelivr") {
    const slug = env.RENDER_GIT_REPO_SLUG, sha = env.RENDER_GIT_COMMIT;
    return slug && sha && /^[\w.-]+\/[\w.-]+$/.test(slug) && /^[0-9a-f]{7,40}$/.test(sha) ? `https://cdn.jsdelivr.net/gh/${slug}@${sha}/frontend/3d-demo/models/` : "";
  }
  return /^https:\/\/\S+$/.test(v) ? v.replace(/\/?$/, "/") : "";
}

/** 화면이 import하는 모듈 본문. BASE가 있으면 공정 모델을 그 주소에서 받는다(실패하면 화면이 이 서버로 다시 받는다) */
export const assetHashesScript = (hashes: Record<string, string>, base = "") => `export const V = ${JSON.stringify(hashes)};\nexport const BASE = ${JSON.stringify(base)};\n`;

/** express.static의 setHeaders: ?v=가 붙은 GLB만 1년 캐시. 나머지(HTML·JS·CSS)는 기본값(매번 ETag로 확인) */
export function cacheVersionedGlb(res: Response, path: string): void {
  if (path.endsWith(".glb") && typeof res.req.query.v === "string" && res.req.query.v) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}
