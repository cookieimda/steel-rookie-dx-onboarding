// 학습 모드 답 저장(캐시). 같은 화면·같은 질문·같은 근거면 모델을 다시 부르지 않고 저장한 답을 돌려준다.
// - 로컬 모델(Ollama)은 답 하나에 30초 넘게 걸리고, 발표 컴퓨터가 정해지지 않아서 추천 질문(칩) 답을 서버가 켜질 때 미리 받아 둔다(warm).
// - 키: 버전(모델·프롬프트) + 공정·화면 공정·설비 + 질문(공백 정리) + 검색한 근거 조각 id. 모델·프롬프트·자료가 바뀌면 자연히 다른 키가 된다.
// - 개인화: 대화 이력·학습자 메모·체크포인트 재도전 개념이 있으면 답이 달라질 수 있어 저장한 답을 쓰지 않는다. 추천 질문(칩)은 예외로 늘 쓴다.
// - 파일(data/answer-cache.json, Git 제외)에 남겨 서버를 다시 켜도 유지한다. 파일을 못 읽거나 못 쓰면 메모리로만 동작한다.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LearningReply } from "../../../llm/src/learning-agent.js";

export interface AnswerKeyParts {
  section: string;
  processId: string | null;
  equipmentId: string | null;
  question: string;
  chunkIds: string[];
}

/** 저장할 답 수 상한(오래된 것부터 버린다). */
const MAX_ENTRIES = 500;

export const normalizeQuestion = (q: string) => q.normalize("NFC").replace(/\s+/g, " ").trim();

export class AnswerCache {
  private readonly entries = new Map<string, LearningReply>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** version: 모델·프롬프트가 바뀌면 달라지는 문자열. file: 남길 파일(없으면 메모리만). */
  constructor(private readonly version: string, private readonly file: string | null = null) {
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { version?: string; entries?: [string, LearningReply][] };
      // 키에 버전이 들어 있지만, 다른 버전 파일이면 통째로 버려 파일이 계속 커지지 않게 한다.
      if (saved.version === version) for (const [k, v] of saved.entries ?? []) this.entries.set(k, v);
    } catch (e) {
      console.warn(`학습 답 저장 파일을 읽지 못했습니다(${file}): ${(e as Error).message}`);
    }
  }

  key(parts: AnswerKeyParts): string {
    const raw = JSON.stringify([this.version, parts.section, parts.processId, parts.equipmentId, normalizeQuestion(parts.question), [...parts.chunkIds].sort()]);
    return createHash("sha256").update(raw).digest("hex").slice(0, 32);
  }

  get(parts: AnswerKeyParts): LearningReply | null {
    return this.entries.get(this.key(parts)) ?? null;
  }

  has(parts: AnswerKeyParts): boolean {
    return this.entries.has(this.key(parts));
  }

  /** 근거 있는 답만 저장한다(형식 오류·근거 없는 답은 다음에 다시 물어본다). */
  set(parts: AnswerKeyParts, reply: LearningReply): void {
    if (reply.status !== "grounded") return;
    const k = this.key(parts);
    this.entries.delete(k);
    this.entries.set(k, reply);
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    this.scheduleSave();
  }

  get size(): number {
    return this.entries.size;
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        mkdirSync(dirname(this.file!), { recursive: true });
        writeFileSync(this.file!, JSON.stringify({ version: this.version, entries: [...this.entries] }));
      } catch (e) {
        console.warn(`학습 답 저장 파일을 쓰지 못했습니다(${this.file}): ${(e as Error).message}`);
      }
    }, 500);
    this.saveTimer.unref?.();
  }
}

/** 모델 이름과 프롬프트 내용으로 버전을 만든다. 프롬프트를 고치면 저장한 답을 다시 받는다. */
export function answerCacheVersion(model: string, promptTexts: string[]): string {
  return `${model}:${createHash("sha256").update(promptTexts.join("\u0000")).digest("hex").slice(0, 12)}`;
}
