import { GeminiAdminSummarizer } from "../../llm/src/admin-summary.js";
import { GeminiEvaluator } from "../../llm/src/evaluator.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { GeminiLearningAgent } from "../../llm/src/learning-agent.js";
import { Retriever } from "../../llm/src/retrieval.js";
import { GeminiTutor } from "../../llm/src/tutor.js";
import { createAdminRouter } from "./admin/routes.js";
import { createApp } from "./app.js";
import { seedDemoAccounts } from "./auth/demo-accounts.js";
import { createAuthRouter } from "./auth/routes.js";
import { jwtSecret } from "./auth/tokens.js";
import { UserRepository } from "./auth/users.js";
import { createMeRouter } from "./me/routes.js";
import { CheckpointEngine } from "./checkpoint/engine.js";
import { CheckpointRepository } from "./checkpoint/repository.js";
import { openDatabase } from "./db/database.js";
import { buildLearnerNotes, useLearnerNotesSource } from "./learning/notes.js";
import { LearningRepository } from "./learning/repository.js";
import { createLearningRouter } from "./learning/routes.js";
import { loadSceneCatalog } from "./learning/scene-catalog.js";
import { loadScreenSteps } from "./learning/screen-material.js";
import { currentUserId } from "./request-user.js";
import { loadFinalRubrics } from "./rubrics.js";
import { passcodeRequired } from "./test-access.js";
import { LlmUsage } from "./usage.js";

// 루브릭 형식이 틀리면 여기서 예외가 나 서버가 시작되지 않는다.
const rubrics = loadFinalRubrics();

const db = openDatabase();
const usage = new LlmUsage(db);
// 체크포인트의 평가자·튜터 호출마다 현재 사용자의 하루 호출 수를 센다.
const gemini = new GeminiClient({ beforeCall: () => usage.consume(currentUserId()) });
const engine = new CheckpointEngine({
  repo: new CheckpointRepository(db),
  evaluator: new GeminiEvaluator(gemini),
  tutor: new GeminiTutor(gemini),
  rubrics,
  // 부가 설명 때 튜터에게만 넘긴다(평가자에게는 넘기지 않음).
  learnerNotes: buildLearnerNotes,
});

const users = new UserRepository(db);
const seeded = await seedDemoAccounts(users);
if (seeded > 0) console.log(`시연 계정 ${seeded}개를 만들었습니다.`);

// 학습 모드: 같은 GeminiClient를 써서 하루 호출 한도를 체크포인트와 함께 센다.
const learningRepo = new LearningRepository(db);
// 체크포인트에 넘길 학습자 메모(buildLearnerNotes)도 같은 기록을 읽는다. 지금 final 루브릭에 없는 개념의 오개념은 뺀다.
const currentConcepts = new Map(rubrics.map((r) => [r.section, new Set(r.concepts.map((c) => c.concept_id))]));
useLearnerNotesSource({
  openMisconceptions: (userId, section) => learningRepo.openMisconceptions(userId, section).filter((m) => currentConcepts.get(section)?.has(m.concept_id)),
});
const learning = createLearningRouter({
  repo: learningRepo,
  retriever: new Retriever({ glossaryFor: (s) => rubrics.find((r) => r.section === s)?.glossary ?? [] }),
  agent: new GeminiLearningAgent(gemini),
  rubrics,
  // 튜터의 3D 화면 조작(scene_actions)에 쓸 공정·설비 목록. data_v2.js 형식이 틀리면 서버가 시작되지 않는다.
  scene: await loadSceneCatalog(),
  // 학습 화면의 설비 작동 단계 설명(3D·2D). 근거로 답하지 못할 때 화면 위치를 안내하는 데에만 쓴다. 못 읽으면 경고만 남긴다.
  screenSteps: await loadScreenSteps(),
  // 체크포인트에서 아직 만점이 아닌 개념(튜터에 넘김)과 진행 중 여부(진행 중이면 키워드 카드를 붙이지 않음). 이해도 계산은 엔진(summarizeSection)이 한다.
  checkpointProgress: (userId, section) => {
    if (!rubrics.some((r) => r.section === section)) return null;
    const p = engine.sectionProgress(userId, section);
    return { retry_concept_ids: p.retry_concept_ids, in_progress: p.in_progress_attempt_id !== null };
  },
});

const app = createApp({ engine, usage, learning });
// 로그인·관리자 API(docs/auth-api.md). createApp의 /api 접속 비밀번호 검사가 먼저 적용된다.
const auth = { users, secret: jwtSecret() };
app.use(createAuthRouter(auth));
// 관리자 AI 요약도 같은 GeminiClient로 관리자 계정의 하루 호출 수를 센다.
app.use(createAdminRouter(db, auth, { summarizer: new GeminiAdminSummarizer(gemini) }));
app.use(createMeRouter(db, auth));

const port = Number(process.env.PORT ?? 3000);
// 이 컴퓨터에서만 접속을 받는다. 원격 공유는 cloudflared 터널(npm run tunnel)이 localhost로 넘겨준다.
app.listen(port, "127.0.0.1", () => {
  console.log(`제선 공정 알아보기: http://localhost:${port}`);
  console.log(`접속 비밀번호: ${passcodeRequired() ? "사용(TEST_PASSCODE)" : "사용 안 함"} · 사용자별 하루 LLM 호출 한도: ${usage.dailyLimit > 0 ? `${usage.dailyLimit}회` : "제한 없음"}`);
});
