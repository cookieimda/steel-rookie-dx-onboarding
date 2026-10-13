// 학습 모드 튜터 품질 평가: 실제 Gemini로 공정별 질문 세트(llm/eval/learning/{공정}.jsonl)를 돌려
// 근거 판정(grounded·unverified·safety_redirect), 화면 조작(scene_actions), 오개념 감지가 기대와 맞는지 센다.
// 실행: npm run eval:learning [-- --resume] [--follow-up] [--section 공정] [--records 파일.jsonl]
//  - 추천 질문(frontend/3d-demo/learning-suggestions.js)도 케이스로 만든다(유형 chip, grounded 기대, 화면 조작은 보지 않음).
//  - --section이면 그 공정의 케이스만 돌린다.
//  - --follow-up이면 grounded 답의 '생각해 보기'(follow_up)를 같은 화면에서 한 번 더 물어 근거 있는 답이 나오는지 센다.
//  - GEMINI_API_KEY 필요, npm test에는 포함하지 않는다. 라우트(backend/src/learning/routes.ts)와 같은 순서로
//    안전 질문 차단 → retrieve() → 튜터 1회를 부르고(이전 대화·학습자 메모 없음), 공정·설비 목록은 data_v2.js에서 읽는다.
//  - 결과는 케이스마다 --records(기본 llm/eval/results/learning.jsonl)에 바로 기록하고, 채점은 보고서를 만들 때 한다.
//    --resume이면 같은 모델·프롬프트로 끝난 케이스를 건너뛴다(기대값만 고치면 다시 부르지 않고 다시 채점된다).
//  - 케이스 사이에 EVAL_DELAY_MS(기본 1000ms)만큼 쉰다. 429·시간 초과·연결 실패는 run-log.ts의 재시도를 따른다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SECTION_ORDER, type Section } from "../../backend/src/checkpoint/types.js";
import { loadSceneCatalog } from "../../backend/src/learning/scene-catalog.js";
import { isSafetyQuestion } from "../../backend/src/learning/safety.js";
import { loadFinalRubrics } from "../../backend/src/rubrics.js";
import { DEFAULT_GEMINI_MODEL } from "../src/gemini.js";
import {
  GeminiLearningAgent,
  LearningFormatError,
  learningSystemPrompt,
  learningUserPrompt,
  SCENE_ACTION_TYPES,
  type LearningInput,
  type SceneAction,
} from "../src/learning-agent.js";
import { Retriever } from "../src/retrieval.js";
import { fingerprint, flag, InfraStreak, isInfraError, MAX_CONSECUTIVE_INFRA, openRecordFile, option, RESULTS_DIR, RetryingGeminiClient, sleep, type RunRecord } from "./run-log.js";

export const LEARNING_SET_DIR = join(process.cwd(), "llm", "eval", "learning");
const SectionId = z.enum(SECTION_ORDER as [Section, ...Section[]]);

const Action = z.object({ type: z.enum(SCENE_ACTION_TYPES), target_id: z.string() });
const CaseLine = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  question: z.string().min(1),
  /** process_id가 null이면 전체 공정 화면(답은 파일의 공정 기준). */
  screen: z.object({ process_id: SectionId.nullable(), equipment_id: z.string().nullable() }),
  expect: z.object({
    status: z.enum(["grounded", "unverified", "safety_redirect"]),
    /** 들어 있어야 하는 조작(순서 무관, 더 있어도 됨). []이면 조작이 없어야 하고, "any"면 보지 않는다. */
    scene: z.union([z.array(Action), z.literal("any")]),
    /** 감지돼야 하는 개념 id, 감지되면 안 되면 null. */
    misconception: z.string().nullable(),
    /** 답에 하나라도 들어 있어야 하는 말(예: 오개념을 바로잡는 "아니"). 없으면 보지 않는다. */
    answer_any: z.array(z.string().min(1)).optional(),
  }),
  note: z.string().optional(),
});
/** 평가 케이스. section은 파일 이름(llm/eval/learning/{section}.jsonl)에서 정한다. */
export type LearningCase = z.infer<typeof CaseLine> & { section: Section };

/** 공정별 질문 세트를 모두 읽는다. 케이스 id는 모든 파일에서 겹치면 안 된다. */
export function loadLearningSet(dir = LEARNING_SET_DIR): LearningCase[] {
  const cases = SECTION_ORDER.flatMap((section) => {
    const path = join(dir, `${section}.jsonl`);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.trim())
      .map(({ line, i }): LearningCase => {
        const parsed = CaseLine.safeParse(JSON.parse(line));
        if (!parsed.success) throw new Error(`${path}:${i + 1} 형식 오류: ${parsed.error.issues.map((x) => x.path.join(".")).join(", ")}`);
        if (parsed.data.screen.process_id && parsed.data.screen.process_id !== section) throw new Error(`${path}:${i + 1} 화면 공정이 파일과 다릅니다`);
        return { ...parsed.data, section };
      });
  });
  const ids = cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${dir} 케이스 id가 겹칩니다: ${dup}`);
  return cases;
}

export const SUGGESTIONS_PATH = join(process.cwd(), "frontend", "3d-demo", "learning-suggestions.js");
const Suggestions = z.object({ process: z.array(z.string().min(1)), equipment: z.record(z.string(), z.array(z.string().min(1))) });

/** 화면에 띄우는 추천 질문(공정별)을 케이스로 만든다. 버튼을 누르면 근거 있는 답이 나와야 한다. */
export async function loadSuggestionCases(path = SUGGESTIONS_PATH): Promise<LearningCase[]> {
  const mod = (await import(pathToFileURL(path).href)) as { SUGGESTIONS?: Record<string, unknown> };
  return SECTION_ORDER.flatMap((section) => {
    if (!mod.SUGGESTIONS?.[section]) return [];
    const s = Suggestions.parse(mod.SUGGESTIONS[section]);
    // 제선은 처음 만든 id(chip-설비-번호)를 그대로 쓴다(기존 기록과 이어지게).
    const prefix = section === "ironmaking" ? "chip" : `chip-${section}`;
    const make = (equipment_id: string | null, question: string, i: number): LearningCase => ({
      id: `${prefix}-${equipment_id ?? "process"}-${i + 1}`,
      type: "chip",
      question,
      section,
      screen: { process_id: section, equipment_id },
      expect: { status: "grounded", scene: "any", misconception: null },
    });
    return [...s.process.map((q, i) => make(null, q, i)), ...Object.entries(s.equipment).flatMap(([eq, qs]) => qs.map((q, i) => make(eq, q, i)))];
  });
}

export interface LearningRecord extends RunRecord {
  model: string;
  status: "grounded" | "unverified" | "safety_redirect" | "format_error" | "infra_error";
  scene_actions: SceneAction[];
  misconception: string | null;
  source_ids: string[];
  answer: string;
  /** --follow-up: 튜터가 낸 '생각해 보기' 질문과 그 질문을 다시 물었을 때의 근거 판정. */
  follow_up?: string | null;
  follow_up_status?: LearningRecord["status"] | null;
  infra_retries: string[];
  error?: string;
  at: string;
}

export interface Checks {
  status: boolean;
  scene: boolean | null;
  misconception: boolean;
  /** answer_any가 없으면 null(보지 않음). */
  answer: boolean | null;
}

/** 기대와 비교한다. scene이 "any"면, answer_any가 없으면 그 항목은 null(보지 않음). */
export function score(c: LearningCase, r: Pick<LearningRecord, "status" | "scene_actions" | "misconception" | "answer">): Checks {
  const scene =
    c.expect.scene === "any"
      ? null
      : c.expect.scene.length === 0
        ? r.scene_actions.length === 0
        : c.expect.scene.every((e) => r.scene_actions.some((a) => a.type === e.type && a.target_id === e.target_id));
  const answer = c.expect.answer_any ? c.expect.answer_any.some((w) => r.answer.includes(w)) : null;
  return { status: r.status === c.expect.status, scene, misconception: r.misconception === c.expect.misconception, answer };
}

const passed = (k: Checks) => k.status && k.scene !== false && k.misconception && k.answer !== false;
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const fmt = (actions: SceneAction[]) => (actions.length ? actions.map((a) => `${a.type}:${a.target_id}`).join(", ") : "(없음)");

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY가 없습니다. .env에 키를 넣고 다시 실행하세요.");
    process.exitCode = 1;
    return;
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const delayMs = Number(process.env.EVAL_DELAY_MS ?? 1000);
  const records = openRecordFile<LearningRecord>(option("records", join(RESULTS_DIR, "learning.jsonl")), flag("resume"));
  const rubrics = loadFinalRubrics();
  const rubricOf = (section: Section) => rubrics.find((r) => r.section === section);
  const scene = await loadSceneCatalog();
  const retriever = new Retriever({ glossaryFor: (s) => rubricOf(s)?.glossary ?? [] });
  const client = new RetryingGeminiClient();
  const agent = new GeminiLearningAgent(client);
  const streak = new InfraStreak();
  const followUp = flag("follow-up");
  const only = option("section", "");
  if (only && !SECTION_ORDER.includes(only as Section)) throw new Error(`--section은 ${SECTION_ORDER.join("|")} 중 하나입니다: ${only}`);
  const cases = [...loadLearningSet(), ...(await loadSuggestionCases())].filter((c) => !only || c.section === only);
  const done: { c: LearningCase; r: LearningRecord }[] = [];
  let skipped = 0;
  let stopped = false;
  // 라우트와 같은 입력: 답·검색은 케이스의 공정 기준, 화면은 케이스의 화면 그대로(전체 공정 화면이면 process_id null).
  const inputFor = (section: Section, question: string, screen: LearningCase["screen"]): LearningInput => ({
    section,
    question,
    screen: { ...screen, equipment_name: scene.processes.flatMap((p) => p.equipment).find((e) => e.id === screen.equipment_id)?.name ?? null },
    chunks: retriever.retrieve(section, question, { process_id: section, equipment_id: screen.equipment_id }),
    history: [],
    openMisconceptions: [],
    concepts: rubricOf(section)?.concepts.map((k) => ({ concept_id: k.concept_id, name: k.name })) ?? [],
    glossary: rubricOf(section)?.glossary ?? [],
    scene,
  });

  console.log(`결과 파일: ${records.path} (모델: ${model}, 케이스 ${cases.length}개${only ? `, ${only}만` : ""}${followUp ? ", 꼬리 질문 확인" : ""})`);
  for (const c of cases) {
    const input = inputFor(c.section, c.question, c.screen);
    const safety = isSafetyQuestion(c.question);
    // 모델·프롬프트(근거 조각·화면 목록 포함)·꼬리 질문 확인 여부가 같으면 같은 결과로 본다. 안전 질문은 모델을 부르지 않는다.
    const fp = safety ? fingerprint("safety", c.question) : fingerprint(model, learningSystemPrompt(input), learningUserPrompt(input), followUp ? "follow-up" : "");
    const prior = records.done(c.id, fp);
    if (prior) {
      done.push({ c, r: prior });
      skipped++;
      process.stdout.write("-");
      continue;
    }
    if (stopped) continue;

    client.reset();
    const base = { key: c.id, fingerprint: fp, model, at: new Date().toISOString() };
    let record: LearningRecord;
    if (safety) {
      record = { ...base, infra_error: false, status: "safety_redirect", scene_actions: [], misconception: null, source_ids: [], answer: "", infra_retries: [] };
    } else {
      try {
        const reply = await agent.reply(input);
        record = {
          ...base,
          infra_error: false,
          status: reply.status,
          scene_actions: reply.scene_actions,
          misconception: reply.detected_misconception?.concept_id ?? null,
          source_ids: reply.source_ids,
          answer: reply.answer,
          infra_retries: client.retries,
        };
        if (followUp) {
          record.follow_up = reply.status === "grounded" ? reply.follow_up : null;
          record.follow_up_status = null;
          if (record.follow_up) {
            if (delayMs) await sleep(delayMs);
            try {
              record.follow_up_status = (await agent.reply(inputFor(c.section, record.follow_up, c.screen))).status;
            } catch (error) {
              if (error instanceof LearningFormatError) record.follow_up_status = "format_error";
              else if (isInfraError(error)) record.follow_up_status = "infra_error";
              else throw error;
            }
          }
        }
      } catch (error) {
        if (error instanceof LearningFormatError) {
          record = { ...base, infra_error: false, status: "format_error", scene_actions: [], misconception: null, source_ids: [], answer: "", infra_retries: client.retries, error: error.message };
        } else if (isInfraError(error)) {
          record = { ...base, infra_error: true, status: "infra_error", scene_actions: [], misconception: null, source_ids: [], answer: "", infra_retries: client.retries, error: error.message };
        } else {
          throw error;
        }
      }
    }
    records.append(record);
    done.push({ c, r: record });
    process.stdout.write(record.infra_error ? "E" : passed(score(c, record)) ? "." : "x");
    if (streak.push(record.infra_error)) {
      console.error(`\n연결 오류가 ${MAX_CONSECUTIVE_INFRA}케이스 연속으로 나서 멈춥니다: ${record.error}`);
      console.error("원인(요청 한도·API 키·네트워크)을 확인한 뒤 --resume으로 이어서 실행하세요.");
      process.exitCode = 1;
      stopped = true;
      continue;
    }
    if (!safety && delayMs) await sleep(delayMs);
  }
  process.stdout.write("\n");
  if (skipped) console.log(`이전 기록 사용: ${skipped}개`);
  if (done.length < cases.length) console.log(`미실행: ${cases.length - done.length}개 (--resume으로 이어서 실행)`);
  report(done);
}

function report(all: { c: LearningCase; r: LearningRecord }[]): void {
  // 연결 오류는 튜터의 답이 아니므로 일치율에서 뺀다(개수만 표시).
  const infra = all.filter((o) => o.r.infra_error);
  const rows = all.filter((o) => !o.r.infra_error).map((o) => ({ ...o, k: score(o.c, o.r) }));
  const scene = rows.filter((o) => o.k.scene !== null);
  console.log(`\n전체 통과(모든 항목): ${rows.filter((o) => passed(o.k)).length}/${rows.length} (${pct(rows.filter((o) => passed(o.k)).length, rows.length)})`);
  console.log(`  근거 판정: ${rows.filter((o) => o.k.status).length}/${rows.length} (${pct(rows.filter((o) => o.k.status).length, rows.length)})`);
  console.log(`  화면 조작: ${scene.filter((o) => o.k.scene).length}/${scene.length} (${pct(scene.filter((o) => o.k.scene).length, scene.length)}, "any" ${rows.length - scene.length}개 제외)`);
  console.log(`  오개념 감지: ${rows.filter((o) => o.k.misconception).length}/${rows.length} (${pct(rows.filter((o) => o.k.misconception).length, rows.length)})`);
  const checked = rows.filter((o) => o.k.answer !== null);
  if (checked.length) console.log(`  답변 내용(answer_any): ${checked.filter((o) => o.k.answer).length}/${checked.length}`);
  console.log(`  형식 오류(format_error): ${rows.filter((o) => o.r.status === "format_error").length}개, 연결 오류(infra_error, 제외): ${infra.length}개`);

  const asked = rows.filter((o) => o.r.follow_up && o.r.follow_up_status && o.r.follow_up_status !== "infra_error");
  if (asked.length) {
    const grounded = asked.filter((o) => o.r.follow_up_status === "grounded");
    console.log(`  꼬리 질문('생각해 보기')을 다시 물었을 때 grounded: ${grounded.length}/${asked.length} (${pct(grounded.length, asked.length)})`);
    for (const o of asked.filter((x) => x.r.follow_up_status !== "grounded")) console.log(`    - ${o.c.id}: "${o.r.follow_up}" → ${o.r.follow_up_status}`);
  }

  console.log("\n공정별 전체 통과");
  for (const section of SECTION_ORDER) {
    const subset = rows.filter((o) => o.c.section === section);
    if (subset.length) console.log(`  ${section}: ${subset.filter((o) => passed(o.k)).length}/${subset.length}`);
  }

  console.log("\n유형별 전체 통과");
  for (const type of [...new Set(rows.map((o) => o.c.type))]) {
    const subset = rows.filter((o) => o.c.type === type);
    console.log(`  ${type}: ${subset.filter((o) => passed(o.k)).length}/${subset.length}`);
  }

  const misses = rows.filter((o) => !passed(o.k));
  console.log(`\n틀린 케이스 ${misses.length}개`);
  for (const { c, r, k } of misses) {
    const what = [!k.status && `근거 ${c.expect.status}→${r.status}`, k.scene === false && `화면 기대 ${fmt(c.expect.scene as SceneAction[])} → ${fmt(r.scene_actions)}`, !k.misconception && `오개념 ${c.expect.misconception}→${r.misconception}`, k.answer === false && `답에 ${c.expect.answer_any!.join("·")} 중 하나도 없음`].filter(Boolean);
    console.log(`- ${c.id} [${c.type}] ${c.question}`);
    console.log(`    ${what.join(" | ")}`);
    if (r.answer) console.log(`    답변: ${r.answer.slice(0, 160)}`);
    if (r.error) console.log(`    오류: ${r.error}`);
    if (c.note) console.log(`    메모: ${c.note}`);
  }
  for (const o of infra) console.log(`- ${o.c.id} 연결 오류: ${o.r.error}`);
}

// 테스트에서 import할 때는 실행하지 않는다.
if (process.argv[1]?.endsWith("run-learning.js")) await main();
