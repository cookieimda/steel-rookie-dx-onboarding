// 학습 모드 trace 요약: 서버가 남긴 data/traces/learning-*.jsonl(llm/src/trace.ts)을 읽어 실패 원인·지연·호출·검증 결과를 센다.
// 실행: npm run trace:report [-- --dir data/traces] [--since 2026-10-15] [--until 2026-10-31] [--list 10]
// 모델을 부르지 않는다(무료). 지표 정의는 docs/agent-observability.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceRecord } from "../src/trace.js";
import { option } from "./run-log.js";

interface Proposal { status: string; source_ids: string[]; scene_actions: { type: string; target_id: string }[]; misconception: string | null; keyword_card: string | null }
interface LearningTrace extends TraceRecord {
  outcome?: string;
  first_text_ms?: number;
  http_status?: number;
  cache?: string;
  request?: { question?: string; section?: string; equipment_id?: string | null; stream?: boolean };
  retrieval?: { count: number; results: { id: string; score: number }[] };
  agent?: { prompt_chars: number; retries: string[]; format_problems: string[]; proposal: Proposal | null };
  result?: { status: string; unverified_reason: string | null; source_ids: string[]; scene_actions: { type: string; target_id: string }[]; misconception: string | null; keyword_card: string | null };
  grounding?: { sentences: number; supported: number; rate: number | null; weakest: { text: string; overlap: number } | null };
  error?: { kind: string; message: string };
}

/** 정렬한 값의 q 분위수(가까운 순위). 값이 없으면 null. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

const countBy = <T>(items: T[], key: (item: T) => string | null | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

const latency = (values: (number | undefined)[]) => {
  const v = values.filter((x): x is number => typeof x === "number");
  return { n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95) };
};

export interface TraceSummary {
  requests: number;
  outcomes: Record<string, number>;
  unverified_reasons: Record<string, number>;
  errors: Record<string, number>;
  cache: Record<string, number>;
  latency_ms: Record<string, { n: number; p50: number | null; p95: number | null }>;
  llm: { requests_with_calls: number; calls: number; failed_calls: number; retries: Record<string, number>; format_problems: number; tokens_per_grounded: number | null; prompt_chars_p50: number | null };
  retrieval: { requests: number; zero_results: number; top_score_p50: number | null };
  validation: {
    /** 모델이 낸 source id 중 이번 검색 결과에 없어 버린 것. */
    dropped_source_ids: number;
    proposed_source_ids: number;
    /** 모델이 낸 화면 조작 수 / 서버 검증 뒤 남은 수. */
    proposed_scene_actions: number;
    final_scene_actions: number;
    /** 모델은 조작을 내지 않았는데 질문 속 설비 이름으로 서버가 붙인 답 수. */
    scene_added_by_name: number;
    misconception_dropped: number;
    keyword_card_dropped: number;
  };
  grounding: { answers: number; fully_supported: number; mean_rate: number | null; low: { trace_id: string; question: string; rate: number; weakest: string; overlap: number }[] };
  unverified_questions: { trace_id: string; reason: string; question: string; top_score: number | null }[];
}

export function summarizeTraces(records: LearningTrace[], listLimit = 10): TraceSummary {
  const answered = records.filter((r) => r.result);
  const withAgent = records.filter((r) => r.agent);
  const proposals = answered.filter((r) => r.agent?.proposal);
  const grounded = answered.filter((r) => r.result!.status === "grounded" && r.cache !== "hit");
  const groundingRows = records.filter((r) => r.grounding && r.grounding.rate !== null);
  const groundedTokens = grounded.filter((r) => r.llm_tokens !== null && r.llm_tokens !== undefined);
  const stageNames = [...new Set(records.flatMap((r) => Object.keys(r.stages ?? {})))];
  const retrievals = records.filter((r) => r.retrieval);

  let dropped = 0, proposedSources = 0, proposedScene = 0, finalScene = 0, addedByName = 0, misDropped = 0, cardDropped = 0;
  for (const r of proposals) {
    const p = r.agent!.proposal!;
    const res = r.result!;
    proposedSources += p.source_ids.length;
    dropped += p.source_ids.filter((id) => !res.source_ids.includes(id)).length;
    proposedScene += p.scene_actions.length;
    finalScene += res.scene_actions.length;
    if (p.scene_actions.length === 0 && res.scene_actions.length > 0) addedByName++;
    if (p.misconception && !res.misconception) misDropped++;
    if (p.keyword_card && !res.keyword_card) cardDropped++;
  }

  return {
    requests: records.length,
    outcomes: countBy(records, (r) => r.outcome ?? "unknown"),
    unverified_reasons: countBy(answered, (r) => r.result!.unverified_reason),
    errors: countBy(records, (r) => r.error?.kind),
    cache: countBy(records, (r) => r.cache),
    latency_ms: {
      total: latency(records.filter((r) => r.result).map((r) => r.total_ms)),
      // 스트리밍에서 첫 글자가 화면에 가기까지(체감 대기).
      first_text: latency(records.map((r) => r.first_text_ms)),
      ...Object.fromEntries(stageNames.map((s) => [s, latency(records.map((r) => r.stages?.[s]))])),
    },
    llm: {
      requests_with_calls: records.filter((r) => r.llm_calls?.length).length,
      calls: records.reduce((n, r) => n + (r.llm_calls?.length ?? 0), 0),
      failed_calls: records.reduce((n, r) => n + (r.llm_calls ?? []).filter((c) => !c.ok).length, 0),
      retries: countBy(withAgent.flatMap((r) => r.agent!.retries), (x) => x),
      format_problems: withAgent.reduce((n, r) => n + r.agent!.format_problems.length, 0),
      tokens_per_grounded: groundedTokens.length ? Math.round(groundedTokens.reduce((n, r) => n + r.llm_tokens!, 0) / groundedTokens.length) : null,
      prompt_chars_p50: quantile(withAgent.map((r) => r.agent!.prompt_chars), 0.5),
    },
    retrieval: {
      requests: retrievals.length,
      zero_results: retrievals.filter((r) => r.retrieval!.count === 0).length,
      top_score_p50: quantile(retrievals.filter((r) => r.retrieval!.count).map((r) => r.retrieval!.results[0]!.score), 0.5),
    },
    validation: {
      dropped_source_ids: dropped,
      proposed_source_ids: proposedSources,
      proposed_scene_actions: proposedScene,
      final_scene_actions: finalScene,
      scene_added_by_name: addedByName,
      misconception_dropped: misDropped,
      keyword_card_dropped: cardDropped,
    },
    grounding: {
      answers: groundingRows.length,
      fully_supported: groundingRows.filter((r) => r.grounding!.rate === 1).length,
      mean_rate: groundingRows.length ? Math.round((groundingRows.reduce((n, r) => n + r.grounding!.rate!, 0) / groundingRows.length) * 1000) / 1000 : null,
      low: groundingRows
        .filter((r) => r.grounding!.rate! < 1 && r.grounding!.weakest)
        .sort((a, b) => a.grounding!.rate! - b.grounding!.rate! || a.grounding!.weakest!.overlap - b.grounding!.weakest!.overlap)
        .slice(0, listLimit)
        .map((r) => ({ trace_id: r.trace_id, question: r.request?.question ?? "", rate: r.grounding!.rate!, weakest: r.grounding!.weakest!.text, overlap: r.grounding!.weakest!.overlap })),
    },
    unverified_questions: answered
      .filter((r) => r.result!.status === "unverified" && r.result!.unverified_reason !== "cached")
      .slice(-listLimit)
      .map((r) => ({ trace_id: r.trace_id, reason: r.result!.unverified_reason ?? "", question: r.request?.question ?? "", top_score: r.retrieval?.results[0]?.score ?? null })),
  };
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const ms = (v: number | null) => (v === null ? "-" : `${v}ms`);
const entries = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "(없음)";

export function formatReport(s: TraceSummary): string {
  const lines = [
    `요청 ${s.requests}개 · 결과: ${entries(s.outcomes)}`,
    `unverified 원인: ${entries(s.unverified_reasons)}`,
    `오류: ${entries(s.errors)}`,
    `저장한 답(cache): ${entries(s.cache)}`,
    "",
    "지연(p50 / p95; total은 답한 요청, 단계는 그 단계를 지난 요청 기준)",
    ...Object.entries(s.latency_ms).filter(([, v]) => v.n).map(([k, v]) => `  ${k}: ${ms(v.p50)} / ${ms(v.p95)} (n=${v.n})`),
    "",
    `LLM 호출: ${s.llm.calls}회(요청 ${s.llm.requests_with_calls}개, 실패 ${s.llm.failed_calls}회) · 재시도 ${entries(s.llm.retries)} · 형식 오류 ${s.llm.format_problems}회`,
    `  grounded 답 하나당 토큰: ${s.llm.tokens_per_grounded ?? "-"} · 프롬프트 글자 수 p50: ${s.llm.prompt_chars_p50 ?? "-"}`,
    `검색: 결과 없음 ${s.retrieval.zero_results}/${s.retrieval.requests} (${pct(s.retrieval.zero_results, s.retrieval.requests)}) · 1위 점수 p50 ${s.retrieval.top_score_p50 ?? "-"}`,
    `서버 검증: 버린 source id ${s.validation.dropped_source_ids}/${s.validation.proposed_source_ids} · 화면 조작 제안 ${s.validation.proposed_scene_actions} → 실행 ${s.validation.final_scene_actions}(이름으로 붙임 ${s.validation.scene_added_by_name}) · 버린 오개념 ${s.validation.misconception_dropped} · 버린 카드 ${s.validation.keyword_card_dropped}`,
    `근거 겹침(grounded ${s.grounding.answers}개): 모든 문장 겹침 ${s.grounding.fully_supported}개 (${pct(s.grounding.fully_supported, s.grounding.answers)}) · 평균 ${s.grounding.mean_rate ?? "-"}`,
  ];
  if (s.grounding.low.length) {
    lines.push("", "겹침이 낮은 답(근거 밖 문장 후보)");
    for (const g of s.grounding.low) lines.push(`  - [${g.trace_id}] ${g.question} → ${g.rate} · "${g.weakest.slice(0, 80)}" (${g.overlap})`);
  }
  if (s.unverified_questions.length) {
    lines.push("", "최근 unverified 질문(검색 평가 세트 후보)");
    for (const u of s.unverified_questions) lines.push(`  - [${u.trace_id}] ${u.reason} · 1위 점수 ${u.top_score ?? "-"} · ${u.question}`);
  }
  return lines.join("\n");
}

/** dir의 {kind}-YYYY-MM-DD.jsonl 중 날짜 범위에 드는 파일을 읽는다. 깨진 줄은 건너뛰고 개수를 돌려준다. */
export function readTraces(dir: string, { kind = "learning", since = "", until = "" } = {}): { records: LearningTrace[]; broken: number; files: string[] } {
  if (!existsSync(dir)) return { records: [], broken: 0, files: [] };
  const pattern = new RegExp(`^${kind}-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`);
  const files = readdirSync(dir)
    .filter((f) => { const m = pattern.exec(f); return m && (!since || m[1]! >= since) && (!until || m[1]! <= until); })
    .sort();
  let broken = 0;
  const records = files.flatMap((f) =>
    readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter((l) => l.trim()).flatMap((line) => {
      try { return [JSON.parse(line) as LearningTrace]; } catch { broken++; return []; }
    }));
  return { records, broken, files };
}

function main(): void {
  const dir = option("dir", process.env.TRACE_DIR || join(process.cwd(), "data", "traces"));
  const { records, broken, files } = readTraces(dir, { since: option("since", ""), until: option("until", "") });
  if (!records.length) {
    console.log(`${dir}에 학습 모드 trace가 없습니다. 서버(npm start)로 질문하면 쌓입니다(TRACE_LOG=off면 남기지 않음).`);
    return;
  }
  console.log(`파일 ${files.length}개(${files[0]} ~ ${files.at(-1)})${broken ? `, 깨진 줄 ${broken}개 건너뜀` : ""}\n`);
  console.log(formatReport(summarizeTraces(records, Number(option("list", "10")))));
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.argv[1]?.endsWith("trace-report.js")) main();
