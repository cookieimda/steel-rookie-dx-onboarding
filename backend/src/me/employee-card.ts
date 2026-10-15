// 학습 기록 '사원증': 공부한 기록으로 경험치(XP)·연속 학습일·직급·배지를 계산한다(말해보카·듀오링고 참고).
// 새 테이블 없이 이미 쌓이는 기록(튜터 질문, 이해도 확인, 보충학습, 설계도 필기, 오개념 해결)만 읽는다. SQL은 me/repository.ts.
// 점수(이해도)와는 별개다. 이해도·통과 판정은 그대로 summarizeSection이 맡고, 여기 XP는 화면 동기 부여용이다.
import type { Section } from "../checkpoint/types.js";

/** 사원증 계산에 쓰는 기록 하나. at은 ISO 시각. */
export type CardEventKind =
  | "question" // 튜터에게 한 학습 질문(안전 안내로 돌린 질문 제외)
  | "concept_correct" // 이해도 확인에서 최종 1점으로 확정한 개념
  | "concept_partial" // 이해도 확인에서 최종 0.5점
  | "checkpoint_done" // 끝낸 이해도 확인 시도
  | "section_passed" // 통과(해금)한 이해도 확인 시도
  | "supplement_resolved" // 보충학습에서 오개념을 해결
  | "supplement_done" // 보충학습을 끝까지 함(해결 못 함)
  | "misconception_resolved" // 오개념이 해결됨으로 바뀜
  | "sketch" // 설계도·필기 도면 하나에 필기
  | "sr_review" // 학습 랩 간격 반복 카드 한 장 복습
  | "socratic_reached"; // 학습 랩 소크라테스 대화에서 스스로 답에 닿음

export interface CardEvent {
  kind: CardEventKind;
  at: string;
  section?: Section | string | null;
  /** 이해도 확인 시도의 이해도(0~1). checkpoint_done에만. */
  understanding?: number | null;
  /** 무엇에 대한 기록인지(설비·개념·도면·카드 id). xAPI 문장(lab/xapi.ts)의 대상으로 쓴다. */
  object_id?: string | null;
  /** 간격 반복 기억 정도(0·3·4·5). sr_review에만. */
  grade?: number | null;
}

export const XP: Record<CardEventKind, number> = {
  question: 10,
  concept_correct: 20,
  concept_partial: 10,
  checkpoint_done: 30,
  section_passed: 100,
  supplement_resolved: 40,
  supplement_done: 15,
  misconception_resolved: 15,
  sketch: 10,
  sr_review: 5,
  socratic_reached: 25,
};
/** 질문만 반복해 XP를 쌓지 않게 하루에 XP로 세는 질문 수. 질문 수(배지·미션)는 그대로 센다. */
export const DAILY_QUESTION_XP_CAP = 10;
/** 하루에 XP로 세는 개수 상한(같은 일을 반복해 XP를 쌓지 않게). 없는 종류는 상한 없음. */
export const DAILY_XP_CAPS: Partial<Record<CardEventKind, number>> = { question: DAILY_QUESTION_XP_CAP, sr_review: 20 };
/** 하루 목표 XP(듀오링고 '일일 목표'). */
export const DAILY_GOAL_XP = 50;

/** 직급(사원증 등급). 재질은 제철 공정 순서: 철광석 → 선철 → 강철 → 스테인리스 → 특수강 → 다마스커스. */
export const RANKS = [
  { level: 1, title: "수습사원", material: "철광석", key: "ore", min_xp: 0 },
  { level: 2, title: "사원", material: "선철", key: "pig", min_xp: 100 },
  { level: 3, title: "주임", material: "강철", key: "steel", min_xp: 300 },
  { level: 4, title: "대리", material: "스테인리스", key: "stainless", min_xp: 600 },
  { level: 5, title: "과장", material: "특수강", key: "special", min_xp: 1000 },
  { level: 6, title: "명장", material: "다마스커스", key: "damascus", min_xp: 1600 },
] as const;

export interface CardBadge {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  /** 진행도(예: 질문 50개 중 12개). 한 번에 얻는 배지는 0 또는 1. */
  progress: number;
  goal: number;
}

export interface CardMission {
  id: string;
  label: string;
  progress: number;
  goal: number;
  done: boolean;
  xp: number;
}

export interface EmployeeCard {
  xp: number;
  rank: (typeof RANKS)[number];
  next_rank: (typeof RANKS)[number] | null;
  /** 지금 직급 안에서 다음 직급까지 진행(0~1). 최고 직급이면 1. */
  rank_progress: number;
  xp_to_next: number;
  streak: { current: number; longest: number; today_done: boolean };
  /** 오늘 포함 최근 7일(오래된 날부터). */
  week: { date: string; xp: number; active: boolean }[];
  today: { date: string; xp: number; goal: number };
  missions: CardMission[];
  badges: CardBadge[];
  counts: { questions: number; sections_asked: number; sections_passed: number; supplements_resolved: number; misconceptions_resolved: number; sketches: number; perfect_checkpoints: number; active_days: number };
}

const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;
/** 날짜 경계는 한국 시간 자정. */
export const kstDay = (at: string | number | Date): string => new Date(new Date(at).getTime() + KST_MS).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** 날짜(한국 시간)별 XP. 하루 상한(DAILY_XP_CAPS)은 그날 앞쪽 기록부터 센다. 사원증과 주간 리그(lab/league.ts)가 같이 쓴다. */
export function dailyXp(events: readonly CardEvent[]): Map<string, number> {
  const xpByDay = new Map<string, number>();
  const counted = new Map<string, number>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = kstDay(e.at);
    const cap = DAILY_XP_CAPS[e.kind];
    const key = `${day}|${e.kind}`;
    const n = (counted.get(key) ?? 0) + 1;
    counted.set(key, n);
    const gain = cap !== undefined && n > cap ? 0 : XP[e.kind];
    xpByDay.set(day, (xpByDay.get(day) ?? 0) + gain);
  }
  return xpByDay;
}

export function buildEmployeeCard(events: readonly CardEvent[], now: Date = new Date()): EmployeeCard {
  const today = kstDay(now);
  const xpByDay = dailyXp(events);
  const count = (kind: CardEventKind, day?: string) => events.filter((e) => e.kind === kind && (!day || kstDay(e.at) === day)).length;
  const xp = [...xpByDay.values()].reduce((a, b) => a + b, 0);

  const rankIndex = RANKS.reduce((idx, r, i) => (xp >= r.min_xp ? i : idx), 0);
  const rank = RANKS[rankIndex];
  const next = RANKS[rankIndex + 1] ?? null;
  const rank_progress = next ? (xp - rank.min_xp) / (next.min_xp - rank.min_xp) : 1;

  // 연속 학습일: 오늘 했으면 오늘까지, 아직 안 했으면 어제까지 이어진 날 수(듀오링고처럼 오늘 안에 하면 이어진다).
  const active = new Set(events.map((e) => kstDay(e.at)));
  const today_done = active.has(today);
  let current = 0;
  for (let d = today_done ? today : addDays(today, -1); active.has(d); d = addDays(d, -1)) current += 1;
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...active].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, xp: xpByDay.get(date) ?? 0, active: active.has(date) };
  });
  const todayXp = xpByDay.get(today) ?? 0;

  const questions = count("question");
  const sectionsAsked = new Set(events.filter((e) => e.kind === "question" && e.section).map((e) => e.section)).size;
  const sectionsPassed = new Set(events.filter((e) => e.kind === "section_passed").map((e) => e.section)).size;
  const supplementsResolved = count("supplement_resolved");
  const misconceptionsResolved = count("misconception_resolved");
  const sketches = count("sketch");
  const perfect = events.filter((e) => e.kind === "checkpoint_done" && e.understanding === 1).length;

  const badge = (id: string, name: string, description: string, progress: number, goal: number): CardBadge =>
    ({ id, name, description, earned: progress >= goal, progress: Math.min(progress, goal), goal });
  const badges = [
    badge("first_question", "첫 질문", "AI 튜터에게 처음 질문하기", questions, 1),
    badge("curious", "호기심 대장", "튜터에게 질문 50개", questions, 50),
    badge("explorer", "공정 탐험가", "제선·제강·연주·압연 4개 공정 모두 질문하기", sectionsAsked, 4),
    badge("streak_3", "3일 연속", "3일 연속 학습", longest, 3),
    badge("streak_7", "일주일 개근", "7일 연속 학습", longest, 7),
    badge("first_pass", "첫 통과", "이해도 확인 통과하기", sectionsPassed, 1),
    badge("perfect", "만점", "이해도 확인을 100%로 끝내기", perfect, 1),
    badge("fixer", "오개념 해결사", "오개념 3개 해결", misconceptionsResolved, 3),
    badge("supplement", "보충학습 완주", "보충학습으로 오개념 해결하기", supplementsResolved, 1),
    badge("sketcher", "설계도 필기왕", "도면 3장에 필기하기", sketches, 3),
  ];

  // 오늘의 미션(말해보카 '오늘의 학습'): 오늘 기록만 센다.
  const mission = (id: string, label: string, progress: number, goal: number, kind: CardEventKind): CardMission =>
    ({ id, label, progress: Math.min(progress, goal), goal, done: progress >= goal, xp: XP[kind] * goal });
  const missions = [
    mission("ask_3", "AI 튜터에게 질문 3개", count("question", today), 3, "question"),
    mission("sketch_1", "설계도에 필기 1장", count("sketch", today), 1, "sketch"),
    mission("review_1", "간격 반복·보충학습·이해도 확인 중 1번",
      count("sr_review", today) + count("supplement_resolved", today) + count("supplement_done", today) + count("checkpoint_done", today), 1, "supplement_done"),
  ];

  return {
    xp,
    rank,
    next_rank: next,
    rank_progress,
    xp_to_next: next ? next.min_xp - xp : 0,
    streak: { current, longest, today_done },
    week,
    today: { date: today, xp: todayXp, goal: DAILY_GOAL_XP },
    missions,
    badges,
    counts: { questions, sections_asked: sectionsAsked, sections_passed: sectionsPassed, supplements_resolved: supplementsResolved,
      misconceptions_resolved: misconceptionsResolved, sketches, perfect_checkpoints: perfect, active_days: active.size },
  };
}
