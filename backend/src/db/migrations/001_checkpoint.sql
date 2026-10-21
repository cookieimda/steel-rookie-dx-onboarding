-- 체크포인트 시도·개념 결과·오개념·대화 기록.
-- PostgreSQL로 옮길 수 있게 id는 TEXT(UUID), 시각은 ISO 문자열, 불리언은 0/1 INTEGER로 둔다.

CREATE TABLE attempts (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  section          TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('first', 'retry')),
  state            TEXT NOT NULL,
  resume_state     TEXT,
  concept_ids      TEXT NOT NULL,
  current_index    INTEGER NOT NULL DEFAULT 0,
  current_question TEXT,
  pending_answer   TEXT,
  understanding    REAL,
  unlocked         INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT
);

CREATE INDEX attempts_user_section ON attempts (user_id, section, created_at);

CREATE TABLE concept_results (
  attempt_id       TEXT NOT NULL REFERENCES attempts (id),
  concept_id       TEXT NOT NULL,
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  verdict          TEXT NOT NULL CHECK (verdict IN ('correct', 'partial', 'wrong', 'assisted')),
  evidence         TEXT,
  explain_from     INTEGER,
  recheck_question TEXT,
  recheck_answer   TEXT,
  recheck_verdict  TEXT CHECK (recheck_verdict IN ('correct', 'partial', 'wrong')),
  recheck_evidence TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (attempt_id, concept_id)
);

CREATE TABLE misconceptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  section     TEXT NOT NULL,
  concept_id  TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('checkpoint', 'learning')),
  phase       TEXT CHECK (phase IN ('initial', 'recheck')),
  attempt_id  TEXT,
  answer_text TEXT NOT NULL,
  summary     TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX misconceptions_user_concept ON misconceptions (user_id, concept_id, resolved);

CREATE TABLE attempt_messages (
  attempt_id TEXT NOT NULL REFERENCES attempts (id),
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('tutor', 'user')),
  type       TEXT,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, seq)
);
