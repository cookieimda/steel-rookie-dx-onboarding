// 지난 trace 보내기: data/traces/*.jsonl(llm/src/trace.ts)을 Langfuse(llm/src/langfuse.ts)로 보낸다. 서버를 켜기 전에 쌓인 기록도 대시보드에서 보려고 쓴다.
// 실행: npm run trace:langfuse [-- --dir data/traces] [--since 2026-10-15] [--until 2026-10-31] [--dry-run]
// - LANGFUSE_HOST·LANGFUSE_PUBLIC_KEY·LANGFUSE_SECRET_KEY가 필요하다(.env). --dry-run이면 보내지 않고 개수와 첫 기록의 span만 보여 준다.
// - trace id로 span id를 정하므로 같은 기록을 다시 보내도 Langfuse에서 겹치지 않는다. 모델을 부르지 않는다(무료).
import { join } from "node:path";
import { langfuseConfigFromEnv, LangfuseExporter, toOtlpSpans, toScores } from "../src/langfuse.js";
import type { TraceRecord } from "../src/trace.js";
import { option } from "./run-log.js";
import { readTraces } from "./trace-report.js";

/** 서버가 남기는 trace 종류(learning·checkpoint·supplement·exam). 화면 표시·대화 복원 기록(learning-ui·learning-restore)은 요청이 아니라 뺀다. */
export const EXPORT_KINDS = ["learning", "checkpoint", "supplement", "exam"] as const;

async function main(): Promise<void> {
  const dir = option("dir", process.env.TRACE_DIR || join(process.cwd(), "data", "traces"));
  const range = { since: option("since", ""), until: option("until", "") };
  const records: TraceRecord[] = EXPORT_KINDS.flatMap((kind) => readTraces(dir, { kind, ...range }).records as TraceRecord[]);
  const byKind = EXPORT_KINDS.map((k) => `${k} ${records.filter((r) => r.kind === k).length}`).join(" · ");
  console.log(`${dir}: 기록 ${records.length}개(${byKind})`);
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
  const exporter = new LangfuseExporter(config, { flushMs: 0 });
  records.forEach((r) => exporter.push(r));
  await exporter.flush();
  const { traces, spans, scores, failed } = exporter.sent;
  console.log(`보냄: trace ${traces}개 · span ${spans}개 · 점수 ${scores}개${failed ? ` · 실패 ${failed}개` : ""} → ${config.host}`);
  if (failed) process.exitCode = 1;
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.argv[1]?.endsWith("trace-langfuse.js")) await main();
