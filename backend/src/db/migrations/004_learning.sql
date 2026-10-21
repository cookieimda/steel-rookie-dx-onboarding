-- 학습 모드 대화 기록. 설계는 docs/learning-mode.md. 보관 기간은 두지 않는다.
-- 003은 로그인 계정(003_users.sql)이 쓴다.
-- PostgreSQL로 옮길 수 있게 id는 TEXT(UUID), 시각은 ISO 문자열, 배열은 JSON 문자열로 둔다.
-- seq: 세션 안의 대화 순서(1부터). 같은 시각에 저장돼도 순서가 섞이지 않게 한다.

CREATE TABLE learning_turns (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  section      TEXT,
  equipment_id TEXT,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('grounded', 'unverified', 'safety_redirect')),
  source_ids   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (session_id, seq)
);

CREATE INDEX learning_turns_user ON learning_turns (user_id, created_at);
