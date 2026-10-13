// 보충학습 에이전트 시나리오 평가(docs/supplementary-learning.md): 정해 둔 학습자 답으로 보충학습을 끝까지 돌려
// 결과(해결 여부)·확인 문제 수·도구 실행·설비 보여 주기·근거 있는 설명·확인 문제 유출을 실행 기록으로 판정한다.
// 실행: npm run eval:supplement [-- --dry-run] [--resume] [--records 파일.jsonl] [--only id]
//  - 기본은 실제 Gemini(설명·확인 문제·채점)다. 유료라 npm test에는 넣지 않는다. GEMINI_API_KEY 필요.
//  - --dry-run: 모델 대신 가짜(설명은 근거 조각 첫 문장, 확인 문제는 고정 문장, 채점은 시나리오의 dry_verdicts)로 돌린다.
//    비용 없이 평가 도구와 엔진 흐름(도구 순서, 상태, 해결 처리, 실행 기록)을 확인할 때 쓴다. 모델 품질은 재지 못한다.
//  - 시나리오마다 새 메모리 DB에서 서버와 같은 SupplementEngine을 쓴다. 결과는 --records(기본 llm/eval/results/supplement.jsonl)에 바로 기록하고,
//    --resume이면 같은 설정(모델·프롬프트·루브릭·시나리오)으로 끝난 시나리오를 건너뛴다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { EvaluateInput, Evaluation, Evaluator } from "../../backend/src/checkpoint/types.js";
import type { Verdict } from "../../backend/src/scoring.js";
import { openDatabase } from "../../backend/src/db/database.js";
import { LearningRepository } from "../../backend/src/learning/repository.js";
import { loadSceneCatalog } from "../../backend/src/learning/scene-catalog.js";
import { SupplementEngine, type SupplementView } from "../../backend/src/learning/supplement.js";
import { SupplementRepository } from "../../backend/src/learning/supplement-repository.js";
import { loadFinalRubrics, type Rubric, type RubricConcept } from "../../backend/src/rubrics.js";
import { GeminiEvaluator } from "../src/evaluator.js";
import { DEFAULT_GEMINI_MODEL } from "../src/gemini.js";
import { GeminiLearningAgent, type LearningAgent, type LearningInput } from "../src/learning-agent.js";
import { findLeaks, hasLeak } from "../src/question-check.js";
import { Retriever } from "../src/retrieval.js";
import { GeminiTutor, type PracticeQuestion } from "../src/tutor.js";
import { fingerprint, flag, InfraStreak, isInfraError, MAX_CONSECUTIVE_INFRA, openRecordFile, option, RESULTS_DIR, RetryingGeminiClient, sleep, type RunRecord } from "./run-log.js";

export const SUPPLEMENT_SET_PATH = join(process.cwd(), "llm", "eval", "supplement", "ironmaking.jsonl");
const VERDICTS = ["correct", "partial", "wrong", "assisted"] as const;

export const Scenario = z.object({
  id: z.string().min(1),
  concept_id: z.string().min(1),
  /** 시작 전에 넣어 둘 학습 메모 오개념(요약). null이면 메모 없음. */
  memo: z.string().min(1).nullable(),
  /** true면 체크포인트 재도전 개념으로 넣는다(메모 없이 후보가 되는 경우). */
  retry: z.boolean().optional(),
  /** 확인 문제에 차례로 낼 학습자 답(1~2개). */
  answers: z.array(z.string().min(1)).min(1).max(2),
  expect: z.object({ outcome: z.enum(["resolved", "not_resolved"]), quizzes: z.union([z.literal(1), z.literal(2)]) }),
  /** --dry-run에서 가짜 평가자가 낼 판정. 없으면 기대 결과에서 만든다. */
  dry_verdicts: z.array(z.enum(VERDICTS)).max(2).optional(),
  note: z.string().optional(),
});
export type Scenario = z.infer<typeof Scenario>;

export function loadScenarios(path = SUPPLEMENT_SET_PATH): Scenario[] {
  const rows = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((line, i) => {
    const parsed = Scenario.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${path}:${i + 1} 형식 오류: ${parsed.error.issues[0]?.message}`);
    return parsed.data;
  });
  const ids = new Set<string>();
  for (const s of rows) {
    if (ids.has(s.id)) throw new Error(`${path}: 시나리오 id가 겹칩니다: ${s.id}`);
    ids.add(s.id);
    if (s.answers.length < s.expect.quizzes) throw new Error(`${path}: ${s.id} 답이 확인 문제 수보다 적습니다.`);
    if (!s.memo && !s.retry) throw new Error(`${path}: ${s.id} memo나 retry가 있어야 후보가 됩니다.`);
  }
  return rows;
}

/** --dry-run 판정: dry_verdicts, 없으면 기대에서(1문제 해결 → correct, 2문제 해결 → wrong·correct, 미해결 → wrong·wrong). */
export function dryVerdicts(s: Scenario): Verdict[] {
  if (s.dry_verdicts?.length) return s.dry_verdicts;
  if (s.expect.quizzes === 1) return [s.expect.outcome === "resolved" ? "correct" : "wrong"];
  return ["wrong", s.expect.outcome === "resolved" ? "correct" : "wrong"];
}

export interface ScenarioResult extends RunRecord {
  id: string;
  concept_id: string;
  outcome: string | null;
  quizzes: number;
  verdicts: string[];
  checks: {
    outcome: boolean;
    quizzes: boolean;
    /** 거절·실패한 도구 호출이 없음. */
    tools: boolean;
    /** 시작 때 루브릭의 관련 설비를 화면에 보여 줌(관련 설비가 없으면 통과). */
    scene: boolean;
    /** 설명에 근거 출처가 붙음(근거를 못 찾아 핵심 정리로 대신했으면 실패로 센다). */
    grounded: boolean;
    /** 확인 문제가 질문 은행 문장이 아님. */
    not_bank: boolean;
    /** 시작 전 학습 메모 오개념이 결과와 맞게 남았는지(해결이면 해결됨, 아니면 그대로). 메모가 없으면 통과. */
    memo: boolean;
  };
  /** 확인 문제별: 고정 문장을 썼는지, 실제로 낸 문장에 유출이 있는지. */
  quiz_details: { text: string; used_fallback: boolean; leaked: string[] }[];
  /** 단계별 걸린 시간(ms): 시작, 답1, 답2. */
  ms: number[];
  messages: { type: string; text: string }[];
  error?: string;
}

/** 실행 기록(steps)과 화면 보기로 시나리오 하나를 판정한다. */
export function judge(s: Scenario, rubric: Rubric, concept: RubricConcept, start: SupplementView, views: SupplementView[], steps: { kind: string; name: string; ok: boolean | null; payload: unknown }[]) {
  const last = views.at(-1) ?? start;
  const tools = steps.filter((x) => x.kind === "tool");
  const quizzes = tools.filter((x) => x.name === "create_quiz" && x.ok);
  const quizDetails = quizzes.map((q) => {
    const r = (q.payload as { result: { question: string; used_fallback: boolean } }).result;
    const leaks = findLeaks(r.question, rubric, concept);
    return { text: r.question, used_fallback: r.used_fallback, leaked: hasLeak(leaks) ? [...leaks.terms, ...leaks.phrases] : [] };
  });
  const bank = new Set([...(concept.questions ?? []), ...(concept.recheck_questions ?? []), ...(concept.fallback_question ? [concept.fallback_question] : [])]);
  const firstEquipment = concept.equipment_ids?.[0];
  const explanation = start.messages.find((m) => m.type === "explanation");
  return {
    outcome: last.outcome,
    quizzes: quizzes.length,
    verdicts: tools.filter((x) => x.name === "evaluate_answer" && x.ok).map((x) => (x.payload as { result: { evaluation: Evaluation } }).result.evaluation.verdict),
    checks: {
      outcome: last.outcome === s.expect.outcome,
      quizzes: quizzes.length === s.expect.quizzes,
      tools: tools.every((x) => x.ok),
      scene: !firstEquipment || start.scene_actions.some((a) => a.type === "focus" && a.target_id === firstEquipment),
      grounded: !!explanation?.sources?.length,
      not_bank: quizDetails.every((q) => !bank.has(q.text)),
      memo: true,
    },
    quiz_details: quizDetails,
    messages: [...start.messages, ...views.flatMap((v) => v.messages)].map((m) => ({ type: m.type, text: m.text })),
  };
}

/** 모델 대신 쓰는 가짜(--dry-run). */
function dryParts(s: Scenario) {
  const verdicts = [...dryVerdicts(s)];
  const agent: LearningAgent = {
    reply: async (input: LearningInput) => ({
      answer: input.chunks[0]?.text ?? "설명", status: input.chunks.length ? "grounded" : "unverified",
      source_ids: input.chunks.slice(0, 1).map((c) => c.id), follow_up: null, detected_misconception: null, scene_actions: [], keyword_card: null,
    }),
  };
  const tutor = {
    practiceQuestion: async ({ previousQuestion }: { previousQuestion?: string | null }): Promise<PracticeQuestion> => {
      const text = previousQuestion ? "(가짜) 다른 각도의 확인 문제" : "(가짜) 확인 문제";
      return { text, usedFallback: false, attempts: [{ text, leaked: [] }] };
    },
    explanation: async () => "(가짜) 놓친 부분부터 다시 설명",
  };
  const evaluator: Evaluator = {
    evaluate: async (input: EvaluateInput) => {
      const verdict = verdicts.shift() ?? "wrong";
      const v = input.phase === "recheck" && verdict === "assisted" ? "wrong" : verdict;
      return { verdict: v, misconception: v === "correct" ? null : "(가짜) 오개념", explain_from: v === "correct" ? null : 0, evidence: "dry-run" };
    },
  };
  return { agent, tutor, evaluator };
}

export async function runScenario(s: Scenario, deps: { rubrics: Rubric[]; scene: Awaited<ReturnType<typeof loadSceneCatalog>>; dry: boolean; client?: RetryingGeminiClient }) {
  const rubric = deps.rubrics.find((r) => r.concepts.some((c) => c.concept_id === s.concept_id));
  if (!rubric) throw new Error(`${s.id}: 루브릭에 없는 개념 ${s.concept_id}`);
  const concept = rubric.concepts.find((c) => c.concept_id === s.concept_id)!;
  const db = openDatabase(":memory:");
  const learningRepo = new LearningRepository(db);
  const repo = new SupplementRepository(db);
  const user = "eval-supplement";
  if (s.memo) learningRepo.recordMisconception({ user_id: user, section: rubric.section, concept_id: s.concept_id, answer_text: "(시나리오)", summary: s.memo }, new Date().toISOString());
  const parts = deps.dry ? dryParts(s) : { agent: new GeminiLearningAgent(deps.client!), tutor: new GeminiTutor(deps.client!), evaluator: new GeminiEvaluator(deps.client!) };
  const engine = new SupplementEngine({
    repo, learningRepo, rubrics: deps.rubrics, scene: deps.scene, ...parts,
    retriever: new Retriever({ glossaryFor: (sec) => deps.rubrics.find((r) => r.section === sec)?.glossary ?? [] }),
    checkpointProgress: () => ({ retry_concept_ids: s.retry ? [s.concept_id] : [], in_progress: false, answering: false }),
  });
  const ms: number[] = [];
  const timed = async <T>(fn: () => Promise<T>) => { const t = Date.now(); try { return await fn(); } finally { ms.push(Date.now() - t); } };
  const start = await timed(() => engine.start(user, rubric.section, s.concept_id, null));
  const views: SupplementView[] = [];
  let current = start;
  for (const answer of s.answers) {
    if (current.state !== "awaiting_answer" && current.state !== "awaiting_recheck") break;
    current = await timed(() => engine.answer(user, current.id, answer));
    views.push(current);
  }
  const judged = judge(s, rubric, concept, start, views, repo.steps(start.id));
  // 학습 메모: 해결이면 미해결 메모가 없어야 하고, 아니면 남아 있어야 한다(채점에서 나온 오개념으로 갱신될 수는 있다).
  const memoOpen = learningRepo.openMisconceptions(user, rubric.section).some((m) => m.concept_id === s.concept_id && m.source === "learning");
  const memo = !s.memo || memoOpen === (judged.outcome !== "resolved");
  return { ...judged, checks: { ...judged.checks, memo }, ms };
}

const pct = (n: number, d: number) => (d ? `${n}/${d} (${((n / d) * 100).toFixed(0)}%)` : "-");

async function main(): Promise<void> {
  const dry = flag("dry-run");
  const only = option("only", "");
  const scenarios = loadScenarios().filter((s) => !only || s.id === only);
  const rubrics = loadFinalRubrics();
  const scene = await loadSceneCatalog();
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const prompts = ["learning-system", "tutor-question", "tutor-recheck", "tutor-explanation", "tutor-correction", "evaluator"]
    .map((p) => readFileSync(join(process.cwd(), "llm", "prompts", `${p}.md`), "utf8"));
  const records = openRecordFile<ScenarioResult>(option("records", join(RESULTS_DIR, dry ? "supplement-dry.jsonl" : "supplement.jsonl")), flag("resume"));
  const client = dry ? undefined : new RetryingGeminiClient();
  const streak = new InfraStreak();
  const delay = Number(process.env.EVAL_DELAY_MS ?? 1000);
  console.log(`보충학습 시나리오 ${scenarios.length}개 · ${dry ? "가짜 모델(--dry-run, 비용 없음)" : `실제 모델 ${model}`}`);

  for (const s of scenarios) {
    const fp = fingerprint(dry ? "dry" : model, ...prompts, JSON.stringify(rubrics), JSON.stringify(s));
    if (records.done(s.id, fp)) continue;
    process.stdout.write(`- ${s.id} … `);
    try {
      const r = await runScenario(s, { rubrics, scene, dry, client });
      const record: ScenarioResult = { key: s.id, fingerprint: fp, infra_error: false, id: s.id, concept_id: s.concept_id, ...r };
      records.append(record);
      const failed = Object.entries(record.checks).filter(([, ok]) => !ok).map(([k]) => k);
      console.log(`${failed.length ? `실패(${failed.join(", ")})` : "통과"} · 판정 ${record.verdicts.join("→")} · ${record.ms.map((x) => (x / 1000).toFixed(1)).join("/")}초`);
      streak.push(false);
    } catch (error) {
      const infra = isInfraError(error);
      records.append({ key: s.id, fingerprint: fp, infra_error: infra, id: s.id, concept_id: s.concept_id, outcome: null, quizzes: 0, verdicts: [],
        checks: { outcome: false, quizzes: false, tools: false, scene: false, grounded: false, not_bank: false, memo: false }, quiz_details: [], ms: [], messages: [], error: (error as Error).message });
      console.log(`${infra ? "연결 오류" : "오류"}: ${(error as Error).message}`);
      if (streak.push(infra)) {
        console.log(`연결 오류가 ${MAX_CONSECUTIVE_INFRA}번 이어져 멈춥니다. --resume으로 이어서 하세요.`);
        break;
      }
    }
    if (!dry) await sleep(delay);
  }

  // 보고서: 파일의 기록 전체(이번 설정이 아닌 기록은 뺀다)로 만든다.
  const rows = scenarios.map((s) => records.latest.get(s.id)).filter((r): r is ScenarioResult => !!r && !r.infra_error && !r.error);
  const infra = scenarios.filter((s) => records.latest.get(s.id)?.infra_error).length;
  const count = (k: keyof ScenarioResult["checks"]) => rows.filter((r) => r.checks[k]).length;
  const quizzes = rows.flatMap((r) => r.quiz_details);
  console.log(`\n결과(연결 오류 ${infra}개 제외 ${rows.length}개)`);
  for (const k of ["outcome", "quizzes", "tools", "scene", "grounded", "not_bank", "memo"] as const) console.log(`  ${k}: ${pct(count(k), rows.length)}`);
  console.log(`  확인 문제 ${quizzes.length}개: 고정 문장 ${pct(quizzes.filter((q) => q.used_fallback).length, quizzes.length)} · 낸 문장 유출 ${pct(quizzes.filter((q) => q.leaked.length).length, quizzes.length)}`);
  const all = rows.flatMap((r) => r.ms);
  if (all.length) console.log(`  걸린 시간: 단계 평균 ${(all.reduce((a, b) => a + b, 0) / all.length / 1000).toFixed(1)}초 · 최대 ${(Math.max(...all) / 1000).toFixed(1)}초`);
  if (rows.some((r) => !r.checks.outcome)) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("run-supplement.js")) await main();
