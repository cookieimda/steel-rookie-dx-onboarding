// 사람 답변 내보내기: 체크포인트 DB의 첫 판정 답변을 hard 세트 형식으로 저장한다.
// 실행: npm run eval:export-human -- [--db 파일 ...] [--section ironmaking] [--out 폴더] [--force]
//  - --db를 여러 번 주면 팀원들이 보내 준 DB를 한 번에 내보낸다(기본: DB_PATH 또는 data/st-rookie.sqlite).
//  - 기본 출력 폴더는 llm/eval/hard/pending/ (Git 제외). 판정을 채운 뒤 hard/로 옮긴다.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { EVAL_DIR } from "./eval-set.js";
import { exportHumanAnswers, toJsonl } from "./human-export.js";

function args(argv: string[]) {
  const dbs: string[] = [];
  let section = "ironmaking";
  let out = join(EVAL_DIR, "hard", "pending");
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") dbs.push(argv[++i]!);
    else if (a === "--section") section = argv[++i]!;
    else if (a === "--out") out = argv[++i]!;
    else if (a === "--force") force = true;
    else throw new Error(`알 수 없는 옵션: ${a}`);
  }
  if (!dbs.length) dbs.push(process.env.DB_PATH || join(process.cwd(), "data", "st-rookie.sqlite"));
  return { dbs: dbs.map((d) => resolve(d)), section, out: resolve(out), force };
}

const { dbs, section, out, force } = args(process.argv.slice(2));
for (const path of dbs) if (!existsSync(path)) throw new Error(`DB 파일이 없습니다: ${path}`);

const casesPath = join(out, `${section}.human.jsonl`);
const verdictsPath = join(out, `${section}.human.model-verdicts.jsonl`);
if (!force && (existsSync(casesPath) || existsSync(verdictsPath))) {
  console.error(`이미 파일이 있습니다: ${casesPath}\n판정을 채우던 파일을 덮어쓰지 않도록 멈췄습니다. 덮어쓰려면 --force를 붙이세요.`);
  process.exitCode = 1;
} else {
  const sources = dbs.map((path) => ({ label: basename(path), db: new DatabaseSync(path, { readOnly: true }) }));
  const { cases, verdicts } = exportHumanAnswers(sources, section);
  mkdirSync(out, { recursive: true });
  writeFileSync(casesPath, toJsonl(cases));
  writeFileSync(verdictsPath, toJsonl(verdicts));
  const respondents = new Set(cases.map((c) => c.respondent)).size;
  console.log(`DB ${dbs.length}개에서 답변 ${cases.length}개(응답자 ${respondents}명)를 내보냈습니다.`);
  console.log(`- 판정용: ${casesPath}  (expected_verdict를 직접 채우세요)`);
  console.log(`- 모델 판정: ${verdictsPath}  (판정을 마친 뒤 case_id로 비교하세요)`);
}
