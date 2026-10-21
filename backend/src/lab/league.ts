// 주간 리그(학습 랩, 듀오링고 리그 참고). 사원증과 같은 XP(me/employee-card.ts의 dailyXp)를 주(월~일, 한국 시간)마다 더해 겨룬다.
// 따로 저장하지 않고 지난 기록으로 매번 다시 계산한다: 모두 브론즈에서 시작해, 지난 주마다 같은 리그 안 순위로 승급·강등한다.
import { dailyXp, kstDay, type CardEvent } from "../me/employee-card.js";
import { addDays } from "./spaced.js";

export const LEAGUES = [
  { key: "bronze", name: "브론즈" },
  { key: "silver", name: "실버" },
  { key: "gold", name: "골드" },
  { key: "sapphire", name: "사파이어" },
  { key: "ruby", name: "루비" },
  { key: "diamond", name: "다이아몬드" },
] as const;

/** 한 주 리그에서 위쪽 30%(XP가 있는 사람만) 승급, 아래쪽 20% 강등. 인원이 적어도 승급은 1명. */
export const PROMOTE_RATE = 0.3;
export const DEMOTE_RATE = 0.2;

export interface LeagueMember { id: string; name: string }
export type Zone = "promote" | "stay" | "demote";

export interface LeagueView {
  week: { start: string; end: string; ends_at: string };
  league: { index: number; key: string; name: string };
  board: { rank: number; name: string; me: boolean; xp: number; zone: Zone }[];
  me: { rank: number; xp: number; zone: Zone; to_promote: number | null } | null;
  /** 지난 주들(오래된 것부터 최대 6주): 그 주 리그와 결과. */
  history: { week_start: string; league: string; rank: number; size: number; xp: number; result: "up" | "down" | "stay" }[];
}

/** 그 날짜가 든 주의 월요일. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 일요일
  return addDays(day, -((dow + 6) % 7));
}

/** 다른 사람 이름은 가운데를 가린다(정다은 → 정*은, 김철 → 김*). */
export function maskName(name: string): string {
  const s = [...name.trim()];
  if (s.length <= 1) return s.join("") || "익명";
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${"*".repeat(s.length - 2)}${s[s.length - 1]}`;
}

/** 순위별 구역. 맨 위 리그는 승급이, 맨 아래 리그(브론즈)는 강등이 없다. */
function zones(ranked: { id: string; xp: number }[], tier: number): Map<string, Zone> {
  const n = ranked.length;
  const out = new Map<string, Zone>();
  const promote = tier < LEAGUES.length - 1 ? Math.max(1, Math.floor(n * PROMOTE_RATE)) : 0;
  const demote = tier > 0 && n >= 5 ? Math.floor(n * DEMOTE_RATE) : 0;
  ranked.forEach((r, i) => out.set(r.id, i < promote && r.xp > 0 ? "promote" : i >= n - demote ? "demote" : "stay"));
  return out;
}

const rankBy = (ids: string[], xp: (id: string) => number) =>
  ids.map((id) => ({ id, xp: xp(id) })).sort((a, b) => b.xp - a.xp || a.id.localeCompare(b.id));

export function computeLeague(members: readonly LeagueMember[], eventsOf: (id: string) => readonly CardEvent[], meId: string, now: Date = new Date()): LeagueView {
  const thisWeek = weekStart(kstDay(now));
  const weekly = new Map<string, Map<string, number>>();
  let first = thisWeek;
  for (const m of members) {
    const byWeek = new Map<string, number>();
    for (const [day, xp] of dailyXp(eventsOf(m.id))) {
      const w = weekStart(day);
      byWeek.set(w, (byWeek.get(w) ?? 0) + xp);
      if (w < first && xp > 0) first = w;
    }
    weekly.set(m.id, byWeek);
  }
  const xpIn = (id: string, w: string) => weekly.get(id)?.get(w) ?? 0;

  const tier = new Map(members.map((m) => [m.id, 0]));
  const history: LeagueView["history"] = [];
  for (let w = first; w < thisWeek; w = addDays(w, 7)) {
    const next = new Map(tier);
    for (let t = 0; t < LEAGUES.length; t++) {
      const ranked = rankBy(members.filter((m) => tier.get(m.id) === t).map((m) => m.id), (id) => xpIn(id, w));
      const z = zones(ranked, t);
      ranked.forEach((r, i) => {
        const zone = z.get(r.id)!;
        const up = zone === "promote", down = zone === "demote";
        next.set(r.id, t + (up ? 1 : down ? -1 : 0));
        if (r.id === meId) history.push({ week_start: w, league: LEAGUES[t].name, rank: i + 1, size: ranked.length, xp: r.xp, result: up ? "up" : down ? "down" : "stay" });
      });
    }
    for (const [id, t] of next) tier.set(id, t);
  }

  const myTier = tier.get(meId) ?? 0;
  const ranked = rankBy(members.filter((m) => (tier.get(m.id) ?? 0) === myTier).map((m) => m.id), (id) => xpIn(id, thisWeek));
  const z = zones(ranked, myTier);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const board = ranked.map((r, i) => ({ rank: i + 1, name: r.id === meId ? nameOf.get(r.id) ?? "나" : maskName(nameOf.get(r.id) ?? ""), me: r.id === meId, xp: r.xp, zone: z.get(r.id)! }));
  const mine = board.find((b) => b.me) ?? null;
  // 승급 구역 마지막 사람을 넘으려면 필요한 XP(이미 승급 구역이면 null)
  const lastPromote = [...board].reverse().find((b) => b.zone === "promote");
  const to_promote = mine && mine.zone !== "promote" ? (lastPromote ? lastPromote.xp - mine.xp + 1 : Math.max(1, 1 - mine.xp)) : null;
  const end = addDays(thisWeek, 6);
  return {
    week: { start: thisWeek, end, ends_at: new Date(Date.parse(`${addDays(thisWeek, 7)}T00:00:00+09:00`)).toISOString() },
    league: { index: myTier, key: LEAGUES[myTier].key, name: LEAGUES[myTier].name },
    board,
    me: mine ? { rank: mine.rank, xp: mine.xp, zone: mine.zone, to_promote } : null,
    history: history.slice(-6),
  };
}
