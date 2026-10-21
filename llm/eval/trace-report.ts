// trace 요약: 서버가 남긴 data/traces/*.jsonl(llm/src/trace.ts)을 읽는다. 학습 모드는 실패 원인·지연·호출·검증 결과를 자세히,
// 체크포인트·보충학습·시험(checkpoint·supplement·exam)은 요청별 시간과 모델별 호출을 센다.
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
  /** 화면 표시 보고(learning-ui-*.jsonl)를 trace id로 이은 것. 보고가 없으면 reports 0. */
  ui: {
    reports: number;
    errors: number;
    client_p50: number | null;
    client_p95: number | null;
    first_partial_p50: number | null;
    /** 브라우저가 잰 전체 시간 - 서버 total_ms(네트워크·화면 그리기·3D 조작 시간). 서버 trace와 이어진 보고만. */
    overhead_p50: number | null;
    /** 3D 조작 종류별 실행/실패. */
    actions: Record<string, { run: number; failed: number }>;
  };
  /** 대화 복원(learning-restore-*.jsonl, 새로고침 때 이전 대화 불러오기). */
  restore: { requests: number; outcomes: Record<string, number>; turns_mean: number | null; total_p95: number | null };
  /** 모델을 부른 요청을 provider:모델별로(Gemini·Ollama 비교). 저장한 답·안전 질문처럼 모델을 안 부른 요청은 뺀다. */
  by_model: Record<string, { requests: number; grounded: number; unverified: number; errors: number; format_problems: number; total_p50: number | null; total_p95: number | null; first_text_p50: number | null; tokens_per_grounded: number | null; grounding_mean: number | null }>;
}

/** 요청이 부른 모델(첫 호출 기준). 모델을 안 불렀으면 null. */
const modelOf = (r: LearningTrace) => r.llm_calls?.[0]?.model ?? null;

function byModel(records: LearningTrace[]): TraceSummary["by_model"] {
  const out: TraceSummary["by_model"] = {};
  for (const model of [...new Set(records.map(modelOf).filter((m): m is string => !!m))].sort()) {
    const rows = records.filter((r) => modelOf(r) === model);
    const answered = rows.filter((r) => r.result);
    const grounded = answered.filter((r) => r.result!.status === "grounded");
    const withTokens = grounded.filter((r) => typeof r.llm_tokens === "number");
    const rates = grounded.map((r) => r.grounding?.rate).filter((x): x is number => typeof x === "number");
    out[model] = {
      requests: rows.length,
      grounded: grounded.length,
      unverified: answered.length - grounded.length,
      errors: rows.filter((r) => r.error).length,
      format_problems: rows.reduce((n, r) => n + (r.agent?.format_problems.length ?? 0), 0),
      total_p50: quantile(answered.map((r) => r.total_ms), 0.5),
      total_p95: quantile(answered.map((r) => r.total_ms), 0.95),
      first_text_p50: quantile(rows.map((r) => r.first_text_ms).filter((x): x is number => typeof x === "number"), 0.5),
      tokens_per_grounded: withTokens.length ? Math.round(withTokens.reduce((n, r) => n + r.llm_tokens!, 0) / withTokens.length) : null,
      grounding_mean: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 1000) / 1000 : null,
    };
  }
  return out;
}

/** 화면 표시 보고 한 줄(backend/src/learning/routes.ts의 POST /api/chat/trace/:id/ui). */
export interface UiTrace extends TraceRecord {
  client_ms: number;
  first_partial_ms: number | null;
  error: boolean;
  actions: { type: string; target_id: string; status: "succeeded" | "failed" }[];
}

function summarizeUi(records: LearningTrace[], ui: UiTrace[]): TraceSummary["ui"] {
  const serverMs = new Map(records.map((r) => [r.trace_id, r.total_ms]));
  const overhead = ui.filter((u) => serverMs.has(u.trace_id)).map((u) => u.client_ms - serverMs.get(u.trace_id)!);
  const actions: TraceSummary["ui"]["actions"] = {};
  for (const a of ui.flatMap((u) => u.actions ?? [])) {
    const row = (actions[a.type] ??= { run: 0, failed: 0 });
    row.run++;
    if (a.status === "failed") row.failed++;
  }
  return {
    reports: ui.length,
    errors: ui.filter((u) => u.error).length,
    client_p50: quantile(ui.map((u) => u.client_ms), 0.5),
    client_p95: quantile(ui.map((u) => u.client_ms), 0.95),
    first_partial_p50: quantile(ui.map((u) => u.first_partial_ms).filter((x): x is number => typeof x === "number"), 0.5),
    overhead_p50: quantile(overhead, 0.5),
    actions,
  };
}

function summarizeRestore(restores: (TraceRecord & { outcome?: string; restored_turns?: number })[]): TraceSummary["restore"] {
  const ok = restores.filter((r) => typeof r.restored_turns === "number");
  return {
    requests: restores.length,
    outcomes: countBy(restores, (r) => r.outcome ?? "unknown"),
    turns_mean: ok.length ? Math.round((ok.reduce((n, r) => n + r.restored_turns!, 0) / ok.length) * 10) / 10 : null,
    total_p95: quantile(restores.map((r) => r.total_ms), 0.95),
  };
}

export function summarizeTraces(records: LearningTrace[], listLimit = 10, ui: UiTrace[] = [], restores: TraceRecord[] = []): TraceSummary {
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
    ui: summarizeUi(records, ui),
    restore: summarizeRestore(restores),
    by_model: byModel(records),
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
  if (s.ui.reports) {
    const acts = Object.entries(s.ui.actions).map(([type, a]) => `${type} ${a.run - a.failed}/${a.run}`).join(" · ") || "(없음)";
    lines.push(`화면 표시(브라우저 보고 ${s.ui.reports}개): 최종 답 p50/p95 ${ms(s.ui.client_p50)} / ${ms(s.ui.client_p95)} · 첫 글자 p50 ${ms(s.ui.first_partial_p50)} · 서버 밖 시간 p50 ${ms(s.ui.overhead_p50)} · 오류 표시 ${s.ui.errors}`);
    lines.push(`  3D 조작 성공: ${acts}`);
  }
  if (s.restore.requests) lines.push(`대화 복원 ${s.restore.requests}회: ${entries(s.restore.outcomes)} · 평균 ${s.restore.turns_mean ?? "-"}턴 · p95 ${ms(s.restore.total_p95)}`);
  const models = Object.entries(s.by_model);
  if (models.length) {
    lines.push("", "모델별(모델을 부른 요청만)");
    for (const [model, m] of models) {
      lines.push(`  ${model}: 요청 ${m.requests} · grounded ${m.grounded} · unverified ${m.unverified} · 오류 ${m.errors} · 형식 오류 ${m.format_problems}회`);
      lines.push(`    total p50/p95 ${ms(m.total_p50)} / ${ms(m.total_p95)} · 첫 글자 p50 ${ms(m.first_text_p50)} · grounded 답당 토큰 ${m.tokens_per_grounded ?? "-"} · 근거 겹침 평균 ${m.grounding_mean ?? "-"}`);
    }
  }
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

/** 학습 밖 경로(checkpoint·supplement·exam) 요약: 요청 수, 결과, 전체 시간, 모델별 LLM 호출 수·평균 시간·실패·토큰. */
export interface KindSummary {
  kind: string;
  requests: number;
  outcomes: Record<string, number>;
  total_p50: number | null;
  total_p95: number | null;
  /** 경로(:id로 묶음)별 요청 수(체크포인트·보충학습). */
  routes: Record<string, number>;
  models: Record<string, { calls: number; failed: number; ms_p50: number | null; tokens: number }>;
}

export function summarizeKind(kind: string, records: (TraceRecord & { outcome?: string; request?: { route?: string } })[]): KindSummary {
  const calls = records.flatMap((r) => r.llm_calls ?? []);
  const models: KindSummary["models"] = {};
  for (const model of [...new Set(calls.map((c) => c.model))].sort()) {
    const mine = calls.filter((c) => c.model === model);
    models[model] = { calls: mine.length, failed: mine.filter((c) => !c.ok).length, ms_p50: quantile(mine.map((c) => c.ms), 0.5), tokens: mine.reduce((n, c) => n + (c.tokens?.total ?? 0), 0) };
  }
  return {
    kind,
    requests: records.length,
    outcomes: countBy(records, (r) => r.outcome ?? "unknown"),
    total_p50: quantile(records.map((r) => r.total_ms), 0.5),
    total_p95: quantile(records.map((r) => r.total_ms), 0.95),
    routes: countBy(records, (r) => r.request?.route),
    models,
  };
}

export function formatKind(s: KindSummary): string {
  const lines = [`[${s.kind}] 요청 ${s.requests}개 · 결과: ${entries(s.outcomes)} · 전체 p50/p95 ${ms(s.total_p50)} / ${ms(s.total_p95)}`];
  if (Object.keys(s.routes).length) lines.push(`  경로: ${entries(s.routes)}`);
  for (const [model, m] of Object.entries(s.models)) lines.push(`  ${model}: 호출 ${m.calls}회(실패 ${m.failed}) · 호출당 p50 ${ms(m.ms_p50)} · 토큰 ${m.tokens}`);
  return lines.join("\n");
}

/** 학습 밖에서 trace를 남기는 경로 종류(서버 ironmaking-server.ts). */
export const OTHER_KINDS = ["checkpoint", "supplement", "exam"] as const;

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
  const range = { since: option("since", ""), until: option("until", "") };
  const { records, broken, files } = readTraces(dir, range);
  const others = OTHER_KINDS.map((kind) => ({ kind, records: readTraces(dir, { kind, ...range }).records })).filter((o) => o.records.length);
  if (!records.length && !others.length) {
    console.log(`${dir}에 trace가 없습니다. 서버(npm start)로 질문하면 쌓입니다(TRACE_LOG=off면 남기지 않음).`);
    return;
  }
  if (records.length) {
    console.log(`[학습 모드] 파일 ${files.length}개(${files[0]} ~ ${files.at(-1)})${broken ? `, 깨진 줄 ${broken}개 건너뜀` : ""}\n`);
    const ui = readTraces(dir, { kind: "learning-ui", ...range }).records as unknown as UiTrace[];
    const restores = readTraces(dir, { kind: "learning-restore", ...range }).records;
    console.log(formatReport(summarizeTraces(records, Number(option("list", "10")), ui, restores)));
  }
  // 체크포인트·보충학습·시험: 요청(작업)별 시간과 모델별 호출(채점이 몇 초 걸리는지, 어느 provider였는지).
  if (others.length) console.log(`\n${others.map((o) => formatKind(summarizeKind(o.kind, o.records as never))).join("\n")}`);
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.argv[1]?.endsWith("trace-report.js")) main();
