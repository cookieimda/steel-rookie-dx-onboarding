// 학습 모드 API: POST /api/chat. 흐름은 docs/learning-mode.md '흐름'.
// 안전 질문 차단 → retrieve() → 최근 대화·미해결 오개념·체크포인트 재도전 개념 → 튜터 1회 → 오개념 기록(source=learning) → 대화 저장.
// 튜터가 고른 키워드 카드는 루브릭에서 내용을 꺼내 붙인다(keywords.ts). 체크포인트 진행 중에는 붙이지 않는다.
// 예전 /api/chat(제선 Q&A, 지금은 삭제)의 요청·응답 필드는 유지하고 screen, follow_up, scene_actions를 더했다.
// GET /api/chat/sessions/:sessionId: 저장된 대화(페이지를 새로고침해도 채팅을 이어 보이게).
// 요청마다 trace(단계별 시간·검색 후보·모델 제안과 서버 검증 결과·unverified 원인)를 traceSink에 넘긴다(docs/agent-observability.md).
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPublicSources } from "../../../llm/src/ironmaking-sources.js";
import { groundingSupport } from "../../../llm/src/grounding.js";
import { LearningFormatError, type LearningAgent, type ModelProposal, type SceneCatalog } from "../../../llm/src/learning-agent.js";
import { retrieveWithHistory, withScreenEquipment, type Retriever } from "../../../llm/src/retrieval.js";
import { runWithTrace, Trace, type TraceSink } from "../../../llm/src/trace.js";
import { LlmUnavailableError, SECTION_ORDER, type Section } from "../checkpoint/types.js";
import { currentUserId } from "../request-user.js";
import type { Rubric } from "../rubrics.js";
import { UsageLimitError } from "../usage.js";
import { keywordCard, keywordCardConcepts } from "./keywords.js";
import { latestPerConcept, type LearningRepository } from "./repository.js";
import { isSafetyQuestion, SAFETY_ANSWER } from "./safety.js";
import { findScreenMaterial, type ScreenStep } from "./screen-material.js";
import { normalizeQuestion, type AnswerCache, type AnswerKeyParts } from "./answer-cache.js";

/** 모델에 넘기는 같은 세션의 최근 대화 수. */
export const HISTORY_TURNS = 6;
/** 새로고침 때 다시 보여 주는 최근 대화 수. */
export const RESTORE_TURNS = 50;

const NOT_FOUND = { error: "대화를 찾지 못했어요. 새로 질문해 주세요." };

/** 자료 id → 화면에 보여 줄 출처. */
function toSources(sourceIds: string[]) {
  return getPublicSources(sourceIds).map(({ id, title, date, date_type, url, publisher }) => ({ id, title, date, date_type, url, publisher }));
}

/**
 * unverified 답의 원인(trace용). grounded·safety_redirect면 null.
 * - no_chunks: 검색된 근거가 없음(검색 부족)
 * - model_unverified: 근거는 있었지만 모델이 근거로 답할 수 없다고 함(근거 밖 질문이거나 근거가 맞지 않음)
 * - invalid_sources: 모델은 grounded라고 했지만 이번 검색 결과에 없는 조각만 인용해 서버가 unverified로 바꿈(출처 검증 실패)
 * - cached: 저장한 답을 씀(원인은 처음 받은 trace에 있음)
 */
export type UnverifiedReason = "no_chunks" | "model_unverified" | "invalid_sources" | "cached";
export function unverifiedReason(status: string, chunkCount: number, proposal: ModelProposal | null | "cached"): UnverifiedReason | null {
  if (status !== "unverified") return null;
  if (proposal === "cached") return "cached";
  if (chunkCount === 0) return "no_chunks";
  return proposal?.status === "grounded" ? "invalid_sources" : "model_unverified";
}

/** 오류 종류(trace용). 라우트가 돌려주는 HTTP 상태와 짝이 맞는다. */
function errorKind(error: unknown): string {
  if (error instanceof UsageLimitError) return "usage_limit";
  if (error instanceof LearningFormatError) return "format_error";
  if (error instanceof LlmUnavailableError) return error.status === 503 ? "llm_not_configured" : "llm_unavailable";
  return "internal";
}

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  session_id: z.string().uuid().optional(),
  screen: z
    .object({
      process_id: z.enum(SECTION_ORDER as [Section, ...Section[]]).optional().nullable(),
      equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/).optional().nullable(),
    })
    .optional(),
  /**
   * true면 NDJSON으로 답한다: 답을 받는 대로 {"type":"answer","text":지금까지의 답} 줄을 보내고,
   * 마지막에 {"type":"done","status":HTTP 상태,"body":평소 응답 본문} 한 줄로 끝낸다. 요청 형식 오류·세션 오류(400·404·409)는 평소처럼 JSON으로 답한다.
   */
  stream: z.boolean().optional(),
});

export interface LearningDeps {
  repo: LearningRepository;
  retriever: Retriever;
  agent: LearningAgent;
  rubrics: Rubric[];
  /** 화면 조작에 쓸 공정·설비 목록(scene-catalog.ts). 없으면 scene_actions는 항상 빈 배열이다. */
  scene?: SceneCatalog;
  /** 학습 화면의 설비 작동 단계 설명(screen-material.ts). 없으면 화면 안내를 하지 않는다. */
  screenSteps?: ScreenStep[];
  /**
   * 학습자의 체크포인트 상태(체크포인트 엔진의 sectionProgress, 실제 기록만). 루브릭이 없는 섹션이면 null.
   * 아직 만점이 아닌 개념은 튜터에 넘기고, 진행 중인 시도가 있으면 키워드 카드를 붙이지 않는다(정답 용어가 모여 있어서).
   */
  checkpointProgress?: (userId: string, section: Section) => { retry_concept_ids: string[]; in_progress: boolean } | null;
  /** 학습 답 저장(answer-cache.ts). 없으면 늘 모델을 부른다. */
  cache?: AnswerCache;
  /** 화면(공정 id, 전체 화면이면 null·설비 id)에 보이는 추천 질문. 추천 질문은 개인 기록이 있어도 저장한 답을 쓴다. */
  suggestedQuestions?: (processId: string | null, equipmentId: string | null) => string[];
  /** 요청마다 완성된 trace를 받는다(llm/src/trace.ts). 서버는 data/traces/*.jsonl에 쓰고, 없으면 남기지 않는다. */
  traceSink?: TraceSink;
  now?: () => string;
}

/** 미리 받아 둘 질문 하나(서버가 켜질 때 warmAnswers로 받는다). */
export interface WarmItem {
  processId: string | null;
  equipmentId: string | null;
  question: string;
}

export interface LearningRouter extends express.Router {
  /** 추천 질문 답을 차례로 미리 받아 저장한다(이미 있으면 건너뜀). 실패해도 멈추지 않는다. */
  warmAnswers(items: WarmItem[], options?: { onEach?: (item: WarmItem, result: "cached" | "saved" | "skipped" | "failed", ms: number) => void }): Promise<{ saved: number; cached: number; failed: number }>;
}

export function createLearningRouter({ repo, retriever, agent, rubrics, scene, screenSteps = [], checkpointProgress, cache, suggestedQuestions, traceSink, now = () => new Date().toISOString() }: LearningDeps): LearningRouter {
  const router = express.Router() as LearningRouter;

  /** 튜터 입력(근거 검색 포함). 실제 질문과 미리 받기(warm)가 같은 경로를 쓴다. */
  const prepare = (args: {
    section: Section; processId: string | null; equipmentId: string | null; question: string;
    history: { question: string; answer: string }[]; openMisconceptions: { concept_id: string; summary: string }[];
    retryConcepts: string[]; inProgress: boolean;
  }) => {
    const rubric = rubrics.find((r) => r.section === args.section);
    const screen = { process_id: args.section, equipment_id: args.equipmentId };
    const equipmentName = scene?.processes.flatMap((p) => p.equipment).find((e) => e.id === args.equipmentId)?.name ?? null;
    // '이 설비의 역할은?'처럼 화면의 설비를 가리키면 검색어에 설비 이름을 붙인다(withScreenEquipment).
    // "그 바람은 몇 도야?"처럼 앞 대화를 이어 묻는 질문은 직전 질문을 붙여 찾은 결과와 합친다(retrieveWithHistory, npm run eval:retrieval로 비교).
    const query = withScreenEquipment(args.question, equipmentName);
    const chunks = retrieveWithHistory(retriever, args.section, query, screen, args.history.at(-1));
    const input = {
      section: args.section,
      question: args.question,
      // 화면 조작은 실제 화면 기준이라 전체 공정 화면(process_id 없음)을 그대로 넘긴다.
      screen: { process_id: args.processId, equipment_id: args.equipmentId, equipment_name: equipmentName },
      chunks,
      history: args.history,
      openMisconceptions: args.openMisconceptions,
      concepts: rubric?.concepts.map((c) => ({ concept_id: c.concept_id, name: c.name })) ?? [],
      glossary: rubric?.glossary ?? [],
      scene,
      // 체크포인트 진행 중에는 카드를 고를 수 없게 목록을 비운다.
      keywordConcepts: args.inProgress ? [] : keywordCardConcepts(rubric),
      retryConcepts: args.retryConcepts,
      screenMaterial: findScreenMaterial(args.question, screenSteps, args.section),
    };
    const cacheKey: AnswerKeyParts = { section: args.section, processId: args.processId, equipmentId: args.equipmentId, question: args.question, chunkIds: chunks.map((c) => c.id) };
    return { rubric, chunks, input, cacheKey };
  };
  const isSuggested = (processId: string | null, equipmentId: string | null, question: string) =>
    (suggestedQuestions?.(processId, equipmentId) ?? []).some((q) => normalizeQuestion(q) === normalizeQuestion(question));

  router.warmAnswers = async (items, { onEach } = {}) => {
    const counts = { saved: 0, cached: 0, failed: 0 };
    for (const item of items) {
      const started = Date.now();
      const section: Section = (item.processId as Section | null) ?? "ironmaking";
      const { input, cacheKey } = prepare({ section, processId: item.processId, equipmentId: item.equipmentId, question: item.question, history: [], openMisconceptions: [], retryConcepts: [], inProgress: false });
      if (!cache || cache.has(cacheKey)) {
        counts.cached++;
        onEach?.(item, "cached", 0);
        continue;
      }
      try {
        const reply = await agent.reply(input);
        cache.set(cacheKey, reply);
        const saved = reply.status === "grounded";
        if (saved) counts.saved++; else counts.failed++;
        onEach?.(item, saved ? "saved" : "skipped", Date.now() - started);
      } catch {
        counts.failed++;
        onEach?.(item, "failed", Date.now() - started);
      }
    }
    return counts;
  };
  // 같은 세션에서 답변 중에 또 질문하면 막는다(대화 순서가 꼬이지 않게).
  const busy = new Set<string>();

  // 요청마다 trace(llm/src/trace.ts)를 만들어 단계별 시간·검색 후보·모델 제안·서버 검증 결과를 남긴다(docs/agent-observability.md).
  // 클라이언트가 X-Trace-Id를 보내면 그 id를 쓰고, 응답 헤더 X-Trace-Id와 본문 trace_id로 돌려준다.
  router.post("/api/chat", async (req, res) => {
    const trace = new Trace("learning", req.get("x-trace-id"));
    res.setHeader("X-Trace-Id", trace.id);
    try {
      await runWithTrace(trace, () => chat(req, res, trace));
    } finally {
      traceSink?.(trace.toRecord());
    }
  });

  const chat = async (req: express.Request, res: express.Response, trace: Trace) => {
    const body = ChatRequest.safeParse(req.body);
    if (!body.success) {
      trace.set("outcome", "bad_request");
      res.status(400).json({ error: "질문은 1~1000자로 입력해 주세요.", trace_id: trace.id });
      return;
    }
    const userId = currentUserId();
    const { question } = body.data;
    const section: Section = body.data.screen?.process_id ?? "ironmaking";
    const equipmentId = body.data.screen?.equipment_id ?? null;

    const sessionId = body.data.session_id ?? randomUUID();
    const stream = body.data.stream === true;
    // 질문 원문은 실패한 질문을 검색 평가 세트로 옮길 때 쓴다. 근거 원문·답 원문은 남기지 않는다(docs/agent-observability.md).
    trace.set("request", { session_id: sessionId, new_session: !body.data.session_id, section, process_id: body.data.screen?.process_id ?? null, equipment_id: equipmentId, question, stream });
    if (body.data.session_id) {
      // 없는 세션이나 다른 사람의 세션은 구분하지 않고 같은 답을 준다.
      if (repo.sessionOwner(sessionId) !== userId) {
        trace.set("outcome", "not_found");
        res.status(404).json({ ...NOT_FOUND, trace_id: trace.id });
        return;
      }
    }
    if (busy.has(sessionId)) {
      trace.set("outcome", "busy");
      res.status(409).json({ error: "이전 질문에 답하는 중이에요.", trace_id: trace.id });
      return;
    }
    busy.add(sessionId);
    // 스트리밍(stream: true)이면 여기부터 NDJSON으로 답한다. 오류도 마지막 done 줄의 status로 알린다.
    const startStream = () => {
      if (res.headersSent) return;
      res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders();
    };
    const send = (status: number, payload: object) => {
      trace.set("http_status", status);
      const withTrace = { ...payload, trace_id: trace.id };
      if (!stream) {
        res.status(status).json(withTrace);
        return;
      }
      startStream();
      res.end(`${JSON.stringify({ type: "done", status, body: withTrace })}\n`);
    };
    const onAnswer = stream ? (text: string) => {
      startStream();
      res.write(`${JSON.stringify({ type: "answer", text })}\n`);
    } : undefined;
    try {
      const base = { user_id: userId, session_id: sessionId, section, equipment_id: equipmentId, question };

      if (isSafetyQuestion(question)) {
        trace.set("outcome", "safety_redirect");
        trace.time("save", () => repo.saveTurn({ ...base, answer: SAFETY_ANSWER, status: "safety_redirect", source_ids: [] }, now()));
        send(200, { answer: SAFETY_ANSWER, status: "safety_redirect", sources: [], follow_up: null, scene_actions: [], keyword_card: null, session_id: sessionId });
        return;
      }

      const { progress, history, openMisconceptions } = trace.time("context", () => ({
        progress: checkpointProgress?.(userId, section) ?? null,
        history: repo.recentTurns(sessionId, HISTORY_TURNS).map((t) => ({ question: t.question, answer: t.answer })),
        // 개념당 최근 1개, 최대 5개(학습자 메모와 같은 기준). 프롬프트가 계속 길어지지 않게 한다.
        openMisconceptions: latestPerConcept(repo.openMisconceptions(userId, section)).map((m) => ({ concept_id: m.concept_id, summary: m.summary })),
      }));
      const retryConcepts = progress?.retry_concept_ids ?? [];
      const processId = body.data.screen?.process_id ?? null;
      const { rubric, chunks, input, cacheKey } = trace.time("retrieve", () =>
        prepare({ section, processId, equipmentId, question, history, openMisconceptions, retryConcepts, inProgress: !!progress?.in_progress }));
      trace.set("context", { history_turns: history.length, open_misconceptions: openMisconceptions.length, retry_concepts: retryConcepts.length, checkpoint_in_progress: !!progress?.in_progress });
      trace.set("retrieval", { count: chunks.length, results: chunks.map((c) => ({ id: c.id, score: c.score })) });

      // 저장한 답(answer-cache.ts): 개인 기록이 없는 질문이면 쓰고 저장한다. 추천 질문은 개인 기록이 있어도 저장한 답을 쓴다(저장은 하지 않음).
      const generic = history.length === 0 && openMisconceptions.length === 0 && retryConcepts.length === 0 && !progress?.in_progress;
      const suggested = isSuggested(processId, equipmentId, question);
      const hit = cache && (generic || suggested) ? cache.get(cacheKey) : null;
      trace.set("cache", !cache ? "off" : hit ? "hit" : generic || suggested ? "miss" : "personal");
      // 추천 질문은 오개념을 단정하는 질문이 아니므로 저장한 답의 오개념 감지는 쓰지 않는다.
      const reply = hit ? { ...hit, detected_misconception: generic ? hit.detected_misconception : null } : await trace.timeAsync("llm", () => agent.reply(input, { onAnswer }));
      if (!hit && generic) cache?.set(cacheKey, reply);

      trace.time("save", () => {
        const at = now();
        if (reply.detected_misconception) {
          repo.recordMisconception({ user_id: userId, section, concept_id: reply.detected_misconception.concept_id, answer_text: question, summary: reply.detected_misconception.summary }, at);
        }
        repo.saveTurn({ ...base, answer: reply.answer, status: reply.status, source_ids: reply.source_ids }, at);
      });

      // 조각 id(자료id#번호) → 자료 id → 화면에 보여 줄 출처.
      const citedChunks = chunks.filter((c) => reply.source_ids.includes(c.id));
      const sources = toSources(citedChunks.flatMap((c) => c.source_ids));
      const card = reply.keyword_card && !progress?.in_progress ? keywordCard(rubric, reply.keyword_card.concept_id) : null;
      const keyword_card = card && { concept_id: card.concept_id, name: card.name, keywords: card.keywords, source: card.source_id ? toSources([card.source_id])[0] ?? null : null };
      const proposal = (trace.fields.agent as { proposal?: ModelProposal | null } | undefined)?.proposal ?? null;
      trace.set("outcome", reply.status);
      trace.set("result", {
        status: reply.status,
        unverified_reason: unverifiedReason(reply.status, chunks.length, hit ? "cached" : proposal),
        source_ids: reply.source_ids,
        scene_actions: reply.scene_actions,
        misconception: reply.detected_misconception?.concept_id ?? null,
        keyword_card: keyword_card?.concept_id ?? null,
        answer_chars: reply.answer.length,
        follow_up: reply.follow_up !== null,
      });
      if (reply.status === "grounded") trace.set("grounding", groundingSupport(reply.answer, citedChunks.map((c) => c.text)));
      send(200, { answer: reply.answer, status: reply.status, sources, follow_up: reply.follow_up, scene_actions: reply.scene_actions, keyword_card, session_id: sessionId });
    } catch (error) {
      trace.set("error", { kind: errorKind(error), message: (error as Error)?.message ?? String(error) });
      trace.set("outcome", "error");
      if (error instanceof UsageLimitError) {
        send(429, { error: `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      } else if (error instanceof LlmUnavailableError) {
        console.error(`학습 모드 Gemini 오류(trace ${trace.id}): ${error.message}`);
        send(
          error.status,
          error.status === 503
            ? { error: "Gemini가 연결되지 않았어요. 서버에 GEMINI_API_KEY를 설정해 주세요.", code: "LLM_NOT_CONFIGURED" }
            : { error: "Gemini 연결 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요." },
        );
      } else if (error instanceof LearningFormatError) {
        console.error(`${error.message} (trace ${trace.id})`);
        send(502, { error: "답변을 처리하지 못했어요. 다시 시도해 주세요." });
      } else {
        console.error(`trace ${trace.id}:`, error);
        send(500, { error: "답변을 처리하지 못했어요. 다시 시도해 주세요." });
      }
    } finally {
      busy.delete(sessionId);
    }
  };

  // 저장된 대화(오래된 것부터 최근 RESTORE_TURNS개). 없는 세션·다른 사람의 세션은 POST와 같이 구분하지 않고 404.
  // follow_up·scene_actions·keyword_card는 저장하지 않으므로 돌려주지 않는다(다시 보여 줄 때 화면을 움직이지 않는다).
  router.get("/api/chat/sessions/:sessionId", (req, res) => {
    const sessionId = req.params.sessionId;
    if (!z.string().uuid().safeParse(sessionId).success || repo.sessionOwner(sessionId) !== currentUserId()) {
      res.status(404).json(NOT_FOUND);
      return;
    }
    const turns = repo.recentTurns(sessionId, RESTORE_TURNS).map((t) => ({
      question: t.question,
      answer: t.answer,
      status: t.status,
      section: t.section,
      equipment_id: t.equipment_id,
      sources: toSources(retriever.sourceIdsOf(t.section ?? "ironmaking", t.source_ids)),
    }));
    res.json({ session_id: sessionId, turns });
  });

  return router;
}
