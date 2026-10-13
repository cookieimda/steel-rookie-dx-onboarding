-- 마이페이지 '설계도·필기' 탭의 펜 필기. 공정·도면(탑뷰·평면도·정면도)마다 한 줄이고, 획 목록을 JSON으로 둔다.
-- 좌표는 도면 영역 크기에 대한 비율(0~1)이라 화면 크기가 바뀌어도 같은 자리에 그려진다.
-- 획을 모두 지우면 행을 지운다. 본인만 읽고 쓴다(GET/PUT /api/me/sketches).

CREATE TABLE learner_sketches (
  user_id     TEXT NOT NULL,
  process_id  TEXT NOT NULL,
  draw_mode   TEXT NOT NULL CHECK (draw_mode IN ('top', 'plan', 'front')),
  strokes     TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, process_id, draw_mode)
);
