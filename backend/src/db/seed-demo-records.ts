// npm run db:seed-demo [seed]
// 시연 신입사원의 시연 기록(origin = 'seed')을 지우고 trainee02~20에게만 무작위로 다시 만든다(trainee01은 실제 테스트용). seed를 주면 같은 기록이 나온다.
// 개념은 final 루브릭에서 읽고, final 루브릭이 없는 섹션은 시연 목록(content/demo/sections.json)으로 채운다. 루브릭이 추가되면 그 섹션은 루브릭 개념을 쓴다.
import { seedDemoAccounts } from "../auth/demo-accounts.js";
import { UserRepository } from "../auth/users.js";
import { loadDemoSections, statSections } from "../demo-sections.js";
import { loadFinalRubrics } from "../rubrics.js";
import { openDatabase } from "./database.js";
import { seedDemoRecords, type SectionConcepts } from "./demo-records.js";

const seed = process.argv[2] ? Number(process.argv[2]) : Math.floor(Math.random() * 1_000_000);
if (!Number.isInteger(seed)) throw new Error(`seed는 정수여야 합니다: ${process.argv[2]}`);

const sections = statSections(loadFinalRubrics(), loadDemoSections());
const concepts: SectionConcepts = Object.fromEntries(
  sections.map((s) => [s.section, s.concepts.map(({ concept_id, name }) => ({ id: concept_id, name }))]),
);

const db = openDatabase();
await seedDemoAccounts(new UserRepository(db));
const counts = seedDemoRecords(db, concepts, seed);
const label = sections.map((s) => (s.demo ? `${s.section}(시연 목록)` : s.section)).join(", ");
console.log(`시연 기록을 만들었습니다(seed ${seed}, 섹션 ${label}): 체크포인트 ${counts.attempts}회, 오개념 ${counts.misconceptions}개`);
