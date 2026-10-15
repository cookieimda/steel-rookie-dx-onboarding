// 간격 반복 복습(학습 랩). Anki·SuperMemo의 SM-2 규칙으로 다음 복습일을 정한다.
// 학습자가 스스로 매긴 기억 정도(grade)만 쓰고, 점수(이해도)에는 반영하지 않는다.

/** 0 다시(기억 안 남), 3 어려움, 4 보통, 5 쉬움. */
export const GRADES = [0, 3, 4, 5] as const;
export type Grade = (typeof GRADES)[number];

export interface SrState {
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  /** 다음 복습일(한국 시간 날짜, YYYY-MM-DD). */
  due_date: string;
  last_grade: Grade;
}

export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** 하루에 새로 꺼내는 카드 수(Anki 기본값처럼 적게 시작). */
export const NEW_PER_DAY = 5;
/** 이 간격(일) 이상이면 '장기 기억'으로 본다. */
export const MATURE_DAYS = 21;

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * 한 번 복습한 뒤의 상태. '다시'면 처음부터(오늘 다시 나옴), 그 밖에는 1일 → 6일 → 간격 × 쉬움 정도로 늘린다.
 * '어려움'은 간격을 조금만 늘리고(× 1.2), '쉬움'은 한 번 더 늘린다(× 1.3).
 */
export function nextReview(prev: SrState | null, grade: Grade, today: string): SrState {
  const ease0 = prev?.ease ?? START_EASE;
  const reps0 = prev?.reps ?? 0;
  const ease = Math.max(MIN_EASE, Number((ease0 + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))).toFixed(2)));
  if (grade < 3) {
    return { ease, interval_days: 0, reps: 0, lapses: (prev?.lapses ?? 0) + (reps0 > 0 ? 1 : 0), due_date: today, last_grade: grade };
  }
  let interval: number;
  if (reps0 === 0) interval = grade === 5 ? 2 : 1;
  else if (reps0 === 1) interval = grade === 3 ? 3 : 6;
  else {
    const base = Math.max(1, prev?.interval_days ?? 1);
    interval = Math.round(base * (grade === 3 ? 1.2 : grade === 5 ? ease * 1.3 : ease));
    interval = Math.max(base + 1, interval);
  }
  return { ease, interval_days: interval, reps: reps0 + 1, lapses: prev?.lapses ?? 0, due_date: addDays(today, interval), last_grade: grade };
}
