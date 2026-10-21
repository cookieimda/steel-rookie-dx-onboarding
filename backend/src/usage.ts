// 사용자별 하루 LLM 호출 수 제한. 무료 등급 사용량을 지키기 위한 장치다.
// 한도는 .env의 LLM_DAILY_LIMIT(기본 150, 0 이하면 제한 없음). 날짜는 서버 시간 기준이며 자정에 초기화된다.
import type { DatabaseSync } from "node:sqlite";

export class UsageLimitError extends Error {
  constructor(readonly limit: number) {
    super(`하루 LLM 호출 한도(${limit}회)를 넘었습니다.`);
  }
}

export function dailyLimitFromEnv(): number {
  const raw = process.env.LLM_DAILY_LIMIT?.trim();
  if (!raw) return 150;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`LLM_DAILY_LIMIT가 숫자가 아닙니다: ${raw}`);
  return n;
}

const localDay = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, 서버 시간대

export class LlmUsage {
  constructor(
    private readonly db: DatabaseSync,
    readonly dailyLimit: number = dailyLimitFromEnv(),
    private readonly today: () => string = localDay,
  ) {}

  /** LLM을 한 번 호출하기 직전에 부른다. 한도를 넘으면 UsageLimitError. */
  consume(userId: string): void {
    if (this.dailyLimit <= 0) return;
    const day = this.today();
    if (this.used(userId, day) >= this.dailyLimit) throw new UsageLimitError(this.dailyLimit);
    this.db
      .prepare(
        `INSERT INTO llm_usage (user_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1`,
      )
      .run(userId, day);
  }

  used(userId: string, day = this.today()): number {
    const row = this.db.prepare("SELECT count FROM llm_usage WHERE user_id = ? AND day = ?").get(userId, day);
    return row ? Number(row.count) : 0;
  }
}
