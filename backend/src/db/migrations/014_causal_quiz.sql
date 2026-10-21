-- 공정 인과 퀴즈(3D 화면, backend/src/lab/causal.ts): 칸마다 고른 답과 맞았는지. 사원증 XP·배지·xAPI가 읽는다(점수·통과와 무관).
CREATE TABLE causal_quiz_answers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  chain_id   TEXT NOT NULL,
  hop        INTEGER NOT NULL CHECK (hop IN (1, 2)),
  correct    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX causal_quiz_answers_user ON causal_quiz_answers (user_id, created_at);
