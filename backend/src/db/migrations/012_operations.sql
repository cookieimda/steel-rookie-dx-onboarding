-- 운영 기능(2026-10-15): 자료 검수 워크플로, 작업 대기열 일반화, 알림, 사고 사례, 설비 주석 공유.
-- What-if 계산·오답 패턴·채점 근거 하이라이트는 계산만 하고 저장하지 않는다.

-- 자료 검수 워크플로: 초안 → 검수 요청 → (수정 요청 → 수정본) → 승인·반려. education_materials.state(draft·approved·rejected)는 그대로 두고
-- 단계는 이 기록으로 정한다. 수정본은 새 자료(새 version)로 만들고 원본과 잇는다(승인된 글은 바꾸지 않는다).
CREATE TABLE material_events (
  id          TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES education_materials (id),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('created', 'submitted', 'commented', 'changes_requested', 'revised', 'approved', 'rejected', 'checked')),
  comment     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX material_events_material ON material_events (material_id, created_at);

CREATE TABLE material_revisions (
  material_id TEXT PRIMARY KEY REFERENCES education_materials (id),
  parent_id   TEXT NOT NULL REFERENCES education_materials (id)
);

-- 작업 대기열 일반화: 우선순위, 다시 시도(일시 오류), 진행률.
ALTER TABLE education_jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE education_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE education_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1;
ALTER TABLE education_jobs ADD COLUMN progress REAL;

-- 알림: 화면 알림함(모든 알림) + 채널별 발송 기록(이메일·사내 메신저). dedupe_key로 같은 알림을 하루 한 번만 만든다.
CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('review_due', 'assignment_due', 'assignment_overdue', 'streak_risk', 'material_review', 'job_done', 'note_reply', 'system')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  dedupe_key TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user ON notifications (user_id, created_at);

CREATE TABLE notification_deliveries (
  id              TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications (id),
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'messenger')),
  state           TEXT NOT NULL CHECK (state IN ('pending', 'sent', 'skipped', 'failed')),
  detail          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
CREATE INDEX notification_deliveries_state ON notification_deliveries (state, updated_at);

CREATE TABLE notification_prefs (
  user_id    TEXT PRIMARY KEY,
  prefs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 사고 사례 시나리오: 원인 분석 문제 풀이 기록(content/scenarios의 교육용 가상 사례).
CREATE TABLE incident_attempts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  scenario_id  TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  score        REAL NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX incident_attempts_user ON incident_attempts (user_id, created_at);

-- 설비 주석 공유: 설비에 남긴 질문·메모·팁. public이면 다른 학습자도 보고 공감·답글을 단다. 신고가 쌓이거나 관리자가 숨기면 hidden.
CREATE TABLE equipment_notes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  process_id   TEXT NOT NULL,
  equipment_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('question', 'memo', 'tip')),
  text         TEXT NOT NULL,
  visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  hidden       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX equipment_notes_equipment ON equipment_notes (equipment_id, created_at);

CREATE TABLE equipment_note_votes (
  note_id TEXT NOT NULL REFERENCES equipment_notes (id),
  user_id TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id)
);

CREATE TABLE equipment_note_replies (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES equipment_notes (id),
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE equipment_note_reports (
  note_id    TEXT NOT NULL REFERENCES equipment_notes (id),
  user_id    TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, user_id)
);
