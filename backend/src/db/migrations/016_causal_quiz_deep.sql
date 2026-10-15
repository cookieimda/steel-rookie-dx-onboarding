-- 인과 퀴즈 심화(세 칸 사슬, causal.ts causalQuiz level 2): 칸 번호 3까지 받는다. 014의 CHECK(1, 2)를 넓히려고 표를 새로 만들어 옮긴다.
CREATE TABLE causal_quiz_answers_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  chain_id   TEXT NOT NULL,
  hop        INTEGER NOT NULL CHECK (hop IN (1, 2, 3)),
  correct    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO causal_quiz_answers_new (id, user_id, chain_id, hop, correct, created_at)
  SELECT id, user_id, chain_id, hop, correct, created_at FROM causal_quiz_answers;
DROP TABLE causal_quiz_answers;
ALTER TABLE causal_quiz_answers_new RENAME TO causal_quiz_answers;
CREATE INDEX causal_quiz_answers_user ON causal_quiz_answers (user_id, created_at);
