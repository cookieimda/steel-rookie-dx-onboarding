// 관리자 대시보드 "AI 요약": 오답률 높은 개념의 집계 숫자만 받아 보강할 내용을 1~2문장으로 정리한다.
// 답변 원문·오개념 설명·사용자 id는 입력에 없다(docs/admin-dashboard.md '개인정보').
import { escapeDelimited, renderPrompt, type LlmClient } from "./gemini.js";

/** 한 개념의 집계. 숫자와 개념·공정 이름만 담는다. */
export interface SummaryConcept {
  section_name: string;
  name: string;
  asked: number;
  partial: number;
  wrong: number;
  assisted: number;
  final_wrong: number;
  open: number;
}

export interface AdminSummarizer {
  summarize(concepts: readonly SummaryConcept[]): Promise<string>;
}

export class AdminSummaryFormatError extends Error {}

const MAX_ATTEMPTS = 2;
export const MAX_SUMMARY_LENGTH = 300;

const pct = (n: number, d: number) => `${Math.round((n / d) * 100)}%`;

/** 집계표. 개념 이름은 루브릭에서 오지만 구분자를 깨지 못하게 이스케이프한다. */
export function summaryPrompt(concepts: readonly SummaryConcept[]): string {
  const rows = concepts.map((c, i) =>
    `${i + 1}. [${escapeDelimited(c.section_name)}] ${escapeDelimited(c.name)} | 출제 ${c.asked}회 | 오답률 ${pct(c.partial + c.wrong + c.assisted, c.asked)}`
    + ` (틀림 ${c.wrong}, 부분 정답 ${c.partial}, 힌트 요청 ${c.assisted}) | 재확인 후에도 틀림 ${c.final_wrong} | 미해결 오개념 ${c.open}`);
  return `오답률 높은 개념(첫 답변 기준, 높은 순):\n<stats>\n${rows.join("\n")}\n</stats>`;
}

/** 응답 JSON에서 요약 문장을 꺼낸다. 형식이 틀리면 이유 문자열. */
export function parseSummary(text: string): string | { problem: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: "JSON이 아님" };
  }
  const summary = (value as { summary?: unknown })?.summary;
  if (typeof summary !== "string" || !summary.trim()) return { problem: "summary가 비어 있음" };
  const trimmed = summary.trim();
  if (trimmed.length > MAX_SUMMARY_LENGTH) return { problem: `summary가 ${MAX_SUMMARY_LENGTH}자를 넘음` };
  return trimmed;
}

export class GeminiAdminSummarizer implements AdminSummarizer {
  constructor(private readonly gemini: LlmClient) {}

  async summarize(concepts: readonly SummaryConcept[]): Promise<string> {
    const request = {
      system: renderPrompt("admin-summary", {}),
      prompt: summaryPrompt(concepts),
      temperature: 0.3,
      maxOutputTokens: 400,
      responseSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    };
    let problem = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 연결·HTTP 오류(LlmUnavailableError)는 그대로 올려 보낸다. 형식 오류만 다시 부른다.
      const result = parseSummary(await this.gemini.generate(request));
      if (typeof result === "string") return result;
      problem = result.problem;
    }
    throw new AdminSummaryFormatError(`AI 요약 응답 형식 오류(${MAX_ATTEMPTS}회): ${problem}`);
  }
}
