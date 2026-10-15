import type { DatabaseSync } from "node:sqlite";

export interface DeletedCounts {
  attempts: number;
  concept_results: number;
  attempt_messages: number;
  attempt_questions: number;
  misconceptions: number;
  llm_usage: number;
  learning_turns: number;
  learner_sketches: number;
  learning_supplements: number;
  /** 학습 랩(011): 간격 반복 카드·복습, 화면 xAPI 문장, 세션 리플레이, 소크라테스 대화. 행 수 합. */
  learning_lab: number;
  /** 운영 기능(012): 알림·알림 설정, 사고 사례 풀이, 설비 메모(내 메모와 거기 달린 공감·답글·신고, 남의 메모에 단 내 공감·답글·신고). 행 수 합. */
  operations: number;
  exam_events: number;
  review_tasks: number;
  education_jobs: number;
}

/**
 * 지울 기록의 출처(attempts·misconceptions의 origin). all이 기본이다.
 * 학습 대화(learning_turns)·하루 LLM 사용량(llm_usage)·마이페이지 필기(learner_sketches)·보충학습(learning_supplements)은 시연 기록이 없으므로 live·all일 때만 지운다.
 */
export type OriginFilter = "seed" | "live" | "all";

const originClause = (origin: OriginFilter) => (origin === "all" ? "" : ` AND origin = '${origin}'`);

/** 한 사용자의 체크포인트 기록·학습 대화·오개념·LLM 사용량을 지운다(하나의 트랜잭션). */
export function deleteUserData(db: DatabaseSync, userId: string, { origin = "all" }: { origin?: OriginFilter } = {}): DeletedCounts {
  const only = originClause(origin);
  const attemptsOf = `SELECT id FROM attempts WHERE user_id = ?${only}`;
  const withoutOrigin = (sql: string) => (origin === "seed" ? 0 : Number(db.prepare(sql).run(userId).changes));
  db.exec("BEGIN");
  try {
    const counts: DeletedCounts = {
      // 시험 이력과 복습 일정이 시도를 참조하므로 부모 기록보다 먼저 지운다.
      exam_events: Number(db.prepare(`DELETE FROM exam_events WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      review_tasks: Number(db.prepare(`DELETE FROM review_tasks WHERE based_attempt IN (${attemptsOf})`).run(userId).changes),
      education_jobs: origin === "seed" ? 0 : Number(db.prepare("DELETE FROM education_jobs WHERE user_id = ? AND id NOT IN (SELECT job_id FROM exam_events)").run(userId).changes),
      concept_results: Number(db.prepare(`DELETE FROM concept_results WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempt_messages: Number(db.prepare(`DELETE FROM attempt_messages WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempt_questions: Number(db.prepare(`DELETE FROM attempt_questions WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempts: Number(db.prepare(`DELETE FROM attempts WHERE user_id = ?${only}`).run(userId).changes),
      misconceptions: Number(db.prepare(`DELETE FROM misconceptions WHERE user_id = ?${only}`).run(userId).changes),
      llm_usage: withoutOrigin("DELETE FROM llm_usage WHERE user_id = ?"),
      learning_turns: withoutOrigin("DELETE FROM learning_turns WHERE user_id = ?"),
      // 마이페이지 펜 필기(008). 시연 기록이 없으므로 live·all일 때만 지운다.
      learner_sketches: withoutOrigin("DELETE FROM learner_sketches WHERE user_id = ?"),
      // 보충학습(009). 실행 기록(steps)이 보충학습을 참조하므로 먼저 지운다. 시연 기록이 없으므로 live·all일 때만 지운다.
      learning_supplements: origin === "seed" ? 0
        : (db.prepare("DELETE FROM learning_supplement_steps WHERE supplement_id IN (SELECT id FROM learning_supplements WHERE user_id = ?)").run(userId),
          Number(db.prepare("DELETE FROM learning_supplements WHERE user_id = ?").run(userId).changes)),
      // 학습 랩(011). 시연 기록이 없으므로 live·all일 때만 지운다. 대화·이벤트가 세션을 참조하므로 먼저 지운다.
      learning_lab: origin === "seed" ? 0 : [
        "DELETE FROM socratic_turns WHERE session_id IN (SELECT id FROM socratic_sessions WHERE user_id = ?)",
        "DELETE FROM socratic_sessions WHERE user_id = ?",
        "DELETE FROM replay_events WHERE session_id IN (SELECT id FROM replay_sessions WHERE user_id = ?)",
        "DELETE FROM replay_sessions WHERE user_id = ?",
        "DELETE FROM xapi_statements WHERE user_id = ?",
        "DELETE FROM sr_reviews WHERE user_id = ?",
        "DELETE FROM sr_cards WHERE user_id = ?",
      ].reduce((n, sql) => n + Number(db.prepare(sql).run(userId).changes), 0),
      operations: origin === "seed" ? 0 : [
        "DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE user_id = ?)",
        "DELETE FROM notifications WHERE user_id = ?",
        "DELETE FROM notification_prefs WHERE user_id = ?",
        "DELETE FROM incident_attempts WHERE user_id = ?",
        // 이상 상황 훈련(013)
        "DELETE FROM fault_attempts WHERE user_id = ?",
        "DELETE FROM equipment_note_votes WHERE note_id IN (SELECT id FROM equipment_notes WHERE user_id = ?)",
        "DELETE FROM equipment_note_replies WHERE note_id IN (SELECT id FROM equipment_notes WHERE user_id = ?)",
        "DELETE FROM equipment_note_reports WHERE note_id IN (SELECT id FROM equipment_notes WHERE user_id = ?)",
        "DELETE FROM equipment_notes WHERE user_id = ?",
        "DELETE FROM equipment_note_votes WHERE user_id = ?",
        "DELETE FROM equipment_note_replies WHERE user_id = ?",
        "DELETE FROM equipment_note_reports WHERE user_id = ?",
      ].reduce((n, sql) => n + Number(db.prepare(sql).run(userId).changes), 0),
    };
    db.exec("COMMIT");
    return counts;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countUserData(db: DatabaseSync, userId: string, { origin = "all" }: { origin?: OriginFilter } = {}): { attempts: number; misconceptions: number; learning_turns: number } {
  const only = originClause(origin);
  const one = (sql: string) => Number(db.prepare(sql).get(userId)?.n ?? 0);
  return {
    attempts: one(`SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?${only}`),
    misconceptions: one(`SELECT COUNT(*) AS n FROM misconceptions WHERE user_id = ?${only}`),
    learning_turns: origin === "seed" ? 0 : one("SELECT COUNT(*) AS n FROM learning_turns WHERE user_id = ?"),
  };
}

/**
 * 이름으로 지울 user_id들. 로그인 계정(users.username)이면 그 users.id와, 토큰 없이 X-User-Id 헤더 이름으로 쌓인 기록(user_id = 이름)을 함께 돌려준다.
 */
export function userIdsForName(db: DatabaseSync, name: string): { userIds: string[]; accountId: string | null } {
  const account = db.prepare("SELECT id FROM users WHERE username = ?").get(name);
  const accountId = account ? String(account.id) : null;
  return { userIds: accountId && accountId !== name ? [accountId, name] : [name], accountId };
}
