-- 보충학습(docs/supplementary-learning.md): 오개념이 있는 개념을 설명 → 확인 문제 → 채점 → 해결/다시 설명으로 이어 간다.
-- 점수(체크포인트)와는 따로다. 확인 문제를 맞히면 그 개념의 학습 모드 오개념 메모(source = learning)만 해결한다.
-- PostgreSQL로 옮길 수 있게 id는 TEXT(UUID), 시각은 ISO 문자열, 기록 내용은 JSON 문자열로 둔다.

CREATE TABLE learning_supplements (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  section      TEXT NOT NULL,
  concept_id   TEXT NOT NULL,
  -- awaiting_answer: 첫 확인 문제의 답 대기, awaiting_recheck: 다시 설명한 뒤 두 번째 문제의 답 대기,
  -- completed: 끝(outcome에 결과), stopped: 학습자가 그만두거나 새 보충학습을 시작해 끝냄.
  state        TEXT NOT NULL CHECK (state IN ('awaiting_answer', 'awaiting_recheck', 'completed', 'stopped')),
  outcome      TEXT CHECK (outcome IN ('resolved', 'not_resolved')),
  -- 지금 답을 기다리는 확인 문제.
  question     TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX learning_supplements_user ON learning_supplements (user_id, section, concept_id, state);

-- 실행 기록: 도구 호출(입력·결과·성공 여부·걸린 시간), 주고받은 말, 화면 조작의 실제 실행 결과. 순서대로 다시 보며 재현할 수 있게 남긴다.
CREATE TABLE learning_supplement_steps (
  supplement_id TEXT NOT NULL REFERENCES learning_supplements (id),
  seq           INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('tool', 'message', 'scene_result')),
  -- tool: 도구 이름, message: 'tutor' 또는 'user', scene_result: 'scene'.
  name          TEXT NOT NULL,
  payload       TEXT NOT NULL,
  ok            INTEGER,
  ms            INTEGER,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (supplement_id, seq)
);
