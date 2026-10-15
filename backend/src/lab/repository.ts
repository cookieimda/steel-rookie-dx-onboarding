// 학습 랩 저장소(011_learning_lab.sql). SQL은 이 파일에만 둔다. 모든 조회는 user_id로 본인 것만 읽는다.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Grade, SrState } from "./spaced.js";
import type { StoredStatementRow } from "./xapi.js";

export interface SrCardRow extends SrState { card_id: string; created_at: string; updated_at: string }
export interface ReplaySession { id: string; started_at: string; ended_at: string; event_count: number }
export interface ReplayEvent { seq: number; t_ms: number; type: string; data: unknown }
export interface SocraticSession { id: string; section: string; equipment_id: string; state: "active" | "reached" | "revealed"; hint_level: number; created_at: string; updated_at: string }

/** 리플레이 한 세션의 이벤트 상한(넘으면 더 받지 않는다). */
export const MAX_REPLAY_EVENTS = 2000;
/** 사용자당 남기는 리플레이 세션 수(오래된 것부터 지운다). */
export const MAX_REPLAY_SESSIONS = 30;

export class LabRepository {
  constructor(private readonly db: DatabaseSync) {}

  trainees(): { id: string; name: string }[] {
    return this.db.prepare("SELECT id, name FROM users WHERE role = 'trainee' ORDER BY username").all().map((r) => ({ id: String(r.id), name: String(r.name) }));
  }

  // ── 간격 반복 ──
  srCards(userId: string): SrCardRow[] {
    return this.db.prepare("SELECT * FROM sr_cards WHERE user_id = ?").all(userId).map((r) => ({
      card_id: String(r.card_id), ease: Number(r.ease), interval_days: Number(r.interval_days), reps: Number(r.reps), lapses: Number(r.lapses),
      due_date: String(r.due_date), last_grade: Number(r.last_grade) as Grade, created_at: String(r.created_at), updated_at: String(r.updated_at),
    }));
  }
  saveReview(userId: string, cardId: string, state: SrState, grade: Grade, now: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`INSERT INTO sr_cards (user_id, card_id, ease, interval_days, reps, lapses, due_date, last_grade, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT (user_id, card_id) DO UPDATE SET ease = excluded.ease, interval_days = excluded.interval_days, reps = excluded.reps,
                         lapses = excluded.lapses, due_date = excluded.due_date, last_grade = excluded.last_grade, updated_at = excluded.updated_at`)
        .run(userId, cardId, state.ease, state.interval_days, state.reps, state.lapses, state.due_date, state.last_grade, now, now);
      this.db.prepare("INSERT INTO sr_reviews (id, user_id, card_id, grade, reviewed_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), userId, cardId, grade, now);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  srReviews(userId: string, since: string): { card_id: string; grade: number; reviewed_at: string }[] {
    return this.db.prepare("SELECT card_id, grade, reviewed_at FROM sr_reviews WHERE user_id = ? AND reviewed_at >= ? ORDER BY reviewed_at").all(userId, since)
      .map((r) => ({ card_id: String(r.card_id), grade: Number(r.grade), reviewed_at: String(r.reviewed_at) }));
  }

  // ── xAPI(화면이 보낸 문장) ──
  addStatement(userId: string, row: Omit<StoredStatementRow, "id" | "stored">, now: string): StoredStatementRow {
    const id = randomUUID();
    this.db.prepare("INSERT INTO xapi_statements (id, user_id, verb, object_id, object_name, timestamp, stored) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, row.verb, row.object_id, row.object_name, row.timestamp, now);
    return { id, ...row, stored: now };
  }
  statements(userId: string): StoredStatementRow[] {
    return this.db.prepare("SELECT id, verb, object_id, object_name, timestamp, stored FROM xapi_statements WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1000").all(userId)
      .map((r) => ({ id: String(r.id), verb: String(r.verb), object_id: String(r.object_id), object_name: String(r.object_name), timestamp: String(r.timestamp), stored: String(r.stored) }));
  }

  // ── 세션 리플레이 ──
  startReplay(userId: string, now: string): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO replay_sessions (id, user_id, started_at, ended_at, event_count) VALUES (?, ?, ?, ?, 0)").run(id, userId, now, now);
    // 오래된 세션 정리(빈 세션 포함). 이벤트가 세션을 참조하므로 먼저 지운다.
    const old = this.db.prepare("SELECT id FROM replay_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET ?").all(userId, MAX_REPLAY_SESSIONS).map((r) => String(r.id));
    for (const sid of old) this.deleteReplay(userId, sid);
    return id;
  }
  replayOwner(id: string): string | null {
    const r = this.db.prepare("SELECT user_id FROM replay_sessions WHERE id = ?").get(id);
    return r ? String(r.user_id) : null;
  }
  /** 이벤트를 뒤에 붙인다. 상한을 넘는 것은 버리고 붙인 개수를 돌려준다. */
  appendReplay(id: string, events: { t: number; type: string; data?: unknown }[], now: string): number {
    const count = Number(this.db.prepare("SELECT event_count FROM replay_sessions WHERE id = ?").get(id)?.event_count ?? 0);
    const room = Math.max(0, MAX_REPLAY_EVENTS - count);
    const take = events.slice(0, room);
    if (!take.length) return 0;
    const insert = this.db.prepare("INSERT INTO replay_events (session_id, seq, t_ms, type, data) VALUES (?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      take.forEach((e, i) => insert.run(id, count + i + 1, Math.round(e.t), e.type, JSON.stringify(e.data ?? null)));
      this.db.prepare("UPDATE replay_sessions SET event_count = ?, ended_at = ? WHERE id = ?").run(count + take.length, now, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return take.length;
  }
  replays(userId: string): ReplaySession[] {
    return this.db.prepare("SELECT id, started_at, ended_at, event_count FROM replay_sessions WHERE user_id = ? AND event_count > 0 ORDER BY started_at DESC").all(userId)
      .map((r) => ({ id: String(r.id), started_at: String(r.started_at), ended_at: String(r.ended_at), event_count: Number(r.event_count) }));
  }
  replayEvents(id: string): ReplayEvent[] {
    return this.db.prepare("SELECT seq, t_ms, type, data FROM replay_events WHERE session_id = ? ORDER BY seq").all(id)
      .map((r) => ({ seq: Number(r.seq), t_ms: Number(r.t_ms), type: String(r.type), data: JSON.parse(String(r.data)) }));
  }
  replaySession(userId: string, id: string): ReplaySession | null {
    const r = this.db.prepare("SELECT id, started_at, ended_at, event_count FROM replay_sessions WHERE id = ? AND user_id = ?").get(id, userId);
    return r ? { id: String(r.id), started_at: String(r.started_at), ended_at: String(r.ended_at), event_count: Number(r.event_count) } : null;
  }
  deleteReplay(userId: string, id: string): boolean {
    if (this.replayOwner(id) !== userId) return false;
    this.db.prepare("DELETE FROM replay_events WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM replay_sessions WHERE id = ?").run(id);
    return true;
  }

  // ── 소크라테스 모드 ──
  startSocratic(userId: string, section: string, equipmentId: string, opening: string, now: string): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO socratic_sessions (id, user_id, section, equipment_id, state, hint_level, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 0, ?, ?)")
      .run(id, userId, section, equipmentId, now, now);
    this.addTurn(id, "tutor", opening, now);
    return id;
  }
  socratic(userId: string, id: string): SocraticSession | null {
    const r = this.db.prepare("SELECT * FROM socratic_sessions WHERE id = ? AND user_id = ?").get(id, userId);
    return r ? { id: String(r.id), section: String(r.section), equipment_id: String(r.equipment_id), state: r.state as SocraticSession["state"], hint_level: Number(r.hint_level), created_at: String(r.created_at), updated_at: String(r.updated_at) } : null;
  }
  socraticList(userId: string): (SocraticSession & { turns: number })[] {
    return this.db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM socratic_turns t WHERE t.session_id = s.id AND t.role = 'user') AS turns
                              FROM socratic_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC LIMIT 20`).all(userId)
      .map((r) => ({ id: String(r.id), section: String(r.section), equipment_id: String(r.equipment_id), state: r.state as SocraticSession["state"], hint_level: Number(r.hint_level), created_at: String(r.created_at), updated_at: String(r.updated_at), turns: Number(r.turns) }));
  }
  turns(id: string): { role: "tutor" | "user"; text: string; created_at: string }[] {
    return this.db.prepare("SELECT role, text, created_at FROM socratic_turns WHERE session_id = ? ORDER BY seq").all(id)
      .map((r) => ({ role: r.role as "tutor" | "user", text: String(r.text), created_at: String(r.created_at) }));
  }
  addTurn(id: string, role: "tutor" | "user", text: string, now: string): void {
    const seq = Number(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS n FROM socratic_turns WHERE session_id = ?").get(id)?.n ?? 0) + 1;
    this.db.prepare("INSERT INTO socratic_turns (session_id, seq, role, text, created_at) VALUES (?, ?, ?, ?, ?)").run(id, seq, role, text, now);
  }
  updateSocratic(id: string, state: SocraticSession["state"], hintLevel: number, now: string): void {
    this.db.prepare("UPDATE socratic_sessions SET state = ?, hint_level = ?, updated_at = ? WHERE id = ?").run(state, hintLevel, now, id);
  }
}
