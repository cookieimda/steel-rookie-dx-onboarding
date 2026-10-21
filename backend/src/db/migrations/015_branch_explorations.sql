-- 사고 사례 갈림길 탐험(학습 기록·3D): "다르게 했다면?"에서 골라 본 선택. 같은 선택은 한 번만 센다(사원증 XP·배지·xAPI가 읽는다, 점수·통과와 무관).
CREATE TABLE branch_explorations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  at_step     INTEGER NOT NULL,
  pick        INTEGER NOT NULL,
  actual      INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, scenario_id, at_step, pick)
);
CREATE INDEX branch_explorations_user ON branch_explorations (user_id, created_at);
