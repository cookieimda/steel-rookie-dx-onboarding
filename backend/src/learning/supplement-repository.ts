// 보충학습 저장소(009_learning_supplements.sql). SQL은 이 파일에만 둔다. 설계는 docs/supplementary-learning.md.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Section } from "../checkpoint/types.js";
import { withTransaction } from "../db/tx.js";
import type { OpenMisconception } from "./repository.js";

export type SupplementState = "awaiting_answer" | "awaiting_recheck" | "completed" | "stopped";
export type SupplementOutcome = "resolved" | "not_resolved";

export interface Supplement {
  id: string;
  user_id: string;
  section: Section;
  concept_id: string;
  state: SupplementState;
  outcome: SupplementOutcome | null;
  question: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type StepKind = "tool" | "message" | "scene_result";

export interface SupplementStep {
  seq: number;
  kind: StepKind;
  name: string;
  payload: unknown;
  ok: boolean | null;
  ms: number | null;
  created_at: string;
}

/** 아직 남기지 않은 실행 기록 한 줄. */
export type NewStep = Omit<SupplementStep, "seq" | "created_at">;

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function toSupplement(row: Row): Supplement {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    section: row.section as Section,
    concept_id: String(row.concept_id),
    state: row.state as SupplementState,
    outcome: str(row.outcome) as SupplementOutcome | null,
    question: str(row.question),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: str(row.completed_at),
  };
}

export class SupplementRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** 보충학습을 만들고 실행 기록을 함께 남긴다(하나의 트랜잭션). 같은 공정에서 진행 중이던 보충학습은 stopped로 끝낸다. */
  create(s: { user_id: string; section: Section; concept_id: string; question: string }, steps: NewStep[], now: string): Supplement {
    const id = randomUUID();
    this.tx(() => {
      this.db
        .prepare("UPDATE learning_supplements SET state = 'stopped', updated_at = ?, completed_at = ? WHERE user_id = ? AND section = ? AND state IN ('awaiting_answer', 'awaiting_recheck')")
        .run(now, now, s.user_id, s.section);
      this.db
        .prepare(
          `INSERT INTO learning_supplements (id, user_id, section, concept_id, state, outcome, question, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, 'awaiting_answer', NULL, ?, ?, ?, NULL)`,
        )
        .run(id, s.user_id, s.section, s.concept_id, s.question, now, now);
      this.insertSteps(id, steps, now);
    });
    return this.get(id)!;
  }

  get(id: string): Supplement | null {
    const row = this.db.prepare("SELECT * FROM learning_supplements WHERE id = ?").get(id);
    return row ? toSupplement(row) : null;
  }

  /** 그 공정에서 답을 기다리는 보충학습(새로고침 뒤 이어 하기). 없으면 null. */
  active(userId: string, section: Section): Supplement | null {
    const row = this.db
      .prepare("SELECT * FROM learning_supplements WHERE user_id = ? AND section = ? AND state IN ('awaiting_answer', 'awaiting_recheck') ORDER BY created_at DESC, id LIMIT 1")
      .get(userId, section);
    return row ? toSupplement(row) : null;
  }

  /** 개념별로 마지막으로 해결(resolved)로 끝낸 시각. 해결한 뒤 새 오개념이 생기지 않았으면 다시 권하지 않는 데 쓴다. */
  lastResolved(userId: string, section: Section): Map<string, string> {
    const rows = this.db
      .prepare("SELECT concept_id, MAX(completed_at) AS at FROM learning_supplements WHERE user_id = ? AND section = ? AND outcome = 'resolved' GROUP BY concept_id")
      .all(userId, section);
    return new Map(rows.map((r) => [String(r.concept_id), String(r.at)]));
  }

  /** 상태를 바꾸고 실행 기록을 덧붙인다(하나의 트랜잭션). completed·stopped면 끝난 시각을 남긴다. */
  update(id: string, next: { state: SupplementState; outcome?: SupplementOutcome | null; question?: string | null }, steps: NewStep[], now: string): Supplement {
    const done = next.state === "completed" || next.state === "stopped";
    this.tx(() => {
      this.db
        .prepare("UPDATE learning_supplements SET state = ?, outcome = ?, question = ?, updated_at = ?, completed_at = ? WHERE id = ?")
        .run(next.state, next.outcome ?? null, next.question ?? null, now, done ? now : null, id);
      this.insertSteps(id, steps, now);
    });
    return this.get(id)!;
  }

  /** 상태는 그대로 두고 실행 기록만 덧붙인다(실패한 도구 호출, 화면 조작 결과). */
  appendSteps(id: string, steps: NewStep[], now: string): void {
    this.tx(() => this.insertSteps(id, steps, now));
  }

  steps(id: string): SupplementStep[] {
    return this.db
      .prepare("SELECT * FROM learning_supplement_steps WHERE supplement_id = ? ORDER BY seq")
      .all(id)
      .map((r) => ({
        seq: Number(r.seq),
        kind: r.kind as StepKind,
        name: String(r.name),
        payload: JSON.parse(String(r.payload)),
        ok: r.ok === null || r.ok === undefined ? null : Number(r.ok) === 1,
        ms: r.ms === null || r.ms === undefined ? null : Number(r.ms),
        created_at: String(r.created_at),
      }));
  }

  /**
   * 보충학습 확인 문제를 맞혔을 때: 그 사람·개념의 학습 모드 오개념 메모(source = learning, 실제 기록)를 해결한다.
   * 체크포인트 오개념(source = checkpoint)은 점수와 관리자 통계의 근거라 체크포인트에서 맞혀야 해결된다(CLAUDE.md '오개념 기록').
   */
  resolveLearningMisconceptions(userId: string, conceptId: string, now: string): number {
    return Number(
      this.db
        .prepare("UPDATE misconceptions SET resolved = 1, resolved_at = ? WHERE user_id = ? AND concept_id = ? AND source = 'learning' AND origin = 'live' AND resolved = 0")
        .run(now, userId, conceptId).changes,
    );
  }

  /**
   * 보충학습이 보는 미해결 오개념: 실제 기록과 시연 기록(origin = 'seed', 시연 계정 trainee02~20에만 있음)을 함께 본다.
   * 시연 계정으로 보충학습을 보여 주기 위해서다(관리자 통계가 seed를 세는 것과 같은 이유). 학습 채팅 프롬프트·학습자 메모는 지금처럼 실제 기록만 본다.
   */
  openMisconceptions(userId: string, section: Section): OpenMisconception[] {
    return this.db
      .prepare("SELECT concept_id, summary, source, created_at FROM misconceptions WHERE user_id = ? AND section = ? AND resolved = 0 ORDER BY created_at, id")
      .all(userId, section)
      .map((row) => ({ concept_id: String(row.concept_id), summary: String(row.summary), source: row.source as OpenMisconception["source"], created_at: String(row.created_at) }));
  }

  private insertSteps(id: string, steps: NewStep[], now: string): void {
    if (!steps.length) return;
    let seq = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM learning_supplement_steps WHERE supplement_id = ?").get(id)?.n ?? 0);
    const insert = this.db.prepare("INSERT INTO learning_supplement_steps (supplement_id, seq, kind, name, payload, ok, ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const s of steps) insert.run(id, ++seq, s.kind, s.name, JSON.stringify(s.payload ?? null), s.ok === null ? null : s.ok ? 1 : 0, s.ms, now);
  }

  private tx(fn: () => void): void {
    withTransaction(this.db, fn);
  }
}
