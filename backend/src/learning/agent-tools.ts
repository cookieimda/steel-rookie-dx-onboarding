// 보충학습 에이전트 도구 실행(계약은 llm/src/learning-tools.ts, 설계는 docs/supplementary-learning.md).
// 도구 호출마다 형식·공정 범위를 확인하고, 설비·개념이 지금 화면 목록·루브릭에 있는지 확인한 뒤 실행한다.
// 실행 기록(입력·결과 요약·성공 여부·걸린 시간)을 함께 돌려줘 보충학습 저장소에 남긴다.
import type { Evaluation, Evaluator, Section } from "../checkpoint/types.js";
import type { Rubric, RubricConcept } from "../rubrics.js";
import type { PracticeQuestion } from "../../../llm/src/tutor.js";
import type { SceneAction, SceneCatalog } from "../../../llm/src/learning-agent.js";
import { parseLearningToolCall, type LearningToolCall, type LearningToolError, type LearningToolName } from "../../../llm/src/learning-tools.js";
import type { Retrieved, Retriever } from "../../../llm/src/retrieval.js";
import { latestPerConcept, type OpenMisconception } from "./repository.js";
import type { NewStep } from "./supplement-repository.js";

/** 보충학습 확인 문제를 만드는 튜터(GeminiTutor.practiceQuestion). 체크포인트 질문 은행은 쓰지 않는다. */
export interface PracticeQuestioner {
  practiceQuestion(input: { rubric: Rubric; concept: RubricConcept; previousQuestion?: string | null }): Promise<PracticeQuestion>;
}

export interface LearningToolContext {
  userId: string;
  section: Section;
  rubric: Rubric;
  /** 미해결 오개념(보충학습은 시연 기록도 본다: SupplementRepository.openMisconceptions). */
  openMisconceptions: () => OpenMisconception[];
  retriever: Retriever;
  scene?: SceneCatalog;
  questioner: PracticeQuestioner;
  evaluator: Evaluator;
  /** 체크포인트에서 아직 만점이 아닌 개념(get_learning_state 결과에 넣는다). */
  retryConceptIds?: () => string[];
}

/** 도구별 결과. */
export interface LearningToolResults {
  get_learning_state: { open_misconceptions: OpenMisconception[]; retry_concept_ids: string[] };
  search_materials: { chunks: Retrieved[] };
  show_equipment: { actions: SceneAction[]; equipment: { id: string; name: string } };
  /** used_fallback·attempts: 만든 문장과 유출 검사에 걸린 표현(실행 기록에서 고정 문장을 쓴 까닭을 볼 수 있게). */
  create_quiz: { question: string; used_fallback: boolean; attempts: PracticeQuestion["attempts"] };
  evaluate_answer: { evaluation: Evaluation };
}

export type ToolOutcome<T extends LearningToolName = LearningToolName> =
  | { ok: true; tool: T; result: LearningToolResults[T]; step: NewStep }
  | { ok: false; error: LearningToolError; step: NewStep };

/** 실행 기록에 남길 결과 요약. 검색 조각 본문처럼 긴 것은 id·점수만 남긴다. */
function summarize(call: LearningToolCall, result: LearningToolResults[LearningToolName]): unknown {
  if (call.tool === "search_materials") return { chunks: (result as LearningToolResults["search_materials"]).chunks.map((c) => ({ id: c.id, score: c.score })) };
  return result;
}

const fail = (call: { call_id: string; tool: LearningToolName | null }, error: LearningToolError["error"], message: string): LearningToolError =>
  ({ ok: false, call_id: call.call_id, tool: call.tool, error, message });

/**
 * 도구 호출 하나를 확인하고 실행한다. 확인에 걸리면(형식·공정 범위·없는 설비·없는 개념) ok: false로 돌려준다.
 * 실행 중 예외(LLM 연결 실패, 하루 호출 한도 등)는 실행 기록에 남긴 뒤 그대로 던진다(라우트가 HTTP 상태로 바꾼다).
 */
export async function executeLearningTool<T extends LearningToolName>(raw: { tool: T } & Record<string, unknown>, ctx: LearningToolContext, onStep: (step: NewStep) => void): Promise<ToolOutcome<T>> {
  const started = Date.now();
  const parsed = parseLearningToolCall(raw, ctx.section);
  const step = (ok: boolean, result: unknown): NewStep => ({ kind: "tool", name: String(raw.tool), payload: { arguments: (raw as { arguments?: unknown }).arguments ?? null, result }, ok, ms: Date.now() - started });
  const rejected = (error: LearningToolError): ToolOutcome<T> => {
    const s = step(false, { error: error.error, message: error.message });
    onStep(s);
    return { ok: false, error, step: s };
  };
  if ("ok" in parsed) return rejected(parsed);
  const call = parsed;
  const conceptOf = (id: string) => ctx.rubric.concepts.find((c) => c.concept_id === id);

  let result: LearningToolResults[LearningToolName];
  try {
    switch (call.tool) {
      case "get_learning_state":
        result = {
          open_misconceptions: latestPerConcept(ctx.openMisconceptions()).filter((m) => conceptOf(m.concept_id)),
          retry_concept_ids: (ctx.retryConceptIds?.() ?? []).filter((id) => conceptOf(id)),
        };
        break;
      case "search_materials":
        result = { chunks: ctx.retriever.retrieve(ctx.section, call.arguments.query, { process_id: ctx.section, equipment_id: call.arguments.equipment_id ?? null }) };
        break;
      case "show_equipment": {
        const equipment = ctx.scene?.processes.find((p) => p.id === ctx.section)?.equipment.find((e) => e.id === call.arguments.equipment_id);
        if (!equipment) return rejected(fail(call, "unknown_equipment", "지금 공정의 화면 목록에 없는 설비입니다."));
        result = { actions: [{ type: "focus", target_id: equipment.id }, { type: "highlight", target_id: equipment.id }], equipment: { id: equipment.id, name: equipment.name } };
        break;
      }
      case "create_quiz": {
        const concept = conceptOf(call.arguments.concept_id);
        if (!concept) return rejected(fail(call, "unknown_concept", "지금 루브릭에 없는 개념입니다."));
        const q = await ctx.questioner.practiceQuestion({ rubric: ctx.rubric, concept, previousQuestion: call.arguments.previous_question ?? null });
        result = { question: q.text, used_fallback: q.usedFallback, attempts: q.attempts };
        break;
      }
      case "evaluate_answer": {
        const concept = conceptOf(call.arguments.concept_id);
        if (!concept) return rejected(fail(call, "unknown_concept", "지금 루브릭에 없는 개념입니다."));
        const { question, answer, phase } = call.arguments;
        result = { evaluation: await ctx.evaluator.evaluate({ rubric: ctx.rubric, concept, question, answer, phase }) };
        break;
      }
    }
  } catch (error) {
    onStep(step(false, { error: "execution_failed", message: (error as Error).message }));
    throw error;
  }
  const s = step(true, summarize(call, result));
  onStep(s);
  return { ok: true, tool: call.tool as T, result: result as LearningToolResults[T], step: s };
}
