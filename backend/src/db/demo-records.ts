// 시연용 체크포인트 기록. 관리자 통계 화면을 채우려고 시연 신입사원 trainee02~20에게만 넣는다.
// trainee01은 팀원 실제 테스트용이라 시연 기록을 넣지 않는다(남아 있는 seed 기록은 지운다).
// 테이블은 001_checkpoint.sql이고, 이해도·해금은 scoring.ts 규칙으로 계산한다.
// 개념은 seed-demo-records.ts가 넘긴다: final 루브릭 개념, final 루브릭이 없는 섹션은 시연 목록(content/demo/sections.json). 개념이 없는 섹션은 기록을 만들지 않는다.
// 시연 기록 계정에는 users.is_demo = 1을 표시한다(006_demo_accounts.sql).
// 모든 기록은 origin = 'seed'(005_record_origin.sql). 실제 기록(live)은 지우지 않는다.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SECTION_ORDER } from "../checkpoint/types.js";
import { DEMO_ACCOUNTS, DEMO_RECORD_TRAINEES } from "../auth/demo-accounts.js";
import {
  applyRetry,
  conceptResult,
  conceptsToRetry,
  isUnlocked,
  understanding,
  type ConceptResult,
  type RecheckVerdict,
  type Verdict,
} from "../scoring.js";

export interface Concept {
  id: string;
  name: string;
}
export type SectionConcepts = Record<string, Concept[]>;

/** 사람마다 실력과 진도를 달리해 화면에서 차이가 보이게 한다. */
interface Profile {
  /** 첫 판정이 correct일 확률. */
  skill: number;
  /** 몇 번째 섹션까지 시도하는지(1~4). */
  reach: number;
  /** 마지막 섹션은 체크포인트를 하다 멈춘 상태로 둔다. */
  stopMidway: boolean;
  /** 80% 미달일 때 재도전하는 최대 횟수. 다 쓰면 '재도전 필요' 상태로 남는다. */
  retries: number;
  /**
   * 정해 둔 판정(시연용 계정). 섹션 → 시도(첫 시도, 재도전…) → 그 시도에서 묻는 개념 순서대로 [첫 판정, 재확인 판정].
   * 있는 섹션은 무작위 판정 대신 이것을 쓰고, 시도 수도 이 길이만큼이다. seed와 상관없이 같은 기록이 나온다.
   */
  script?: Partial<Record<string, [Verdict, RecheckVerdict | null][][]>>;
}

// trainee11~14는 처음 정한 그대로, 나머지는 아래 유형을 돌려 쓰며 실력을 조금씩 다르게 한다.
const PROFILES: Record<string, Profile> = {
  // 시연용 신입사원 2(홈 [시작하기]의 '시연용'): 틀림·부분·힌트 요청, 재도전 뒤 통과, 재도전 필요, 해결·미해결 오개념이 모두 보이게 판정을 정해 둔다.
  trainee02: {
    skill: 0.5, reach: 2, stopMidway: false, retries: 1,
    script: {
      // 제선: 첫 시도 50%(미달) → 재도전에서 모두 맞혀 통과. 틀렸던 두 개념의 오개념은 해결됨으로 바뀐다.
      ironmaking: [
        [["correct", null], ["wrong", "partial"], ["assisted", "wrong"]],
        [["partial", "correct"], ["wrong", "correct"]],
      ],
      // 제강: 67%(미달), 재도전 전. 끝내 틀린 개념의 오개념이 미해결로 남는다.
      steelmaking: [
        [["partial", "correct"], ["wrong", "wrong"], ["correct", null]],
      ],
    },
  },
  trainee11: { skill: 0.8, reach: 4, stopMidway: false, retries: 2 }, // 잘하는 편, 끝까지 감
  trainee12: { skill: 0.6, reach: 3, stopMidway: true, retries: 2 }, // 세 번째 섹션을 하다 멈춤
  trainee13: { skill: 0.4, reach: 2, stopMidway: false, retries: 1 }, // 재도전해도 잘 안 됨
  trainee14: { skill: 0.5, reach: 2, stopMidway: false, retries: 0 }, // 아직 재도전 전
};

const ARCHETYPES: Profile[] = [
  { skill: 0.8, reach: 4, stopMidway: false, retries: 2 }, // 잘하는 편
  { skill: 0.65, reach: 3, stopMidway: true, retries: 2 }, // 하다 멈춤
  { skill: 0.45, reach: 2, stopMidway: false, retries: 1 }, // 재도전해도 잘 안 됨
  { skill: 0.55, reach: 2, stopMidway: false, retries: 0 }, // 아직 재도전 전
  { skill: 0.7, reach: 4, stopMidway: true, retries: 1 }, // 꽤 하는 편, 마지막 섹션 진행 중
];

function profileOf(username: string, index: number): Profile {
  const fixed = PROFILES[username];
  if (fixed) return fixed;
  const base = ARCHETYPES[index % ARCHETYPES.length];
  // 같은 유형끼리도 결과가 갈리도록 사람마다 실력을 -0.05~+0.05 사이로 바꾼다(seed와 무관하게 고정).
  const jitter = (((index * 37) % 11) - 5) / 100;
  return { ...base, skill: Math.min(0.95, Math.max(0.2, base.skill + jitter)) };
}

const WRONG_ANSWERS = ["잘 모르겠어요.", "온도를 높이는 설비 같아요.", "쇳물을 식히는 곳이요.", "불순물을 넣는 단계예요."];
const PARTIAL_ANSWERS = ["대략 재료를 가공하는 곳이에요.", "다음 공정으로 보내는 설비예요.", "열을 쓰는 곳인데 정확히는 모르겠어요."];

/** 같은 seed면 같은 기록이 나오게 하는 작은 난수 생성기(mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_TRAINEES = DEMO_ACCOUNTS.filter((a) => a.role === "trainee").map((a) => a.username);
/** 실제 테스트용 시연 계정(trainee01). 시연 기록을 넣지 않는다. */
export const LIVE_TEST_TRAINEES = DEMO_TRAINEES.slice(0, 1);
/** 시연 기록을 넣는 계정(trainee02~20, users.is_demo = 1). */
export const SEEDED_TRAINEES = DEMO_RECORD_TRAINEES;

/**
 * 시연 신입사원 전체(trainee01~20)의 시연 기록(origin = 'seed')을 지우고, trainee02~20에게만 새로 만든다.
 * 다른 사용자의 기록과 실제 기록(live)은 건드리지 않는다.
 */
export function seedDemoRecords(db: DatabaseSync, concepts: SectionConcepts, seed: number, now = new Date()): { attempts: number; misconceptions: number } {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const firstVerdict = (skill: number): Verdict => {
    const r = random();
    if (r < skill) return "correct";
    return pick<Verdict>(["partial", "partial", "wrong", "assisted"]);
  };
  // 첫 판정을 놓친 개념이라 재확인에서 바로 다 맞히지는 못한다.
  const recheckVerdict = (skill: number): RecheckVerdict => {
    const r = random();
    return r < skill * 0.6 ? "correct" : r < skill * 0.6 + 0.3 ? "partial" : "wrong";
  };

  const counts = { attempts: 0, misconceptions: 0 };
  // 사람마다 2~3.5일 전부터 시작해 시도 사이에 몇 시간씩 띄운다.
  let clock = now.getTime();
  const tick = (minHours: number, maxHours: number) => {
    clock += (minHours + random() * (maxHours - minHours)) * 3600_000;
    return new Date(Math.min(clock, now.getTime() - 60_000)).toISOString();
  };

  db.exec("BEGIN");
  try {
    for (const username of DEMO_TRAINEES) {
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (user) clearSeed(db, String(user.id));
    }
    for (const [index, username] of SEEDED_TRAINEES.entries()) {
      const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (!user) continue;
      const userId = String(user.id);
      db.prepare("UPDATE users SET is_demo = 1 WHERE id = ?").run(userId);
      clock = now.getTime() - (2 + random() * 1.5) * 24 * 3600_000;
      const profile = profileOf(username, index);

      for (const [sectionIndex, section] of SECTION_ORDER.slice(0, profile.reach).entries()) {
        const sectionConcepts = concepts[section] ?? [];
        // 루브릭이 없는 섹션은 체크포인트를 볼 수 없으므로 기록을 만들지 않는다(관리자 화면에서 미시작). 그 뒤 섹션도 잠겨 있다.
        if (sectionConcepts.length === 0) break;
        const ids = sectionConcepts.map((c) => c.id);
        const nameOf = new Map(sectionConcepts.map((c) => [c.id, c.name]));
        const lastSection = sectionIndex === profile.reach - 1;
        let results = new Map<string, ConceptResult>();
        // 아직 해결되지 않은 오개념: concept_id → misconception id
        const openMis = new Map<string, string>();

        const plan = profile.script?.[section];
        for (let retry = 0; retry <= (plan ? plan.length - 1 : profile.retries); retry++) {
          const asked = retry === 0 ? ids : conceptsToRetry(ids, results);
          const stopHere = lastSection && profile.stopMidway && retry === 0;
          const answered = stopHere ? asked.slice(0, Math.max(1, Math.floor(asked.length / 2))) : asked;
          const attemptId = randomUUID();
          const createdAt = tick(retry === 0 ? 4 : 1, retry === 0 ? 14 : 5);
          const retried = new Map<string, ConceptResult>();
          const rows: unknown[][] = [];

          for (const [i, conceptId] of answered.entries()) {
            const planned = plan?.[retry]?.[i];
            const verdict = planned ? planned[0] : firstVerdict(profile.skill);
            const recheck = planned ? planned[1] : verdict === "correct" ? null : recheckVerdict(profile.skill);
            retried.set(conceptId, conceptResult(conceptId, verdict, recheck));
            const at = tick(0.02, 0.1);
            const name = nameOf.get(conceptId) ?? conceptId;
            rows.push([attemptId, conceptId, `${name}은(는) 어떤 일을 하나요?`, answerFor(verdict, name, pick), verdict, recheck,
              recheck ? `${name}에서 들어가는 것과 나오는 것은 무엇인가요?` : null, recheck ? answerFor(recheck, name, pick) : null, at]);

            const finalCorrect = (recheck ?? verdict) === "correct";
            if (verdict !== "correct" && !openMis.has(conceptId)) {
              const misId = randomUUID();
              db.prepare(`INSERT INTO misconceptions (id, user_id, section, concept_id, source, phase, attempt_id, answer_text, summary, resolved, resolved_at, created_at, origin)
                          VALUES (?, ?, ?, ?, 'checkpoint', 'initial', ?, ?, ?, 0, NULL, ?, 'seed')`)
                .run(misId, userId, section, conceptId, attemptId, String(rows.at(-1)![3]), `${name}의 역할을 다른 설비와 헷갈림`, at);
              openMis.set(conceptId, misId);
              counts.misconceptions++;
            }
            if (finalCorrect && openMis.has(conceptId)) {
              db.prepare("UPDATE misconceptions SET resolved = 1, resolved_at = ? WHERE id = ?").run(at, openMis.get(conceptId)!);
              openMis.delete(conceptId);
            }
          }

          results = retry === 0 ? retried : applyRetry(ids, results, retried);
          const done = !stopHere;
          const updatedAt = tick(0.05, 0.2);
          db.prepare(`INSERT INTO attempts (id, user_id, section, kind, state, resume_state, concept_ids, current_index, current_question, pending_answer,
                        understanding, unlocked, created_at, updated_at, completed_at, origin)
                      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'seed')`)
            .run(attemptId, userId, section, retry === 0 ? "first" : "retry", done ? "completed" : "awaiting_answer", JSON.stringify(asked),
              answered.length, done ? null : `${nameOf.get(asked[answered.length]) ?? ""}은(는) 어떤 일을 하나요?`,
              done ? understanding(ids, results) : null, done ? (isUnlocked(ids, results) ? 1 : 0) : null, createdAt, updatedAt, done ? updatedAt : null);
          const insertResult = db.prepare(`INSERT INTO concept_results (attempt_id, concept_id, question, answer, verdict, evidence, explain_from,
                                             recheck_question, recheck_answer, recheck_verdict, recheck_evidence, created_at, updated_at)
                                           VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?)`);
          for (const [attempt, conceptId, question, answer, verdict, recheck, recheckQuestion, recheckAnswer, at] of rows)
            insertResult.run(attempt as string, conceptId as string, question as string, answer as string, verdict as string,
              recheckQuestion as string | null, recheckAnswer as string | null, recheck as string | null, at as string, at as string);
          counts.attempts++;

          if (!done || isUnlocked(ids, results)) break;
        }
        // 통과하지 못했거나 중간에 멈춘 섹션 다음은 잠겨 있으므로 더 진행하지 않는다.
        if (!isUnlocked(ids, results)) break;
      }

      // 학습 모드에서 감지된 오개념(점수 반영 없음)도 한 사람에 하나씩 둔다.
      const learned = concepts[SECTION_ORDER[0]]?.[Math.floor(random() * (concepts[SECTION_ORDER[0]]?.length ?? 1))];
      if (learned) {
        db.prepare(`INSERT INTO misconceptions (id, user_id, section, concept_id, source, phase, attempt_id, answer_text, summary, resolved, resolved_at, created_at, origin)
                    VALUES (?, ?, ?, ?, 'learning', NULL, NULL, ?, ?, 0, NULL, ?, 'seed')`)
          .run(randomUUID(), userId, SECTION_ORDER[0], learned.id, `${learned.name}은(는) 쇳물을 직접 만드는 곳이죠?`, `${learned.name}의 역할을 고로와 헷갈림`, tick(0.5, 3));
        counts.misconceptions++;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return counts;
}

function answerFor(verdict: string, name: string, pick: <T>(list: readonly T[]) => T): string {
  if (verdict === "correct") return `${name}은(는) 앞 공정의 재료를 받아 다음 공정에 맞게 바꾸는 설비예요.`;
  if (verdict === "partial") return pick(PARTIAL_ANSWERS);
  if (verdict === "assisted") return "힌트를 보고 나서야 알았어요.";
  return pick(WRONG_ANSWERS);
}

/** 한 사용자의 시연 기록(origin = 'seed')만 지운다. 실제 기록은 남긴다. */
function clearSeed(db: DatabaseSync, userId: string): void {
  const attemptsOf = "SELECT id FROM attempts WHERE user_id = ? AND origin = 'seed'";
  db.prepare(`DELETE FROM concept_results WHERE attempt_id IN (${attemptsOf})`).run(userId);
  db.prepare(`DELETE FROM attempt_messages WHERE attempt_id IN (${attemptsOf})`).run(userId);
  db.prepare("DELETE FROM misconceptions WHERE user_id = ? AND origin = 'seed'").run(userId);
  db.prepare("DELETE FROM attempts WHERE user_id = ? AND origin = 'seed'").run(userId);
}
