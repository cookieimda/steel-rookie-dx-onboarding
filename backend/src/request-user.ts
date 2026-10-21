// 요청한 사용자 구분.
// - 로그인 토큰(Authorization: Bearer)이 있으면 토큰의 사용자 id(users.id)로 구분한다. 토큰이 틀리거나 만료됐으면 401.
// - [임시] 토큰이 없으면 예전처럼 X-User-Id 헤더(프론트가 URL의 ?user=이름을 encodeURIComponent로 보냄)로 구분한다.
//   모든 화면이 로그인 토큰을 보내게 되면 헤더 방식은 지운다.
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { jwtSecret, verifyToken } from "./auth/tokens.js";
import { CheckpointError } from "./checkpoint/types.js";

export const DEFAULT_USER_ID = "demo-user";
const USER_ID = /^[\p{L}\p{N}_-]{1,32}$/u;

/** withRequestUser가 토큰에서 찾은 사용자 id. userIdOf()가 먼저 본다. */
const tokenUsers = new WeakMap<Request, string>();

/** X-User-Id 헤더(임시)로 사용자를 구분한다. 없으면 demo-user. */
function headerUserId(req: Request): string {
  const raw = req.get("x-user-id");
  if (raw === undefined || raw === "") return DEFAULT_USER_ID;
  let name: string;
  try {
    name = decodeURIComponent(raw).normalize("NFC").trim();
  } catch {
    throw new CheckpointError(400, "사용자 이름을 읽지 못했어요.");
  }
  if (!USER_ID.test(name)) throw new CheckpointError(400, "사용자 이름은 한글·영문·숫자·_·-로 32자 이하만 쓸 수 있어요.");
  return name;
}

/** 이 요청의 사용자. withRequestUser를 거친 요청이면 로그인 토큰의 사용자, 아니면 X-User-Id 헤더. */
export function userIdOf(req: Request): string {
  return tokenUsers.get(req) ?? headerUserId(req);
}

/** 요청 처리 중 어디서든(예: LLM 호출 직전) 현재 사용자를 알 수 있게 한다. */
const store = new AsyncLocalStorage<{ userId: string }>();

export async function withRequestUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
  let userId: string;
  if (token) {
    const id = await verifyToken(token, jwtSecret());
    if (!id) {
      res.status(401).json({ error: "로그인이 만료됐어요. 다시 로그인해 주세요.", code: "TOKEN_INVALID" });
      return;
    }
    tokenUsers.set(req, id);
    userId = id;
  } else {
    try {
      userId = headerUserId(req);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
  }
  store.run({ userId }, next);
}

export const currentUserId = (): string => store.getStore()?.userId ?? DEFAULT_USER_ID;
