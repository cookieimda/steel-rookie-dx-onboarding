import { GeminiAdminSummarizer } from "../../llm/src/admin-summary.js";
import { evaluatorGuardOptions, GeminiEvaluator } from "../../llm/src/evaluator.js";
import { GeminiLearningAgent } from "../../llm/src/learning-agent.js";
import { useApprovedSources } from "../../llm/src/ironmaking-sources.js";
import { createLlmClient, profileFor, providerInfo } from "../../llm/src/provider.js";
import { loadSectionChunks, Retriever } from "../../llm/src/retrieval.js";
import { traceMiddleware, traceSinkFromEnv } from "../../llm/src/trace.js";
import { GeminiTutor } from "../../llm/src/tutor.js";
import { createAdminRouter } from "./admin/routes.js";
import { createApp } from "./app.js";
import { seedDemoAccounts } from "./auth/demo-accounts.js";
import { createAuthRouter } from "./auth/routes.js";
import { jwtSecret } from "./auth/tokens.js";
import { UserRepository } from "./auth/users.js";
import { createMeRouter } from "./me/routes.js";
import { createTopicResolver } from "./me/concept-topic.js";
import { defaultDemoSections } from "./admin/trainee-stats.js";
import { loadDeck } from "./lab/deck.js";
import { createLabRouter } from "./lab/routes.js";
import { createLabExtrasRouter } from "./lab/extras-routes.js";
import { loadIncidents } from "./lab/incidents.js";
import { loadFaults } from "./lab/faults.js";
import { loadLessons } from "./lab/lessons.js";
import { MeRepository } from "./me/repository.js";
import { Notifier } from "./notify/service.js";
import { createNotifyRouter } from "./notify/routes.js";
import { createOpsRouter, registerOpsJobs } from "./ops/routes.js";
import { createHighlightRouter } from "./education/highlights.js";
import { createJobRouter } from "./education/job-routes.js";
import { MaterialWorkflow } from "./education/workflow.js";
import { createWorkflowRouter } from "./education/workflow-routes.js";
import { CheckpointEngine } from "./checkpoint/engine.js";
import { CheckpointRepository } from "./checkpoint/repository.js";
import type { Section } from "./checkpoint/types.js";
import { openDatabase } from "./db/database.js";
import { buildLearnerNotes, useLearnerNotesSource } from "./learning/notes.js";
import { LearningRepository } from "./learning/repository.js";
import { createLearningRouter } from "./learning/routes.js";
import { loadSceneCatalog } from "./learning/scene-catalog.js";
import { loadScreenSteps } from "./learning/screen-material.js";
import { AnswerCache, answerCacheVersion } from "./learning/answer-cache.js";
import { loadSuggestedQuestions, warmItems } from "./learning/suggested.js";
import { createSupplementRouter, SupplementEngine } from "./learning/supplement.js";
import { SupplementRepository } from "./learning/supplement-repository.js";
import { EducationJobs, jobAwareClient, jobUserId, phaseEvaluator, phaseTutor } from "./education/jobs.js";
import { EducationRepository } from "./education/repository.js";
import { createEducationRouter } from "./education/routes.js";
import { currentUserId } from "./request-user.js";
import { loadFinalRubrics } from "./rubrics.js";
import { passcodeRequired } from "./test-access.js";
import { LlmUsage } from "./usage.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 루브릭 형식이 틀리면 여기서 예외가 나 서버가 시작되지 않는다.
const rubrics = loadFinalRubrics();

const db = openDatabase();
const usage = new LlmUsage(db);
// 요청 trace(docs/agent-observability.md): 학습·체크포인트·보충학습·시험 작업을 data/traces/{종류}-날짜.jsonl에 남긴다. 끄려면 TRACE_LOG=off.
const traceSink = traceSinkFromEnv();
// 평가 시험(docs/exam-page.md): 시험 작업 대기열·취소, 루브릭 이력·복습 일정·교육 그룹·자료 검수.
const jobs = new EducationJobs(db, traceSink);
const education = new EducationRepository(db, rubrics);
useApprovedSources(() => education.approvedSources());
// LLM provider(LLM_PROVIDER=gemini 기본|ollama, docs/llm-providers.md). 모든 에이전트가 같은 클라이언트를 쓰고, provider별 설정은 profileFor가 정한다.
const llmInfo = providerInfo();
const profile = profileFor(llmInfo.provider);
// 체크포인트·학습·관리자 호출마다 사용자의 하루 호출 수를 센다. 시험 작업 안에서는 요청을 보낸 사람이 아니라 작업 주인(jobUserId)으로 세고,
// 작업을 취소하면 진행 중인 추론도 끊는다(jobAwareClient).
const llm = jobAwareClient(createLlmClient({ beforeCall: () => usage.consume(jobUserId() ?? currentUserId()) }));
// 평가자·튜터는 체크포인트·시험·보충학습이 함께 쓴다. 시험 작업에서는 단계(문제·채점·설명)를 작업 상태에 적는다(phase*).
// 로컬 모델은 판정 필드 형식·wrong·partial 경계를 자주 틀리고 누락을 오개념으로 적어서 보강을 켠다(llm/src/evaluator.ts evaluatorGuardOptions).
const evaluator = new GeminiEvaluator(llm, evaluatorGuardOptions(profile.evaluatorGuards));
const tutor = new GeminiTutor(llm);
const engine = new CheckpointEngine({
  repo: new CheckpointRepository(db),
  evaluator: phaseEvaluator(evaluator),
  tutor: phaseTutor(tutor),
  rubrics,
  // 부가 설명 때 튜터에게만 넘긴다(평가자에게는 넘기지 않음).
  learnerNotes: buildLearnerNotes,
});

const users = new UserRepository(db);
const seeded = await seedDemoAccounts(users);
if (seeded > 0) console.log(`시연 계정 ${seeded}개를 만들었습니다.`);

// 학습 모드: 같은 LLM 클라이언트를 써서 하루 호출 한도를 체크포인트와 함께 센다.
const learningRepo = new LearningRepository(db);
// 체크포인트에 넘길 학습자 메모(buildLearnerNotes)도 같은 기록을 읽는다. 지금 final 루브릭에 없는 개념의 오개념은 뺀다.
const currentConcepts = new Map(rubrics.map((r) => [r.section, new Set(r.concepts.map((c) => c.concept_id))]));
useLearnerNotesSource({
  openMisconceptions: (userId, section) => learningRepo.openMisconceptions(userId, section).filter((m) => currentConcepts.get(section)?.has(m.concept_id)),
});
// 학습 답 저장(answer-cache.ts): provider·모델·학습 프롬프트·공개 자료가 바뀌면 버전이 바뀌어 다시 받는다(Gemini 답과 로컬 모델 답을 섞지 않는다).
const readText = (path: string) => { try { return readFileSync(join(process.cwd(), path), "utf8"); } catch { return ""; } };
const learningPrompt = profile.learning === "compact" ? "llm/prompts/learning-compact.md" : "llm/prompts/learning-system.md";
const answerCache = new AnswerCache(
  answerCacheVersion(llmInfo.label, [learningPrompt, "backend/data/ironmaking-sources.json", "content/materials/ironmaking/section.md"].map(readText)),
  process.env.ANSWER_CACHE_PATH || join(process.cwd(), "data", "answer-cache.json"),
);
const sceneCatalog = await loadSceneCatalog();
const suggestedQuestions = await loadSuggestedQuestions();
// 근거: 개념별 자료·공개 자료 메모(loadSectionChunks)에 관리자가 승인한 교육 자료(education.approvedChunks)를 더한다.
const retriever = new Retriever({
  glossaryFor: (s) => rubrics.find((r) => r.section === s)?.glossary ?? [],
  chunksFor: (s) => [...loadSectionChunks(s), ...education.approvedChunks(s)],
});
const learningAgent = new GeminiLearningAgent(llm, undefined, profile.learning);
// 체크포인트에서 아직 만점이 아닌 개념(튜터에 넘김)과 진행 중 여부. 학습 채팅과 보충학습이 함께 쓴다. 이해도 계산은 엔진(summarizeSection)이 한다.
const checkpointProgress = (userId: string, section: Section) => {
  if (!rubrics.some((r) => r.section === section)) return null;
  const p = engine.sectionProgress(userId, section);
  // answering: 답하는 중(멈춘 시도 제외). 보충학습은 이때만 막는다.
  return { retry_concept_ids: p.retry_concept_ids, in_progress: p.in_progress_attempt_id !== null, answering: !!p.in_progress && p.in_progress.state !== "paused" };
};
const learning = createLearningRouter({
  repo: learningRepo,
  retriever,
  agent: learningAgent,
  rubrics,
  // 튜터의 3D 화면 조작(scene_actions)에 쓸 공정·설비 목록. data_v2.js 형식이 틀리면 서버가 시작되지 않는다.
  scene: sceneCatalog,
  // 학습 화면의 설비 작동 단계 설명(3D·2D). 근거로 답하지 못할 때 화면 위치를 안내하는 데에만 쓴다. 못 읽으면 경고만 남긴다.
  screenSteps: await loadScreenSteps(),
  // 진행 중이면 키워드 카드를 붙이지 않는다.
  checkpointProgress,
  cache: answerCache,
  suggestedQuestions,
  // 질문마다 단계별 기록을 data/traces/learning-날짜.jsonl에 남긴다.
  traceSink,
  // 로컬 모델은 근거와 겹치는 문장이 없는 답을 unverified로 낮추고 안내를 붙인다(grounding.ts lowSupport).
  groundingCheck: profile.groundingCheck,
});

const app = createApp({ engine, usage, learning, traceSink });
// 로그인·관리자 API(docs/auth-api.md). createApp의 /api 접속 비밀번호 검사가 먼저 적용된다.
const auth = { users, secret: jwtSecret() };
app.use(createAuthRouter(auth));
// 관리자 AI 요약도 같은 LLM 클라이언트로 관리자 계정의 하루 호출 수를 센다.
app.use(createAdminRouter(db, auth, { summarizer: new GeminiAdminSummarizer(llm) }));
// 오개념·복습 표시 경로(공정 › 소단원 › 개념)에 설비 이름을 쓴다(me/concept-topic.ts).
app.use(createMeRouter(db, auth, { scene: sceneCatalog }));
// 학습 랩(학습 기록 화면의 '학습 랩' 탭): 간격 반복·주간 리그·xAPI 기록·세션 리플레이.
const deck = await loadDeck();
app.use(createLabRouter({ db, auth, deck }));
// 운영 기능(012): 알림 · 자료 검수 워크플로 · 작업 대기열 일반화 · 오답 패턴 · 채점 근거 하이라이트 · 사고 사례 · What-if · 설비 주석 공유
const meRepo = new MeRepository(db);
const notifier = new Notifier({ db, cardEvents: (id) => meRepo.cardEvents(id),
  passed: (userId, section) => { try { return engine.sectionProgress(userId, section as Section).unlocked; } catch { return false; } } });
const workflow = new MaterialWorkflow(db);
registerOpsJobs(jobs, { db, notifier, workflow });
// 시험이 아닌 작업이 끝나면 넣은 사람에게 알린다
jobs.onSettled = (job) => { notifier.notify(job.user_id, "job_done", `${job.state === "succeeded" ? "작업 완료" : "작업 실패"} · ${String(job.metadata.label ?? job.kind)}`,
  job.state === "succeeded" ? "결과를 확인해 주세요." : job.error?.message ?? "처리하지 못했어요.", "/login_ui/admin-ops.html#jobs", `job_done:${job.id}`); };
app.use(createJobRouter(auth, jobs));
app.use(createWorkflowRouter({ auth, jobs, notifier }, workflow));
app.use(createNotifyRouter(auth, notifier));
app.use(createOpsRouter(auth, db));
app.use(createHighlightRouter(auth, db, rubrics));
const knownEquipment = new Set(deck.map((c) => c.equipment_id));
// 사고 사례·이상 상황 훈련 콘텐츠는 형식·설비 id가 틀리면 서버가 시작하지 않는다
{
  // 수업 모드는 이상 상황·사고 사례를 가리키므로 같은 내용으로 참조를 검사한다(틀리면 서버가 시작하지 않는다)
  const incidents = loadIncidents(undefined, knownEquipment), faults = loadFaults(undefined, knownEquipment);
  app.use(createLabExtrasRouter({ db, auth, deck, notifier, incidents, faults, lessons: loadLessons(undefined, { faults: faults.faults, scenarios: incidents.scenarios }) }));
}
// 정기 알림: NOTIFY_INTERVAL_MIN분마다(기본 15, 0이면 끔) 전체 학습자의 알림을 만들고 켠 채널로 발송한다
const notifyEvery = Number(process.env.NOTIFY_INTERVAL_MIN ?? 15);
if (notifyEvery > 0) setInterval(() => { try { notifier.generateAll(); void notifier.deliverPending(); } catch (e) { console.warn("정기 알림 실패", e); } }, notifyEvery * 60_000).unref();
// 평가 시험 API(/api/exams, /api/exam-jobs, /api/me/reviews·assignments·exam-history, /api/admin/education). 승인 자료가 바뀌면 검색·저장한 답을 다시 만든다.
app.use(createEducationRouter({ auth, engine, jobs, repo: education,
  onMaterialsChanged: (section) => { retriever.invalidate(section); answerCache.clear(); },
  // 복습 항목에 공정 › 소단원 › 개념과 다시 볼 핵심을 붙인다(me/concept-topic.ts).
  topicOf: createTopicResolver({ rubrics, demo: defaultDemoSections(), scene: sceneCatalog }),
}));
// 보충학습(docs/supplementary-learning.md): 오개념이 있는 개념을 설명 → 확인 문제 → 채점 → 해결/다시 설명. 요청마다 trace(kind supplement).
app.use("/api/learning/supplements", traceMiddleware("supplement", traceSink));
app.use(createSupplementRouter(new SupplementEngine({
  repo: new SupplementRepository(db), learningRepo, retriever, agent: learningAgent, tutor, evaluator, rubrics, scene: sceneCatalog, checkpointProgress,
})));

const port = Number(process.env.PORT ?? 3000);
// 이 컴퓨터에서만 접속을 받는다. 원격 공유는 cloudflared 터널(npm run tunnel)이 localhost로 넘겨준다.
app.listen(port, "127.0.0.1", () => {
  console.log(`제선 공정 알아보기: http://localhost:${port}`);
  console.log(`접속 비밀번호: ${passcodeRequired() ? "사용(TEST_PASSCODE)" : "사용 안 함"} · 사용자별 하루 LLM 호출 한도: ${usage.dailyLimit > 0 ? `${usage.dailyLimit}회` : "제한 없음"}`);
  console.log(`LLM: ${llmInfo.label} · 학습 프롬프트 ${profile.learning} · 채점 보강 ${profile.evaluatorGuards ? "켬" : "끔"} · 근거 겹침 검사 ${profile.groundingCheck ? "켬" : "끔"}`);
  // 추천 질문 답을 뒤에서 미리 받아 둔다(저장한 답이 있으면 건너뜀). 끄려면 WARM_ANSWERS=off.
  // 로컬 모델은 CPU에서 질문 하나에 수십 초라 미리 받기가 학습자 질문과 CPU를 다툰다. 그래서 기본으로 끄고 WARM_ANSWERS=on일 때만 받는다.
  const warm = process.env.WARM_ANSWERS?.trim().toLowerCase();
  if (warm === "off" || (llmInfo.provider === "ollama" && warm !== "on")) return;
  const items = warmItems(suggestedQuestions, sceneCatalog);
  console.log(`추천 질문 답 미리 받기: ${items.length}개(저장된 답 ${answerCache.size}개)`);
  const started = Date.now();
  void learning.warmAnswers(items).then(({ saved, cached, failed }) =>
    console.log(`추천 질문 답 미리 받기 끝: 새로 ${saved} · 이미 있음 ${cached} · 실패 ${failed} (${Math.round((Date.now() - started) / 1000)}초)`));
});
