import { jwtVerify, SignJWT } from "jose";
import { randomBytes } from "node:crypto";
import type { User } from "./users.js";

// 로그인 상태 유지를 켜면 7일, 끄면 12시간.
export const TOKEN_TTL = { remember: "7d", session: "12h" } as const;

let cachedSecret: Uint8Array | null = null;

/**
 * .env의 JWT_SECRET. 없으면 프로세스마다 한 번 임시 키를 만들므로 서버를 다시 켜면 모든 로그인이 풀린다(로컬 개발용).
 * 로그인 라우터와 요청 사용자 구분(request-user.ts)이 같은 키를 쓰도록 처음 만든 키를 계속 돌려준다.
 */
export function jwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) cachedSecret = new TextEncoder().encode(secret);
  else {
    console.warn("JWT_SECRET이 없어 임시 키를 씁니다. 서버를 다시 켜면 로그인이 풀립니다.");
    cachedSecret = randomBytes(32);
  }
  return cachedSecret;
}

export function signToken(user: User, secret: Uint8Array, ttl: string = TOKEN_TTL.session): Promise<string> {
  // 권한 확인은 토큰의 role이 아니라 DB에서 다시 읽은 role로 한다(requireUser).
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret);
}

/** 서명·만료를 확인하고 사용자 id를 돌려준다. 틀린 토큰이면 null. */
export async function verifyToken(token: string, secret: Uint8Array): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
