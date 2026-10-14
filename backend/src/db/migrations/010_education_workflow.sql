CREATE TABLE education_jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
  request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
  phase TEXT NOT NULL, result_json TEXT, error_json TEXT, metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, request_key)
);
CREATE INDEX education_jobs_user ON education_jobs(user_id, created_at);
CREATE TABLE rubric_versions (
  id TEXT PRIMARY KEY, section TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE exam_events (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), attempt_id TEXT NOT NULL REFERENCES attempts(id),
  job_id TEXT NOT NULL UNIQUE REFERENCES education_jobs(id), rubric_version TEXT NOT NULL REFERENCES rubric_versions(id),
  metadata_json TEXT NOT NULL, view_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX exam_events_user ON exam_events(user_id, attempt_id);
CREATE TABLE review_tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), section TEXT NOT NULL,
  concept_id TEXT NOT NULL, concept_name TEXT NOT NULL, due_date TEXT NOT NULL, reason TEXT NOT NULL,
  based_attempt TEXT NOT NULL REFERENCES attempts(id), completed_at TEXT, created_at TEXT NOT NULL,
  UNIQUE(user_id, section, concept_id)
);
CREATE TABLE education_groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE education_members (
  group_id TEXT NOT NULL REFERENCES education_groups(id), user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(group_id, user_id)
);
CREATE TABLE education_assignments (
  id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES education_groups(id), section TEXT NOT NULL,
  title TEXT NOT NULL, due_date TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE education_materials (
  id TEXT PRIMARY KEY, section TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  source_url TEXT NOT NULL, publisher TEXT NOT NULL, version TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('draft','approved','rejected')),
  created_by TEXT NOT NULL REFERENCES users(id), reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL, reviewed_at TEXT
);
