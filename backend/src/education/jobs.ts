import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { LlmClient, GenerateRequest } from "../../../llm/src/llm-client.js";
import { CheckpointError, type Evaluator, type Tutor } from "../checkpoint/types.js";

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface EducationJob {
  id: string; user_id: string; kind: string; state: JobState; phase: string;
  result: unknown; error: { message: string; status: number } | null;
  metadata: Record<string, unknown>; created_at: string; updated_at: string;
  /** 일반화(012): 높을수록 먼저, 시도한 횟수/최대 횟수, 진행률(0~1, 모르면 null). */
  priority: number; attempts: number; max_attempts: number; progress: number | null;
}
const context = new AsyncLocalStorage<{ userId: string; signal: AbortSignal; phase: (phase: string) => void; progress: (value: number) => void }>();
export const jobUserId = () => context.getStore()?.userId;
export const jobPhase = (phase: string) => context.getStore()?.phase(phase);
/** 작업 안에서 진행률(0~1)을 알린다. */
export const jobProgress = (value: number) => context.getStore()?.progress(value);

/** 시험 밖의 작업 종류(보고서·생성·알림 등). 등록한 종류만 POST /api/jobs로 넣을 수 있다(backend/src/education/job-routes.ts). */
export interface JobKind {
  /** 누가 넣을 수 있는지. admin이면 관리자만. */
  role: "admin" | "any";
  /** 화면에 보일 이름. */
  label: string;
  priority?: number;
  /** 일시 오류(429·503·연결 실패)일 때 다시 시도할 최대 횟수(첫 시도 포함). */
  maxAttempts?: number;
  /** 입력 검사. 틀리면 예외(CheckpointError 400). */
  parse?: (payload: unknown) => unknown;
  run: (payload: unknown, ctx: { userId: string; signal: AbortSignal }) => Promise<unknown>;
}
/** 다시 시도할 오류: 요청 한도(429)·서버/모델 일시 오류(503). */
const retryable = (status: number) => status === 429 || status === 503;
/** 다시 시도 전 기다림(ms): 1초, 2초, 4초 … 테스트는 JOB_RETRY_BASE_MS로 줄인다. */
const backoff = (attempt: number) => Number(process.env.JOB_RETRY_BASE_MS ?? 1000) * 2 ** Math.max(0, attempt - 1);

/** Each call is cancellable and belongs to the queued learner, rather than the last HTTP request. */
export function jobAwareClient(client: LlmClient): LlmClient {
  return { async generate(request: GenerateRequest) {
    const signal = context.getStore()?.signal;
    signal?.throwIfAborted();
    const response = await client.generate({ ...request, ...(signal ? { signal } : {}) });
    signal?.throwIfAborted();
    return response;
  } };
}

export function phaseEvaluator(evaluator: Evaluator): Evaluator {
  return { async evaluate(input) { jobPhase("grading"); const result = await evaluator.evaluate(input); context.getStore()?.signal.throwIfAborted(); return result; } };
}
export function phaseTutor(tutor: Tutor): Tutor {
  return {
    async question(input) { jobPhase("question"); const result = await tutor.question(input); context.getStore()?.signal.throwIfAborted(); return result; },
    async explanation(input) { jobPhase("explanation"); const result = await tutor.explanation(input); context.getStore()?.signal.throwIfAborted(); return result; },
    async recheckQuestion(input) { jobPhase("recheck"); const result = await tutor.recheckQuestion(input); context.getStore()?.signal.throwIfAborted(); return result; },
  };
}

/** One worker protects CPU inference. Durable statuses survive refresh; interrupted work is reported on restart. */
export class EducationJobs {
  private pending: { id: string; userId: string; priority: number; task: () => Promise<unknown> }[] = [];
  private kinds = new Map<string, JobKind>();
  /** 시험이 아닌 작업이 끝나면(성공·실패) 부른다. 서버가 작업 완료 알림을 붙인다. */
  onSettled?: (job: EducationJob) => void;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private controllers = new Map<string, AbortController>();
  private working = false;
  private disposed = false;
  constructor(private readonly db: DatabaseSync) {
    db.prepare("UPDATE education_jobs SET state='failed', phase='interrupted', error_json=?, updated_at=? WHERE state IN ('queued','running')")
      .run(JSON.stringify({ status: 503, message: "서버가 다시 시작되어 처리가 중단됐어요. 시험 상태를 확인한 뒤 다시 시도해 주세요." }), new Date().toISOString());
  }
  private row(id: string, userId: string): EducationJob | null {
    const r = this.db.prepare("SELECT * FROM education_jobs WHERE id=? AND user_id=?").get(id, userId);
    if (!r) return null;
    return { id: String(r.id), user_id: String(r.user_id), kind: String(r.kind), state: r.state as JobState,
      phase: String(r.phase), result: r.result_json ? JSON.parse(String(r.result_json)) : null,
      error: r.error_json ? JSON.parse(String(r.error_json)) : null, metadata: JSON.parse(String(r.metadata_json)),
      created_at: String(r.created_at), updated_at: String(r.updated_at),
      priority: Number(r.priority ?? 0), attempts: Number(r.attempts ?? 0), max_attempts: Number(r.max_attempts ?? 1), progress: r.progress == null ? null : Number(r.progress) };
  }
  /** 작업 종류 등록(서버 시작 때). */
  register(kind: string, def: JobKind): void {
    if (kind.startsWith("exam")) throw new Error("exam으로 시작하는 종류는 시험 API가 쓴다.");
    this.kinds.set(kind, def);
  }
  kind(kind: string): JobKind | undefined { return this.kinds.get(kind); }
  registeredKinds(): { kind: string; label: string; role: JobKind["role"] }[] {
    return [...this.kinds].map(([kind, d]) => ({ kind, label: d.label, role: d.role }));
  }
  /** 등록한 종류의 작업을 넣는다. key가 없으면 새로 만든다(같은 key·같은 내용이면 같은 작업을 돌려준다). */
  enqueue(userId: string, kind: string, payload: unknown, key?: string): EducationJob {
    const def = this.kinds.get(kind);
    if (!def) throw new CheckpointError(404, "알 수 없는 작업 종류예요.");
    const input = def.parse ? def.parse(payload) : payload;
    return this.submit(userId, kind, key ?? randomUUID(), input, { label: def.label }, () => {
      const signal = context.getStore()?.signal ?? new AbortController().signal;
      return def.run(input, { userId, signal });
    }, { priority: def.priority ?? 0, maxAttempts: def.maxAttempts ?? 1 });
  }
  /** 관리자 목록: 상태·종류로 거른다(최근 것부터). */
  list(filter: { state?: string; kind?: string; userId?: string; limit?: number } = {}): EducationJob[] {
    const where: string[] = [], args: string[] = [];
    if (filter.state) { where.push("state=?"); args.push(filter.state); }
    if (filter.kind) { where.push("kind=?"); args.push(filter.kind); }
    if (filter.userId) { where.push("user_id=?"); args.push(filter.userId); }
    const rows = this.db.prepare(`SELECT id,user_id FROM education_jobs${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC,rowid DESC LIMIT ${Math.min(500, Math.max(1, filter.limit ?? 100))}`).all(...args);
    return rows.map((r) => this.row(String(r.id), String(r.user_id))!).filter(Boolean);
  }
  /** 상태·종류별 개수와 최근 하루의 평균 대기·처리 시간(초). */
  stats() {
    const byState = Object.fromEntries(this.db.prepare("SELECT state,COUNT(*) AS n FROM education_jobs GROUP BY state").all().map((r) => [String(r.state), Number(r.n)]));
    const byKind = this.db.prepare("SELECT kind,state,COUNT(*) AS n FROM education_jobs GROUP BY kind,state ORDER BY kind").all().map((r) => ({ kind: String(r.kind), state: String(r.state), n: Number(r.n) }));
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const done = this.db.prepare("SELECT created_at,updated_at FROM education_jobs WHERE state IN ('succeeded','failed') AND updated_at >= ?").all(since);
    const avg = done.length ? done.reduce((sum, r) => sum + (Date.parse(String(r.updated_at)) - Date.parse(String(r.created_at))), 0) / done.length / 1000 : null;
    return { by_state: byState, by_kind: byKind, queued_in_memory: this.pending.length, working: this.working, avg_seconds_24h: avg == null ? null : Math.round(avg * 10) / 10 };
  }
  get(id: string, userId: string): EducationJob {
    const row = this.row(id, userId);
    if (!row) throw new CheckpointError(404, "요청을 찾을 수 없어요.");
    return row;
  }
  submit(userId: string, kind: string, key: string, payload: unknown, metadata: Record<string, unknown>, task: () => Promise<unknown>,
    options: { priority?: number; maxAttempts?: number } = {}) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key)) throw new CheckpointError(400, "요청 식별 키가 올바르지 않아요.");
    const hash = createHash("sha256").update(JSON.stringify([kind, payload])).digest("hex");
    const prior = this.db.prepare("SELECT id,payload_hash FROM education_jobs WHERE user_id=? AND request_key=?").get(userId, key);
    if (prior) {
      if (prior.payload_hash !== hash) throw new CheckpointError(409, "같은 요청 키를 다른 답안에 사용할 수 없어요.");
      return this.get(String(prior.id), userId);
    }
    if (kind.startsWith("exam")) {
      const activeForUser = this.db.prepare("SELECT metadata_json FROM education_jobs WHERE user_id=? AND state IN ('queued','running')").all(userId);
      if (activeForUser.some((r) => JSON.parse(String(r.metadata_json)).section === metadata.section)) {
        throw new CheckpointError(409, "이 시험의 이전 요청이 아직 처리 중이에요.");
      }
    }
    const active = Number(this.db.prepare("SELECT COUNT(*) AS n FROM education_jobs WHERE user_id=? AND state IN ('queued','running')").get(userId)?.n);
    if (active >= 3 || this.pending.length >= 100) throw new CheckpointError(429, "처리 중인 요청이 많아요. 이전 요청이 끝난 뒤 다시 시도해 주세요.");
    const id = randomUUID(), at = new Date().toISOString();
    const priority = options.priority ?? 0, maxAttempts = Math.max(1, options.maxAttempts ?? 1);
    this.db.prepare("INSERT INTO education_jobs(id,user_id,kind,request_key,payload_hash,state,phase,metadata_json,created_at,updated_at,priority,max_attempts) VALUES(?,?,?,?,?,'queued','queued',?,?,?,?,?)")
      .run(id, userId, kind, key, hash, JSON.stringify(metadata), at, at, priority, maxAttempts);
    this.enqueuePending({ id, userId, priority, task });
    setImmediate(() => void this.run());
    return this.get(id, userId);
  }
  cancel(id: string, userId: string): EducationJob {
    const job = this.get(id, userId);
    if (job.state === "cancelled") return job;
    if (job.state === "succeeded" || job.state === "failed") throw new CheckpointError(409, "이미 끝난 요청이에요.");
    this.update(id, "cancelled", "cancelled");
    this.pending = this.pending.filter((p) => p.id !== id);
    this.controllers.get(id)?.abort(new Error("사용자가 요청을 취소했어요."));
    return this.get(id, userId);
  }
  /** 우선순위가 높은 것이 앞, 같으면 먼저 넣은 것이 앞. */
  private enqueuePending(item: { id: string; userId: string; priority: number; task: () => Promise<unknown> }) {
    const at = this.pending.findIndex((p) => p.priority < item.priority);
    if (at < 0) this.pending.push(item); else this.pending.splice(at, 0, item);
  }
  private update(id: string, state: JobState, phase: string, result: unknown = null, error: unknown = null) {
    this.db.prepare("UPDATE education_jobs SET state=?,phase=?,result_json=?,error_json=?,updated_at=? WHERE id=?")
      .run(state, phase, result === null ? null : JSON.stringify(result), error === null ? null : JSON.stringify(error), new Date().toISOString(), id);
  }
  private async run() {
    if (this.working || this.disposed) return;
    this.working = true;
    try {
      while (this.pending.length && !this.disposed) {
        const item = this.pending.shift()!;
        if (this.get(item.id, item.userId).state !== "queued") continue;
        const controller = new AbortController();
        this.controllers.set(item.id, controller);
        this.db.prepare("UPDATE education_jobs SET attempts=attempts+1 WHERE id=?").run(item.id);
        this.update(item.id, "running", "preparing");
        try {
          const result = await context.run({ userId: item.userId, signal: controller.signal,
            phase: (phase) => { if (!controller.signal.aborted) this.update(item.id, "running", phase); },
            progress: (value) => { if (!controller.signal.aborted) this.db.prepare("UPDATE education_jobs SET progress=?,updated_at=? WHERE id=?").run(Math.max(0, Math.min(1, value)), new Date().toISOString(), item.id); },
          }, item.task);
          if (!controller.signal.aborted) { this.update(item.id, "succeeded", "completed", result); this.db.prepare("UPDATE education_jobs SET progress=1 WHERE id=?").run(item.id); }
        } catch (error) {
          if (!controller.signal.aborted) {
            const status = error instanceof CheckpointError ? error.status : 503, job = this.get(item.id, item.userId);
            // 일시 오류면 기다렸다가 같은 작업을 다시 넣는다(최대 max_attempts번).
            if (retryable(status) && job.attempts < job.max_attempts && !this.disposed) {
              this.update(item.id, "queued", "retry-wait", null, { message: (error as Error).message, status });
              const timer = setTimeout(() => { this.timers.delete(timer); if (this.get(item.id, item.userId).state === "queued") { this.enqueuePending(item); void this.run(); } }, backoff(job.attempts));
              this.timers.add(timer);
            } else this.update(item.id, "failed", "failed", null, { message: (error as Error).message, status });
          }
        } finally {
          this.controllers.delete(item.id);
          const settled = this.row(item.id, item.userId);
          if (settled && !settled.kind.startsWith("exam") && (settled.state === "succeeded" || settled.state === "failed")) {
            try { this.onSettled?.(settled); } catch (e) { console.warn("작업 완료 알림 실패", e); }
          }
        }
      }
    } finally { this.working = false; }
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const p of this.pending) this.update(p.id, "failed", "interrupted", null, { message: "서버 종료로 중단됐어요.", status: 503 });
    this.pending = [];
    for (const [id, controller] of this.controllers) { this.update(id, "cancelled", "interrupted"); controller.abort(); }
  }
}
