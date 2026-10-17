// LLM provider 고르기: LLM_PROVIDER=gemini(기본)|ollama. 서버·평가 스크립트가 여기서 클라이언트를 만든다.
// 튜터·평가자·학습 에이전트는 LlmClient 계약만 알고 provider를 모른다. provider별로 다른 설정(짧은 프롬프트, 채점 보강)은 profileFor()로 고른다.
// Gemini 서버에서 일부 일만 로컬 모델에 먼저 맡기는 섞어 쓰기는 localTasks()·localFirstClient().
// 설계는 docs/llm-providers.md.
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { DEFAULT_GEMINI_MODEL, GeminiClient, type GeminiOptions } from "./gemini.js";
import type { LlmClient } from "./llm-client.js";
import { OllamaClient, ollamaSettings, type OllamaOptions } from "./ollama.js";

export const LLM_PROVIDERS = ["gemini", "ollama"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * LLM_PROVIDER 값. 비어 있으면 gemini, 모르는 값이면 예외(서버가 시작하지 않는다).
 * PRIVATE_LLM_ONLY=1이면 외부 API(Gemini)를 쓰지 않는다: gemini로 정해져 있으면 예외(학습자 답이 밖으로 나가지 않게 실수로 켜는 것을 막는다).
 */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const value = (env.LLM_PROVIDER ?? "").trim().toLowerCase() || "gemini";
  if (!(LLM_PROVIDERS as readonly string[]).includes(value)) throw new Error(`LLM_PROVIDER는 ${LLM_PROVIDERS.join("|")} 중 하나입니다: ${value}`);
  if (env.PRIVATE_LLM_ONLY === "1" && value === "gemini") throw new Error("PRIVATE_LLM_ONLY=1이면 Gemini를 쓸 수 없습니다. LLM_PROVIDER=ollama로 정해 주세요.");
  return value as LlmProvider;
}

export interface ProviderInfo {
  provider: LlmProvider;
  model: string;
  /** trace·답 저장·평가 기록에서 쓰는 이름(예: gemini:gemini-3.5-flash-lite, ollama:qwen2.5:3b). */
  label: string;
}

export function providerInfo(env: NodeJS.ProcessEnv = process.env): ProviderInfo {
  const provider = configuredProvider(env);
  const model = provider === "ollama" ? (env.OLLAMA_MODEL || ollamaSettings().model) : (env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
  return { provider, model, label: `${provider}:${model}` };
}

export interface LlmFactoryOptions {
  gemini?: GeminiOptions;
  ollama?: OllamaOptions;
  /** 두 provider에 같이 넣는 호출 직전 훅(사용자별 호출 수 제한). */
  beforeCall?: () => void;
}

export function createLlmClient(options: LlmFactoryOptions = {}, env: NodeJS.ProcessEnv = process.env): LlmClient {
  const before = options.beforeCall ? { beforeCall: options.beforeCall } : {};
  return configuredProvider(env) === "ollama"
    ? new OllamaClient({ ...before, ...options.ollama })
    : new GeminiClient({ ...before, ...options.gemini });
}

/**
 * Gemini 서버에서 로컬 모델(Ollama)에 먼저 맡기는 일(LLM_LOCAL_TASKS, 쉼표로 여러 개). Gemini 호출을 줄이려고 쓴다.
 * - practice: 보충학습 확인 문제 만들기. 점수에 들어가지 않고, 유출 검사에 두 번 걸리면 고정 문장을 쓴다.
 * - summary: 관리자 AI 요약. 숫자를 그대로 옮겼는지 검사하지 않아 시연 서버 기본에는 넣지 않는다.
 * 채점·학습 답·부가 설명·시험 질문은 로컬 모델과 품질 차이가 커서 넣지 않는다. 시험 질문 말투 다듬기는 로컬 3B가 뜻을 바꾸거나 군말을 붙여서
 * 로컬에 맡기지 않고 끈다(QUESTION_POLISH=off, docs/llm-providers.md '섞어 쓰기').
 */
export const LOCAL_TASKS = ["practice", "summary"] as const;
export type LocalTask = (typeof LOCAL_TASKS)[number];

/** LLM_LOCAL_TASKS 값. 서버 전체가 Ollama면 이미 모두 로컬이라 빈 목록이다. 모르는 이름이면 예외(서버가 시작하지 않는다). */
export function localTasks(env: NodeJS.ProcessEnv = process.env): Set<LocalTask> {
  if (configuredProvider(env) === "ollama") return new Set();
  const names = (env.LLM_LOCAL_TASKS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && s !== "off");
  const unknown = names.filter((n) => !(LOCAL_TASKS as readonly string[]).includes(n));
  if (unknown.length) throw new Error(`LLM_LOCAL_TASKS는 ${LOCAL_TASKS.join(",")} 중에서 고릅니다: ${unknown.join(", ")}`);
  return new Set(names as LocalTask[]);
}

export interface LocalFirstOptions {
  /** 로컬 모델이 실패한 뒤 이 시간(ms) 동안은 Gemini로 바로 보낸다. 꺼진 Ollama를 호출마다 기다리지 않게 한다. */
  cooldownMs?: number;
  now?: () => number;
  onFallback?: (error: LlmUnavailableError) => void;
}

/**
 * 로컬 모델에 먼저 묻고, 연결 실패·시간 초과·HTTP 오류(LlmUnavailableError)면 같은 요청을 fallback(Gemini)에 다시 묻는다.
 * 시연 컴에 Ollama가 없거나 꺼져 있어도 섞기 전처럼 Gemini로 돈다. 시험 작업 취소(req.signal)로 끊긴 호출은 넘기지 않는다.
 * 하루 호출 한도(beforeCall)는 fallback에만 건다: 한도는 유료 호출을 막는 장치이고 로컬 호출은 비용이 없다.
 */
export function localFirstClient(local: LlmClient, fallback: LlmClient, options: LocalFirstOptions = {}): LlmClient {
  const cooldownMs = options.cooldownMs ?? 5 * 60_000;
  const now = options.now ?? Date.now;
  let downUntil = 0;
  return {
    async generate(req) {
      if (now() < downUntil) return fallback.generate(req);
      try {
        return await local.generate(req);
      } catch (error) {
        if (req.signal?.aborted || !(error instanceof LlmUnavailableError)) throw error;
        downUntil = now() + cooldownMs;
        options.onFallback?.(error);
        return fallback.generate(req);
      }
    },
  };
}

/**
 * provider별 에이전트 설정.
 * - learning: 학습 튜터 프롬프트. 로컬 3B 모델은 긴 프롬프트에서 형식이 자주 깨지고 느려서 짧은 프롬프트·줄인 맥락(compact)을 쓴다.
 * - evaluatorGuards: 채점 보강(evaluator.ts의 repairFormat·verifyBoundary). 로컬 모델의 형식 오류·부분 정답→오답을 줄인다. Gemini는 끈다.
 * - groundingCheck: 근거와 겹치는 문장이 하나도 없는 학습 답을 unverified로 낮춘다(grounding.ts lowSupport). 로컬 3B가 근거 밖 수치를 지어내서 켠다.
 *   Gemini는 같은 기준에서 맞는 답을 1개 낮춰서(10/06 제선 28개 중 overview-bf) 끈다.
 */
export function profileFor(provider: LlmProvider): { learning: "full" | "compact"; evaluatorGuards: boolean; groundingCheck: boolean } {
  return provider === "ollama"
    ? { learning: "compact", evaluatorGuards: true, groundingCheck: true }
    : { learning: "full", evaluatorGuards: false, groundingCheck: false };
}
