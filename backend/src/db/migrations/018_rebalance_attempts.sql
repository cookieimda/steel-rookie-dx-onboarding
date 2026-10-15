-- 되돌리기 퍼즐(3D, causal.ts rebalancePuzzles): 퍼즐·움직인 조정 값과 값, 풀었는지, 부작용 없이 풀었는지. 사원증 XP·배지·xAPI·관리자 통계가 읽는다(점수·통과와 무관).
CREATE TABLE rebalance_attempts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  puzzle     TEXT NOT NULL,
  control    TEXT NOT NULL,
  value      REAL NOT NULL,
  solved     INTEGER NOT NULL,
  clean      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX rebalance_attempts_user ON rebalance_attempts (user_id, created_at);
