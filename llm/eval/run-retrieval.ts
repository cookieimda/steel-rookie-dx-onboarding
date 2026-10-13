// 학습 모드 근거 검색 평가(npm run eval:retrieval). 모델을 부르지 않아 비용이 없다.
// 케이스마다 기대 출처(expected_source_ids) 중 하나가 상위 결과에 있는지(Recall@N)와 첫 기대 출처의 순위(MRR)를 잰다.
// 서버와 같이 루브릭 용어집(고로 = 용광로 등)으로 검색어를 넓힌다. 기대 출처가 빈 케이스는 검색 결과가 없어야 맞다.
// 세트는 단독 질문(ironmaking.jsonl)과 이어지는 질문(ironmaking-followup.jsonl, 직전 대화 history 포함) 두 개다.
// 이어지는 질문은 서버와 같은 retrieveWithHistory로 찾고, --follow-up으로 방식을 바꿔 비교한다.
// 실행 기록(--records)에는 방식, 세트별 결과, 자료 판(공개 자료 메모·section.md 해시)을 남긴다.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { Retriever, publicSourceChunks, retrieveWithHistory, type FollowUpStrategy, type Screen } from "../src/retrieval.js";
import { option, flag } from "./run-log.js";

const DIR = join(process.cwd(), "llm", "eval", "retrieval");
export const RETRIEVAL_SET_PATH = join(DIR, "ironmaking.jsonl");
export const FOLLOW_UP_SET_PATH = join(DIR, "ironmaking-followup.jsonl");
const STRATEGIES: FollowUpStrategy[] = ["empty-fallback", "pointing", "merge"];

export const RetrievalCase = z.object({
  id: z.string().min(1),
  section: z.enum(["ironmaking", "steelmaking", "continuous_casting", "rolling"]),
  query: z.string().min(1),
  screen: z.object({ process_id: z.string().optional(), equipment_id: z.string().optional() }).optional(),
  /** 이어지는 질문의 직전 대화(오래된 것부터). 마지막 턴만 검색에 쓴다. */
  history: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).optional(),
  expected_source_ids: z.array(z.string()),
});
export type RetrievalCase = z.infer<typeof RetrievalCase>;

export function loadRetrievalSet(path = RETRIEVAL_SET_PATH): RetrievalCase[] {
  const rows = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim())
    .map(({ line, index }) => {
      const parsed = RetrievalCase.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`${path}:${index + 1} 형식 오류`);
      return parsed.data;
    });
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`${path}: 케이스 id가 겹칩니다: ${row.id}`);
    ids.add(row.id);
  }
  return rows;
}

export interface RetrievalScore {
  id: string;
  expected: string[];
  retrieved: string[];
  hit: boolean;
  reciprocalRank: number;
}

export function scoreRetrieval(c: RetrievalCase, retriever: Retriever, strategy: FollowUpStrategy = "merge"): RetrievalScore {
  const results = retrieveWithHistory(retriever, c.section, c.query, (c.screen ?? {}) as Screen, c.history?.at(-1), strategy);
  const expected = new Set(c.expected_source_ids);
  const retrieved = [...new Set(results.flatMap((r) => r.source_ids))];
  const rank = results.findIndex((r) => r.source_ids.some((id) => expected.has(id)));
  return { id: c.id, expected: [...expected], retrieved, hit: expected.size === 0 ? results.length === 0 : rank >= 0, reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0 };
}

export function summarize(scores: RetrievalScore[]): { cases: number; hits: number; mrr: number } {
  return { cases: scores.length, hits: scores.filter((s) => s.hit).length, mrr: scores.length ? scores.reduce((sum, s) => sum + s.reciprocalRank, 0) / scores.length : 0 };
}

function pct(value: number, total: number): string {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "-";
}

/** 검색 자료의 판: 공개 자료 메모와 section.md 내용의 해시. 결과를 비교할 때 자료가 같은지 본다. */
function materialVersion(): string {
  const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  const root = process.cwd();
  return createHash("sha256").update(read(join(root, "backend", "data", "ironmaking-sources.json")))
    .update(read(join(root, "content", "materials", "ironmaking", "section.md"))).digest("hex").slice(0, 12);
}

function main(): void {
  const sets = { 단독: loadRetrievalSet(), 이어지는: loadRetrievalSet(FOLLOW_UP_SET_PATH) };
  const ranking = option("ranking", "idf");
  if (ranking !== "idf" && ranking !== "overlap") throw new Error("--ranking은 idf 또는 overlap입니다.");
  const strategy = option("follow-up", "merge") as FollowUpStrategy;
  if (!STRATEGIES.includes(strategy)) throw new Error(`--follow-up은 ${STRATEGIES.join(", ")} 중 하나입니다.`);
  const maxResults = Number(option("max-results", "5"));
  const rubrics = loadFinalRubrics();
  const retriever = new Retriever({ ranking, maxResults,
    glossaryFor: (s) => rubrics.find((r) => r.section === s)?.glossary ?? [],
    // --public-only: section.md 없이 공개 자료 메모만(section.md 효과 비교용).
    ...(flag("public-only") ? { chunksFor: (s) => publicSourceChunks().filter((c) => c.section === s) } : {}),
  });
  const report: Record<string, { cases: number; hits: number; mrr: number; scores: RetrievalScore[] }> = {};
  let allHit = true;
  console.log(`검색: ${ranking} · 이어지는 질문: ${strategy} · 자료 판 ${materialVersion()}`);
  for (const [name, cases] of Object.entries(sets)) {
    const scores = cases.map((c) => scoreRetrieval(c, retriever, strategy));
    const s = summarize(scores);
    report[name] = { ...s, scores };
    allHit &&= s.hits === s.cases;
    console.log(`\n[${name} 질문] ${s.cases}개 · Recall@${maxResults} ${s.hits}/${s.cases} (${pct(s.hits, s.cases)}) · MRR ${s.mrr.toFixed(3)}`);
    for (const miss of scores.filter((x) => !x.hit)) console.log(`- ${miss.id}: 기대 ${miss.expected.join(", ") || "빈 결과"} / 검색 ${miss.retrieved.join(", ") || "빈 결과"}`);
  }
  const path = option("records", "");
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ranking, follow_up: strategy, max_results: maxResults, public_only: flag("public-only"), material_version: materialVersion(),
      sets: report, at: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  }
  if (!allHit) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("run-retrieval.js")) main();
