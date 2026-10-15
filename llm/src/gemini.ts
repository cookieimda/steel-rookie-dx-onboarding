// Gemini GenerateContent 호출 공통 코드. 평가자와 튜터가 함께 쓴다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";

/** GEMINI_MODEL이 비어 있을 때 쓰는 모델. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface GenerateRequest {
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  /** 있으면 JSON 응답을 이 스키마로 강제한다(Gemini responseSchema). */
  responseSchema?: object;
  /**
   * 있으면 streamGenerateContent(SSE)로 받아 받은 글자를 차례로 넘긴다(학습 모드 답을 화면에 바로 보여 줄 때). 지금까지 받은 전체 텍스트를 넘긴다.
   * 돌려주는 값은 스트리밍과 상관없이 전체 텍스트다.
   */
  onText?: (soFar: string) => void;
}

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 실제 호출 직전에 부른다(예: 사용자별 호출 수 제한). 예외를 던지면 호출하지 않는다. */
  beforeCall?: () => void;
}

/** 연결·HTTP 오류의 종류. 재시도할지는 호출하는 쪽(예: 평가 스크립트)이 정한다. */
export type GeminiFailure = "rate_limit" | "timeout" | "network" | "http";

/** Gemini 호출 실패. 서버는 LlmUnavailableError로 처리하고, 평가 스크립트는 reason으로 재시도를 정한다. */
export class GeminiCallError extends LlmUnavailableError {
  constructor(message: string, readonly reason: GeminiFailure, readonly httpStatus?: number) {
    super(message);
  }

  /** 429, 시간 초과, 연결 실패(fetch failed 등)는 잠시 뒤 다시 하면 될 수 있다. */
  get retryable(): boolean {
    return this.reason !== "http";
  }
}

function connectionError(error: unknown): GeminiCallError {
  const e = error as Error;
  const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
  return new GeminiCallError(`Gemini 연결 실패: ${e?.message ?? String(error)}`, timeout ? "timeout" : "network");
}

export class GeminiClient {
  constructor(private readonly options: GeminiOptions = {}) {}

  /** 응답 텍스트를 돌려준다. 키가 없거나 연결·HTTP 오류면 LlmUnavailableError. */
  async generate(req: GenerateRequest): Promise<string> {
    // 서버가 키 없이도 시작할 수 있도록 호출할 때 읽는다.
    const apiKey = this.options.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new LlmUnavailableError("GEMINI_API_KEY가 설정되지 않았습니다.", 503);
    const model = this.options.model ?? (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
    const doFetch = this.options.fetch ?? fetch;
    this.options.beforeCall?.();

    let response: Response;
    try {
      response = await doFetch(
        // onText가 있으면 streamGenerateContent(SSE)로 받아 조각마다 알린다.
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${req.onText ? "streamGenerateContent?alt=sse" : "generateContent"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: "user", parts: [{ text: req.prompt }] }],
            generationConfig: {
              temperature: req.temperature,
              maxOutputTokens: req.maxOutputTokens,
              ...(req.responseSchema
                ? { responseMimeType: "application/json", responseSchema: req.responseSchema }
                : { responseMimeType: "text/plain" }),
            },
          }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
        },
      );
    } catch (error) {
      throw connectionError(error);
    }
    if (!response.ok) {
      throw new GeminiCallError(`Gemini HTTP ${response.status}`, response.status === 429 ? "rate_limit" : "http", response.status);
    }
    type Result = { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const textOf = (r: Result) => r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (req.onText) {
      let text = "";
      try {
        await readLines(response, (line) => {
          if (!line.startsWith("data:")) return;
          text += textOf(JSON.parse(line.slice(5)) as Result);
          req.onText!(text);
        });
      } catch (error) {
        throw error instanceof SyntaxError ? new GeminiCallError("Gemini 응답이 JSON이 아님", "http", response.status) : connectionError(error);
      }
      return text;
    }
    let result: Result;
    try {
      // 본문을 읽는 중에도 시간 초과·연결 끊김이 날 수 있다.
      result = (await response.json()) as typeof result;
    } catch (error) {
      throw error instanceof SyntaxError ? new GeminiCallError("Gemini 응답이 JSON이 아님", "http", response.status) : connectionError(error);
    }
    return textOf(result);
  }
}

/** 응답 본문을 줄 단위로 읽는다(SSE·NDJSON 스트리밍). 빈 줄은 건너뛴다. */
export async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) throw new Error("응답 본문이 없습니다.");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onLine(line);
    }
  }
  const rest = (buffer + decoder.decode()).trim();
  if (rest) onLine(rest);
}

const PROMPT_DIR = join(process.cwd(), "llm", "prompts");

/** llm/prompts/{name}.md를 읽어 {{key}}를 채운다. 빠진 값이 있으면 예외. */
export function renderPrompt(name: string, values: Record<string, string>): string {
  const template = readFileSync(join(PROMPT_DIR, `${name}.md`), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`프롬프트 ${name}에 값이 없다: ${key}`);
    return values[key]!;
  });
}

/** 구분자(<question>, <answer>)를 닫거나 새로 열 수 없게 꺾쇠를 이스케이프한다. */
export function escapeDelimited(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
