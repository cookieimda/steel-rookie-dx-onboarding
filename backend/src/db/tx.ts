// 트랜잭션은 이 함수 하나로 연다. 저장소마다 BEGIN/COMMIT/ROLLBACK을 따로 쓰지 않는다.
// LLM 호출은 이 안에서 하지 않는다: 먼저 부르고, 결과를 받은 뒤 쓰기만 묶는다(checkpoint/engine.ts commit과 같은 규칙).
import type { DatabaseSync } from "node:sqlite";

/** fn 안의 쓰기를 하나의 트랜잭션으로 묶는다. 예외가 나면 모두 되돌린다. */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
