// 학습 모드 저장소. SQL은 이 파일에만 둔다. 설계는 docs/learning-mode.md.
// 학습 모드는 채점하지 않으므로 오개념을 기록만 하고 해결 처리는 하지 않는다(해결은 체크포인트에서 맞혔을 때).
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Section } from "../checkpoint/types.js";

export type TurnStatus = "grounded" | "unverified" | "safety_redirect";

export interface LearningTurn {
  id: string;
  user_id: string;
  session_id: string;
  seq: number;
  section: Section | null;
  equipment_id: string | null;
  question: string;
  answer: string;
  status: TurnStatus;
  source_ids: string[];
  created_at: string;
}

export type NewTurn = Omit<LearningTurn, "id" | "seq" | "created_at">;

export interface OpenMisconception {
  concept_id: string;
  summary: string;
  source: "checkpoint" | "learning";
  created_at: string;
}

/** 프롬프트·학습자 메모에 넣는 미해결 오개념 수. */
export const MAX_OPEN_MISCONCEPTIONS = 5;

/** 개념당 가장 최근 것 하나만 남겨 최근 것부터 limit개. 학습 채팅 프롬프트와 학습자 메모가 함께 쓴다. */
export function latestPerConcept(items: OpenMisconception[], limit = MAX_OPEN_MISCONCEPTIONS): OpenMisconception[] {
  const latest = new Map<string, OpenMisconception>();
  for (const m of items) {
    const prev = latest.get(m.concept_id);
    if (!prev || m.created_at >= prev.created_at) latest.set(m.concept_id, m);
  }
  return [...latest.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function toTurn(row: Row): LearningTurn {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    session_id: String(row.session_id),
    seq: Number(row.seq),
    section: str(row.section) as Section | null,
    equipment_id: str(row.equipment_id),
    question: String(row.question),
    answer: String(row.answer),
    status: row.status as TurnStatus,
    source_ids: JSON.parse(String(row.source_ids)) as string[],
    created_at: String(row.created_at),
  };
}

export class LearningRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** 대화 한 턴을 세션 끝에 붙여 저장한다. */
  saveTurn(turn: NewTurn, now: string): LearningTurn {
    const next = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM learning_turns WHERE session_id = ?").get(turn.session_id)?.n);
    const saved: LearningTurn = { ...turn, id: randomUUID(), seq: next, created_at: now };
    this.db
      .prepare(
        `INSERT INTO learning_turns (id, user_id, session_id, seq, section, equipment_id, question, answer, status, source_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(saved.id, saved.user_id, saved.session_id, saved.seq, saved.section, saved.equipment_id, saved.question, saved.answer, saved.status,
        JSON.stringify(saved.source_ids), saved.created_at);
    return saved;
  }

  /** 세션을 만든 사용자. 없는 세션이면 null. 다른 사람의 세션을 이어 쓰지 못하게 확인할 때 쓴다. */
  sessionOwner(sessionId: string): string | null {
    return str(this.db.prepare("SELECT user_id FROM learning_turns WHERE session_id = ? AND seq = 1").get(sessionId)?.user_id);
  }

  /** 세션의 최근 대화 limit개를 오래된 것부터. 모델에 넘길 대화 맥락에 쓴다. */
  recentTurns(sessionId: string, limit: number): LearningTurn[] {
    const rows = this.db.prepare("SELECT * FROM learning_turns WHERE session_id = ? ORDER BY seq DESC LIMIT ?").all(sessionId, limit);
    return rows.map(toTurn).reverse();
  }

  /**
   * 학습 모드에서 감지한 오개념을 기록한다(source = learning, 점수 반영 없음).
   * 같은 사용자·섹션·개념에 미해결 learning 오개념이 이미 있으면 새로 넣지 않고 summary·답변 원문만 최신으로 바꾼다
   * (미해결 오개념이 다시 프롬프트에 들어가 같은 오해가 질문마다 쌓이지 않게). 해결된 뒤 다시 나오면 새로 넣는다.
   */
  recordMisconception(m: { user_id: string; section: Section; concept_id: string; answer_text: string; summary: string }, now: string): string {
    const existing = this.db
      .prepare("SELECT id FROM misconceptions WHERE user_id = ? AND section = ? AND concept_id = ? AND source = 'learning' AND origin = 'live' AND resolved = 0 ORDER BY created_at DESC, id LIMIT 1")
      .get(m.user_id, m.section, m.concept_id);
    if (existing) {
      const id = String(existing.id);
      this.db.prepare("UPDATE misconceptions SET answer_text = ?, summary = ? WHERE id = ?").run(m.answer_text, m.summary, id);
      return id;
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO misconceptions (id, user_id, section, concept_id, source, phase, attempt_id, answer_text, summary, created_at)
         VALUES (?, ?, ?, ?, 'learning', NULL, NULL, ?, ?, ?)`,
      )
      .run(id, m.user_id, m.section, m.concept_id, m.answer_text, m.summary, now);
    return id;
  }

  /** 섹션의 미해결 오개념(학습·체크포인트 모두, 실제 기록만). 학습자 메모와 학습 모드 프롬프트에 쓴다. 시연 기록(origin = 'seed')은 뺀다. */
  openMisconceptions(userId: string, section: Section): OpenMisconception[] {
    return this.db
      .prepare("SELECT concept_id, summary, source, created_at FROM misconceptions WHERE user_id = ? AND section = ? AND origin = 'live' AND resolved = 0 ORDER BY created_at, id")
      .all(userId, section)
      .map((row) => ({
        concept_id: String(row.concept_id),
        summary: String(row.summary),
        source: row.source as OpenMisconception["source"],
        created_at: String(row.created_at),
      }));
  }
}
