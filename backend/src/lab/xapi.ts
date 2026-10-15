// 학습 기록을 xAPI(Experience API 1.0.3) 문장으로(학습 랩 'xAPI 기록'). 사내 LMS·LRS로 옮길 수 있는 표준 형식이다.
// 서버 기록(사원증 계산과 같은 MeRepository.cardEvents)은 저장하지 않고 그때그때 문장으로 바꾸고, 화면이 보낸 문장(설비를 살펴봄)만 xapi_statements에 둔다.
// 문장 id는 기록 내용으로 정해 같은 기록은 늘 같은 id다.
import { createHash } from "node:crypto";
import type { CardEvent, CardEventKind } from "../me/employee-card.js";
import { SECTION_NAMES, type Section } from "../checkpoint/types.js";

export const XAPI_VERSION = "1.0.3";
/** 이 서비스의 활동 IRI 기준(실제 접속 주소와 상관없는 이름 공간). */
export const BASE = "https://st-rookie.local";
const ADL = "http://adlnet.gov/expapi/verbs";
const OWN = `${BASE}/xapi/verbs`;

export const VERBS = {
  asked: { id: `${ADL}/asked`, ko: "질문함" },
  answered: { id: `${ADL}/answered`, ko: "답함" },
  completed: { id: `${ADL}/completed`, ko: "끝냄" },
  passed: { id: `${ADL}/passed`, ko: "통과함" },
  experienced: { id: `${ADL}/experienced`, ko: "살펴봄" },
  resolved: { id: `${OWN}/resolved`, ko: "해결함" },
  annotated: { id: `${OWN}/annotated`, ko: "필기함" },
  reviewed: { id: `${OWN}/reviewed`, ko: "복습함" },
  mastered: { id: `${ADL}/mastered`, ko: "스스로 답함" },
} as const;
export type VerbKey = keyof typeof VERBS;

export interface Statement {
  id: string;
  actor: { objectType: "Agent"; name: string; account: { homePage: string; name: string } };
  verb: { id: string; display: { "ko-KR": string } };
  object: { objectType: "Activity"; id: string; definition: { name: { "ko-KR": string }; type: string } };
  result?: { success?: boolean; completion?: boolean; score?: { scaled: number }; extensions?: Record<string, unknown> };
  context: { platform: string; language: string; extensions?: Record<string, unknown> };
  timestamp: string;
  stored: string;
  version: string;
}

export interface Names {
  equipment: (id: string) => string | undefined;
  concept: (section: string, id: string) => string | undefined;
}

const uuidFrom = (text: string): string => {
  const h = createHash("sha1").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const activity = (kind: string, id: string, name: string, type: string) =>
  ({ objectType: "Activity" as const, id: `${BASE}/activities/${kind}/${encodeURIComponent(id)}`, definition: { name: { "ko-KR": name }, type } });
const ACT = "http://adlnet.gov/expapi/activities";
const sectionName = (s?: string | null) => (s && SECTION_NAMES[s as Section]) || s || "학습";
const GRADE_LABEL: Record<number, string> = { 0: "다시", 3: "어려움", 4: "보통", 5: "쉬움" };

/** 서버 기록 하나 → 문장 하나(없으면 null). */
export function statementFor(e: CardEvent, actor: Statement["actor"], names: Names): Omit<Statement, "stored" | "version"> & { verbKey: VerbKey } | null {
  const sec = e.section ?? null;
  const equipment = (id?: string | null) => (id ? activity("equipment", id, names.equipment(id) ?? id, `${ACT}/simulation`) : activity("section", sec ?? "learning", sectionName(sec), `${ACT}/module`));
  const concept = (id?: string | null) => activity("concept", id ?? "unknown", (id && sec && names.concept(sec, id)) || `${sectionName(sec)} 개념`, `${ACT}/objective`);
  const section = () => activity("section", sec ?? "learning", `${sectionName(sec)} 이해도 확인`, `${ACT}/assessment`);
  const map: Record<CardEventKind, () => { verb: VerbKey; object: Statement["object"]; result?: Statement["result"] }> = {
    question: () => ({ verb: "asked", object: equipment(e.object_id) }),
    concept_correct: () => ({ verb: "answered", object: concept(e.object_id), result: { success: true, score: { scaled: 1 } } }),
    concept_partial: () => ({ verb: "answered", object: concept(e.object_id), result: { success: false, score: { scaled: 0.5 } } }),
    checkpoint_done: () => ({ verb: "completed", object: section(), result: { completion: true, ...(e.understanding == null ? {} : { score: { scaled: Math.round(e.understanding * 1000) / 1000 } }) } }),
    section_passed: () => ({ verb: "passed", object: section(), result: { success: true } }),
    supplement_resolved: () => ({ verb: "resolved", object: concept(e.object_id), result: { success: true, extensions: { [`${BASE}/xapi/ext/via`]: "보충학습" } } }),
    supplement_done: () => ({ verb: "completed", object: concept(e.object_id), result: { success: false, extensions: { [`${BASE}/xapi/ext/via`]: "보충학습" } } }),
    misconception_resolved: () => ({ verb: "resolved", object: concept(e.object_id), result: { success: true } }),
    sketch: () => ({ verb: "annotated", object: activity("blueprint", e.object_id ?? sec ?? "blueprint", `${sectionName(sec)} 설계도`, `${ACT}/media`) }),
    sr_review: () => {
      const eq = (e.object_id ?? "").replace(/^eq:/, "");
      return { verb: "reviewed", object: activity("review-card", e.object_id ?? "card", `${names.equipment(eq) ?? eq} 복습 카드`, `${ACT}/interaction`),
        result: { success: (e.grade ?? 0) >= 3, extensions: { [`${BASE}/xapi/ext/grade`]: GRADE_LABEL[e.grade ?? 0] ?? String(e.grade) } } };
    },
    socratic_reached: () => ({ verb: "mastered", object: equipment(e.object_id), result: { success: true, extensions: { [`${BASE}/xapi/ext/via`]: "소크라테스 모드" } } }),
    causal_correct: () => ({ verb: "answered", object: activity("causal-link", e.object_id ?? "link", "공정 인과 퀴즈", `${ACT}/interaction`), result: { success: true } }),
    fault_drill: () => ({ verb: "completed", object: activity("fault-drill", e.object_id ?? "drill", "이상 상황 훈련", `${ACT}/simulation`),
      result: { completion: true, ...(e.understanding == null ? {} : { score: { scaled: e.understanding } }) } }),
  };
  const m = map[e.kind]?.();
  if (!m) return null;
  return {
    id: uuidFrom(`${actor.account.name}|${e.kind}|${e.at}|${e.section ?? ""}|${e.object_id ?? ""}|${e.grade ?? ""}`),
    actor,
    verb: { id: VERBS[m.verb].id, display: { "ko-KR": VERBS[m.verb].ko } },
    verbKey: m.verb,
    object: m.object,
    ...(m.result ? { result: m.result } : {}),
    context: { platform: "ST-ROOKIE", language: "ko-KR", extensions: { [`${BASE}/xapi/ext/source`]: e.kind } },
    timestamp: e.at,
  };
}

export interface StoredStatementRow { id: string; verb: string; object_id: string; object_name: string; timestamp: string; stored: string }

/** 화면이 보낸 문장(지금은 설비 살펴봄만) → 문장. */
export function storedStatement(row: StoredStatementRow, actor: Statement["actor"]): Statement & { verbKey: VerbKey } {
  const verbKey = (row.verb in VERBS ? row.verb : "experienced") as VerbKey;
  return {
    id: row.id, actor, verb: { id: VERBS[verbKey].id, display: { "ko-KR": VERBS[verbKey].ko } }, verbKey,
    object: activity("equipment", row.object_id, row.object_name, `${ACT}/simulation`),
    context: { platform: "ST-ROOKIE", language: "ko-KR", extensions: { [`${BASE}/xapi/ext/source`]: "screen" } },
    timestamp: row.timestamp, stored: row.stored, version: XAPI_VERSION,
  };
}

export const actorOf = (user: { name: string; username: string }): Statement["actor"] =>
  ({ objectType: "Agent", name: user.name, account: { homePage: BASE, name: user.username } });
