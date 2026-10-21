-- 사용자별 하루 LLM 호출 수(backend/src/usage.ts).
CREATE TABLE llm_usage (
  user_id TEXT NOT NULL,
  day     TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
