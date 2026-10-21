// 체크포인트 저장소. SQL은 이 파일에만 둔다.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { RecheckVerdict, Verdict } from "../scoring.js";
import type { AttemptKind, CheckpointState, HistoryMessage, Phase, Section, UtteranceType } from "./types.js";

export interface AttemptRow {
  id: string;
  user_id: string;
  section: Section;
  kind: AttemptKind;
  state: CheckpointState;
  resume_state: CheckpointState | null;
  concept_ids: string[];
  current_index: number;
  current_question: string | null;
  pending_answer: string | null;
  understanding: number | null;
  unlocked: boolean | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ConceptResultRow {
  attempt_id: string;
  concept_id: string;
  question: string;
  answer: string;
  verdict: Verdict;
  evidence: string | null;
  explain_from: number | null;
  recheck_question: string | null;
  recheck_answer: string | null;
  recheck_verdict: RecheckVerdict | null;
  recheck_evidence: string | null;
}

export interface MisconceptionRow {
  id: string;
  user_id: string;
  section: Section;
  concept_id: string;
  source: "checkpoint" | "learning";
  phase: Phase | null;
  attempt_id: string | null;
  answer_text: string;
  summary: string;
  resolved: boolean;
  resolved_at: string | null;
}

type Row = Record<string, unknown>;
export type AttemptPatch = Partial<Omit<AttemptRow, "id" | "user_id" | "section" | "kind" | "created_at">>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => (v === null || v === undefined ? null : Number(v) === 1);

function toAttempt(row: Row): AttemptRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    section: row.section as Section,
    kind: row.kind as AttemptKind,
    state: row.state as CheckpointState,
    resume_state: str(row.resume_state) as CheckpointState | null,
    concept_ids: JSON.parse(String(row.concept_ids)) as string[],
    current_index: Number(row.current_index),
    current_question: str(row.current_question),
    pending_answer: str(row.pending_answer),
    understanding: num(row.understanding),
    unlocked: bool(row.unlocked),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    completed_at: str(row.completed_at),
  };
}

function toResult(row: Row): ConceptResultRow {
  return {
    attempt_id: String(row.attempt_id),
    concept_id: String(row.concept_id),
    question: String(row.question),
    answer: String(row.answer),
    verdict: row.verdict as Verdict,
    evidence: str(row.evidence),
    explain_from: num(row.explain_from),
    recheck_question: str(row.recheck_question),
    recheck_answer: str(row.recheck_answer),
    recheck_verdict: str(row.recheck_verdict) as RecheckVerdict | null,
    recheck_evidence: str(row.recheck_evidence),
  };
}

function toMisconception(row: Row): MisconceptionRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    section: row.section as Section,
    concept_id: String(row.concept_id),
    source: row.source as MisconceptionRow["source"],
    phase: str(row.phase) as Phase | null,
    attempt_id: str(row.attempt_id),
    answer_text: String(row.answer_text),
    summary: String(row.summary),
    resolved: Number(row.resolved) === 1,
    resolved_at: str(row.resolved_at),
  };
}

const toSql = (v: unknown): SQLInputValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return JSON.stringify(v);
  return v as SQLInputValue;
};

export class CheckpointRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** fn 안의 쓰기를 하나의 트랜잭션으로 묶는다. 예외가 나면 모두 되돌린다. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createAttempt(a: Omit<AttemptRow, "updated_at" | "completed_at" | "understanding" | "unlocked" | "resume_state" | "pending_answer">): void {
    this.db
      .prepare(
        `INSERT INTO attempts (id, user_id, section, kind, state, concept_ids, current_index, current_question, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.user_id, a.section, a.kind, a.state, JSON.stringify(a.concept_ids), a.current_index, a.current_question, a.created_at, a.created_at);
  }

  // 시도 조회는 실제 기록(origin = 'live')만 본다. 시연 기록(db:seed-demo)이 진행·해금·재도전에 섞이지 않게 한다.

  getAttempt(id: string): AttemptRow | null {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ? AND origin = 'live'").get(id);
    return row ? toAttempt(row) : null;
  }

  findOpenAttempt(userId: string, section: Section): AttemptRow | null {
    const row = this.db
      .prepare("SELECT * FROM attempts WHERE user_id = ? AND section = ? AND origin = 'live' AND state <> 'completed' ORDER BY created_at DESC LIMIT 1")
      .get(userId, section);
    return row ? toAttempt(row) : null;
  }

  /** 완료된 시도를 오래된 순서로. */
  listCompletedAttempts(userId: string, section: Section): AttemptRow[] {
    return this.db
      .prepare("SELECT * FROM attempts WHERE user_id = ? AND section = ? AND origin = 'live' AND state = 'completed' ORDER BY completed_at, created_at")
      .all(userId, section)
      .map(toAttempt);
  }

  updateAttempt(id: string, patch: AttemptPatch, now: string): void {
    const entries = Object.entries(patch);
    const sets = [...entries.map(([key]) => `${key} = ?`), "updated_at = ?"].join(", ");
    this.db.prepare(`UPDATE attempts SET ${sets} WHERE id = ?`).run(...entries.map(([, v]) => toSql(v)), now, id);
  }

  insertResult(r: Pick<ConceptResultRow, "attempt_id" | "concept_id" | "question" | "answer" | "verdict" | "evidence" | "explain_from">, now: string): void {
    this.db
      .prepare(
        `INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, evidence, explain_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.attempt_id, r.concept_id, r.question, r.answer, r.verdict, r.evidence, r.explain_from, now, now);
  }

  updateRecheckQuestion(attemptId: string, conceptId: string, question: string, now: string): void {
    this.db
      .prepare("UPDATE concept_results SET recheck_question = ?, updated_at = ? WHERE attempt_id = ? AND concept_id = ?")
      .run(question, now, attemptId, conceptId);
  }

  updateRecheck(
    attemptId: string,
    conceptId: string,
    r: { recheck_answer: string; recheck_verdict: RecheckVerdict; recheck_evidence: string },
    now: string,
  ): void {
    this.db
      .prepare(
        `UPDATE concept_results SET recheck_answer = ?, recheck_verdict = ?, recheck_evidence = ?, updated_at = ?
         WHERE attempt_id = ? AND concept_id = ?`,
      )
      .run(r.recheck_answer, r.recheck_verdict, r.recheck_evidence, now, attemptId, conceptId);
  }

  getResult(attemptId: string, conceptId: string): ConceptResultRow | null {
    const row = this.db.prepare("SELECT * FROM concept_results WHERE attempt_id = ? AND concept_id = ?").get(attemptId, conceptId);
    return row ? toResult(row) : null;
  }

  listResults(attemptId: string): ConceptResultRow[] {
    return this.db.prepare("SELECT * FROM concept_results WHERE attempt_id = ?").all(attemptId).map(toResult);
  }

  /** 시도에서 낸 질문을 남긴다. bank는 은행 원문(LLM이 만든 질문이면 null). 이어 풀 때 안 쓴 질문을 고르는 데 쓴다. */
  insertAskedQuestion(q: { attempt_id: string; concept_id: string; phase: Phase; bank: string | null; text: string }, now: string): void {
    this.db
      .prepare("INSERT INTO attempt_questions (attempt_id, concept_id, phase, bank_question, asked_text, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(q.attempt_id, q.concept_id, q.phase, q.bank, q.text, now);
  }

  /** 이 시도에서 이 개념·단계에 이미 쓴 은행 원문. */
  listUsedBankQuestions(attemptId: string, conceptId: string, phase: Phase): string[] {
    return this.db
      .prepare("SELECT DISTINCT bank_question FROM attempt_questions WHERE attempt_id = ? AND concept_id = ? AND phase = ? AND bank_question IS NOT NULL")
      .all(attemptId, conceptId, phase)
      .map((row) => String(row.bank_question));
  }

  insertMisconception(m: Omit<MisconceptionRow, "resolved" | "resolved_at">, now: string): void {
    this.db
      .prepare(
        `INSERT INTO misconceptions (id, user_id, section, concept_id, source, phase, attempt_id, answer_text, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(m.id, m.user_id, m.section, m.concept_id, m.source, m.phase, m.attempt_id, m.answer_text, m.summary, now);
  }

  /** 같은 개념을 맞히면 그 개념의 미해결 오개념을 모두 해결 처리한다. */
  resolveMisconceptions(userId: string, conceptId: string, now: string): void {
    this.db
      .prepare("UPDATE misconceptions SET resolved = 1, resolved_at = ? WHERE user_id = ? AND concept_id = ? AND resolved = 0")
      .run(now, userId, conceptId);
  }

  listMisconceptions(userId: string): MisconceptionRow[] {
    return this.db.prepare("SELECT * FROM misconceptions WHERE user_id = ? ORDER BY created_at, rowid").all(userId).map(toMisconception);
  }

  appendMessages(attemptId: string, messages: { role: "tutor" | "user"; type: UtteranceType | null; text: string }[], now: string): void {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM attempt_messages WHERE attempt_id = ?").get(attemptId);
    let seq = Number(row?.seq ?? 0);
    const insert = this.db.prepare("INSERT INTO attempt_messages (attempt_id, seq, role, type, text, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const m of messages) insert.run(attemptId, ++seq, m.role, m.type, m.text, now);
  }

  listMessages(attemptId: string): HistoryMessage[] {
    return this.db
      .prepare("SELECT role, type, text FROM attempt_messages WHERE attempt_id = ? ORDER BY seq")
      .all(attemptId)
      .map((row) => ({ role: row.role as HistoryMessage["role"], type: str(row.type) as HistoryMessage["type"], text: String(row.text) }));
  }
}
