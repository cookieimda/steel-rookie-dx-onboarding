// LLM provider 고르기: LLM_PROVIDER=gemini(기본)|ollama. 서버·평가 스크립트가 여기서 클라이언트를 만든다.
// 튜터·평가자·학습 에이전트는 LlmClient 계약만 알고 provider를 모른다. provider별로 다른 설정(짧은 프롬프트, 채점 보강)은 profileFor()로 고른다.
// 설계는 docs/llm-providers.md.
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
 * provider별 에이전트 설정.
 * - learning: 학습 튜터 프롬프트. 로컬 3B 모델은 긴 프롬프트에서 형식이 자주 깨지고 느려서 짧은 프롬프트·줄인 맥락(compact)을 쓴다.
 * - evaluatorGuards: 채점 보강(evaluator.ts의 repairFormat·verifyBoundary). 로컬 모델의 형식 오류·부분 정답→오답을 줄인다. Gemini는 끈다.
 */
export function profileFor(provider: LlmProvider): { learning: "full" | "compact"; evaluatorGuards: boolean } {
  return provider === "ollama" ? { learning: "compact", evaluatorGuards: true } : { learning: "full", evaluatorGuards: false };
}
