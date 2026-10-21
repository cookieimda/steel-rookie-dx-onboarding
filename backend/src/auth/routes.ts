// 회원가입·로그인·아이디 찾기·비밀번호 재설정 API. 요청·응답 형식은 docs/auth-api.md.
import express, { type NextFunction, type Request, type Response } from "express";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { DEMO_ACCOUNTS, demoAccountsEnabled, demoPassword } from "./demo-accounts.js";
import { signToken, TOKEN_TTL, verifyToken } from "./tokens.js";
import { DuplicateUserError, type User, type UserRepository } from "./users.js";

const Username = z.string().trim().regex(/^[a-z0-9_]{4,20}$/, "아이디는 영문 소문자·숫자·_로 4~20자로 입력해 주세요.");
// bcrypt는 72바이트까지만 비교하므로 그보다 긴 비밀번호는 받지 않는다.
const Password = z
  .string()
  .min(8, "비밀번호는 8자 이상으로 입력해 주세요.")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "비밀번호가 너무 길어요.");
const Name = z.string().trim().min(1, "이름을 입력해 주세요.").max(20, "이름은 20자 이하로 입력해 주세요.");
const EmployeeNo = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "사번은 영문·숫자·-로 3~20자로 입력해 주세요.");

const SignupBody = z.object({ username: Username, password: Password, name: Name, employee_no: EmployeeNo });
const LoginBody = z.object({ username: z.string().trim(), password: z.string(), remember: z.boolean().optional() });
const FindIdBody = z.object({ name: Name, employee_no: EmployeeNo });
const ResetBody = z.object({ username: z.string().trim(), name: Name, employee_no: EmployeeNo, password: Password });

// 본인 확인에 실패하면 조금 늦게 답해, 이름·사번을 바꿔 가며 맞혀 보는 시도를 느리게 한다.
const FAIL_DELAY_MS = 500;

export interface AuthDeps {
  users: UserRepository;
  secret: Uint8Array;
}

export function createAuthRouter({ users, secret }: AuthDeps): express.Router {
  const router = express.Router();

  router.post("/api/auth/signup", async (req, res) => {
    const body = SignupBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }
    try {
      const user = await users.create(body.data);
      res.status(201).json({ token: await signToken(user, secret), user });
    } catch (error) {
      if (!(error instanceof DuplicateUserError)) throw error;
      res.status(409).json(
        error.field === "username"
          ? { error: "이미 쓰고 있는 아이디예요.", code: "USERNAME_TAKEN" }
          : { error: "이미 가입된 사번이에요. 아이디 찾기를 이용해 주세요.", code: "EMPLOYEE_NO_TAKEN" },
      );
    }
  });

  router.post("/api/auth/login", async (req, res) => {
    const body = LoginBody.safeParse(req.body);
    const user = body.success ? await users.verify(body.data.username, body.data.password) : null;
    if (!user) {
      res.status(401).json({ error: "아이디 또는 비밀번호가 맞지 않아요.", code: "INVALID_CREDENTIALS" });
      return;
    }
    const ttl = body.data?.remember ? TOKEN_TTL.remember : TOKEN_TTL.session;
    res.json({ token: await signToken(user, secret, ttl), user });
  });

  router.post("/api/auth/find-id", async (req, res) => {
    const body = FindIdBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }
    const user = users.findByIdentity(body.data.name, body.data.employee_no);
    if (!user) {
      await sleep(FAIL_DELAY_MS);
      res.status(404).json({ error: "이름과 사번이 맞는 계정이 없어요.", code: "NOT_FOUND" });
      return;
    }
    res.json({ username: user.username });
  });

  router.post("/api/auth/reset-password", async (req, res) => {
    const body = ResetBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }
    const user = users.findByIdentity(body.data.name, body.data.employee_no);
    if (!user || user.username !== body.data.username) {
      await sleep(FAIL_DELAY_MS);
      res.status(404).json({ error: "아이디·이름·사번이 맞는 계정이 없어요.", code: "NOT_FOUND" });
      return;
    }
    // 시연 계정은 모두가 같은 비밀번호로 쓰므로 한 사람이 바꾸지 못하게 막는다.
    if (demoAccountsEnabled() && DEMO_ACCOUNTS.some((a) => a.username === user.username)) {
      res.status(403).json({ error: "시연 계정은 비밀번호를 바꿀 수 없어요.", code: "DEMO_ACCOUNT" });
      return;
    }
    await users.setPassword(user.id, body.data.password);
    res.json({ ok: true });
  });

  // 로그인 화면의 일반 사용자/관리자 토글이 쓰는 시연 계정 목록. 꺼져 있으면 빈 목록을 준다.
  router.get("/api/auth/demo-accounts", (_req, res) => {
    if (!demoAccountsEnabled()) {
      res.json({ accounts: [], password: null });
      return;
    }
    const accounts = DEMO_ACCOUNTS.map(({ username, role, name }) => ({ username, role, name }));
    res.json({ accounts, password: demoPassword() });
  });

  router.get("/api/auth/me", requireUser({ users, secret }), (_req, res) => {
    res.json({ user: res.locals.user });
  });

  return router;
}

/** Authorization: Bearer 토큰을 확인하고 res.locals.user에 로그인한 사용자를 넣는다. */
export function requireUser({ users, secret }: AuthDeps) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    if (!token) {
      res.status(401).json({ error: "로그인이 필요해요.", code: "AUTH_REQUIRED" });
      return;
    }
    const userId = await verifyToken(token, secret);
    // 토큰이 맞아도 계정이 지워졌으면 로그인을 다시 하게 한다.
    const user: User | null = userId ? users.findById(userId) : null;
    if (!user) {
      res.status(401).json({ error: "로그인이 만료됐어요. 다시 로그인해 주세요.", code: "TOKEN_INVALID" });
      return;
    }
    res.locals.user = user;
    next();
  };
}

/** requireUser 뒤에 둔다. 관리자가 아니면 403. */
export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  if ((res.locals.user as User | undefined)?.role !== "admin") {
    res.status(403).json({ error: "관리자만 볼 수 있어요.", code: "ADMIN_ONLY" });
    return;
  }
  next();
}
