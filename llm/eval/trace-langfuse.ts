// 지난 trace 보내기: data/traces/*.jsonl(llm/src/trace.ts)을 Langfuse(llm/src/langfuse.ts)로 보낸다. 서버를 켜기 전에 쌓인 기록도 대시보드에서 보려고 쓴다.
// 실행: npm run trace:langfuse [-- --dir data/traces] [--since 2026-10-15] [--until 2026-10-31] [--dry-run] [--force]
// - LANGFUSE_HOST·LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 필요하다(.env). --dry-run이면 보내지 않고 개수와 첫 기록의 span만 보여 준다.
// - 보낸 trace id를 {dir}/langfuse-sent.txt에 적고 다음에는 건너뛴다(서버가 바로 보낸 기록도 같은 파일에 적힌다).
//   Langfuse v4는 같은 기록을 다시 받으면 행을 하나 더 만들기 때문이다. --force면 적힌 기록도 다시 보낸다. 모델을 부르지 않는다(무료).
import { join } from "node:path";
import { LANGFUSE_SENT_LOG, langfuseConfigFromEnv, LangfuseExporter, readSentIds, toOtlpSpans, toScores } from "../src/langfuse.js";
import type { TraceRecord } from "../src/trace.js";
import { option } from "./run-log.js";
import { readTraces } from "./trace-report.js";

/** 서버가 남기는 trace 종류(learning·checkpoint·supplement·exam). 화면 표시·대화 복원 기록(learning-ui·learning-restore)은 요청이 아니라 뺀다. */
export const EXPORT_KINDS = ["learning", "checkpoint", "supplement", "exam"] as const;

async function main(): Promise<void> {
  const dir = option("dir", process.env.TRACE_DIR || join(process.cwd(), "data", "traces"));
  const range = { since: option("since", ""), until: option("until", "") };
  const sentLog = join(dir, LANGFUSE_SENT_LOG);
  const sent = process.argv.includes("--force") ? new Set<string>() : readSentIds(sentLog);
  const found: TraceRecord[] = EXPORT_KINDS.flatMap((kind) => readTraces(dir, { kind, ...range }).records as TraceRecord[]);
  const records = found.filter((r) => !sent.has(r.trace_id));
  const byKind = EXPORT_KINDS.map((k) => `${k} ${records.filter((r) => r.kind === k).length}`).join(" · ");
  console.log(`${dir}: 기록 ${found.length}개 중 보낼 것 ${records.length}개(${byKind})${found.length > records.length ? ` · 이미 보낸 ${found.length - records.length}개 건너뜀(--force면 다시 보냄)` : ""}`);
  if (!records.length) return;

  if (process.argv.includes("--dry-run")) {
    const spans = records.flatMap(toOtlpSpans), scores = records.flatMap(toScores);
    console.log(`보낼 span ${spans.length}개 · 점수 ${scores.length}개(보내지 않음, --dry-run)`);
    console.log(JSON.stringify(toOtlpSpans(records[0]!).map((s) => ({ name: s.name, parent: s.parentSpanId ?? null, attributes: Object.fromEntries(s.attributes.map((a) => [a.key, Object.values(a.value)[0]])) })), null, 2));
    return;
  }
  const config = langfuseConfigFromEnv();
  if (!config) {
    console.error("LANGFUSE_HOST·LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY를 .env에 넣어 주세요(docs/agent-observability.md 'Langfuse').");
    process.exitCode = 1;
    return;
  }
  const exporter = new LangfuseExporter(config, { flushMs: 0, sentLog });
  records.forEach((r) => exporter.push(r));
  await exporter.flush();
  const { traces, spans, scores, failed } = exporter.sent;
  console.log(`보냄: trace ${traces}개 · span ${spans}개 · 점수 ${scores}개${failed ? ` · 실패 ${failed}개` : ""} → ${config.host}`);
  if (failed) process.exitCode = 1;
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.argv[1]?.endsWith("trace-langfuse.js")) await main();
