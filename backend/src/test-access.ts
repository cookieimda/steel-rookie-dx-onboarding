// [임시] 원격 팀원 테스트용 접속 비밀번호. 로그인이 붙으면 지운다.
// .env의 TEST_PASSCODE가 있으면 모든 /api 요청에 X-Test-Passcode 헤더를 확인하고, 비어 있으면 검사하지 않는다(로컬 개발).
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const digest = (value: string) => createHash("sha256").update(value).digest();
const expectedPasscode = () => process.env.TEST_PASSCODE?.trim() ?? "";

export function passcodeRequired(): boolean {
  return expectedPasscode() !== "";
}

export function passcodeGuard(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedPasscode();
  if (!expected) {
    next();
    return;
  }
  let given = "";
  try {
    given = decodeURIComponent(req.get("x-test-passcode") ?? "");
  } catch {
    given = "";
  }
  if (timingSafeEqual(digest(given), digest(expected))) {
    next();
    return;
  }
  // 터널 주소는 공개되므로 틀린 시도는 조금 늦게 답해 무차별 대입을 느리게 한다.
  setTimeout(() => res.status(401).json({ error: "접속 비밀번호가 맞지 않아요.", code: "PASSCODE_REQUIRED" }), 500);
}
