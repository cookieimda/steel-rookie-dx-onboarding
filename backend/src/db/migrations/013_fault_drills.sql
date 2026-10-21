-- 이상 상황 훈련(3D 화면, backend/src/lab/faults.ts): 단계마다 몇 번 만에 맞혔는지와 점수. 점수는 이해도·통과와 상관없다.
CREATE TABLE fault_attempts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  fault_id   TEXT NOT NULL,
  tries_json TEXT NOT NULL,
  score      REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX fault_attempts_user ON fault_attempts (user_id, created_at);
