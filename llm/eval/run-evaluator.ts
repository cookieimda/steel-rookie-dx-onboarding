// 평가자 정확도 평가: 실제 모델로 평가 세트를 채점해 일치율, 혼동 표, 형식 재시도, 같은 뜻 쌍 일치율, 틀린 케이스를 출력한다.
// 실행: npm run eval:evaluator -- --set smoke|hard [--resume] [--records 파일.jsonl] [--no-guards]
//  - 기본 smoke, npm test에는 포함하지 않는다. 모델은 LLM_PROVIDER(기본 Gemini, GEMINI_API_KEY 필요 / ollama는 무료).
//  - Ollama는 채점 보강(repairFormat·verifyBoundary)을 켜고 돌린다. --no-guards로 끄고 비교한다.
//  - 케이스마다 결과를 --records(기본 llm/eval/results/evaluator-{set}.jsonl, Ollama는 evaluator-{set}-ollama.jsonl)에 바로 기록한다.
//    --resume이면 같은 모델·프롬프트·루브릭으로 끝난 케이스를 건너뛰고, 보고서는 파일의 기록 전체로 만든다.
//  - 무료 등급 요청 제한을 피하려고 케이스 사이에 EVAL_DELAY_MS(기본 1000ms)만큼 쉰다.
//  - 429·시간 초과·연결 실패는 EVAL_RETRY_BASE_MS(기본 10000ms)부터 2배씩 늘려 최대 3회 다시 호출한다.
//    그래도 실패하면 infra_error로 기록하고 일치율에서 뺀다. 연속 3케이스면 멈춘다.
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { evaluatorSystemPrompt, evaluatorUserPrompt, GeminiEvaluator } from "../src/evaluator.js";
import { EVAL_SETS, loadEvalSet, SOURCES, type EvalCase, type EvalSetName } from "./eval-set.js";
import { evalProvider, fingerprint, flag, InfraStreak, MAX_CONSECUTIVE_INFRA, isInfraError, option, openRecordFile, resultsFile, RetryingLlmClient, sleep, type RunRecord } from "./run-log.js";

const EXPECTED = ["correct", "partial", "wrong", "assisted"] as const;
const PREDICTED = [...EXPECTED, "format_error"] as const;
type Predicted = (typeof PREDICTED)[number];

interface EvaluatorRecord extends RunRecord {
  model: string;
  where: string;
  concept_id: string;
  phase: string;
  expected: string;
  got: Predicted | "infra_error";
  evidence: string;
  misconception: string | null;
  explain_from: number | null;
  attempts: number;
  format_problems: string[];
  /** 채점 보강(형식 보정·경계 재확인)으로 바꾼 내용. */
  adjustments?: string[];
  /** 연결 오류로 다시 호출한 이유(재시도 횟수 = 길이). */
  infra_retries: string[];
  error?: string;
  at: string;
}

interface Outcome {
  c: EvalCase;
  r: EvaluatorRecord;
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const hit = (o: Outcome) => o.r.got === o.c.expected_verdict;
const where = (c: EvalCase) => `${c.file}:${c.line}`;

async function main(): Promise<void> {
  const set = option("set", "smoke") as EvalSetName;
  if (!EVAL_SETS.includes(set)) throw new Error(`--set은 ${EVAL_SETS.join("|")} 중 하나입니다: ${set}`);
  const p = await evalProvider();
  if (!p) {
    process.exitCode = 1;
    return;
  }
  const model = p.model;
  // 채점 보강(repairFormat·verifyBoundary)은 provider 설정을 따른다(Ollama 켬). --no-guards로 끄고 비교한다.
  const guards = p.profile.evaluatorGuards && !flag("no-guards");
  // 로컬 모델은 대기 없이 돌린다(요청 제한이 없다).
  const delayMs = Number(process.env.EVAL_DELAY_MS ?? (p.provider === "gemini" ? 1000 : 0));
  const records = openRecordFile<EvaluatorRecord>(option("records", resultsFile(`evaluator-${set}`, p.provider)), flag("resume"));
  const client = new RetryingLlmClient();
  // --verify-misconception: 채점 보강에 오개념 재확인을 더한다(측정용, llm/src/evaluator.ts verifyMisconception).
  const verifyMisconception = guards && flag("verify-misconception");
  const evaluator = new GeminiEvaluator(client, { repairFormat: guards, verifyBoundary: guards, verifyMisconception });
  const streak = new InfraStreak();
  const outcomes: Outcome[] = [];
  let total = 0;
  let skipped = 0;
  let stale = 0;
  let stopped = false;

  console.log(`결과 파일: ${records.path} (모델: ${model}, 채점 보강 ${guards ? "켬" : "끔"}${verifyMisconception ? " + 오개념 재확인" : ""})`);
  for (const rubric of loadFinalRubrics()) {
    const cases = loadEvalSet(set, rubric.section);
    if (!cases.length) continue;
    console.log(`\n[${set}/${rubric.section}] ${cases.length}개 케이스`);
    for (const c of cases) {
      total++;
      const concept = rubric.concepts.find((k) => k.concept_id === c.concept_id);
      if (!concept) throw new Error(`${where(c)} 루브릭에 없는 개념: ${c.concept_id}`);
      // 모델, 평가자 프롬프트(루브릭·용어집 포함), 질문·답변이 같아야 같은 결과로 본다.
      // 채점 보강을 켜면 다른 결과로 본다(끈 기록은 예전 지문 그대로).
      const fp = fingerprint(model, evaluatorSystemPrompt(rubric, concept, c.phase), evaluatorUserPrompt(c.question, c.answer), ...(guards ? ["guards"] : []), ...(verifyMisconception ? ["verify-misconception"] : []));
      const key = where(c);
      const prior = records.done(key, fp);
      if (prior) {
        outcomes.push({ c, r: prior });
        skipped++;
        process.stdout.write("-");
        continue;
      }
      if (stopped) continue;
      if (records.stale(key, fp)) stale++;

      client.reset();
      const base = { key, fingerprint: fp, model, where: key, concept_id: c.concept_id, phase: c.phase, expected: c.expected_verdict };
      let record: EvaluatorRecord;
      try {
        const d = await evaluator.evaluateDetailed({ rubric, concept, question: c.question, answer: c.answer, phase: c.phase });
        record = {
          ...base,
          infra_error: false,
          got: d.evaluation?.verdict ?? "format_error",
          evidence: d.evaluation?.evidence ?? d.formatProblems.join(" / "),
          misconception: d.evaluation?.misconception ?? null,
          explain_from: d.evaluation?.explain_from ?? null,
          attempts: d.attempts,
          format_problems: d.formatProblems,
          adjustments: d.adjustments,
          infra_retries: client.retries,
          at: new Date().toISOString(),
        };
      } catch (error) {
        if (!isInfraError(error)) throw error;
        record = {
          ...base,
          infra_error: true,
          got: "infra_error",
          evidence: "",
          misconception: null,
          explain_from: null,
          attempts: 0,
          format_problems: [],
          infra_retries: client.retries,
          error: error.message,
          at: new Date().toISOString(),
        };
      }
      records.append(record);
      outcomes.push({ c, r: record });
      process.stdout.write(record.infra_error ? "E" : hit(outcomes.at(-1)!) ? "." : "x");
      if (streak.push(record.infra_error)) {
        console.error(`\n연결 오류가 ${MAX_CONSECUTIVE_INFRA}케이스 연속으로 나서 멈춥니다: ${record.error}`);
        console.error("원인(요청 한도·API 키·네트워크)을 확인한 뒤 --resume으로 이어서 실행하세요.");
        process.exitCode = 1;
        stopped = true;
        continue;
      }
      if (delayMs) await sleep(delayMs);
    }
    process.stdout.write("\n");
  }
  if (skipped) console.log(`이전 기록 사용: ${skipped}개${stale ? `, 설정이 바뀌어 다시 실행: ${stale}개` : ""}`);
  if (outcomes.length < total) console.log(`미실행: ${total - outcomes.length}개 (--resume으로 이어서 실행)`);
  report(outcomes);
}

function rate(label: string, subset: Outcome[]): string {
  return `  ${label}: ${subset.filter(hit).length}/${subset.length} (${pct(subset.filter(hit).length, subset.length)})`;
}

function report(all: Outcome[]): void {
  // 연결 오류는 평가자의 판정이 아니므로 일치율·혼동 표에서 뺀다(개수만 표시).
  const infra = all.filter((o) => o.r.infra_error);
  const outcomes = all.filter((o) => !o.r.infra_error);
  const formatErrors = outcomes.filter((o) => o.r.got === "format_error");

  console.log(`\n일치율: ${outcomes.filter(hit).length}/${outcomes.length} (${pct(outcomes.filter(hit).length, outcomes.length)})`);
  console.log(`  평가자 형식 오류(format_error, 일치율에 포함): ${formatErrors.length}개`);
  console.log(`  연결 오류(infra_error, 일치율에서 제외): ${infra.length}개${infra.length ? " → --resume으로 다시 실행" : ""}`);
  for (const phase of ["initial", "recheck"] as const) {
    const subset = outcomes.filter((o) => o.c.phase === phase);
    if (subset.length) console.log(rate(phase, subset));
  }

  console.log("\nsource별 일치율");
  for (const source of SOURCES) {
    const subset = outcomes.filter((o) => o.c.source === source);
    console.log(subset.length ? rate(source, subset) : `  ${source}: 케이스 없음`);
  }
  const types = [...new Set(outcomes.map((o) => o.c.type).filter(Boolean))] as string[];
  if (types.length) {
    console.log("\n유형별 일치율");
    for (const type of types) console.log(rate(type, outcomes.filter((o) => o.c.type === type)));
  }

  for (const source of SOURCES) {
    const subset = outcomes.filter((o) => o.c.source === source);
    if (!subset.length) continue;
    console.log(`\n혼동 표 [${source}] (행: 기대, 열: 판정)`);
    const width = 13;
    console.log(["", ...PREDICTED].map((h) => h.padEnd(width)).join(""));
    for (const expected of EXPECTED) {
      const row = subset.filter((o) => o.c.expected_verdict === expected);
      if (row.length) console.log([expected, ...PREDICTED.map((p) => String(row.filter((o) => o.r.got === p).length))].map((v) => v.padEnd(width)).join(""));
    }
  }

  const retried = outcomes.filter((o) => o.r.attempts > 1);
  const retries = outcomes.reduce((sum, o) => sum + o.r.attempts - 1, 0);
  const calls = outcomes.reduce((sum, o) => sum + o.r.attempts, 0);
  console.log(`\n평가자 형식 재시도: 케이스 ${retried.length}/${outcomes.length} (${pct(retried.length, outcomes.length)}), 호출 ${retries}/${calls}회 (${pct(retries, calls)})`);
  for (const o of retried) {
    console.log(`- ${where(o.c)} 시도 ${o.r.attempts}회${o.r.got === "format_error" ? " (최종 실패)" : ""}: ${o.r.format_problems.join(" / ")}`);
  }

  const reconnected = all.filter((o) => o.r.infra_retries.length);
  console.log(`\n연결 재시도(429·시간 초과·연결 실패): 케이스 ${reconnected.length}/${all.length}, 재호출 ${reconnected.reduce((s, o) => s + o.r.infra_retries.length, 0)}회`);
  for (const o of infra) console.log(`- ${where(o.c)} 연결 오류: ${o.r.error}`);

  const pairs = new Map<string, Outcome[]>();
  for (const o of outcomes) if (o.c.pair_id) pairs.set(o.c.pair_id, [...(pairs.get(o.c.pair_id) ?? []), o]);
  const groups = [...pairs.entries()].filter(([, members]) => members.length >= 2);
  if (groups.length) {
    const split = groups.filter(([, members]) => new Set(members.map((m) => m.r.got)).size > 1);
    console.log(`\n같은 뜻 쌍 판정 일치율: ${groups.length - split.length}/${groups.length} (${pct(groups.length - split.length, groups.length)})`);
    for (const [id, members] of split) {
      console.log(`- ${id}: ${members.map((m) => `${where(m.c)}=${m.r.got}`).join(", ")} (기대 ${members[0]!.c.expected_verdict})`);
    }
  }

  const misses = outcomes.filter((o) => !hit(o));
  console.log(`\n틀린 케이스 ${misses.length}개`);
  for (const { c, r } of misses) {
    console.log(`- ${where(c)} [${c.concept_id}/${c.phase}/${c.source}${c.type ? `/${c.type}` : ""}] 기대 ${c.expected_verdict} → ${r.got}`);
    console.log(`    답변: ${c.answer}`);
    console.log(`    근거: ${r.evidence}`);
    if (c.note) console.log(`    메모: ${c.note}`);
  }
}

await main();
