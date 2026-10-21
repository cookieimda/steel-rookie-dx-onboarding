-- 로그인 계정. 다른 테이블의 user_id는 users.id(UUID)를 가리킨다.
-- PostgreSQL로 옮길 수 있게 id는 TEXT(UUID), 시각은 ISO 문자열로 둔다.
-- role: trainee(신입사원) | admin(관리자). 회원가입은 항상 trainee로 만든다.
-- name·employee_no(사번)는 아이디 찾기·비밀번호 재설정 때 본인 확인에 쓴다.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'trainee' CHECK (role IN ('trainee', 'admin')),
  name          TEXT NOT NULL,
  employee_no   TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL
);
