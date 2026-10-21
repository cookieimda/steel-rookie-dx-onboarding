import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type Role = "trainee" | "admin";

export interface User {
  id: string;
  username: string;
  role: Role;
  name: string;
  employee_no: string;
}

export interface NewUser {
  username: string;
  password: string;
  name: string;
  employee_no: string;
  role?: Role;
}

const BCRYPT_COST = 10;
// 없는 아이디로 로그인해도 비밀번호 비교 시간을 똑같이 써서, 응답 시간으로 아이디 존재 여부를 알 수 없게 한다.
const DUMMY_HASH = bcrypt.hashSync("st-rookie-dummy-password", BCRYPT_COST);
const USER_COLUMNS = "id, username, role, name, employee_no";

/** 아이디나 사번이 이미 있을 때. field는 겹친 칸. */
export class DuplicateUserError extends Error {
  constructor(readonly field: "username" | "employee_no") {
    super(`duplicate ${field}`);
  }
}

export class UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  async create({ username, password, name, employee_no, role = "trainee" }: NewUser): Promise<User> {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    const user: User = { id: randomUUID(), username, role, name, employee_no };
    try {
      this.db
        .prepare("INSERT INTO users (id, username, password_hash, role, name, employee_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(user.id, username, hash, role, name, employee_no, new Date().toISOString());
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (isUniqueViolation(error)) throw new DuplicateUserError(message.includes("employee_no") ? "employee_no" : "username");
      throw error;
    }
    return user;
  }

  /** 아이디와 비밀번호가 맞으면 사용자를, 아니면 null을 돌려준다. */
  async verify(username: string, password: string): Promise<User | null> {
    const row = this.db.prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = ?`).get(username);
    const ok = await bcrypt.compare(password, row ? String(row.password_hash) : DUMMY_HASH);
    return row && ok ? toUser(row) : null;
  }

  findById(id: string): User | null {
    const row = this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id);
    return row ? toUser(row) : null;
  }

  /** 이름과 사번이 모두 맞는 계정. 아이디 찾기·비밀번호 재설정의 본인 확인. */
  findByIdentity(name: string, employee_no: string): User | null {
    const row = this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE name = ? AND employee_no = ?`).get(name, employee_no);
    return row ? toUser(row) : null;
  }

  async setPassword(id: string, password: string): Promise<void> {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    this.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }

  /** 시연 계정 표시(users.is_demo = 1). 관리자 화면의 'demo' 배지와 ?include_demo=false 필터에 쓴다. */
  markDemo(usernames: readonly string[]): void {
    const mark = this.db.prepare("UPDATE users SET is_demo = 1 WHERE username = ? AND role = 'trainee'");
    for (const username of usernames) mark.run(username);
  }

  exists(username: string): boolean {
    return this.db.prepare("SELECT 1 FROM users WHERE username = ?").get(username) !== undefined;
  }
}

const toUser = (row: Record<string, unknown>): User => ({
  id: String(row.id),
  username: String(row.username),
  role: row.role === "admin" ? "admin" : "trainee",
  name: String(row.name),
  employee_no: String(row.employee_no),
});

// SQLITE_CONSTRAINT_UNIQUE
const isUniqueViolation = (error: unknown) => (error as { errcode?: number }).errcode === 2067;
