import type { Rubric, RubricConcept } from "../rubrics.js";
import type { RecheckVerdict, Verdict } from "../scoring.js";

export type Section = Rubric["section"];
export type Phase = "initial" | "recheck";
/** paused: 학습자가 '나중에 이어 풀기'로 멈춘 시도. resume_state에 멈추기 전 단계(awaiting_ready·awaiting_answer·awaiting_recheck)를 둔다. */
export type CheckpointState = "awaiting_ready" | "awaiting_answer" | "awaiting_recheck" | "paused" | "completed" | "error";
export type AttemptKind = "first" | "retry";

/** 섹션 목록과 순서의 단일 기준. 다른 파일은 이것을 import한다(루브릭 스키마의 section enum과 같은지 테스트로 확인). */
const SECTIONS_IN_ORDER = ["ironmaking", "steelmaking", "continuous_casting", "rolling"] as const satisfies readonly Section[];
// 모든 Section이 목록에 있는지 컴파일 때 확인한다.
const _allSections: Exclude<Section, (typeof SECTIONS_IN_ORDER)[number]> extends never ? true : never = true;
void _allSections;
/** z.enum(SECTION_ORDER)에 바로 쓸 수 있게 비어 있지 않은 튜플로 둔다. 고치지 말고 읽기만 한다. */
export const SECTION_ORDER: [Section, ...Section[]] = [...SECTIONS_IN_ORDER];
export const SECTION_NAMES: Record<Section, string> = {
  ironmaking: "제선",
  steelmaking: "제강",
  continuous_casting: "연주",
  rolling: "열간압연",
};

// --- LLM 역할 ---

export interface EvaluateInput {
  rubric: Rubric;
  concept: RubricConcept;
  question: string;
  answer: string;
  phase: Phase;
}

export interface Evaluation {
  /** recheck 단계에서는 assisted가 나오지 않는다(되묻기·힌트 요청은 wrong). */
  verdict: Verdict;
  misconception: string | null;
  /**
   * correct가 아니면 학습자가 처음 놓친 key_points 인덱스(0부터). correct면 null.
   * 핵심 요소를 모두 맞혔지만 사실 오류로 partial이면 null이고 misconception이 있어야 한다(오개념만 교정).
   */
  explain_from: number | null;
  evidence: string;
}

/** verdict·misconception·explain_from이 서로 맞는지 본다. 틀리면 이유, 맞으면 null. 평가자 파싱과 엔진 검증이 함께 쓴다. */
export function explainFromProblem(e: Pick<Evaluation, "verdict" | "misconception" | "explain_from">, keyPointCount: number): string | null {
  const from = e.explain_from;
  if (e.verdict === "correct") return from === null ? null : "correct인데 explain_from이 있음";
  if (from === null) {
    // 오개념만 교정하는 경우: partial이고 오개념이 기록되어 있어야 한다.
    if (e.verdict !== "partial") return `${e.verdict}인데 explain_from이 없음`;
    return e.misconception?.trim() ? null : "partial인데 explain_from과 misconception이 모두 없음";
  }
  return Number.isInteger(from) && from >= 0 && from < keyPointCount ? null : `explain_from 범위 오류: ${from}`;
}

/** 평가자. 응답 형식 검증과 1회 재시도까지 구현 안에서 처리하고, 끝까지 실패하면 EvaluationFormatError를 던진다. */
export interface Evaluator {
  evaluate(input: EvaluateInput): Promise<Evaluation>;
}

/** 튜터가 낸 질문. bank는 고른 은행 원문(questions·recheck_questions·fallback_question)이고, LLM이 만든 질문이면 null이다. */
export interface AskedQuestion {
  text: string;
  bank: string | null;
}

/**
 * 튜터 발화. 질문, 부가 설명, 다른 각도의 재확인 질문을 만든다.
 * exclude는 이 시도에서 이 개념에 이미 쓴 은행 원문이다(이어 풀기). 남은 은행 질문이 없으면 fallback_question을 다시 쓴다.
 */
export interface Tutor {
  question(input: { rubric: Rubric; concept: RubricConcept; exclude?: readonly string[] }): Promise<AskedQuestion>;
  explanation(input: {
    rubric: Rubric;
    concept: RubricConcept;
    /** null이면 핵심 요소는 모두 맞혔고 오개념만 교정한다. */
    explainFrom: number | null;
    misconception: string | null;
    answer: string;
    /** 학습자 메모(학습 모드·이전 체크포인트의 미해결 오개념 요약). 관련 있을 때만 짚는다. 평가자에게는 주지 않는다. */
    learnerNotes?: string | null;
  }): Promise<string>;
  recheckQuestion(input: { rubric: Rubric; concept: RubricConcept; previousQuestion: string; exclude?: readonly string[] }): Promise<AskedQuestion>;
}

// --- 에러 ---

/** 평가자 출력이 형식 검증에 실패했다(재시도 포함). 시도는 error 상태가 된다. */
export class EvaluationFormatError extends Error {}

/** LLM에 연결하지 못했다. 상태를 바꾸지 않고 요청만 실패시킨다(같은 메시지를 다시 보내면 된다). */
export class LlmUnavailableError extends Error {
  constructor(message: string, readonly status: 502 | 503 = 502) {
    super(message);
  }
}

/** 클라이언트가 고칠 수 있는 요청 오류. status는 그대로 HTTP 상태 코드가 된다. */
export class CheckpointError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, message: string) {
    super(message);
  }
}

// --- 응답 ---

export type UtteranceType =
  | "intro"
  | "question"
  | "feedback"
  | "explanation"
  | "recheck_question"
  | "key_points"
  | "result"
  | "error";

export interface Utterance {
  type: UtteranceType;
  text: string;
}

export interface HistoryMessage {
  role: "tutor" | "user";
  type: UtteranceType | null;
  text: string;
}

export interface ResultView {
  understanding: number;
  unlocked: boolean;
  threshold: number;
  concepts: { concept_id: string; name: string; score: number; final_verdict: RecheckVerdict | null }[];
  retry_concept_ids: string[];
}

export interface CheckpointView {
  attempt_id: string;
  section: Section;
  kind: AttemptKind;
  state: CheckpointState;
  concept: { id: string; name: string; index: number; total: number } | null;
  /** 이번 요청으로 새로 생긴 튜터 발화. */
  tutor: Utterance[];
  progress: { concept_id: string; status: "done" | "current" | "pending" }[];
  result: ResultView | null;
  /** 시도를 이어서 열 때(GET, 진행 중인 시도 재시작)만 채운다. */
  history?: HistoryMessage[];
}

export interface SectionProgressView {
  section: Section;
  open: boolean;
  unlocked: boolean;
  understanding: number | null;
  retry_concept_ids: string[];
  /** 통과한 섹션에서 아직 확인하지 않은 개념(통과 뒤 루브릭에 새로 생긴 개념). 다시 묻지 않고 미확인으로 보여 준다. */
  unconfirmed_concept_ids: string[];
  in_progress_attempt_id: string | null;
  /** 끝나지 않은 시도의 상태와 확정한 개념 수(done/total). paused면 화면에 '이어 풀기 (1/3 완료)'로 보인다. */
  in_progress: { attempt_id: string; state: CheckpointState; done: number; total: number } | null;
}
