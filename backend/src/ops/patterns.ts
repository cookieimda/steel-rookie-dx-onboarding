// 오답 패턴 분류(Knewton처럼 오개념을 유형별로 묶는다). LLM 없이 오개념 설명(summary)의 두 글자 조각 겹침으로 묶고,
// 묶음마다 자주 나온 낱말을 이름표로 단다. 관리자 화면에는 이름표(낱말)와 개수만 보여 준다(설명·답변 원문은 본인만, CLAUDE.md '오개념 기록').
// 개수는 체크포인트 기록(source = checkpoint)만, 시연 기록(seed)도 센다(관리자 통계와 같은 기준). 지금 루브릭·시연 목록에 있는 개념만 본다.
import type { DatabaseSync } from "node:sqlite";

export interface PatternItem { id: string; text: string; user_id: string; resolved: boolean }
export interface Pattern { keywords: string[]; count: number; learners: number; open: number; item_ids: string[] }

const PARTICLES = /(으로|에서|에게|까지|부터|보다|처럼|이나|이라|라고|하고|하는|하여|해서|한다|된다|이다|있다|없다|은|는|이|가|을|를|에|의|로|와|과|도|만|라)$/;
const STOP = new Set(["것으로", "것을", "것이", "것", "수", "때", "등", "및", "또는", "그리고", "오해", "잘못", "이해", "이해함", "생각", "생각함", "알고", "있음", "함", "있는", "없는", "대한", "관련", "역할", "의미",
  "헷갈림", "헷갈려", "헷갈", "혼동", "다른", "같은", "부분", "설명", "답함", "말함", "모름"]);
/** 낱말로 보지 않는 말끝(…다고·…라고·…ㄴ다 같은 서술). */
const VERBAL = /(다고|라고|한다|된다|는다|었다|였다|하는|되는|만드)$/;

/** 낱말(두 글자 이상, 조사 뗌, 흔한 말 뺌). */
export function words(text: string): string[] {
  return text.normalize("NFC").split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(PARTICLES, "")).filter((w) => w.length >= 2 && !STOP.has(w) && !VERBAL.test(w));
}
const bigrams = (text: string) => {
  const out = new Set<string>();
  for (const w of words(text)) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  return out;
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

/** 평균 연결(average linkage)로 묶는다. 묶음 사이 평균 유사도가 threshold 이상이면 합친다. */
export function clusterTexts(items: readonly PatternItem[], threshold = 0.22): Pattern[] {
  const grams = items.map((i) => bigrams(i.text));
  let groups = items.map((_, i) => [i]);
  const sim = (a: number[], b: number[]) => { let s = 0; for (const x of a) for (const y of b) s += jaccard(grams[x], grams[y]); return s / (a.length * b.length); };
  for (;;) {
    let best = -1, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) { const s = sim(groups[i], groups[j]); if (s > best) { best = s; bi = i; bj = j; } }
    if (best < threshold || bi < 0) break;
    groups = groups.filter((_, k) => k !== bi && k !== bj).concat([[...groups[bi], ...groups[bj]]]);
  }
  return groups.map((g) => {
    const freq = new Map<string, number>();
    for (const i of g) for (const w of new Set(words(items[i].text))) freq.set(w, (freq.get(w) ?? 0) + 1);
    const keywords = [...freq].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w);
    const members = g.map((i) => items[i]);
    return { keywords, count: members.length, learners: new Set(members.map((m) => m.user_id)).size, open: members.filter((m) => !m.resolved).length, item_ids: members.map((m) => m.id) };
  }).sort((a, b) => b.count - a.count || b.learners - a.learners);
}

export interface ConceptRef { section: string; concept_id: string; name: string }

/** 개념별 오답 패턴(관리자용: 이름표·개수만). */
export function misconceptionPatterns(db: DatabaseSync, concepts: readonly ConceptRef[]) {
  return concepts.map((c) => {
    const rows = db.prepare("SELECT id, user_id, summary, resolved FROM misconceptions WHERE source='checkpoint' AND section=? AND concept_id=?").all(c.section, c.concept_id)
      .map((r) => ({ id: String(r.id), user_id: String(r.user_id), text: String(r.summary), resolved: Number(r.resolved) === 1 }));
    const patterns = clusterTexts(rows).map(({ item_ids: _ids, ...p }) => p);
    return { ...c, total: rows.length, learners: new Set(rows.map((r) => r.user_id)).size, open: rows.filter((r) => !r.resolved).length, patterns };
  }).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
}

/** 내 오답 유형(본인 화면용: 내 설명을 묶어 보여 준다). */
export function myPatterns(db: DatabaseSync, userId: string, nameOf: (section: string, id: string) => string) {
  const rows = db.prepare("SELECT id, user_id, section, concept_id, summary, resolved FROM misconceptions WHERE user_id=? AND origin='live' ORDER BY created_at DESC").all(userId)
    .map((r) => ({ id: String(r.id), user_id: String(r.user_id), text: String(r.summary), resolved: Number(r.resolved) === 1, section: String(r.section), concept_id: String(r.concept_id) }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return clusterTexts(rows).map((p) => ({ ...p, items: p.item_ids.map((id) => { const r = byId.get(id)!; return { summary: r.text, concept: nameOf(r.section, r.concept_id), resolved: r.resolved }; }) }));
}
