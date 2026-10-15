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
}
const context = new AsyncLocalStorage<{ userId: string; signal: AbortSignal; phase: (phase: string) => void }>();
export const jobUserId = () => context.getStore()?.userId;
export const jobPhase = (phase: string) => context.getStore()?.phase(phase);

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
  private pending: { id: string; userId: string; task: () => Promise<unknown> }[] = [];
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
      created_at: String(r.created_at), updated_at: String(r.updated_at) };
  }
  get(id: string, userId: string): EducationJob {
    const row = this.row(id, userId);
    if (!row) throw new CheckpointError(404, "요청을 찾을 수 없어요.");
    return row;
  }
  submit(userId: string, kind: string, key: string, payload: unknown, metadata: Record<string, unknown>, task: () => Promise<unknown>) {
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
    this.db.prepare("INSERT INTO education_jobs(id,user_id,kind,request_key,payload_hash,state,phase,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,'queued','queued',?,?,?)")
      .run(id, userId, kind, key, hash, JSON.stringify(metadata), at, at);
    this.pending.push({ id, userId, task });
    setImmediate(() => void this.run());
    return this.get(id, userId);
  }
  cancel(id: string, userId: string): EducationJob {
    const job = this.get(id, userId);
    if (job.state === "succeeded" || job.state === "failed") throw new CheckpointError(409, "이미 끝난 요청이에요.");
    this.update(id, "cancelled", "cancelled");
    this.pending = this.pending.filter((p) => p.id !== id);
    this.controllers.get(id)?.abort(new Error("사용자가 요청을 취소했어요."));
    return this.get(id, userId);
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
        this.update(item.id, "running", "preparing");
        try {
          const result = await context.run({ userId: item.userId, signal: controller.signal,
            phase: (phase) => { if (!controller.signal.aborted) this.update(item.id, "running", phase); },
          }, item.task);
          if (!controller.signal.aborted) this.update(item.id, "succeeded", "completed", result);
        } catch (error) {
          if (!controller.signal.aborted) this.update(item.id, "failed", "failed", null,
            { message: (error as Error).message, status: error instanceof CheckpointError ? error.status : 503 });
        } finally { this.controllers.delete(item.id); }
      }
    } finally { this.working = false; }
  }
  dispose() {
    this.disposed = true;
    for (const p of this.pending) this.update(p.id, "failed", "interrupted", null, { message: "서버 종료로 중단됐어요.", status: 503 });
    this.pending = [];
    for (const [id, controller] of this.controllers) { this.update(id, "cancelled", "interrupted"); controller.abort(); }
  }
}
