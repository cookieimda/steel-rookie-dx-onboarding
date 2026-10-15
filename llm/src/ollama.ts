// 로컬 모델(Ollama) 호출. GeminiClient와 같은 LlmClient 계약이라 튜터·평가자·학습 에이전트가 provider를 몰라도 된다(provider.ts가 고른다).
// - responseSchema는 JSON Schema로 바꿔 format에 넣고, 형식 검증은 Gemini와 같이 서버가 한 번 더 한다.
// - 오류는 GeminiCallError(reason: timeout·network·http)로 올려 보내 재시도·오류 처리를 Gemini와 같이 탄다.
// - 요청 trace(trace.ts)가 있으면 호출마다 시간·토큰(prompt_eval_count·eval_count)을 남긴다.
// 설정: OLLAMA_BASE_URL(기본 http://localhost:11434), OLLAMA_MODEL(기본 qwen2.5:3b), OLLAMA_NUM_CTX(기본 4096), OLLAMA_KEEP_ALIVE(기본 20m), OLLAMA_TIMEOUT_MS(기본 180000).
import { performance } from "node:perf_hooks";
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { GeminiCallError, readLines } from "./gemini.js";
import { toJsonSchema } from "./json-schema.js";
import type { GenerateRequest, LlmClient } from "./llm-client.js";
import { currentTrace, type LlmCallRecord } from "./trace.js";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** 실제 호출 직전에 부른다(예: 사용자별 호출 수 제한). 예외를 던지면 호출하지 않는다. */
  beforeCall?: () => void;
  contextLength?: number;
  keepAlive?: string | number;
}

export function ollamaSettings(options: OllamaOptions = {}) {
  return {
    baseUrl: (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, ""),
    model: options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL,
  };
}

export function ollamaRuntimeSettings(options: OllamaOptions = {}) {
  const contextLength = Number(options.contextLength ?? process.env.OLLAMA_NUM_CTX ?? 4096);
  if (!Number.isInteger(contextLength) || contextLength < 1024) throw new Error("OLLAMA_NUM_CTX는 1024 이상의 정수입니다.");
  const timeout = Number(options.timeoutMs ?? process.env.OLLAMA_TIMEOUT_MS ?? 180_000);
  return { contextLength, keepAlive: options.keepAlive ?? process.env.OLLAMA_KEEP_ALIVE ?? "20m", timeoutMs: Number.isInteger(timeout) && timeout > 0 ? timeout : 180_000 };
}

function connectionError(error: unknown): GeminiCallError {
  const e = error as Error;
  const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
  return new GeminiCallError(`Ollama 연결 실패: ${e?.message ?? String(error)}`, timeout ? "timeout" : "network");
}

interface OllamaChunk {
  message?: { content?: unknown };
  error?: unknown;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

const tokensOf = (c: OllamaChunk): LlmCallRecord["tokens"] | undefined =>
  c.prompt_eval_count === undefined && c.eval_count === undefined
    ? undefined
    : { prompt: c.prompt_eval_count, output: c.eval_count, total: (c.prompt_eval_count ?? 0) + (c.eval_count ?? 0) };

export class OllamaClient implements LlmClient {
  constructor(private readonly options: OllamaOptions = {}) {}

  private get doFetch(): typeof fetch {
    return this.options.fetch ?? fetch;
  }

  /** 서버가 켜져 있고 모델을 받아 두었는지(/api/tags). 모델을 부르지 않는다. */
  async checkConnection(): Promise<{ connected: boolean; reason: "ready" | "model_missing" | "unreachable" }> {
    const { baseUrl, model } = ollamaSettings(this.options);
    try {
      const response = await this.doFetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { connected: false, reason: "unreachable" };
      const body = (await response.json()) as { models?: { name?: string; model?: string }[] };
      const names = new Set([model, ...(model.includes(":") ? [] : [`${model}:latest`])]);
      const connected = Array.isArray(body.models) && body.models.some((m) => names.has(m.name ?? "") || names.has(m.model ?? ""));
      return { connected, reason: connected ? "ready" : "model_missing" };
    } catch {
      return { connected: false, reason: "unreachable" };
    }
  }

  /** 모델을 추론과 같은 문맥 길이로 메모리에 올려 둔다(첫 질문이 모델 로딩을 기다리지 않게). 답을 만들지 않고 호출 수에도 들어가지 않는다. */
  async warmUp(): Promise<void> {
    const { baseUrl, model } = ollamaSettings(this.options);
    const { contextLength, keepAlive, timeoutMs } = ollamaRuntimeSettings(this.options);
    let response: Response;
    try {
      response = await this.doFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [], stream: false, keep_alive: keepAlive, options: { num_ctx: contextLength } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw connectionError(error);
    }
    if (!response.ok) throw new GeminiCallError(`Ollama 미리 올리기 실패: HTTP ${response.status}`, "http", response.status);
  }

  async generate(req: GenerateRequest): Promise<string> {
    const { model } = ollamaSettings(this.options);
    if (!model) throw new LlmUnavailableError("OLLAMA_MODEL을 설정해 주세요.", 503);
    this.options.beforeCall?.();
    const trace = currentTrace();
    const started = performance.now();
    const usage: { tokens?: LlmCallRecord["tokens"] } = {};
    const label = `ollama:${model}`;
    try {
      const text = await this.call(req, model, usage);
      trace?.llm({ model: label, ms: Math.round(performance.now() - started), ok: true, streamed: !!req.onText, ...usage });
      return text;
    } catch (error) {
      const failure = error instanceof GeminiCallError ? { failure: error.reason, ...(error.httpStatus ? { http_status: error.httpStatus } : {}) } : { failure: "error" };
      trace?.llm({ model: label, ms: Math.round(performance.now() - started), ok: false, streamed: !!req.onText, ...failure });
      throw error;
    }
  }

  private async call(req: GenerateRequest, model: string, usage: { tokens?: LlmCallRecord["tokens"] }): Promise<string> {
    const { baseUrl } = ollamaSettings(this.options);
    const { contextLength, keepAlive, timeoutMs } = ollamaRuntimeSettings(this.options);
    const schema = req.responseSchema ? toJsonSchema(req.responseSchema) : undefined;
    // 작은 모델은 schema만으로는 설명을 영어로 쓰는 일이 있어 한 줄 덧붙인다.
    const system = schema ? `${req.system}\n\n출력은 제공된 JSON Schema를 따르는 JSON 객체 하나입니다. 설명은 한국어로 작성하세요.` : req.system;
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await this.doFetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, { role: "user", content: req.prompt }],
          // onText가 있으면 NDJSON으로 조각마다 받는다(학습 모드 답을 화면에 바로 보여 준다).
          stream: !!req.onText,
          keep_alive: keepAlive,
          ...(schema ? { format: schema } : {}),
          options: { temperature: req.temperature, num_predict: req.maxOutputTokens, num_ctx: contextLength },
        }),
        signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
      });
    } catch (error) {
      throw connectionError(error);
    }
    if (!response.ok) throw new GeminiCallError(`Ollama HTTP ${response.status}`, response.status === 429 ? "rate_limit" : "http", response.status);

    if (req.onText) {
      let text = "";
      try {
        await readLines(response, (line) => {
          const part = JSON.parse(line) as OllamaChunk;
          if (part.error) throw new GeminiCallError(`Ollama 오류: ${String(part.error)}`, "http", response.status);
          if (part.done) usage.tokens = tokensOf(part);
          if (typeof part.message?.content === "string" && part.message.content) {
            text += part.message.content;
            req.onText!(text);
          }
        });
      } catch (error) {
        if (error instanceof GeminiCallError) throw error;
        if (error instanceof SyntaxError) throw new GeminiCallError("Ollama 응답이 JSON이 아닙니다.", "http", response.status);
        throw connectionError(error);
      }
      if (!text.trim()) throw new GeminiCallError("Ollama 응답이 비어 있습니다.", "http", response.status);
      return text;
    }

    let body: OllamaChunk;
    try {
      body = (await response.json()) as OllamaChunk;
    } catch (error) {
      if (error instanceof SyntaxError) throw new GeminiCallError("Ollama 응답이 JSON이 아닙니다.", "http", response.status);
      throw connectionError(error);
    }
    usage.tokens = tokensOf(body);
    if (body.error || typeof body.message?.content !== "string" || !body.message.content.trim()) {
      throw new GeminiCallError(`Ollama 응답이 비어 있거나 형식이 올바르지 않습니다${body.error ? `: ${String(body.error)}` : ""}.`, "http", response.status);
    }
    return body.message.content;
  }
}
