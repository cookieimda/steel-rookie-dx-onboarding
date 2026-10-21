-- 거꾸로 추론 퀴즈(3D, causal.ts diagnoseQuiz): 문제(진짜 원인 키 "변수:방향")와 고른 원인, 맞았는지. 관리자 3D 실습 통계가 읽는다(점수·통과·XP와 무관).
CREATE TABLE diagnose_answers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  question   TEXT NOT NULL,
  choice     TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX diagnose_answers_user ON diagnose_answers (user_id, created_at);
