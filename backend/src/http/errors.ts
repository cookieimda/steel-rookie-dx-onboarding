// 오류 응답을 한곳에서 만든다. 라우터는 throw만 하고, 모양({ error, code })과 HTTP 상태는 여기서 정한다.
// 화면은 code로 오류 종류를 나눈다(예: LLM_UNAVAILABLE이면 다시 보내기 안내). 문구를 바꿀 때도 이 표만 고친다.
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { CheckpointError, LlmUnavailableError } from "../checkpoint/types.js";
import { UsageLimitError } from "../usage.js";

export const ERRORS = {
  INVALID_INPUT: { status: 400, message: "입력이 올바르지 않아요." },
  FORBIDDEN: { status: 403, message: "이 기능을 쓸 권한이 없어요." },
  NOT_FOUND: { status: 404, message: "찾지 못했어요." },
  CONFLICT: { status: 409, message: "다른 요청과 겹쳤어요. 다시 시도해 주세요." },
  TOO_MANY_ATTEMPTS: { status: 429, message: "시도가 너무 많아요. 5분 뒤 다시 시도해 주세요." },
  USAGE_LIMIT: { status: 429, message: "오늘 쓸 수 있는 튜터 호출을 다 썼어요. 내일 다시 하거나 진행자에게 알려 주세요." },
  LLM_UNAVAILABLE: { status: 502, message: "튜터에 연결하지 못했어요. 잠시 후 같은 내용을 다시 보내 주세요." },
  LLM_NOT_CONFIGURED: { status: 503, message: "튜터 모델이 연결되지 않았어요. 서버의 LLM 설정을 확인해 주세요." },
  INTERNAL: { status: 500, message: "서버 오류가 생겼어요." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;

/** 업무 오류. message를 비우면 ERRORS 표의 문구를 쓴다. */
export class AppError extends Error {
  constructor(readonly code: ErrorCode, message?: string) {
    super(message ?? ERRORS[code].message);
  }
}

const CODE_BY_STATUS: Record<CheckpointError["status"], ErrorCode> = {
  400: "INVALID_INPUT", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "TOO_MANY_ATTEMPTS",
};

export interface ErrorResponse {
  status: number;
  body: { error: string; code: ErrorCode };
}

/** 던져진 오류 → HTTP 상태와 본문. 모르는 오류는 로그를 남기고 500. */
export function errorResponse(error: unknown): ErrorResponse {
  const of = (code: ErrorCode, message?: string, status?: number): ErrorResponse =>
    ({ status: status ?? ERRORS[code].status, body: { error: message ?? ERRORS[code].message, code } });
  if (error instanceof AppError) return of(error.code, error.message);
  // CheckpointError는 체크포인트 밖에서도 상태와 문구를 담는 데 쓰여 왔다. 상태는 그대로 두고 code만 붙인다.
  if (error instanceof CheckpointError) return of(CODE_BY_STATUS[error.status], error.message, error.status);
  if (error instanceof z.ZodError) return of("INVALID_INPUT", error.issues[0]?.message);
  if (error instanceof UsageLimitError) return of("USAGE_LIMIT", `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요. 내일 다시 하거나 진행자에게 알려 주세요.`);
  if (error instanceof LlmUnavailableError) return of(error.status === 503 ? "LLM_NOT_CONFIGURED" : "LLM_UNAVAILABLE");
  // express.json()이 본문을 못 읽은 경우(형식 오류·크기 초과). 이 오류는 status와 expose를 가진다.
  const parser = error as { status?: unknown; expose?: unknown };
  if (typeof parser?.status === "number" && parser.status >= 400 && parser.status < 500 && parser.expose === true) return of("INVALID_INPUT", undefined, parser.status);
  console.error(error);
  return of("INTERNAL");
}

/** 라우터 핸들러를 감싸 예외를 errorResponse로 돌려준다. 비동기 핸들러도 await한다. */
export const handle = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (error) {
    const { status, body } = errorResponse(error);
    res.status(status).json(body);
  }
};

/** 앱 맨 마지막에 한 번 둔다. 어느 라우터에서 던진 오류든 HTML 500 대신 같은 JSON으로 나간다. */
export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, body } = errorResponse(error);
  res.status(status).json(body);
}
