import type { DatabaseSync } from "node:sqlite";

export interface DeletedCounts {
  attempts: number;
  concept_results: number;
  attempt_messages: number;
  attempt_questions: number;
  misconceptions: number;
  llm_usage: number;
  learning_turns: number;
}

/**
 * 지울 기록의 출처(attempts·misconceptions의 origin). all이 기본이다.
 * 학습 대화(learning_turns)와 하루 LLM 사용량(llm_usage)은 시연 기록이 없으므로 live·all일 때만 지운다.
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
      concept_results: Number(db.prepare(`DELETE FROM concept_results WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempt_messages: Number(db.prepare(`DELETE FROM attempt_messages WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempt_questions: Number(db.prepare(`DELETE FROM attempt_questions WHERE attempt_id IN (${attemptsOf})`).run(userId).changes),
      attempts: Number(db.prepare(`DELETE FROM attempts WHERE user_id = ?${only}`).run(userId).changes),
      misconceptions: Number(db.prepare(`DELETE FROM misconceptions WHERE user_id = ?${only}`).run(userId).changes),
      llm_usage: withoutOrigin("DELETE FROM llm_usage WHERE user_id = ?"),
      learning_turns: withoutOrigin("DELETE FROM learning_turns WHERE user_id = ?"),
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
