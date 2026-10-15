// 튜터 질문 표본(실제 Gemini 사용). 결과를 마크다운 표로 출력한다.
// - 질문 은행이 있는 개념: 은행 질문(questions, recheck_questions)마다 말투 다듬기를 --polish-count회 돌려
//   원문과 다듬은 결과의 유출 검사 결과를 기록한다. '의미 변경' 열은 사람이 채운다.
// - 은행이 빈 개념(대체 경로): 개념마다 LLM 질문을 --count개 만들어 유출 검사·재생성·대체 결과를 기록한다. '범위 초과' 열은 사람이 채운다.
// 실행: npm run eval:questions -- [--polish-count 3] [--count 10] [--gap 6000] [--out 파일.md] [--resume] [--records 파일.jsonl]
//  - 모든 Gemini 호출(재생성·연결 재시도 포함) 사이에 --gap(ms)만큼 쉰다. 무료 등급 분당 한도를 넘지 않게 6000 이상을 권장.
//  - 표본마다 결과를 --records(기본 llm/eval/results/questions.jsonl)에 바로 기록한다.
//    --resume이면 같은 모델·프롬프트·루브릭으로 끝난 표본을 건너뛰고, 보고서는 파일의 기록 전체로 만든다.
//  - 429·시간 초과·연결 실패는 EVAL_RETRY_BASE_MS(기본 10000ms)부터 2배씩 늘려 최대 3회 다시 호출한다.
//    그래도 실패하면 infra_error로 기록하고 비율에서 뺀다. 연속 3개면 멈춘다.
//  - 빈 응답은 형식 오류(format_error)로 따로 센다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LlmUnavailableError } from "../../backend/src/checkpoint/types.js";
import { loadFinalRubrics, type Rubric, type RubricConcept } from "../../backend/src/rubrics.js";
import { createLlmClient } from "../src/provider.js";
import { answerTermsInName, findLeaks, hasLeak, type LeakResult } from "../src/question-check.js";
import { GeminiTutor, type PolishResult } from "../src/tutor.js";
import { evalProvider, fingerprint, flag, InfraStreak, isInfraError, MAX_CONSECUTIVE_INFRA, option, openRecordFile, resultsFile, RetryingLlmClient, type RunRecord } from "./run-log.js";

type Handling = "통과" | "재생성" | "대체 질문";
type Status = "ok" | "format_error" | "infra_error";

interface BaseRecord extends RunRecord {
  model: string;
  section: string;
  concept_id: string;
  index: number;
  status: Status;
  /** 이 표본에 쓴 Gemini 호출 수(재생성·연결 재시도 포함). */
  calls: number;
  infra_retries: string[];
  error?: string;
  at: string;
}

/** 은행 질문 다듬기 표본. */
interface PolishRecord extends BaseRecord {
  mode: "bank";
  kind: "question" | "recheck";
  /** 은행 안의 번호(1부터). */
  bank_index: number;
  original: string;
  original_leaks: LeakResult;
  polished: string | null;
  polished_leaks: LeakResult | null;
  polished_strict: LeakResult | null;
  used: PolishResult["used"];
  reason: PolishResult["reason"] | null;
}

/** 은행이 빈 개념의 LLM 질문 생성 표본. */
interface GeneratedRecord extends BaseRecord {
  mode: "generated";
  handling: Handling | null;
  final: string | null;
  /** 시도별 생성 문장과 유출 검사 결과(완화: 실제 검사, 엄격: 단어 경계 무시 4글자). */
  attempts: { text: string; leaks: LeakResult; strict: LeakResult }[];
}

type QuestionRecord = PolishRecord | GeneratedRecord;

const count = Number(option("count", "10"));
const polishCount = Number(option("polish-count", "3"));
const gap = Number(option("gap", "6000"));
const out = option("out", "");
const show = (r: LeakResult | null) => (!r ? "-" : hasLeak(r) ? [...r.terms, ...r.phrases].join(", ") : "없음");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");

// 모델은 LLM_PROVIDER를 따른다(기본 Gemini, ollama는 무료).
const provider = await evalProvider();
if (!provider) process.exit(1);

const model = provider.model;
const records = openRecordFile<QuestionRecord>(option("records", resultsFile("questions", provider.provider)), flag("resume"));
const prompt = (name: string) => readFileSync(join(process.cwd(), "llm", "prompts", `${name}.md`), "utf8");

let last = 0;
let calls = 0;
const throttled = (async (...args: Parameters<typeof fetch>) => {
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  calls++;
  return fetch(...args);
}) as typeof fetch;
const client = new RetryingLlmClient(createLlmClient({ gemini: { fetch: throttled }, ollama: { fetch: throttled } }));
const tutor = new GeminiTutor(client);
const streak = new InfraStreak();
let skipped = 0;
let stopped = false;

/** 표본 하나를 실행하고 기록한다. 이미 같은 설정으로 끝났으면 그 기록을 돌려준다. */
async function sample<T extends QuestionRecord>(key: string, fp: string, run: () => Promise<T>): Promise<T | null> {
  const prior = records.done(key, fp) as T | undefined;
  if (prior) {
    skipped++;
    process.stdout.write("-");
    return prior;
  }
  if (stopped) return null;
  client.reset();
  const record = await run();
  records.append(record);
  process.stdout.write(progressMark(record));
  if (streak.push(record.infra_error)) {
    console.error(`\n연결 오류가 ${MAX_CONSECUTIVE_INFRA}개 연속으로 나서 멈춥니다: ${record.error}`);
    console.error("원인(요청 한도·API 키·네트워크)을 확인한 뒤 --resume으로 이어서 실행하세요.");
    process.exitCode = 1;
    stopped = true;
  }
  return record;
}

function progressMark(r: QuestionRecord): string {
  if (r.status === "infra_error") return "E";
  if (r.status === "format_error") return "?";
  if (r.mode === "bank") return r.used === "polished" ? "." : "o";
  return r.handling === "통과" ? "." : r.handling === "재생성" ? "r" : "F";
}

function base(key: string, fp: string, rubric: Rubric, concept: RubricConcept, index: number, before: number) {
  return {
    key, fingerprint: fp, model, section: rubric.section, concept_id: concept.concept_id, index,
    calls: calls - before, infra_retries: client.retries, at: new Date().toISOString(),
  };
}

async function bankSamples(rubric: Rubric, concept: RubricConcept): Promise<PolishRecord[]> {
  // 모델, 튜터 프롬프트(시스템·다듬기), 개념 루브릭, 용어집이 같아야 같은 결과로 본다.
  const fp = fingerprint(model, prompt("tutor-system"), prompt("tutor-polish"), JSON.stringify(concept), JSON.stringify(rubric.glossary ?? []));
  const bank = [
    ...(concept.questions ?? []).map((text, j) => ({ kind: "question" as const, j: j + 1, text })),
    ...(concept.recheck_questions ?? []).map((text, j) => ({ kind: "recheck" as const, j: j + 1, text })),
  ];
  const mine: PolishRecord[] = [];
  for (const q of bank) {
    for (let i = 1; i <= polishCount; i++) {
      const key = `${rubric.section}/${concept.concept_id}/${q.kind}${q.j}/${i}`;
      const r = await sample<PolishRecord>(key, fp, async () => {
        const before = calls;
        const p = await tutor.polish(rubric, concept, q.text);
        const status: Status = !p.error ? "ok" : p.error.infra ? "infra_error" : "format_error";
        return {
          ...base(key, fp, rubric, concept, i, before),
          mode: "bank", kind: q.kind, bank_index: q.j, infra_error: status === "infra_error", status,
          original: p.original, original_leaks: p.originalLeaks,
          polished: p.polished, polished_leaks: p.polishedLeaks,
          polished_strict: p.polished === null ? null : findLeaks(p.polished, rubric, concept, { crossWordOnly: false }),
          used: p.used, reason: p.reason ?? null, ...(p.error ? { error: p.error.message } : {}),
        };
      });
      if (r) mine.push(r);
    }
  }
  return mine;
}

async function generatedSamples(rubric: Rubric, concept: RubricConcept): Promise<GeneratedRecord[]> {
  const fp = fingerprint(model, prompt("tutor-system"), prompt("tutor-question"), JSON.stringify(concept), JSON.stringify(rubric.glossary ?? []));
  const mine: GeneratedRecord[] = [];
  for (let i = 1; i <= count; i++) {
    const key = `${rubric.section}/${concept.concept_id}/${i}`;
    const r = await sample<GeneratedRecord>(key, fp, async () => {
      const before = calls;
      try {
        const q = await tutor.questionDetailed({ rubric, concept });
        return {
          ...base(key, fp, rubric, concept, i, before),
          mode: "generated", infra_error: false, status: "ok",
          handling: q.usedFallback ? "대체 질문" : q.attempts.length > 1 ? "재생성" : "통과",
          final: q.text,
          attempts: q.attempts.map((a) => ({ ...a, strict: findLeaks(a.text, rubric, concept, { crossWordOnly: false }) })),
        };
      } catch (error) {
        // 연결 오류(GeminiCallError)가 아닌 LlmUnavailableError는 튜터의 빈 응답이다.
        if (!(error instanceof LlmUnavailableError)) throw error;
        const infra = isInfraError(error);
        return {
          ...base(key, fp, rubric, concept, i, before),
          mode: "generated", infra_error: infra, status: infra ? "infra_error" : "format_error",
          handling: null, final: null, attempts: [], error: error.message,
        };
      }
    });
    if (r) mine.push(r);
  }
  return mine;
}

function failures(mine: QuestionRecord[]): string[] {
  const failed = mine.filter((r) => r.status !== "ok");
  return failed.length ? ["", "실패", "", ...failed.map((r) => `- ${r.key} ${r.status}: ${r.error}`)] : [];
}

function bankSection(title: string, mine: PolishRecord[]): string[] {
  const counted = mine.filter((r) => r.status !== "infra_error");
  const ok = mine.filter((r) => r.status === "ok");
  const n = (f: (r: PolishRecord) => boolean) => counted.filter(f).length;
  const section = [
    `\n### ${title} · 질문 은행\n`,
    `다듬은 문장 사용 ${n((r) => r.used === "polished")}/${counted.length} (${pct(n((r) => r.used === "polished"), counted.length)}), ` +
      `유출로 원문 사용 ${n((r) => r.reason === "leak")}, 형식 오류(빈 응답)로 원문 사용 ${n((r) => r.status === "format_error")} · ` +
      `연결 오류 ${mine.length - counted.length}개(비율에서 제외)`,
    "",
    "| 종류 | 은행 # | 원문 | 원문 유출 | 회차 | 다듬은 결과 | 다듬은 결과 유출(완화) | 유출(엄격 4글자) | 사용 | 의미 변경 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of ok) {
    const kind = r.kind === "question" ? "첫 질문" : "재확인";
    const used = r.used === "polished" ? "다듬은 문장" : "원문(유출)";
    section.push(`| ${kind} | ${r.bank_index} | ${cell(r.original)} | ${show(r.original_leaks)} | ${r.index} | ${cell(r.polished ?? "")} | ${show(r.polished_leaks)} | ${show(r.polished_strict)} | ${used} | |`);
  }
  return [...section, ...failures(mine)];
}

function generatedSection(title: string, mine: GeneratedRecord[]): string[] {
  const ok = mine.filter((r) => r.status === "ok");
  const section = [`\n### ${title} · LLM 생성(은행 없음)\n`, generatedSummary(mine), ""];
  section.push("| # | 최종 질문 | 처리 | 첫 생성 유출(완화) | 첫 생성 유출(엄격 4글자) | 범위 초과 |", "|---|---|---|---|---|---|");
  for (const r of ok) {
    const first = r.attempts[0]!;
    section.push(`| ${r.index} | ${cell(r.final!)} | ${r.handling} | ${show(first.leaks)} | ${show(first.strict)} | |`);
  }
  // 유출 검사에 걸린 질문 문장과 걸린 표현. 재생성 지시와 대체 질문을 판단한 근거다.
  const caught = ok.flatMap((r) => r.attempts.map((a, n) => ({ r, a, n })).filter(({ a }) => hasLeak(a.leaks)));
  if (caught.length) {
    section.push("", "유출 검사에 걸린 질문", "", "| # | 시도 | 질문 | 정답 용어 | 근거 문장 구 |", "|---|---|---|---|---|");
    for (const { r, a, n } of caught) {
      section.push(`| ${r.index} | ${n + 1} | ${cell(a.text)} | ${a.leaks.terms.join(", ") || "-"} | ${a.leaks.phrases.join(", ") || "-"} |`);
    }
  }
  return [...section, ...failures(mine)];
}

/** 처리 비율은 연결 오류를 뺀 질문으로 계산한다. */
function generatedSummary(rs: GeneratedRecord[]): string {
  const infra = rs.filter((r) => r.status === "infra_error").length;
  const format = rs.filter((r) => r.status === "format_error").length;
  const counted = rs.filter((r) => r.status !== "infra_error");
  const n = (h: Handling) => counted.filter((r) => r.handling === h).length;
  return (
    `통과 ${n("통과")}/${counted.length} (${pct(n("통과"), counted.length)}), ` +
    `재생성 ${n("재생성")} (${pct(n("재생성"), counted.length)}), ` +
    `대체 질문 ${n("대체 질문")} (${pct(n("대체 질문"), counted.length)}), ` +
    `형식 오류(빈 응답) ${format} (${pct(format, counted.length)}) · ` +
    `연결 오류 ${infra}개(비율에서 제외)`
  );
}

console.log(`결과 파일: ${records.path} (모델: ${model})`);
const lines: string[] = [];
const all: QuestionRecord[] = [];
for (const rubric of loadFinalRubrics()) {
  for (const concept of rubric.concepts) {
    const inName = answerTermsInName(rubric, concept);
    if (inName.length) console.warn(`\n경고: ${concept.concept_id}의 answer_terms 중 개념 이름에 든 말은 유출 검사에서 빠집니다: ${inName.join(", ")}`);
    const title = `${rubric.section} · ${concept.name} (\`${concept.concept_id}\`)`;
    if (concept.questions?.length || concept.recheck_questions?.length) {
      const mine = await bankSamples(rubric, concept);
      all.push(...mine);
      lines.push(...bankSection(title, mine));
    } else {
      const mine = await generatedSamples(rubric, concept);
      all.push(...mine);
      lines.push(...generatedSection(title, mine));
    }
  }
}

const totalCalls = all.reduce((s, r) => s + r.calls, 0);
const reconnects = all.reduce((s, r) => s + r.infra_retries.length, 0);
const infraTotal = all.filter((r) => r.status === "infra_error").length;
const report =
  `# 튜터 질문 표본 (${new Date().toISOString().slice(0, 10)}, 모델 ${model}, 은행 질문당 다듬기 ${polishCount}회, 은행 없는 개념당 생성 ${count}개)\n\n` +
  `Gemini 호출 ${totalCalls}회, 연결 재시도 ${reconnects}회, 연결 오류 ${infraTotal}개(비율에서 제외)\n` +
  lines.join("\n") +
  "\n";
process.stdout.write("\n");
if (skipped) console.log(`이전 기록 사용: ${skipped}개`);
if (out) {
  writeFileSync(out, report);
  console.log(`저장: ${out}`);
} else {
  console.log(report);
}
