-- 기록 출처: live(실제 사용) | seed(npm run db:seed-demo가 만든 시연 기록).
-- 시연 계정(trainee01~)으로 실제 테스트도 하므로 계정이 아니라 기록 단위로 구분한다.
-- eval:export-human은 live만 내보내고, seed는 시연 기록만 지우고 다시 만든다.

ALTER TABLE attempts ADD COLUMN origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live', 'seed'));
ALTER TABLE misconceptions ADD COLUMN origin TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live', 'seed'));

-- 이 마이그레이션 전에 만든 시연 기록 표시.
-- 엔진은 시도마다 대화 기록(attempt_messages)을 남기지만 seed는 남기지 않는다.
UPDATE attempts SET origin = 'seed'
 WHERE NOT EXISTS (SELECT 1 FROM attempt_messages m WHERE m.attempt_id = attempts.id);

UPDATE misconceptions SET origin = 'seed'
 WHERE attempt_id IN (SELECT id FROM attempts WHERE origin = 'seed');

-- 학습 모드 오개념은 같은 질문의 대화(learning_turns)와 함께 저장되지만, seed가 만든 것은 대화가 없다.
UPDATE misconceptions SET origin = 'seed'
 WHERE source = 'learning'
   AND NOT EXISTS (SELECT 1 FROM learning_turns t WHERE t.user_id = misconceptions.user_id AND t.question = misconceptions.answer_text);
