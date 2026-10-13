// 특정 사용자의 기록 삭제: npm run db:reset-user -- 이름 --origin seed|live|all [--yes]
// - 이름이 로그인 아이디(users.username)면 그 계정(users.id)의 기록과, 같은 이름으로 X-User-Id 헤더에 쌓인 기록을 함께 지운다.
// - --origin(필수): 지울 기록의 출처. 실제 답변을 실수로 지우지 않도록 기본값을 두지 않는다. seed는 db:seed-demo가 만든 시연 기록만, live는 실제 기록만. 학습 대화·LLM 사용량은 live·all일 때만 지운다.
// - 체크포인트 시도·답변·대화 기록·학습 대화·오개념·하루 LLM 사용량을 지운다. 계정(users)은 지우지 않는다. --yes가 없으면 지우기 전에 한 번 묻는다.
// - 실제 기록(live)은 평가 세트의 사람 답변 원천이다. 지우기 전에 필요하면 npm run eval:export-human으로 백업한다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { openDatabase } from "./database.js";
import { countUserData, deleteUserData, userIdsForName, type OriginFilter } from "./user-data.js";

const USAGE = "사용법: npm run db:reset-user -- 이름 --origin seed|live|all [--yes]";
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const originIndex = args.indexOf("--origin");
const origin = (originIndex >= 0 ? args[originIndex + 1] : undefined) as OriginFilter | undefined;
if (!origin || !["seed", "live", "all"].includes(origin)) {
  console.error(`--origin을 seed, live, all 중 하나로 지정해 주세요.\n${USAGE}`);
  process.exit(1);
}
const positional = args.filter((a, i) => a !== "--yes" && a !== "--origin" && !(originIndex >= 0 && i === originIndex + 1));
const name = positional[0]?.normalize("NFC").trim();
if (!name) {
  console.error(USAGE);
  process.exit(1);
}

const path = process.env.DB_PATH || join(process.cwd(), "data", "st-rookie.sqlite");
if (!existsSync(path)) {
  console.error(`DB 파일이 없습니다: ${path}`);
  process.exit(1);
}
const db = openDatabase(path);
const { userIds, accountId } = userIdsForName(db, name);
const targets = userIds
  .map((id) => ({ id, label: id === accountId ? `계정 ${name}(${id})` : `헤더 이름 ${id}`, before: countUserData(db, id, { origin }) }))
  .filter((t) => t.before.attempts + t.before.misconceptions + t.before.learning_turns > 0);
if (targets.length === 0) {
  console.log(`'${name}'의 기록(origin=${origin})이 없습니다. (${path})`);
  process.exit(0);
}

for (const t of targets) {
  console.log(`${t.label}: 체크포인트 시도 ${t.before.attempts}개, 학습 대화 ${t.before.learning_turns}개, 오개념 ${t.before.misconceptions}개 (origin=${origin})`);
}
console.log(`위 기록을 지웁니다. (${path})`);
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("계속할까요? (y/N) ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y") {
    console.log("지우지 않았습니다.");
    process.exit(0);
  }
}
for (const t of targets) {
  const d = deleteUserData(db, t.id, { origin });
  console.log(`${t.label} 삭제 완료: 시도 ${d.attempts}, 개념 결과 ${d.concept_results}, 대화 ${d.attempt_messages}, 질문 기록 ${d.attempt_questions}, 오개념 ${d.misconceptions}, 사용량 ${d.llm_usage}, 학습 대화 ${d.learning_turns}`);
}
