// 요청 trace(trace.ts)를 Langfuse로 보내 웹 대시보드에서 질문 하나씩 타임라인으로 본다(선택, 기본 꺼짐). 설계는 docs/agent-observability.md 'Langfuse'.
// - Langfuse v4가 받는 OpenTelemetry(OTLP/HTTP JSON, /api/public/otel/v1/traces)로 보낸다. SDK를 쓰지 않고 fetch로 보낸다(의존성 추가 없음).
// - 요청 하나 = 루트 span, 단계(context·retrieve·llm·save) = 하위 span, LLM 호출 = generation. 근거 겹침·결과는 점수(/api/public/scores)로 붙인다.
// - 파일 기록(TraceLog)과 같은 내용만 보낸다(근거 조각 원문·답 원문은 원래 없다). 학습자 질문 문장은 들어가므로 기본은 이 컴퓨터(localhost)의 Langfuse에만 보낸다.
// 설정: LANGFUSE_HOST(예: http://localhost:3100), LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY. 다른 컴퓨터로 보내려면 LANGFUSE_ALLOW_REMOTE=1.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TraceRecord, TraceSink } from "./trace.js";

export interface LangfuseConfig {
  host: string;
  publicKey: string;
  secretKey: string;
}

/** 세 값이 모두 있으면 설정, 하나라도 없으면 null(꺼짐). localhost가 아닌 주소는 LANGFUSE_ALLOW_REMOTE=1이 있어야 한다(없으면 예외, 서버가 시작하지 않는다). */
export function langfuseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LangfuseConfig | null {
  const host = env.LANGFUSE_HOST?.trim().replace(/\/+$/, "");
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (!host || !publicKey || !secretKey) return null;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  if (!local && env.LANGFUSE_ALLOW_REMOTE !== "1") {
    throw new Error(`LANGFUSE_HOST(${host})가 이 컴퓨터가 아닙니다. 학습자 질문이 밖으로 나가므로 LANGFUSE_ALLOW_REMOTE=1을 함께 정해야 보냅니다.`);
  }
  return { host, publicKey, secretKey };
}

type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean } | { arrayValue: { values: { stringValue: string }[] } };
interface OtlpAttribute { key: string; value: AttrValue }
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
}
export interface LangfuseScore {
  id: string;
  traceId: string;
  name: string;
  value: number | string;
  dataType: "NUMERIC" | "CATEGORICAL";
  comment?: string;
}

const hex = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);
/** OTel trace id(32자리 16진수). UUID면 그대로, 아니면(X-Trace-Id) 해시. 같은 기록은 늘 같은 id라 Langfuse에서 한 trace로 묶인다(다시 보내면 행은 겹친다, sentLog). */
export function otelTraceId(traceId: string): string {
  const plain = traceId.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(plain) ? plain : hex(traceId, 32);
}
const spanId = (traceId: string, name: string) => hex(`${traceId}:${name}`, 16);
const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`;
const json = (v: unknown) => JSON.stringify(v);

function attr(key: string, value: unknown): OtlpAttribute | null {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return { key, value: { arrayValue: { values: value.map((v) => ({ stringValue: v })) } } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") return Number.isInteger(value) ? { key, value: { intValue: String(value) } } : { key, value: { doubleValue: value } };
  return { key, value: { stringValue: typeof value === "string" ? value : json(value) } };
}
const attrs = (pairs: [string, unknown][]) => pairs.map(([k, v]) => attr(k, v)).filter((a): a is OtlpAttribute => a !== null);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** 트레이스 이름: 학습은 learning, 미들웨어 trace는 kind + 경로, 시험 작업은 exam:작업 종류. */
function traceName(r: TraceRecord): string {
  const request = obj(r.request), job = obj(r.job);
  if (typeof job.kind === "string") return `${r.kind}:${job.kind}`;
  if (typeof request.route === "string") return `${r.kind} ${String(request.method ?? "")} ${request.route}`.trim();
  return r.kind;
}

/** 루트 span의 입력·출력. 학습은 질문·화면과 결과(상태·출처·3D 조작), 그 밖은 요청 경로와 결과. */
function inputOutput(r: TraceRecord): { input: unknown; output: unknown } {
  const request = obj(r.request);
  if (typeof request.question === "string") {
    return {
      input: { question: request.question, section: request.section, equipment_id: request.equipment_id ?? null },
      output: r.result ?? { outcome: r.outcome, error: r.error ?? null },
    };
  }
  return { input: Object.keys(request).length ? request : r.job ?? null, output: { outcome: r.outcome ?? null, http_status: r.http_status ?? null } };
}

function level(r: TraceRecord): "DEFAULT" | "WARNING" | "ERROR" {
  const outcome = String(r.outcome ?? "");
  if (r.error || outcome === "error" || outcome === "failed" || /^http_5/.test(outcome)) return "ERROR";
  if (outcome === "unverified" || /^http_4/.test(outcome)) return "WARNING";
  return "DEFAULT";
}

/** 기록 하나 → OTLP span 목록(루트·단계·LLM 호출). */
export function toOtlpSpans(r: TraceRecord): OtlpSpan[] {
  const traceId = otelTraceId(r.trace_id);
  const start = Date.parse(r.at);
  const root = spanId(r.trace_id, "root");
  const { input, output } = inputOutput(r);
  const request = obj(r.request), agent = obj(r.agent), result = obj(r.result);
  const lvl = level(r);
  const metadata: [string, unknown][] = [
    ["outcome", r.outcome], ["cache", r.cache], ["http_status", r.http_status], ["unverified_reason", result.unverified_reason],
    ["prompt_profile", agent.profile], ["prompt_chars", agent.prompt_chars], ["llm_tokens", r.llm_tokens],
    ["section", request.section], ["queue_ms", obj(r.job).queue_ms],
  ];
  const tags = [r.kind, ...(typeof r.outcome === "string" ? [r.outcome] : []), ...new Set(r.llm_calls.map((c) => c.model))];
  const spans: OtlpSpan[] = [{
    traceId, spanId: root, name: traceName(r), kind: 2,
    startTimeUnixNano: nanos(start), endTimeUnixNano: nanos(start + r.total_ms),
    attributes: attrs([
      ["langfuse.trace.name", traceName(r)],
      ["langfuse.session.id", request.session_id],
      ["langfuse.trace.tags", tags],
      ["langfuse.observation.type", "span"],
      ["langfuse.observation.input", json(input)],
      ["langfuse.observation.output", json(output)],
      ["langfuse.observation.level", lvl],
      ["langfuse.observation.status_message", obj(r.error).message],
      ...metadata.map(([k, v]) => [`langfuse.trace.metadata.${k}`, v] as [string, unknown]),
    ]),
    status: { code: lvl === "ERROR" ? 2 : 1 },
  }];

  // 단계: 기록한 시작 시각이 있으면 그 자리에, 없으면(예전 기록) 차례로 놓는다.
  let cursor = 0;
  for (const [name, ms] of Object.entries(r.stages)) {
    const offset = r.stage_offsets?.[name] ?? cursor;
    cursor = offset + ms;
    const extra: [string, unknown][] = name === "retrieve"
      ? [["langfuse.observation.type", "retriever"], ["langfuse.observation.output", json(r.retrieval ?? null)]]
      : name === "context" ? [["langfuse.observation.type", "span"], ["langfuse.observation.output", json(r.context ?? null)]]
      : [["langfuse.observation.type", "span"]];
    spans.push({
      traceId, spanId: spanId(r.trace_id, `stage:${name}`), parentSpanId: root, name, kind: 1,
      startTimeUnixNano: nanos(start + offset), endTimeUnixNano: nanos(start + offset + ms), attributes: attrs(extra), status: { code: 1 },
    });
  }

  // LLM 호출: llm 단계가 있으면 그 아래, 없으면(체크포인트·시험) 루트 아래.
  const parent = "llm" in r.stages ? spanId(r.trace_id, "stage:llm") : root;
  let llmCursor = r.stage_offsets?.llm ?? 0;
  r.llm_calls.forEach((c, i) => {
    const offset = c.start_ms ?? llmCursor;
    llmCursor = offset + c.ms;
    const [provider, ...rest] = c.model.split(":");
    const model = rest.length ? rest.join(":") : c.model;
    spans.push({
      traceId, spanId: spanId(r.trace_id, `llm:${i}`), parentSpanId: parent, name: `${provider} 호출`, kind: 3,
      startTimeUnixNano: nanos(start + offset), endTimeUnixNano: nanos(start + offset + c.ms),
      attributes: attrs([
        ["langfuse.observation.type", "generation"],
        ["langfuse.observation.model.name", model],
        ["langfuse.observation.usage_details", c.tokens ? json({ input: c.tokens.prompt ?? 0, output: c.tokens.output ?? 0, total: c.tokens.total ?? 0 }) : null],
        ["langfuse.observation.level", c.ok ? "DEFAULT" : "ERROR"],
        ["langfuse.observation.status_message", c.ok ? null : `${c.failure ?? "error"}${c.http_status ? ` (HTTP ${c.http_status})` : ""}`],
        ["langfuse.observation.metadata.provider", provider],
        ["langfuse.observation.metadata.streamed", c.streamed],
        ["langfuse.observation.metadata.retry", i > 0],
      ]),
      status: { code: c.ok ? 1 : 2 },
    });
  });
  return spans;
}

/** 점수: 결과(categorical)와 근거 겹침 비율(numeric, 학습 답에만). id는 trace id에서 정한다. */
export function toScores(r: TraceRecord): LangfuseScore[] {
  const traceId = otelTraceId(r.trace_id);
  const scores: LangfuseScore[] = [];
  if (typeof r.outcome === "string") scores.push({ id: `${traceId}-outcome`, traceId, name: "outcome", value: r.outcome, dataType: "CATEGORICAL" });
  const grounding = obj(r.grounding);
  if (typeof grounding.rate === "number") {
    scores.push({ id: `${traceId}-grounding`, traceId, name: "grounding_rate", value: grounding.rate, dataType: "NUMERIC",
      comment: `근거와 겹친 문장 ${String(grounding.supported ?? "?")}/${String(grounding.sentences ?? "?")}` });
  }
  return scores;
}

export interface LangfuseExporterOptions {
  fetch?: typeof fetch;
  /** 모아서 보내는 간격(ms, 기본 2000). 0이면 타이머 없이 flush()로만 보낸다. */
  flushMs?: number;
  /** 한 번에 보내는 기록 수(기본 50). */
  batchSize?: number;
  warn?: (message: string) => void;
  /**
   * 보낸 trace id를 한 줄씩 적는 파일(기본 없음). Langfuse v4는 같은 span id를 다시 받으면 덮어쓰지 않고 행을 하나 더 만들어서(2026-10-18 확인: 두 번 보내 110행/55 id),
   * 지난 기록 내보내기(trace-langfuse.ts)가 이 파일을 보고 이미 보낸 기록을 건너뛴다. 서버는 data/traces/langfuse-sent.txt에 적는다.
   */
  sentLog?: string;
}

/** trace 폴더 안의 보낸 기록 파일 이름(서버와 trace-langfuse.ts가 같이 쓴다). .jsonl이 아니라 trace:report가 읽지 않는다. */
export const LANGFUSE_SENT_LOG = "langfuse-sent.txt";

/** sentLog 파일의 trace id들. 파일이 없으면 빈 집합. */
export function readSentIds(path: string): Set<string> {
  return existsSync(path) ? new Set(readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) : new Set();
}

/**
 * 기록을 모았다가 Langfuse로 보낸다. 요청을 막지 않고, 보내기에 실패하면 경고를 한 번만 남기고 버린다(파일 기록은 그대로 남는다).
 * 서버(traceSinkFromEnv)와 지난 기록 내보내기(llm/eval/trace-langfuse.ts)가 같이 쓴다.
 */
export class LangfuseExporter {
  private queue: TraceRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warned = false;
  private sending: Promise<void> = Promise.resolve();
  readonly sent = { traces: 0, spans: 0, scores: 0, failed: 0 };

  constructor(private readonly config: LangfuseConfig, private readonly options: LangfuseExporterOptions = {}) {}

  private get doFetch(): typeof fetch {
    return this.options.fetch ?? fetch;
  }

  private headers(contentType = "application/json"): Record<string, string> {
    const auth = Buffer.from(`${this.config.publicKey}:${this.config.secretKey}`).toString("base64");
    return { Authorization: `Basic ${auth}`, "Content-Type": contentType, "x-langfuse-ingestion-version": "4" };
  }

  readonly push: TraceSink = (record) => {
    this.queue.push(record);
    if (this.queue.length >= (this.options.batchSize ?? 50)) void this.flush();
    else if (!this.timer && (this.options.flushMs ?? 2000) > 0) {
      this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.options.flushMs ?? 2000);
      this.timer.unref?.();
    }
  };

  /** 쌓인 기록을 모두 보낸다. 앞선 보내기가 끝난 뒤 차례로 보낸다. */
  flush(): Promise<void> {
    this.sending = this.sending.then(async () => {
      while (this.queue.length) await this.send(this.queue.splice(0, this.options.batchSize ?? 50));
    });
    return this.sending;
  }

  private async send(records: TraceRecord[]): Promise<void> {
    const spans = records.flatMap(toOtlpSpans);
    const body = {
      resourceSpans: [{
        resource: { attributes: attrs([["service.name", "st-rookie"], ["deployment.environment", process.env.NODE_ENV || "local"]]) },
        scopeSpans: [{ scope: { name: "st-rookie-trace", version: "1" }, spans }],
      }],
    };
    try {
      const res = await this.doFetch(`${this.config.host}/api/public/otel/v1/traces`, { method: "POST", headers: this.headers(), body: json(body), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      this.sent.traces += records.length;
      this.sent.spans += spans.length;
      if (this.options.sentLog) {
        mkdirSync(dirname(this.options.sentLog), { recursive: true });
        appendFileSync(this.options.sentLog, records.map((r) => `${r.trace_id}\n`).join(""), "utf8");
      }
      for (const score of records.flatMap(toScores)) {
        const s = await this.doFetch(`${this.config.host}/api/public/scores`, { method: "POST", headers: this.headers(), body: json(score), signal: AbortSignal.timeout(10_000) });
        if (!s.ok) throw new Error(`점수 HTTP ${s.status}`);
        this.sent.scores++;
      }
    } catch (error) {
      this.sent.failed += records.length;
      if (!this.warned) (this.options.warn ?? console.warn)(`Langfuse로 trace를 보내지 못했습니다(${this.config.host}): ${(error as Error).message}`);
      this.warned = true;
    }
  }
}
