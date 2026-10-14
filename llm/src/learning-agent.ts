// 학습 모드 튜터(Gemini): 근거 조각으로 자유 질문에 답하고, 학습자가 틀린 내용을 단정하면 오개념을 함께 알려 준다.
// 예전 /api/chat(ironmaking-agent.ts, 지금은 삭제)을 대체했다. 설계는 docs/learning-mode.md '흐름'.
// - 호출은 1회(temperature 0.3). responseSchema로 형식을 강제하고, 서버에서 한 번 더 검증해 실패하면 1회 다시 부른다.
// - Gemini 과부하(HTTP 503)와 순간적인 연결 끊김은 1초·2초 뒤 최대 2번 다시 부른다. 다시 부를 때마다 하루 호출 수에 들어간다.
// - source_ids는 이번에 검색한 조각 id만, concept_id는 루브릭 개념만 남긴다.
// - scene_actions(3D 화면 조작)는 화면 목록(data_v2.js)에 있는 공정·설비만 남기고, 다른 공정의 설비면 그 공정으로 먼저 이동시킨다.
// - keyword_card는 카드를 띄울 개념만 고른다. 카드 내용은 서버가 루브릭에서 꺼낸다(backend/src/learning/keywords.ts). 호출 수는 늘지 않는다.
import { z } from "zod";
import { SECTION_NAMES, type Section } from "../../backend/src/checkpoint/types.js";
import type { GlossaryEntry } from "../../backend/src/rubrics.js";
import { escapeDelimited, GeminiCallError, renderPrompt, type GenerateRequest, type LlmClient } from "./gemini.js";
import { politeText } from "./polite.js";
import type { Retrieved, Screen } from "./retrieval.js";

const MAX_ATTEMPTS = 2;
const TEMPERATURE = 0.3;
const MAX_OUTPUT_TOKENS = 1200;
const MAX_ANSWER_CHARS = 4000;
/** 한 답변에 붙이는 화면 조작 수(공정 이동을 끼워 넣은 뒤 기준). */
export const MAX_SCENE_ACTIONS = 4;

/** 화면(frontend/3d-demo/learning-chat.js의 runActions)이 실행할 수 있는 조작. */
export const SCENE_ACTION_TYPES = ["goto_process", "highlight", "focus", "play_animation"] as const;
export interface SceneAction {
  type: (typeof SCENE_ACTION_TYPES)[number];
  /** goto_process·play_animation은 공정 id, highlight·focus는 설비 id. */
  target_id: string;
}

/** 튜터가 화면에서 고를 수 있는 공정·설비. 기준은 frontend/3d-demo/data_v2.js(backend/src/learning/scene-catalog.ts가 읽는다). */
export interface SceneCatalog {
  processes: { id: Section; name: string; equipment: { id: string; name: string }[] }[];
}

/** 근거 없이 grounded라고 답했을 때 대신 보여 줄 답. */
export const UNVERIFIED_ANSWER =
  "수집한 공개 자료에서는 이 질문의 답을 확인하지 못했어요. 실제 운전 조건이나 작업 절차는 해당 자료와 현장 지침에서 따로 확인해 주세요.";

/** 학습 화면의 설비 작동 단계 설명(backend/src/learning/screen-material.ts). 근거가 아니라 화면 안내에만 쓴다. */
export interface ScreenMaterial {
  equipment_id: string;
  equipment_name: string;
  /** 작동 단계 번호(1부터). */
  step: number;
  text: string;
}

export interface LearningInput {
  section: Section;
  question: string;
  /** process_id가 null이면 전체 공정 화면이다(답은 section 기준). */
  screen: Screen & { equipment_name?: string | null };
  /** retrieve() 결과. 비어 있으면 모델은 unverified로 답한다. */
  chunks: Retrieved[];
  /** 같은 세션의 최근 대화(오래된 것부터). */
  history: { question: string; answer: string }[];
  /** 이 섹션의 미해결 오개념 요약(학습자 메모). */
  openMisconceptions: { concept_id: string; summary: string }[];
  /** 오개념을 붙일 수 있는 개념(루브릭). 비어 있으면 오개념을 기록하지 않는다. */
  concepts: { concept_id: string; name: string }[];
  glossary?: GlossaryEntry[];
  /** 화면 조작에 쓸 공정·설비 목록. 없으면 scene_actions는 항상 빈 배열이다. */
  scene?: SceneCatalog;
  /** 키워드 카드를 띄울 수 있는 개념(keywords.ts의 keywordCardConcepts). 비어 있으면 keyword_card는 항상 null이다. */
  keywordConcepts?: { concept_id: string; name: string }[];
  /** 체크포인트에서 아직 만점이 아닌 개념 id(섹션 진행의 retry_concept_ids). */
  retryConcepts?: string[];
  /** 질문 단어가 나오는 학습 화면 단계 설명. 근거로 답하지 못할 때 화면 위치를 안내하는 데 쓴다. */
  screenMaterial?: ScreenMaterial[];
}

export interface LearningReply {
  answer: string;
  status: "grounded" | "unverified";
  /** 근거로 쓴 조각 id(이번 검색 결과 안에서만). */
  source_ids: string[];
  follow_up: string | null;
  detected_misconception: { concept_id: string; summary: string } | null;
  scene_actions: SceneAction[];
  /** 답변 아래에 띄울 키워드 카드의 개념. grounded 답변에서만, keywordConcepts 안에서만. */
  keyword_card: { concept_id: string } | null;
}

/** 라우트가 쓰는 학습 모드 튜터. 테스트는 가짜 구현을 넣는다. */
export interface LearningAgent {
  /** onAnswer: 답(answer)을 받는 대로 지금까지의 글을 넘긴다(스트리밍). 형식 오류로 다시 부르면 처음부터 다시 넘긴다. 최종 답은 돌려주는 값이다. */
  reply(input: LearningInput, options?: { onAnswer?: (text: string) => void }): Promise<LearningReply>;
}

/**
 * 받는 중인 JSON 텍스트에서 answer 값의 지금까지 부분을 꺼낸다. 아직 answer가 시작되지 않았으면 null.
 * 이스케이프(\n, \", \uXXXX)를 풀고, 끝에 잘린 이스케이프는 뺀다.
 */
export function partialAnswer(raw: string): string | null {
  const start = /"answer"\s*:\s*"/.exec(raw);
  if (!start) return null;
  let out = "";
  for (let i = start.index + start[0].length; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[next] ?? next;
    i++;
  }
  return out;
}

/** 두 번 모두 형식에 맞지 않는 응답을 받았을 때. 라우트는 502로 답한다. */
export class LearningFormatError extends Error {}

/** Gemini responseSchema. 고를 수 있는 조각 id·개념 id·화면 id·카드 개념 id를 enum으로 묶는다(빈 목록이면 enum을 두지 않는다). */
export function learningResponseSchema(chunkIds: string[], conceptIds: string[], sceneIds: string[] = [], keywordConceptIds: string[] = []): object {
  const enumOf = (values: string[]) => (values.length ? { enum: values } : {});
  return {
    type: "OBJECT",
    properties: {
      answer: { type: "STRING" },
      status: { type: "STRING", enum: ["grounded", "unverified"] },
      source_ids: { type: "ARRAY", items: { type: "STRING", ...enumOf(chunkIds) } },
      follow_up: { type: "STRING", nullable: true },
      scene_actions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { type: { type: "STRING", enum: [...SCENE_ACTION_TYPES] }, target_id: { type: "STRING", ...enumOf(sceneIds) } },
          required: ["type", "target_id"],
        },
      },
      detected_misconception: {
        type: "OBJECT",
        nullable: true,
        properties: { concept_id: { type: "STRING", ...enumOf(conceptIds) }, summary: { type: "STRING" } },
        required: ["concept_id", "summary"],
      },
      keyword_card: {
        type: "OBJECT",
        nullable: true,
        properties: { concept_id: { type: "STRING", ...enumOf(keywordConceptIds) } },
        required: ["concept_id"],
      },
    },
    required: ["answer", "status", "source_ids", "follow_up", "scene_actions", "detected_misconception", "keyword_card"],
    propertyOrdering: ["answer", "status", "source_ids", "follow_up", "scene_actions", "detected_misconception", "keyword_card"],
  };
}

/** 화면에서 고를 수 있는 공정·설비 id(schema enum용). */
export function sceneIds(scene: SceneCatalog | undefined): string[] {
  return scene ? scene.processes.flatMap((p) => [p.id, ...p.equipment.map((e) => e.id)]) : [];
}

export function learningSystemPrompt(input: Pick<LearningInput, "section" | "concepts" | "glossary" | "scene" | "keywordConcepts">): string {
  return renderPrompt("learning-system", {
    section_name: SECTION_NAMES[input.section],
    concepts: input.concepts.length ? input.concepts.map((c) => `- ${c.concept_id}: ${c.name}`).join("\n") : "(없음: detected_misconception은 항상 null)",
    keyword_concepts: input.keywordConcepts?.length
      ? input.keywordConcepts.map((c) => `- ${c.concept_id}: ${c.name}`).join("\n")
      : "(없음: keyword_card는 항상 null)",
    glossary: input.glossary?.length ? input.glossary.map((g) => `- ${g.term} = ${g.aliases.join(", ")}`).join("\n") : "(없음)",
    scene: input.scene?.processes.length
      ? input.scene.processes.map((p) => `- 공정 ${p.id} (${p.name}): ${p.equipment.map((e) => `${e.id} (${e.name})`).join(", ")}`).join("\n")
      : "(없음: scene_actions는 항상 빈 배열)",
  });
}

/** 사용자 메시지. 학습자에게서 온 글(질문·이전 대화)은 구분자를 닫지 못하게 이스케이프한다. */
export function learningUserPrompt(input: LearningInput): string {
  const screen = !input.screen.process_id
    ? "전체 공정 화면, 선택한 설비 없음"
    : input.screen.equipment_id
      ? `공정 ${input.screen.process_id}, 설비 ${input.screen.equipment_id}${input.screen.equipment_name ? ` (${input.screen.equipment_name})` : ""}`
      : `공정 ${input.screen.process_id}, 선택한 설비 없음`;
  const sources = input.chunks.length
    ? input.chunks.map((c) => `[${c.id}] ${c.title}\n${c.text}`).join("\n\n")
    : "(검색된 근거 없음)";
  const history = input.history.length
    ? input.history.map((t) => `학습자: ${escapeDelimited(t.question)}\n튜터: ${escapeDelimited(t.answer)}`).join("\n")
    : "(없음)";
  const notes = input.openMisconceptions.length ? input.openMisconceptions.map((m) => `- ${m.concept_id}: ${m.summary}`).join("\n") : "(없음)";
  const nameOf = new Map(input.concepts.map((c) => [c.concept_id, c.name]));
  const retry = input.retryConcepts?.length ? input.retryConcepts.map((id) => `- ${id}${nameOf.has(id) ? `: ${nameOf.get(id)}` : ""}`).join("\n") : "(없음)";
  const material = input.screenMaterial?.length
    ? input.screenMaterial.map((m) => `- ${m.equipment_name} (${m.equipment_id}) 작동 단계 ${m.step}: ${m.text}`).join("\n")
    : "(없음)";
  return [
    `<screen>${screen}</screen>`,
    `<learner_notes>\n${notes}\n</learner_notes>`,
    `<checkpoint_retry>\n${retry}\n</checkpoint_retry>`,
    `<sources>\n${sources}\n</sources>`,
    `<screen_material>\n${material}\n</screen_material>`,
    `<history>\n${history}\n</history>`,
    `<question>${escapeDelimited(input.question)}</question>`,
  ].join("\n\n");
}

const ReplySchema = z.object({
  answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
  status: z.enum(["grounded", "unverified"]),
  source_ids: z.array(z.string()),
  follow_up: z.string().nullable(),
  // 화면 조작 형식이 틀려도 답변은 살린다(빈 배열로 본다).
  scene_actions: z.array(z.object({ type: z.string(), target_id: z.string() })).catch([]),
  detected_misconception: z.object({ concept_id: z.string(), summary: z.string() }).nullable(),
  // 카드 형식이 틀려도 답변은 살린다(카드 없음으로 본다).
  keyword_card: z.object({ concept_id: z.string() }).nullable().catch(null),
});

/**
 * 화면 목록에 있는 조작만 남긴다. 다른 공정의 설비·공정을 가리키면 goto_process를 앞에 끼우고,
 * 이미 그 공정에 있으면 goto_process를 버린다(같은 공정으로 이동하면 화면이 초기화된다). focus 뒤에는 highlight를 붙인다. 같은 조작은 한 번만.
 * current가 null이면 전체 공정 화면이다.
 */
export function normalizeSceneActions(raw: { type: string; target_id: string }[], scene: SceneCatalog | undefined, current: string | null): SceneAction[] {
  if (!scene) return [];
  const processes = new Set<string>(scene.processes.map((p) => p.id));
  const processOf = new Map(scene.processes.flatMap((p) => p.equipment.map((e) => [e.id, p.id] as const)));
  const out: SceneAction[] = [];
  let at = current;
  // 한 답에서는 한 공정으로만 옮긴다. 제강으로 갔다가 제선으로 돌아오는 식이면 화면이 흔들리므로 처음 옮긴 공정 밖의 조작은 버린다.
  let moved = false;
  const push = (action: SceneAction) => {
    if (!out.some((a) => a.type === action.type && a.target_id === action.target_id)) out.push(action);
  };
  const moveTo = (process: string): boolean => {
    if (process === at) return true;
    if (moved) return false;
    push({ type: "goto_process", target_id: process });
    at = process;
    moved = true;
    return true;
  };
  for (const a of raw) {
    if (a.type === "goto_process" || a.type === "play_animation") {
      if (!processes.has(a.target_id) || !moveTo(a.target_id)) continue;
      if (a.type === "play_animation") push({ type: "play_animation", target_id: a.target_id });
    } else if (a.type === "highlight" || a.type === "focus") {
      const process = processOf.get(a.target_id);
      if (!process || !moveTo(process)) continue;
      push({ type: a.type, target_id: a.target_id });
      // 카메라만 옮기면 설비 정보가 안 보이므로 focus에는 highlight를 함께 붙인다(모델이 하나만 낼 때가 있다).
      if (a.type === "focus") push({ type: "highlight", target_id: a.target_id });
    }
  }
  return out.slice(0, MAX_SCENE_ACTIONS);
}

/**
 * 질문이 이름으로 가리키는 설비가 하나면 그 id. 이름은 '·'로 나뉜 부분(괄호 안은 뺌) 중 두 글자 이상이 질문에 그대로 있으면 맞는다.
 * '~기'로 끝나는 이름은 '기'를 뗀 말도 본다('소결이 뭐야?' → 소결기, '권취는?' → 권취기).
 * 예: '소결기는 무슨 일을 해?' → sinter_plant, '2차 정련은 왜 해?' → secondary_refining. 둘 이상이거나 없으면 null.
 */
export function namedEquipment(question: string, scene: SceneCatalog | undefined): string | null {
  if (!scene) return null;
  const words = (name: string) => name.replace(/\([^)]*\)/g, " ").split(/[·,]/).map((part) => part.trim())
    .flatMap((part) => (part.endsWith("기") ? [part, part.slice(0, -1)] : [part]));
  const hits = scene.processes.flatMap((p) => p.equipment).filter((e) => words(e.name).some((w) => w.length >= 2 && question.includes(w)));
  return hits.length === 1 ? hits[0].id : null;
}

/** 형식을 검사하고 허용된 id만 남긴다. 형식이 틀리면 이유 문자열. */
export function parseLearningReply(
  raw: string,
  input: Pick<LearningInput, "chunks" | "concepts" | "scene" | "screen" | "keywordConcepts"> & { question?: string },
): LearningReply | string {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return "JSON이 아님";
  }
  const parsed = ReplySchema.safeParse(json);
  if (!parsed.success) return `스키마 불일치: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`;
  const r = parsed.data;

  const allowedChunks = new Set(input.chunks.map((c) => c.id));
  const source_ids = [...new Set(r.source_ids.filter((id) => allowedChunks.has(id)))];
  const allowedConcepts = new Set(input.concepts.map((c) => c.concept_id));
  const m = r.detected_misconception;
  const detected_misconception = m && allowedConcepts.has(m.concept_id) && m.summary.trim() ? { concept_id: m.concept_id, summary: m.summary.trim() } : null;
  // 해요체 규칙을 넣어도 모델이 '~답니다'·'~입니다'를 섞어서 문장 끝 어미를 맞춘다(polite.ts).
  const follow_up = r.follow_up?.trim() ? politeText(r.follow_up.trim()) : null;

  // grounded라고 했지만 쓸 수 있는 근거가 없으면 답을 믿지 않는다. 같은 응답의 화면 조작·카드도 버린다.
  if (r.status === "grounded" && source_ids.length === 0) {
    return { answer: UNVERIFIED_ANSWER, status: "unverified", source_ids: [], follow_up, detected_misconception, scene_actions: [], keyword_card: null };
  }
  let scene_actions = normalizeSceneActions(r.scene_actions, input.scene, input.screen.process_id ?? null);
  // 질문이 설비 하나를 이름으로 물었는데 화면 조작을 내지 않았으면 그 설비를 보여 준다(모델이 자주 빠뜨린다). 이미 보고 있으면 그대로 둔다.
  const named = scene_actions.length === 0 && input.question ? namedEquipment(input.question, input.scene) : null;
  if (named && named !== input.screen.equipment_id) {
    scene_actions = normalizeSceneActions([{ type: "focus", target_id: named }], input.scene, input.screen.process_id ?? null);
  }
  // 카드는 근거로 설명한 답을 정리하는 것이라 grounded 답변에만 붙인다.
  const allowedCards = new Set((input.keywordConcepts ?? []).map((c) => c.concept_id));
  const keyword_card = r.status === "grounded" && r.keyword_card && allowedCards.has(r.keyword_card.concept_id) ? { concept_id: r.keyword_card.concept_id } : null;
  return { answer: politeText(r.answer.trim()), status: r.status, source_ids, follow_up, detected_misconception, scene_actions, keyword_card };
}

/** Gemini 과부하(HTTP 503 "high demand")·연결 끊김 때 다시 부르기 전에 기다리는 시간(ms). 길이가 다시 부르는 횟수다. */
export const OVERLOAD_RETRY_DELAYS_MS = [1000, 2000];

export class GeminiLearningAgent implements LearningAgent {
  constructor(
    private readonly gemini: LlmClient,
    private readonly retryDelaysMs: number[] = OVERLOAD_RETRY_DELAYS_MS,
  ) {}

  /**
   * 503 과부하와 순간적인 연결 끊김(fetch failed)은 몇 초 사이에도 풀리므로 잠시 뒤 다시 부른다.
   * 시간 초과(이미 오래 기다림)와 그 밖의 HTTP 오류는 그대로 올려 보낸다.
   */
  private async generate(request: GenerateRequest): Promise<string> {
    for (let retry = 0; ; retry++) {
      try {
        return await this.gemini.generate(request);
      } catch (error) {
        const transient = error instanceof GeminiCallError && (error.httpStatus === 503 || error.reason === "network");
        if (!transient || retry >= this.retryDelaysMs.length) throw error;
        await new Promise((r) => setTimeout(r, this.retryDelaysMs[retry]));
      }
    }
  }

  async reply(input: LearningInput, { onAnswer }: { onAnswer?: (text: string) => void } = {}): Promise<LearningReply> {
    // 스트리밍: 받는 중인 JSON에서 answer만 꺼내 해요체로 바꿔 넘긴다(최종 답은 parseLearningReply 결과).
    let shown = "";
    const onText = onAnswer && ((raw: string) => {
      const text = partialAnswer(raw);
      if (!text?.trim()) return;
      const polite = politeText(text);
      if (polite !== shown) onAnswer((shown = polite));
    });
    const request = {
      ...(onText ? { onText } : {}),
      system: learningSystemPrompt(input),
      prompt: learningUserPrompt(input),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseSchema: learningResponseSchema(
        input.chunks.map((c) => c.id),
        input.concepts.map((c) => c.concept_id),
        sceneIds(input.scene),
        (input.keywordConcepts ?? []).map((c) => c.concept_id),
      ),
    };
    let problem = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 연결·HTTP 오류(LlmUnavailableError)는 503 과부하만 generate()가 다시 부르고 나머지는 그대로 올려 보낸다. 형식 오류는 여기서 다시 부른다.
      const result = parseLearningReply(await this.generate(request), input);
      if (typeof result !== "string") return result;
      problem = result;
    }
    throw new LearningFormatError(`학습 모드 응답 형식 오류(${MAX_ATTEMPTS}회): ${problem}`);
  }
}
