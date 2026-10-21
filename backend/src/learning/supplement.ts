// 보충학습 에이전트(docs/supplementary-learning.md): 오개념이 있는 개념을 설명 → 확인 문제 → 채점 → 해결 또는 다른 각도로 한 번 더.
// - 도구(agent-tools.ts)를 서버가 정한 순서로 부른다: 학습 상태 → 근거 검색 → 설비 보여 주기 → (설명·확인 문제) → 채점.
//   모델은 설명(학습 튜터)·확인 문제(튜터)·채점(평가자)만 한다. 단계마다 모델에게 다음 도구를 묻지 않는다(호출 수·시간을 줄이려고).
// - 점수와 상관없다. 확인 문제를 맞히면 그 개념의 학습 모드 오개념 메모(source = learning)만 해결한다.
//   체크포인트 오개념은 체크포인트에서 맞혀야 해결된다(CLAUDE.md '오개념 기록').
// - 단계 수는 정해져 있다: 확인 문제 최대 2번(처음, 다시 설명한 뒤 1번). 체크포인트의 재확인 1회 규칙과 같다.
// - 이해도 확인에 답하는 중이면 시작·답하기를 막는다(409). 멈춘(paused) 동안은 쓸 수 있다. 2시간 넘게 멈춘 보충학습은 끝낸다.
// - 실행 기록(도구 호출·주고받은 말·화면 조작 결과)은 learning_supplement_steps에 남긴다.
import express from "express";
import { z } from "zod";
import { getPublicSources } from "../../../llm/src/ironmaking-sources.js";
import { LearningFormatError, normalizeSceneActions, type LearningAgent, type SceneAction, type SceneCatalog } from "../../../llm/src/learning-agent.js";
import { toPolite, withObject } from "../../../llm/src/polite.js";
import type { LearningToolName } from "../../../llm/src/learning-tools.js";
import type { Retriever } from "../../../llm/src/retrieval.js";
import { LlmUnavailableError, SECTION_ORDER, type Evaluator, type Section, type Tutor } from "../checkpoint/types.js";
import { currentUserId } from "../request-user.js";
import type { Rubric, RubricConcept } from "../rubrics.js";
import { UsageLimitError } from "../usage.js";
import { executeLearningTool, type LearningToolContext, type PracticeQuestioner } from "./agent-tools.js";
import { latestPerConcept, type LearningRepository } from "./repository.js";
import { SupplementRepository, type NewStep, type Supplement } from "./supplement-repository.js";

/** 이만큼 답이 없던 보충학습은 끝낸다(다음 요청 때). */
export const SUPPLEMENT_TTL_MS = 2 * 60 * 60 * 1000;

export const SUPPLEMENT_TEXT = {
  correct: "정답이에요!",
  recheckCorrect: "정답이에요! 이번에는 정확해요.",
  almost: "거의 맞았어요, 조금만 더 생각해 볼까요?",
  miss: "아쉬워요, 같이 다시 볼게요.",
  keyPoints: "아쉬워요. 핵심만 정리할게요.",
  fallbackExplanation: "공개 자료에서 이 개념을 설명할 문장을 찾지 못해서, 핵심만 먼저 정리할게요.",
} as const;

export interface SourceView {
  id: string;
  title: string;
  url: string;
}

export interface SupplementMessage {
  role: "tutor" | "user";
  type: "intro" | "explanation" | "question" | "reaction" | "key_points" | "closing" | "answer";
  text: string;
  /** reaction일 때 어떤 반응인지(화면이 포석호 표정·효과음을 고른다). */
  tone?: "correct" | "almost" | "miss";
  sources?: SourceView[];
}

/** 보충학습을 권할 개념. misconception: 미해결 오개념, retry: 체크포인트에서 아직 만점이 아님. */
export interface SupplementCandidate {
  concept_id: string;
  name: string;
  reason: "misconception" | "retry";
  summary: string | null;
}

export interface SupplementView {
  id: string;
  section: Section;
  concept_id: string;
  concept_name: string;
  state: Supplement["state"];
  outcome: Supplement["outcome"];
  /** 답을 기다리는 확인 문제. 끝났으면 null. */
  question: string | null;
  /** 이번 요청에서 새로 생긴 말(시작·답하기). 다시 불러오기(GET)면 지금까지의 말 전체. */
  messages: SupplementMessage[];
  /** 화면이 실행할 조작(설비 보여 주기). 실행 결과는 scene-results로 알려 준다. */
  scene_actions: SceneAction[];
}

/** 클라이언트가 고칠 수 있는 요청 오류. status가 HTTP 상태가 된다. */
export class SupplementError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string, readonly code: string) {
    super(message);
  }
}

export interface SupplementDeps {
  repo: SupplementRepository;
  learningRepo: LearningRepository;
  retriever: Retriever;
  agent: LearningAgent;
  tutor: PracticeQuestioner & Pick<Tutor, "explanation">;
  evaluator: Evaluator;
  rubrics: Rubric[];
  scene?: SceneCatalog;
  /**
   * 체크포인트에서 아직 만점이 아닌 개념과 진행 중 여부. 루브릭이 없는 공정이면 null.
   * answering: 답하는 중(멈춤 paused가 아닌 진행 중 시도). 없으면 in_progress로 본다.
   */
  checkpointProgress?: (userId: string, section: Section) => { retry_concept_ids: string[]; in_progress: boolean; answering?: boolean } | null;
  now?: () => string;
}

function toSources(sourceIds: string[]): SourceView[] {
  return getPublicSources([...new Set(sourceIds)]).map(({ id, title, url }) => ({ id, title, url }));
}

const keyPointsText = (concept: RubricConcept) => concept.key_points.map((k) => `- ${toPolite(k.point)}`).join("\n");

export class SupplementEngine {
  private readonly now: () => string;
  private readonly busy = new Set<string>();

  constructor(private readonly deps: SupplementDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  private rubricOf(section: Section): Rubric {
    const rubric = this.deps.rubrics.find((r) => r.section === section);
    if (!rubric) throw new SupplementError(404, "이 공정은 아직 보충학습을 준비하지 않았어요.", "NO_RUBRIC");
    return rubric;
  }

  private conceptOf(rubric: Rubric, conceptId: string): RubricConcept {
    const concept = rubric.concepts.find((c) => c.concept_id === conceptId);
    if (!concept) throw new SupplementError(404, "이 개념은 지금 보충학습 목록에 없어요.", "UNKNOWN_CONCEPT");
    return concept;
  }

  /** 이해도 확인에 답하는 중이면 막는다. '나중에 이어 풀기'로 멈춘 동안은 학습 채팅처럼 쓸 수 있다(CLAUDE.md '확정'). */
  private assertNoCheckpoint(userId: string, section: Section): void {
    const p = this.deps.checkpointProgress?.(userId, section);
    if (p && (p.answering ?? p.in_progress)) {
      throw new SupplementError(409, "이해도 확인을 푸는 중에는 보충학습을 할 수 없어요. 이해도 확인을 마치거나 멈춘 뒤 다시 시작해 주세요.", "CHECKPOINT_IN_PROGRESS");
    }
  }

  private context(userId: string, section: Section, rubric: Rubric): LearningToolContext {
    return {
      userId, section, rubric,
      openMisconceptions: () => this.deps.repo.openMisconceptions(userId, section), retriever: this.deps.retriever, scene: this.deps.scene,
      questioner: this.deps.tutor, evaluator: this.deps.evaluator,
      retryConceptIds: () => this.deps.checkpointProgress?.(userId, section)?.retry_concept_ids ?? [],
    };
  }

  /** 같은 사용자·대상에 요청이 겹치면 막는다(두 번 눌러 같은 채점을 두 번 하지 않게). */
  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) throw new SupplementError(409, "이전 요청을 처리하는 중이에요.", "BUSY");
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }

  /**
   * 보충학습을 권할 개념: 지금 루브릭 개념 중 미해결 오개념이 있거나(최근 것) 체크포인트에서 아직 만점이 아닌 것.
   * 보충학습으로 해결한 뒤 새 오개념이 생기지 않은 개념은 뺀다(체크포인트 오개념은 해결로 바뀌지 않아도 다시 권하지 않게).
   */
  candidates(userId: string, section: Section): SupplementCandidate[] {
    const rubric = this.deps.rubrics.find((r) => r.section === section);
    if (!rubric) return [];
    const resolvedAt = this.deps.repo.lastResolved(userId, section);
    const open = new Map(latestPerConcept(this.deps.repo.openMisconceptions(userId, section), Infinity).map((m) => [m.concept_id, m] as const));
    const retry = new Set(this.deps.checkpointProgress?.(userId, section)?.retry_concept_ids ?? []);
    const out: SupplementCandidate[] = [];
    for (const c of rubric.concepts) {
      const m = open.get(c.concept_id);
      const done = resolvedAt.get(c.concept_id);
      if (m && (!done || m.created_at > done)) out.push({ concept_id: c.concept_id, name: c.name, reason: "misconception", summary: m.summary });
      else if (!m && retry.has(c.concept_id) && !done) out.push({ concept_id: c.concept_id, name: c.name, reason: "retry", summary: null });
    }
    return out;
  }

  /** 답을 기다리는 보충학습을 지금까지의 말과 함께 돌려준다(새로고침 뒤 이어 하기). 없으면 null. */
  active(userId: string, section: Section): SupplementView | null {
    const s = this.deps.repo.active(userId, section);
    if (!s) return null;
    if (this.expired(s)) {
      this.deps.repo.update(s.id, { state: "stopped" }, [], this.now());
      return null;
    }
    const messages = this.deps.repo.steps(s.id).filter((st) => st.kind === "message").map((st) => st.payload as SupplementMessage);
    return this.view(s, messages, []);
  }

  private expired(s: Supplement): boolean {
    return Date.parse(this.now()) - Date.parse(s.updated_at) > SUPPLEMENT_TTL_MS;
  }

  private view(s: Supplement, messages: SupplementMessage[], sceneActions: SceneAction[]): SupplementView {
    const concept = this.deps.rubrics.find((r) => r.section === s.section)?.concepts.find((c) => c.concept_id === s.concept_id);
    return {
      id: s.id, section: s.section, concept_id: s.concept_id, concept_name: concept?.name ?? s.concept_id,
      state: s.state, outcome: s.outcome, question: s.question, messages, scene_actions: sceneActions,
    };
  }

  /** 보충학습 시작: 학습 상태 → 근거 검색 → 설비 보여 주기 → 설명과 확인 문제(동시에). 같은 공정의 진행 중 보충학습은 끝낸다. */
  start(userId: string, section: Section, conceptId: string, currentProcess: string | null): Promise<SupplementView> {
    return this.exclusive(`start:${userId}:${section}`, async () => {
      this.assertNoCheckpoint(userId, section);
      const rubric = this.rubricOf(section);
      const concept = this.conceptOf(rubric, conceptId);
      const ctx = this.context(userId, section, rubric);
      const steps: NewStep[] = [];
      const log = (s: NewStep) => steps.push(s);
      const call = <T extends LearningToolName>(raw: { tool: T; call_id: string; arguments: Record<string, unknown> }) => executeLearningTool<T>(raw, ctx, log);

      const state = await call({ tool: "get_learning_state", call_id: "state", arguments: { section } });
      const memo = state.ok ? state.result.open_misconceptions.find((m) => m.concept_id === concept.concept_id) ?? null : null;
      const search = await call({ tool: "search_materials", call_id: "search", arguments: { section, query: [concept.name, memo?.summary ?? ""].join(" ").trim(), equipment_id: concept.equipment_ids?.[0] ?? null } });
      const chunks = search.ok ? search.result.chunks : [];
      // 관련 설비 중 화면 목록에 있는 첫 설비를 보여 준다. 없는 설비면 도구가 거절하고(기록에 남김) 다음 설비를 본다.
      let shown: { actions: SceneAction[]; equipment: { id: string; name: string } } | null = null;
      for (const [i, id] of (concept.equipment_ids ?? []).entries()) {
        const r = await call({ tool: "show_equipment", call_id: `show_${i}`, arguments: { section, equipment_id: id } });
        if (r.ok) {
          shown = r.result;
          break;
        }
      }

      // 설명(학습 튜터, 근거 조각 사용)과 확인 문제(튜터)는 서로 기다릴 필요가 없어 동시에 부른다.
      const [explanation, quiz] = await Promise.all([
        this.explain(rubric, concept, chunks, memo?.summary ?? null, shown?.equipment ?? null, currentProcess),
        call({ tool: "create_quiz", call_id: "quiz_1", arguments: { section, concept_id: concept.concept_id, previous_question: null } }),
      ]);
      if (!quiz.ok) throw new Error(`확인 문제 도구 거절: ${quiz.error.message}`);

      const intro = [
        memo ? `지난번 기록: ${toPolite(memo.summary)}` : "이해도 확인에서 아직 만점이 아닌 개념이에요.",
        `${withObject(`'${concept.name}'`)} 다시 짚어 볼게요.${shown ? ` 화면에 ${withObject(shown.equipment.name)} 띄워 둘게요.` : ""}`,
      ].join("\n");
      const messages: SupplementMessage[] = [
        { role: "tutor", type: "intro", text: intro },
        { role: "tutor", type: "explanation", text: explanation.text, sources: explanation.sources },
        { role: "tutor", type: "question", text: `확인 문제예요. ${quiz.result.question}` },
      ];
      const sceneActions = shown ? normalizeSceneActions(shown.actions, this.deps.scene, currentProcess) : [];
      const s = this.deps.repo.create(
        { user_id: userId, section, concept_id: concept.concept_id, question: quiz.result.question },
        [...steps, ...messages.map((m): NewStep => ({ kind: "message", name: m.role, payload: m, ok: null, ms: null }))],
        this.now(),
      );
      return this.view(s, messages, sceneActions);
    });
  }

  /** 설명: 학습 튜터(근거 조각·오개념 메모를 넘김). 근거가 없거나 근거 없는 답이면 루브릭 핵심 요소를 정리해 보여 준다. */
  private async explain(rubric: Rubric, concept: RubricConcept, chunks: Awaited<ReturnType<Retriever["retrieve"]>>, memo: string | null, equipment: { id: string; name: string } | null, currentProcess: string | null): Promise<{ text: string; sources: SourceView[] }> {
    const fallback = { text: [SUPPLEMENT_TEXT.fallbackExplanation, keyPointsText(concept)].join("\n"), sources: toSources([concept.source.ref].filter((x): x is string => !!x)) };
    if (!chunks.length) return fallback;
    const reply = await this.deps.agent.reply({
      section: rubric.section,
      question: `${withObject(`'${concept.name}'`)} 처음부터 차근차근 다시 설명해 주세요.`,
      screen: { process_id: currentProcess === rubric.section ? rubric.section : null, equipment_id: equipment?.id ?? null, equipment_name: equipment?.name ?? null },
      chunks,
      history: [],
      openMisconceptions: memo ? [{ concept_id: concept.concept_id, summary: memo }] : [],
      concepts: rubric.concepts.map((c) => ({ concept_id: c.concept_id, name: c.name })),
      glossary: rubric.glossary ?? [],
      scene: this.deps.scene,
      keywordConcepts: [],
      retryConcepts: [],
    });
    if (reply.status !== "grounded") return fallback;
    const cited = chunks.filter((c) => reply.source_ids.includes(c.id)).flatMap((c) => c.source_ids);
    return { text: reply.answer, sources: toSources(cited) };
  }

  /** 확인 문제에 답하기: 채점 → 맞으면 해결하고 끝, 아니면(첫 문제) 다시 설명하고 다른 각도의 문제, 두 번째도 아니면 핵심 정리 후 끝. */
  answer(userId: string, id: string, answer: string): Promise<SupplementView> {
    return this.exclusive(`answer:${id}`, async () => {
      const s = this.deps.repo.get(id);
      if (!s || s.user_id !== userId) throw new SupplementError(404, "보충학습을 찾지 못했어요. 다시 시작해 주세요.", "NOT_FOUND");
      if (s.state !== "awaiting_answer" && s.state !== "awaiting_recheck") throw new SupplementError(409, "이미 끝난 보충학습이에요.", "FINISHED");
      if (this.expired(s)) {
        this.deps.repo.update(s.id, { state: "stopped" }, [], this.now());
        throw new SupplementError(409, "보충학습을 오래 멈춰 두어서 끝냈어요. 다시 시작해 주세요.", "EXPIRED");
      }
      this.assertNoCheckpoint(userId, s.section);
      const rubric = this.rubricOf(s.section);
      const concept = this.conceptOf(rubric, s.concept_id);
      const ctx = this.context(userId, s.section, rubric);
      const steps: NewStep[] = [];
      const log = (st: NewStep) => steps.push(st);
      const phase = s.state === "awaiting_answer" ? "initial" : "recheck";
      const question = s.question ?? "";

      let graded;
      try {
        graded = await executeLearningTool({ tool: "evaluate_answer", call_id: `evaluate_${phase}`, arguments: { section: s.section, concept_id: s.concept_id, question, answer, phase } }, ctx, log);
      } catch (error) {
        // 채점이 실패하면 답을 받지 않은 것으로 둔다(같은 문제에 다시 답할 수 있다). 실패 기록은 남긴다.
        this.deps.repo.appendSteps(s.id, steps, this.now());
        throw error;
      }
      if (!graded.ok) throw new Error(`채점 도구 거절: ${graded.error.message}`);
      const evaluation = graded.result.evaluation;
      const userMessage: SupplementMessage = { role: "user", type: "answer", text: answer };
      const now = this.now();
      const toSteps = (messages: SupplementMessage[]): NewStep[] => [
        ...steps,
        ...[userMessage, ...messages].map((m): NewStep => ({ kind: "message", name: m.role, payload: m, ok: null, ms: null })),
      ];
      // 학습 모드 오개념 메모로 남긴다(점수 반영 없음). 같은 개념의 미해결 메모가 있으면 그 행을 갱신한다.
      if (evaluation.misconception) {
        this.deps.learningRepo.recordMisconception({ user_id: userId, section: s.section, concept_id: s.concept_id, answer_text: answer, summary: evaluation.misconception }, now);
      }

      if (evaluation.verdict === "correct") {
        const resolved = this.deps.repo.resolveLearningMisconceptions(userId, s.concept_id, now);
        const checkpointOpen = this.deps.learningRepo.openMisconceptions(userId, s.section).some((m) => m.concept_id === s.concept_id && m.source === "checkpoint");
        const closing = [
          `'${concept.name}' 보충학습을 마쳤어요.${resolved ? " 학습 메모의 이 오개념은 해결로 바꿨어요." : ""}`,
          ...(checkpointOpen ? ["이해도 확인에서 남은 기록은 이해도 확인에서 이 개념을 맞히면 해결돼요."] : []),
        ].join(" ");
        const messages: SupplementMessage[] = [
          { role: "tutor", type: "reaction", tone: "correct", text: phase === "initial" ? SUPPLEMENT_TEXT.correct : SUPPLEMENT_TEXT.recheckCorrect },
          { role: "tutor", type: "closing", text: closing },
        ];
        const done = this.deps.repo.update(s.id, { state: "completed", outcome: "resolved" }, toSteps(messages), now);
        return this.view(done, messages, []);
      }

      if (phase === "initial") {
        // 처음 놓친 핵심 요소부터 다시 설명하고(체크포인트 튜터 설명과 같은 프롬프트), 다른 각도의 확인 문제를 낸다. 둘은 동시에 부른다.
        const [explanation, quiz] = await Promise.all([
          this.deps.tutor.explanation({ rubric, concept, explainFrom: evaluation.explain_from, misconception: evaluation.misconception, answer }),
          executeLearningTool({ tool: "create_quiz", call_id: "quiz_2", arguments: { section: s.section, concept_id: s.concept_id, previous_question: question } }, ctx, log),
        ]).catch((error) => {
          this.deps.repo.appendSteps(s.id, steps, this.now());
          throw error;
        });
        if (!quiz.ok) throw new Error(`확인 문제 도구 거절: ${quiz.error.message}`);
        const messages: SupplementMessage[] = [
          { role: "tutor", type: "reaction", tone: evaluation.verdict === "partial" ? "almost" : "miss", text: evaluation.verdict === "partial" ? SUPPLEMENT_TEXT.almost : SUPPLEMENT_TEXT.miss },
          { role: "tutor", type: "explanation", text: explanation },
          { role: "tutor", type: "question", text: `다른 각도로 한 번 더 물어볼게요. ${quiz.result.question}` },
        ];
        const next = this.deps.repo.update(s.id, { state: "awaiting_recheck", question: quiz.result.question }, toSteps(messages), now);
        return this.view(next, messages, []);
      }

      const messages: SupplementMessage[] = [
        { role: "tutor", type: "key_points", text: [SUPPLEMENT_TEXT.keyPoints, keyPointsText(concept)].join("\n") },
        { role: "tutor", type: "closing", text: `'${concept.name}' 보충학습은 여기까지예요. 위 핵심을 다시 읽어 보고, 궁금한 점은 튜터에게 물어보세요. 언제든 다시 시작할 수 있어요.` },
      ];
      const done = this.deps.repo.update(s.id, { state: "completed", outcome: "not_resolved" }, toSteps(messages), now);
      return this.view(done, messages, []);
    });
  }

  /** 그만두기. 이미 끝났으면 그대로 돌려준다. */
  stop(userId: string, id: string): SupplementView {
    const s = this.deps.repo.get(id);
    if (!s || s.user_id !== userId) throw new SupplementError(404, "보충학습을 찾지 못했어요.", "NOT_FOUND");
    if (s.state === "completed" || s.state === "stopped") return this.view(s, [], []);
    const message: SupplementMessage = { role: "tutor", type: "closing", text: "보충학습을 멈췄어요. 언제든 다시 시작할 수 있어요." };
    const stopped = this.deps.repo.update(s.id, { state: "stopped", question: null }, [{ kind: "message", name: "tutor", payload: message, ok: null, ms: null }], this.now());
    return this.view(stopped, [message], []);
  }

  /** 화면이 실제로 실행한 조작 결과(설비를 찾았는지)를 실행 기록에 남긴다. 도구가 만든 조작과 실제 실행 성공을 따로 본다. */
  recordSceneResults(userId: string, id: string, results: { type: string; target_id: string; status: "succeeded" | "failed" }[]): void {
    const s = this.deps.repo.get(id);
    if (!s || s.user_id !== userId) throw new SupplementError(404, "보충학습을 찾지 못했어요.", "NOT_FOUND");
    this.deps.repo.appendSteps(s.id, [{ kind: "scene_result", name: "scene", payload: results, ok: results.every((r) => r.status === "succeeded"), ms: null }], this.now());
  }
}

const SectionParam = z.enum(SECTION_ORDER as [Section, ...Section[]]);
const StartBody = z.object({
  section: SectionParam,
  concept_id: z.string().regex(/^[a-z0-9_]{1,80}$/),
  /** 지금 화면의 공정(전체 화면이면 null). 다른 공정이면 설비를 보여 주기 전에 그 공정으로 옮긴다. */
  screen: z.object({ process_id: SectionParam.nullable().optional() }).optional(),
});
const AnswerBody = z.object({ answer: z.string().trim().min(1).max(2000) });
const SceneResultsBody = z.object({
  results: z.array(z.object({ type: z.string().max(40), target_id: z.string().max(80), status: z.enum(["succeeded", "failed"]) })).max(10),
});

/**
 * 보충학습 API(docs/supplementary-learning.md 'API').
 * GET  /api/learning/supplements?section=  → { candidates, active }
 * POST /api/learning/supplements          → 시작(201)
 * POST /api/learning/supplements/:id/answer · /stop · /scene-results
 */
export function createSupplementRouter(engine: SupplementEngine): express.Router {
  const router = express.Router();

  const handle = (fn: (req: express.Request, res: express.Response) => Promise<void> | void) => async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof SupplementError) res.status(error.status).json({ error: error.message, code: error.code });
      else if (error instanceof UsageLimitError) res.status(429).json({ error: `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      else if (error instanceof LlmUnavailableError) {
        console.error(`보충학습 LLM 오류: ${error.message}`);
        res.status(error.status).json({ error: "튜터 모델 연결 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요." });
      } else if (error instanceof LearningFormatError) {
        console.error(error.message);
        res.status(502).json({ error: "설명을 만들지 못했어요. 다시 시도해 주세요." });
      } else {
        console.error(error);
        res.status(500).json({ error: "보충학습을 처리하지 못했어요. 다시 시도해 주세요." });
      }
    }
  };

  router.get("/api/learning/supplements", handle((req, res) => {
    const section = SectionParam.safeParse(req.query.section);
    if (!section.success) throw new SupplementError(400, "공정을 알려 주세요.", "BAD_REQUEST");
    const userId = currentUserId();
    res.json({ candidates: engine.candidates(userId, section.data), active: engine.active(userId, section.data) });
  }));

  router.post("/api/learning/supplements", handle(async (req, res) => {
    const body = StartBody.safeParse(req.body);
    if (!body.success) throw new SupplementError(400, "보충학습할 개념을 알려 주세요.", "BAD_REQUEST");
    res.status(201).json(await engine.start(currentUserId(), body.data.section, body.data.concept_id, body.data.screen?.process_id ?? null));
  }));

  router.post("/api/learning/supplements/:id/answer", handle(async (req, res) => {
    const body = AnswerBody.safeParse(req.body);
    if (!body.success) throw new SupplementError(400, "답은 1~2000자로 입력해 주세요.", "BAD_REQUEST");
    res.json(await engine.answer(currentUserId(), String(req.params.id), body.data.answer));
  }));

  router.post("/api/learning/supplements/:id/stop", handle((req, res) => {
    res.json(engine.stop(currentUserId(), String(req.params.id)));
  }));

  router.post("/api/learning/supplements/:id/scene-results", handle((req, res) => {
    const body = SceneResultsBody.safeParse(req.body);
    if (!body.success) throw new SupplementError(400, "화면 조작 결과 형식이 올바르지 않아요.", "BAD_REQUEST");
    engine.recordSceneResults(currentUserId(), String(req.params.id), body.data.results);
    res.status(204).end();
  }));

  return router;
}
