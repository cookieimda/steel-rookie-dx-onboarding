// 학습 모드 API: POST /api/chat. 흐름은 docs/learning-mode.md '흐름'.
// 안전 질문 차단 → retrieve() → 최근 대화·미해결 오개념·체크포인트 재도전 개념 → 튜터 1회 → 오개념 기록(source=learning) → 대화 저장.
// 튜터가 고른 키워드 카드는 루브릭에서 내용을 꺼내 붙인다(keywords.ts). 체크포인트 진행 중에는 붙이지 않는다.
// 예전 /api/chat(제선 Q&A, 지금은 삭제)의 요청·응답 필드는 유지하고 screen, follow_up, scene_actions를 더했다.
// GET /api/chat/sessions/:sessionId: 저장된 대화(페이지를 새로고침해도 채팅을 이어 보이게).
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPublicSources } from "../../../llm/src/ironmaking-sources.js";
import { LearningFormatError, type LearningAgent, type SceneCatalog } from "../../../llm/src/learning-agent.js";
import { withScreenEquipment, type Retriever } from "../../../llm/src/retrieval.js";
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

const ChatRequest = z.object({
  question: z.string().trim().min(1).max(1000),
  session_id: z.string().uuid().optional(),
  screen: z
    .object({
      process_id: z.enum(SECTION_ORDER as [Section, ...Section[]]).optional().nullable(),
      equipment_id: z.string().regex(/^[a-z0-9_]{1,40}$/).optional().nullable(),
    })
    .optional(),
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

export function createLearningRouter({ repo, retriever, agent, rubrics, scene, screenSteps = [], checkpointProgress, cache, suggestedQuestions, now = () => new Date().toISOString() }: LearningDeps): LearningRouter {
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
    // "그럼 그건요?"처럼 가리키는 말만 있는 후속 질문은 검색어가 없으므로, 질문만으로 못 찾으면 직전 대화를 붙여 다시 찾는다.
    const query = withScreenEquipment(args.question, equipmentName);
    let chunks = retriever.retrieve(args.section, query, screen);
    const last = args.history.at(-1);
    if (chunks.length === 0 && last) chunks = retriever.retrieve(args.section, `${query} ${last.question} ${last.answer}`, screen);
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

  router.post("/api/chat", async (req, res) => {
    const body = ChatRequest.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "질문은 1~1000자로 입력해 주세요." });
      return;
    }
    const userId = currentUserId();
    const { question } = body.data;
    const section: Section = body.data.screen?.process_id ?? "ironmaking";
    const equipmentId = body.data.screen?.equipment_id ?? null;

    const sessionId = body.data.session_id ?? randomUUID();
    if (body.data.session_id) {
      // 없는 세션이나 다른 사람의 세션은 구분하지 않고 같은 답을 준다.
      if (repo.sessionOwner(sessionId) !== userId) {
        res.status(404).json(NOT_FOUND);
        return;
      }
    }
    if (busy.has(sessionId)) {
      res.status(409).json({ error: "이전 질문에 답하는 중이에요." });
      return;
    }
    busy.add(sessionId);
    try {
      const base = { user_id: userId, session_id: sessionId, section, equipment_id: equipmentId, question };

      if (isSafetyQuestion(question)) {
        repo.saveTurn({ ...base, answer: SAFETY_ANSWER, status: "safety_redirect", source_ids: [] }, now());
        res.json({ answer: SAFETY_ANSWER, status: "safety_redirect", sources: [], follow_up: null, scene_actions: [], keyword_card: null, session_id: sessionId });
        return;
      }

      const progress = checkpointProgress?.(userId, section) ?? null;
      const history = repo.recentTurns(sessionId, HISTORY_TURNS).map((t) => ({ question: t.question, answer: t.answer }));
      // 개념당 최근 1개, 최대 5개(학습자 메모와 같은 기준). 프롬프트가 계속 길어지지 않게 한다.
      const openMisconceptions = latestPerConcept(repo.openMisconceptions(userId, section)).map((m) => ({ concept_id: m.concept_id, summary: m.summary }));
      const retryConcepts = progress?.retry_concept_ids ?? [];
      const processId = body.data.screen?.process_id ?? null;
      const { rubric, chunks, input, cacheKey } = prepare({ section, processId, equipmentId, question, history, openMisconceptions, retryConcepts, inProgress: !!progress?.in_progress });

      // 저장한 답(answer-cache.ts): 개인 기록이 없는 질문이면 쓰고 저장한다. 추천 질문은 개인 기록이 있어도 저장한 답을 쓴다(저장은 하지 않음).
      const generic = history.length === 0 && openMisconceptions.length === 0 && retryConcepts.length === 0 && !progress?.in_progress;
      const suggested = isSuggested(processId, equipmentId, question);
      const hit = cache && (generic || suggested) ? cache.get(cacheKey) : null;
      // 추천 질문은 오개념을 단정하는 질문이 아니므로 저장한 답의 오개념 감지는 쓰지 않는다.
      const reply = hit ? { ...hit, detected_misconception: generic ? hit.detected_misconception : null } : await agent.reply(input);
      if (!hit && generic) cache?.set(cacheKey, reply);

      const at = now();
      if (reply.detected_misconception) {
        repo.recordMisconception({ user_id: userId, section, concept_id: reply.detected_misconception.concept_id, answer_text: question, summary: reply.detected_misconception.summary }, at);
      }
      repo.saveTurn({ ...base, answer: reply.answer, status: reply.status, source_ids: reply.source_ids }, at);

      // 조각 id(자료id#번호) → 자료 id → 화면에 보여 줄 출처.
      const cited = chunks.filter((c) => reply.source_ids.includes(c.id)).flatMap((c) => c.source_ids);
      const sources = toSources(cited);
      const card = reply.keyword_card && !progress?.in_progress ? keywordCard(rubric, reply.keyword_card.concept_id) : null;
      const keyword_card = card && { concept_id: card.concept_id, name: card.name, keywords: card.keywords, source: card.source_id ? toSources([card.source_id])[0] ?? null : null };
      res.json({ answer: reply.answer, status: reply.status, sources, follow_up: reply.follow_up, scene_actions: reply.scene_actions, keyword_card, session_id: sessionId });
    } catch (error) {
      if (error instanceof UsageLimitError) {
        res.status(429).json({ error: `오늘 쓸 수 있는 튜터 호출(${error.limit}회)을 다 썼어요.`, code: "USAGE_LIMIT" });
      } else if (error instanceof LlmUnavailableError) {
        console.error(`학습 모드 Gemini 오류: ${error.message}`);
        res.status(error.status).json(
          error.status === 503
            ? { error: "Gemini가 연결되지 않았어요. 서버에 GEMINI_API_KEY를 설정해 주세요.", code: "LLM_NOT_CONFIGURED" }
            : { error: "Gemini 연결 중 오류가 생겼어요. 잠시 후 다시 시도해 주세요." },
        );
      } else if (error instanceof LearningFormatError) {
        console.error(error.message);
        res.status(502).json({ error: "답변을 처리하지 못했어요. 다시 시도해 주세요." });
      } else {
        console.error(error);
        res.status(500).json({ error: "답변을 처리하지 못했어요. 다시 시도해 주세요." });
      }
    } finally {
      busy.delete(sessionId);
    }
  });

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
