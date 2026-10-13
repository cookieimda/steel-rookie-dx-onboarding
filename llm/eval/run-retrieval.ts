// 학습 모드 근거 검색 평가(npm run eval:retrieval). 모델을 부르지 않아 비용이 없다.
// 케이스마다 기대 출처(expected_source_ids) 중 하나가 상위 결과에 있는지(Recall@N)와 첫 기대 출처의 순위(MRR)를 잰다.
// 서버와 같이 루브릭 용어집(고로 = 용광로 등)으로 검색어를 넓힌다. 기대 출처가 빈 케이스는 검색 결과가 없어야 맞다.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { Retriever, publicSourceChunks, type Screen } from "../src/retrieval.js";
import { option, flag } from "./run-log.js";

export const RETRIEVAL_SET_PATH = join(process.cwd(), "llm", "eval", "retrieval", "ironmaking.jsonl");

export const RetrievalCase = z.object({
  id: z.string().min(1),
  section: z.enum(["ironmaking", "steelmaking", "continuous_casting", "rolling"]),
  query: z.string().min(1),
  screen: z.object({ process_id: z.string().optional(), equipment_id: z.string().optional() }).optional(),
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

export function scoreRetrieval(c: RetrievalCase, retriever: Retriever): RetrievalScore {
  const results = retriever.retrieve(c.section, c.query, (c.screen ?? {}) as Screen);
  const expected = new Set(c.expected_source_ids);
  const retrieved = [...new Set(results.flatMap((r) => r.source_ids))];
  const rank = results.findIndex((r) => r.source_ids.some((id) => expected.has(id)));
  return { id: c.id, expected: [...expected], retrieved, hit: expected.size === 0 ? results.length === 0 : rank >= 0, reciprocalRank: rank >= 0 ? 1 / (rank + 1) : 0 };
}

function pct(value: number, total: number): string {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "-";
}

function main(): void {
  const cases = loadRetrievalSet();
  const ranking = option("ranking", "idf");
  if (ranking !== "idf" && ranking !== "overlap") throw new Error("--ranking은 idf 또는 overlap입니다.");
  const maxResults = Number(option("max-results", "5"));
  const rubrics = loadFinalRubrics();
  const retriever = new Retriever({ ranking, maxResults,
    glossaryFor: (s) => rubrics.find((r) => r.section === s)?.glossary ?? [],
    // --public-only: section.md 없이 공개 자료 메모만(section.md 효과 비교용).
    ...(flag("public-only") ? { chunksFor: (s) => publicSourceChunks().filter((c) => c.section === s) } : {}),
  });
  const scores = cases.map((c) => scoreRetrieval(c, retriever));
  const hits = scores.filter((s) => s.hit).length;
  const mrr = scores.reduce((sum, s) => sum + s.reciprocalRank, 0) / scores.length;
  console.log(`검색 세트: ${cases.length}개`);
  console.log(`Recall@${maxResults}(케이스): ${hits}/${cases.length} (${pct(hits, cases.length)})`);
  console.log(`MRR: ${mrr.toFixed(3)}`);
  for (const miss of scores.filter((s) => !s.hit)) console.log(`- ${miss.id}: 기대 ${miss.expected.join(", ") || "빈 결과"} / 검색 ${miss.retrieved.join(", ") || "빈 결과"}`);
  const path = option("records", "");
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ranking, max_results: maxResults, public_only: flag("public-only"), cases: cases.length,
      hits, mrr, scores, at: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
  }
  if (hits !== cases.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("run-retrieval.js")) main();
