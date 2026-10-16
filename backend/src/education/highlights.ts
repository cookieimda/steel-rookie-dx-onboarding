// 채점 근거 하이라이트: 끝난 시험에서 내 답안의 어느 구절이 루브릭 핵심 요소(key_points)에 해당하는지 표시한다.
// 평가자(LLM)를 다시 부르지 않고, 답안을 구절로 나눠 핵심 요소와 두 글자 조각이 얼마나 겹치는지로 짚는 참고용 표시다(판정·점수는 바꾸지 않는다).
// 용어집 동의어(예: 쇳물 = 용선)는 같은 말로 본다. 평가자 근거(evidence)가 답안 속 문장이면 그 부분도 함께 표시한다.
// 핵심 요소는 시험이 끝난 뒤에만 보여 준다(진행 중인 시도는 409).
import express from "express";
import type { DatabaseSync } from "node:sqlite";
import { requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import type { Rubric } from "../rubrics.js";

export interface Segment { text: string; kp: number | null; evidence: boolean }
export interface KeyPointMatch { index: number; point: string; matched: boolean; score: number }

/** 이 값 이상 겹치면 그 구절이 핵심 요소를 말한 것으로 표시한다. */
export const MATCH_THRESHOLD = 0.3;

type Glossary = { term: string; aliases: string[] }[];
const normalize = (text: string, glossary: Glossary) => {
  let out = text.normalize("NFC");
  for (const g of glossary) for (const a of g.aliases) if (a) out = out.split(a).join(g.term);
  return out;
};
const bigrams = (text: string) => {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  return out;
};
/** 핵심 요소 조각 중 구절에 나온 비율(구절이 핵심 요소를 얼마나 덮는지). 아주 짧은 구절은 낮춘다. */
const coverage = (clause: Set<string>, point: Set<string>) => {
  if (!clause.size || !point.size) return 0;
  let n = 0;
  for (const b of point) if (clause.has(b)) n++;
  return (n / point.size) * Math.min(1, clause.size / 4);
};

/** 구절 나누기: 문장 끝·쉼표·줄바꿈·이어 주는 말 앞에서 자른다. 위치(start·end)를 지킨다. */
export function clauses(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[.!?。,;\n]+|\s(?=그리고|그래서|하지만|또한|그러면|따라서)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const end = m.index + m[0].length; if (text.slice(last, end).trim()) out.push({ start: last, end }); last = end; }
  if (text.slice(last).trim()) out.push({ start: last, end: text.length });
  return out;
}

export function highlightAnswer(answer: string, points: readonly string[], glossary: Glossary = [], evidence?: string | null): { segments: Segment[]; key_points: KeyPointMatch[] } {
  const parts = clauses(answer);
  const pointGrams = points.map((p) => bigrams(normalize(p, glossary)));
  const assigned = parts.map((c) => {
    const grams = bigrams(normalize(answer.slice(c.start, c.end), glossary));
    let best = -1, score = 0;
    pointGrams.forEach((pg, i) => { const s = coverage(grams, pg); if (s > score) { score = s; best = i; } });
    return { ...c, kp: score >= MATCH_THRESHOLD ? best : null, score };
  });
  // 평가자 근거가 답안에 그대로 있으면 그 범위, 아니면 근거와 가장 많이 겹치는 구절(0.5 이상)
  let ev: { start: number; end: number } | null = null;
  const e = (evidence ?? "").trim().replace(/^["'“‘「]|["'”’」]$/g, "");
  if (e.length >= 4) {
    const at = answer.indexOf(e);
    if (at >= 0) ev = { start: at, end: at + e.length };
    else {
      const eg = bigrams(normalize(e, glossary));
      const hit = assigned.map((c) => ({ c, s: coverage(bigrams(normalize(answer.slice(c.start, c.end), glossary)), eg) })).sort((a, b) => b.s - a.s)[0];
      if (hit && hit.s >= 0.5) ev = { start: hit.c.start, end: hit.c.end };
    }
  }
  // 구절 경계와 근거 경계로 잘라 조각마다 핵심 요소·근거 여부를 붙인다
  const cuts = new Set([0, answer.length, ...assigned.flatMap((c) => [c.start, c.end]), ...(ev ? [ev.start, ev.end] : [])]);
  const marks = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const [s, t] = [marks[i], marks[i + 1]];
    if (s === t) continue;
    const owner = assigned.find((c) => c.start <= s && t <= c.end);
    const seg = { text: answer.slice(s, t), kp: owner?.kp ?? null, evidence: !!ev && ev.start <= s && t <= ev.end };
    const prev = segments.at(-1);
    if (prev && prev.kp === seg.kp && prev.evidence === seg.evidence) prev.text += seg.text; else segments.push(seg);
  }
  const key_points = points.map((point, index) => {
    const best = Math.max(0, ...assigned.filter((c) => c.kp === index).map((c) => c.score));
    return { index, point, matched: assigned.some((c) => c.kp === index), score: Math.round(best * 100) / 100 };
  });
  return { segments, key_points };
}

/** GET /api/exams/:id/highlights: 끝난 내 시험의 개념별 첫 답·재확인 답 하이라이트. */
export function createHighlightRouter(auth: AuthDeps, db: DatabaseSync, rubrics: readonly Rubric[]): express.Router {
  const router = express.Router();
  router.get("/api/exams/:id/highlights", requireUser(auth), (req, res) => {
    const user = res.locals.user as User, id = String(req.params.id);
    const attempt = db.prepare("SELECT id, section, state FROM attempts WHERE id=? AND user_id=?").get(id, user.id);
    if (!attempt) { res.status(404).json({ error: "시험을 찾지 못했어요." }); return; }
    if (attempt.state !== "completed") { res.status(409).json({ error: "시험이 끝난 뒤에 볼 수 있어요." }); return; }
    const rubric = rubrics.find((r) => r.section === attempt.section);
    const glossary = (rubric?.glossary ?? []) as Glossary;
    const rows = db.prepare("SELECT concept_id, answer, verdict, evidence, recheck_answer, recheck_verdict, recheck_evidence FROM concept_results WHERE attempt_id=? ORDER BY rowid").all(id);
    const concepts = rows.flatMap((r) => {
      const concept = rubric?.concepts.find((c) => c.concept_id === r.concept_id);
      if (!concept) return [];
      const points = concept.key_points.map((k) => k.point);
      const one = (answer: unknown, verdict: unknown, evidence: unknown) => (answer == null ? null : { verdict: String(verdict), ...highlightAnswer(String(answer), points, glossary, evidence == null ? null : String(evidence)) });
      return [{ concept_id: concept.concept_id, name: concept.name, first: one(r.answer, r.verdict, r.evidence), recheck: one(r.recheck_answer, r.recheck_verdict, r.recheck_evidence) }];
    });
    res.json({ attempt_id: id, section: attempt.section, threshold: MATCH_THRESHOLD, concepts });
  });
  return router;
}
