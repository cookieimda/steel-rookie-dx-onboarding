-- 시연 계정 표시: 1이면 시연 기록(npm run db:seed-demo)을 넣는 시연 신입사원(trainee11~20).
-- trainee01~10은 팀원 실제 테스트 계정이라 0이다. 관리자 화면은 실제 계정과 섞어 보여 주고, ?include_demo=false면 뺀다.
-- 새 DB는 서버가 시연 계정을 만들 때(seedDemoAccounts) 표시한다. 이미 있는 계정은 여기서 표시한다.

ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1));

UPDATE users SET is_demo = 1
 WHERE role = 'trainee'
   AND username IN ('trainee11', 'trainee12', 'trainee13', 'trainee14', 'trainee15',
                    'trainee16', 'trainee17', 'trainee18', 'trainee19', 'trainee20');
