// 보충학습 에이전트 도구 계약(docs/supplementary-learning.md). 모델 종류와 상관없다.
// - 도구 호출은 이 형식으로만 실행한다. 실행 전에 형식과 공정 범위(지금 학습 중인 공정만)를 확인한다.
// - 실제 실행(설비·개념 확인, 검색, 문제, 채점)은 backend/src/learning/agent-tools.ts가 한다.
// - 지금은 서버(supplement.ts)가 정해진 순서로 도구를 부른다. 모델이 다음 도구를 고르게 바꿔도 같은 계약과 검증을 쓴다.
import { z } from "zod";
import type { Section } from "../../backend/src/checkpoint/types.js";

export const LEARNING_TOOL_NAMES = ["get_learning_state", "search_materials", "show_equipment", "create_quiz", "evaluate_answer"] as const;
export type LearningToolName = (typeof LEARNING_TOOL_NAMES)[number];

const Base = z.object({ tool: z.enum(LEARNING_TOOL_NAMES), call_id: z.string().min(1).max(80) });
export const LearningToolCall = z.discriminatedUnion("tool", [
  /** 학습자의 미해결 오개념(개념당 최근 1개)과 체크포인트에서 아직 만점이 아닌 개념. */
  Base.extend({ tool: z.literal("get_learning_state"), arguments: z.object({ section: z.string() }) }),
  /** 근거 자료 검색(retrieval.ts). */
  Base.extend({ tool: z.literal("search_materials"), arguments: z.object({ section: z.string(), query: z.string().trim().min(1).max(1000), equipment_id: z.string().nullable().optional() }) }),
  /** 3D 화면에서 설비를 보여 주는 조작을 만든다. 화면에서 실제로 됐는지는 화면이 따로 알려 준다(scene-results). */
  Base.extend({ tool: z.literal("show_equipment"), arguments: z.object({ section: z.string(), equipment_id: z.string().min(1) }) }),
  /** 확인 문제. 체크포인트 질문 은행은 쓰지 않는다(시험 문제를 미리 보지 않게). previous_question이 있으면 다른 각도로 묻는다. */
  Base.extend({ tool: z.literal("create_quiz"), arguments: z.object({ section: z.string(), concept_id: z.string().min(1), previous_question: z.string().max(1000).nullable().optional() }) }),
  /** 답 채점(체크포인트와 같은 평가자·루브릭). phase recheck에서는 assisted가 나오지 않는다. */
  Base.extend({ tool: z.literal("evaluate_answer"), arguments: z.object({ section: z.string(), concept_id: z.string().min(1), question: z.string().trim().min(1).max(1000), answer: z.string().trim().min(1).max(4000), phase: z.enum(["initial", "recheck"]) }) }),
]);
export type LearningToolCall = z.infer<typeof LearningToolCall>;

export type LearningToolErrorCode = "invalid_arguments" | "forbidden_section" | "unknown_equipment" | "unknown_concept" | "execution_failed";

export interface LearningToolError {
  ok: false;
  call_id: string;
  tool: LearningToolName | null;
  error: LearningToolErrorCode;
  message: string;
}

export interface LearningToolResult<T = unknown> {
  ok: true;
  call_id: string;
  tool: LearningToolName;
  result: T;
}

export function isLearningToolError(value: LearningToolCall | LearningToolError | LearningToolResult): value is LearningToolError {
  return "ok" in value && value.ok === false;
}

/** 도구 호출을 실행하기 전에 형식과 공정 범위를 확인한다. 지금 학습 중인 공정이 아닌 호출은 막는다. */
export function parseLearningToolCall(raw: unknown, section: Section): LearningToolCall | LearningToolError {
  const parsed = LearningToolCall.safeParse(raw);
  if (!parsed.success) {
    const r = raw as { call_id?: unknown; tool?: unknown } | null;
    const tool = LEARNING_TOOL_NAMES.find((t) => t === r?.tool) ?? null;
    return { ok: false, call_id: typeof r?.call_id === "string" ? r.call_id : "unknown", tool, error: "invalid_arguments", message: "도구 호출 형식이 올바르지 않습니다." };
  }
  const call = parsed.data;
  if (call.arguments.section !== section) {
    return { ok: false, call_id: call.call_id, tool: call.tool, error: "forbidden_section", message: "지금 학습 중인 공정 밖의 도구 호출은 허용하지 않습니다." };
  }
  return call;
}
