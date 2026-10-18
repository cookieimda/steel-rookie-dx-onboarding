// 요청 하나의 단계별 기록(trace). 학습 모드 질문 하나가 어디서(검색·모델·검증·저장) 실패하거나 느려졌는지 나중에 찾으려고 남긴다.
// 설계와 필드는 docs/agent-observability.md.
// - 라우트가 Trace를 만들어 runWithTrace로 감싸면, 그 안에서 부르는 LLM 클라이언트(gemini.ts)·튜터(learning-agent.ts)가
//   currentTrace()로 같은 기록에 호출·재시도·제안을 더한다(함수 인자를 늘리지 않으려고 AsyncLocalStorage를 쓴다).
// - 근거 조각 원문·답변 원문은 남기지 않는다. 조각은 id·점수, 답은 길이와 근거 겹침 지표만 남긴다.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { LANGFUSE_SENT_LOG, langfuseConfigFromEnv, LangfuseExporter } from "./langfuse.js";

/** LLM 호출 하나. 다시 부르면(과부하·형식 오류) 호출마다 하나씩 쌓인다. */
export interface LlmCallRecord {
  model: string;
  ms: number;
  ok: boolean;
  /** 실패 종류(gemini.ts의 GeminiFailure 또는 "no_key"). */
  failure?: string;
  http_status?: number;
  streamed: boolean;
  /** 받은 응답의 토큰 수(Gemini usageMetadata). 응답에 없으면 비운다. */
  tokens?: { prompt?: number; output?: number; thoughts?: number; total?: number };
  /** 요청 시작부터 이 호출이 시작될 때까지(ms). Trace.llm()이 붙인다(타임라인 내보내기용, langfuse.ts). */
  start_ms?: number;
}

/** 요청을 클라이언트가 붙여 보낸 trace id(X-Trace-Id)로 이을 때 허용하는 형식. */
export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export class Trace {
  readonly id: string;
  readonly kind: string;
  readonly at = new Date().toISOString();
  private readonly started = performance.now();
  /** 단계 이름 → 걸린 시간(ms). 같은 단계를 두 번 재면 더한다. */
  readonly stages: Record<string, number> = {};
  /** 단계 이름 → 처음 시작한 시각(요청 시작부터 ms). 타임라인으로 내보낼 때 쓴다(langfuse.ts). */
  readonly stage_offsets: Record<string, number> = {};
  readonly llm_calls: LlmCallRecord[] = [];
  readonly fields: Record<string, unknown> = {};

  constructor(kind: string, id?: string | null) {
    this.kind = kind;
    this.id = id && TRACE_ID_PATTERN.test(id) ? id : randomUUID();
  }

  /** 시작부터 지금까지(ms). */
  elapsed(): number {
    return Math.round(performance.now() - this.started);
  }

  /** fn이 걸린 시간을 stages[name]에 더한다. 예외가 나도 잰다. */
  time<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.addStage(name, t0, performance.now() - t0);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.addStage(name, t0, performance.now() - t0);
    }
  }

  private addStage(name: string, t0: number, ms: number): void {
    this.stages[name] = Math.round((this.stages[name] ?? 0) + ms);
    this.stage_offsets[name] ??= Math.max(0, Math.round(t0 - this.started));
  }

  /** 기록 필드를 정한다(같은 키면 덮어쓴다). */
  set(key: string, value: unknown): void {
    this.fields[key] = value;
  }

  /** 처음 한 번만 정한다(예: 스트리밍 첫 글자 시각). */
  once(key: string, value: unknown): void {
    if (!(key in this.fields)) this.fields[key] = value;
  }

  /** 끝난 호출을 더한다. 시작 시각은 지금 - 걸린 시간으로 붙인다(클라이언트가 따로 넘기지 않게). */
  llm(call: LlmCallRecord): void {
    this.llm_calls.push({ ...call, start_ms: call.start_ms ?? Math.max(0, this.elapsed() - call.ms) });
  }

  /** 파일에 남길 한 줄. total_ms는 이 함수를 부른 시각 기준이다. */
  toRecord(): TraceRecord {
    const tokens = this.llm_calls.reduce((sum, c) => sum + (c.tokens?.total ?? 0), 0);
    return {
      trace_id: this.id,
      kind: this.kind,
      at: this.at,
      total_ms: this.elapsed(),
      stages: { ...this.stages },
      stage_offsets: { ...this.stage_offsets },
      llm_calls: this.llm_calls,
      llm_tokens: this.llm_calls.some((c) => c.tokens?.total !== undefined) ? tokens : null,
      ...this.fields,
    };
  }
}

export interface TraceRecord {
  trace_id: string;
  kind: string;
  at: string;
  total_ms: number;
  stages: Record<string, number>;
  /** 단계별 시작 시각(ms). 2026-10-18 전 기록에는 없다(내보낼 때 단계를 차례로 놓는다). */
  stage_offsets?: Record<string, number>;
  llm_calls: LlmCallRecord[];
  /** 모든 호출의 total 토큰 합. 토큰 정보가 하나도 없으면 null. */
  llm_tokens: number | null;
  [field: string]: unknown;
}

const store = new AsyncLocalStorage<Trace>();

/** fn 안(비동기 포함)에서 currentTrace()가 trace를 돌려준다. */
export function runWithTrace<T>(trace: Trace, fn: () => T): T {
  return store.run(trace, fn);
}

/** 지금 요청의 trace. 감싸지 않은 곳(평가 스크립트·서버 시작 때 미리 받기)에서는 undefined. */
export function currentTrace(): Trace | undefined {
  return store.getStore();
}

/** 완성된 trace를 받는 곳. 서버는 파일(TraceLog), 테스트는 배열에 모은다. */
export type TraceSink = (record: TraceRecord) => void;

/**
 * 날짜별 JSONL 파일(dir/{kind}-YYYY-MM-DD.jsonl)에 한 줄씩 덧붙인다. 쓰기에 실패해도 요청은 막지 않고 경고만 한 번 남긴다.
 * 기본 위치는 data/traces(Git 제외). TRACE_LOG=off면 남기지 않는다(traceSinkFromEnv).
 */
export class TraceLog {
  private warned = false;
  constructor(readonly dir: string) {}

  /** 파일 날짜는 서버 시간대 기준이다(at은 UTC라 한국 오전 9시 전 질문이 전날 파일로 가지 않게). */
  pathFor(record: Pick<TraceRecord, "kind" | "at">): string {
    return join(this.dir, `${record.kind}-${localDate(new Date(record.at))}.jsonl`);
  }

  readonly write: TraceSink = (record) => {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.pathFor(record), `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      if (!this.warned) console.warn(`trace 기록 실패(${this.dir}): ${(error as Error).message}`);
      this.warned = true;
    }
  };
}

/** 경로의 UUID·긴 id를 :id로 바꾼다(요약에서 같은 API끼리 묶으려고). */
export function routePattern(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/:id");
}

/** traceMiddleware가 쓰는 요청·응답의 최소 모양(express에 묶이지 않게). */
interface TraceReq { method: string; originalUrl: string; get(name: string): string | undefined }
interface TraceRes { statusCode: number; setHeader(name: string, value: string): unknown; on(event: "finish" | "close", fn: () => void): unknown }

/**
 * 요청 하나를 trace로 감싸는 미들웨어(체크포인트·보충학습처럼 요청 안에서 모델을 부르는 API). 응답이 끝나면 sink로 보낸다.
 * 기록: method·경로(:id로 묶음)·HTTP 상태·전체 시간·LLM 호출(클라이언트가 남김). sink가 없으면 아무것도 하지 않는다.
 */
export function traceMiddleware(kind: string, sink: TraceSink | undefined) {
  return (req: TraceReq, res: TraceRes, next: () => void) => {
    if (!sink) return next();
    const trace = new Trace(kind, req.get("x-trace-id"));
    res.setHeader("X-Trace-Id", trace.id);
    trace.set("request", { method: req.method, route: routePattern(req.originalUrl.split("?")[0]!) });
    let sent = false;
    const done = () => {
      if (sent) return;
      sent = true;
      trace.set("http_status", res.statusCode);
      trace.set("outcome", res.statusCode < 400 ? "ok" : `http_${res.statusCode}`);
      sink(trace.toRecord());
    };
    res.on("finish", done);
    res.on("close", done);
    runWithTrace(trace, next);
  };
}

/** 서버 시간대의 YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 서버용: TRACE_LOG=off면 undefined, 아니면 TRACE_DIR(기본 data/traces)에 쓰는 sink.
 * LANGFUSE_HOST·LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 있으면 같은 기록을 Langfuse로도 보낸다(langfuse.ts, 기본 꺼짐).
 */
export function traceSinkFromEnv(env: NodeJS.ProcessEnv = process.env): TraceSink | undefined {
  if (env.TRACE_LOG?.trim().toLowerCase() === "off") return undefined;
  const dir = env.TRACE_DIR || join(process.cwd(), "data", "traces");
  const file = new TraceLog(dir).write;
  const config = langfuseConfigFromEnv(env);
  if (!config) return file;
  // 보낸 trace id를 적어 두어 지난 기록 내보내기(npm run trace:langfuse)가 같은 기록을 다시 보내지 않게 한다.
  const langfuse = new LangfuseExporter(config, { sentLog: join(dir, LANGFUSE_SENT_LOG) });
  console.log(`trace를 Langfuse로도 보냅니다: ${config.host}`);
  return (record) => { file(record); langfuse.push(record); };
}
