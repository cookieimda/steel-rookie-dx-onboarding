-- 체크포인트 '나중에 이어 풀기': 시도 안에서 낸 질문 기록.
-- 이어 풀 때 같은 개념에 아직 안 쓴 은행 질문을 고르려고 은행 원문을 남긴다(current_question에는 다듬은 문장이 들어 있어 원문을 알 수 없다).
-- 상태 paused는 attempts.state에 CHECK가 없어서 스키마를 바꾸지 않는다.

CREATE TABLE attempt_questions (
  attempt_id    TEXT NOT NULL REFERENCES attempts (id),
  concept_id    TEXT NOT NULL,
  phase         TEXT NOT NULL CHECK (phase IN ('initial', 'recheck')),
  bank_question TEXT,
  asked_text    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX attempt_questions_attempt_concept ON attempt_questions (attempt_id, concept_id, phase);
