-- 학습 랩(학습 기록 화면의 '학습 랩' 탭, backend/src/lab/): 간격 반복 복습, xAPI 기록, 세션 리플레이, 소크라테스 모드.
-- 주간 리그는 기존 기록으로 계산해 따로 저장하지 않는다.

-- 간격 반복(SM-2) 카드 상태. card_id는 'eq:<설비 id>'. 처음 복습할 때 행을 만든다.
CREATE TABLE sr_cards (
  user_id       TEXT NOT NULL,
  card_id       TEXT NOT NULL,
  ease          REAL NOT NULL,
  interval_days INTEGER NOT NULL,
  reps          INTEGER NOT NULL,
  lapses        INTEGER NOT NULL,
  due_date      TEXT NOT NULL,
  last_grade    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

-- 복습할 때마다 한 줄(통계·xAPI·XP에 쓴다). grade: 0 다시, 3 어려움, 4 보통, 5 쉬움.
CREATE TABLE sr_reviews (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  card_id     TEXT NOT NULL,
  grade       INTEGER NOT NULL CHECK (grade IN (0, 3, 4, 5)),
  reviewed_at TEXT NOT NULL
);
CREATE INDEX sr_reviews_user ON sr_reviews (user_id, reviewed_at);

-- 화면이 보낸 xAPI 문장(설비를 살펴봄 등). 서버 기록에서 만드는 문장은 저장하지 않고 그때그때 만든다.
CREATE TABLE xapi_statements (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  verb        TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  object_name TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  stored      TEXT NOT NULL
);
CREATE INDEX xapi_statements_user ON xapi_statements (user_id, timestamp);

-- 세션 리플레이: 학습 기록 화면에서 한 번 머문 동안의 화면 조작(탭·공정·설비·질문). 본인만 본다.
CREATE TABLE replay_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX replay_sessions_user ON replay_sessions (user_id, started_at);

CREATE TABLE replay_events (
  session_id TEXT NOT NULL REFERENCES replay_sessions (id),
  seq        INTEGER NOT NULL,
  t_ms       INTEGER NOT NULL,
  type       TEXT NOT NULL,
  data       TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);

-- 소크라테스 모드: 답을 바로 주지 않고 질문으로 이끄는 대화. goal은 이 대화에서 스스로 말하게 할 설비 역할.
CREATE TABLE socratic_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  section      TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('active', 'reached', 'revealed')),
  hint_level   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX socratic_sessions_user ON socratic_sessions (user_id, created_at);

CREATE TABLE socratic_turns (
  session_id TEXT NOT NULL REFERENCES socratic_sessions (id),
  seq        INTEGER NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('tutor', 'user')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
