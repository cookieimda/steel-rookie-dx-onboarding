// 자료 검수 워크플로(012): 초안 → 검수 요청 → (수정 요청 → 수정본) → 승인·반려.
// education_materials.state(draft·approved·rejected)는 그대로 쓰고, 단계는 material_events 기록으로 정한다.
// 승인된 글은 바꾸지 않는다: 고칠 때는 수정본(새 자료, 새 version)을 만들고 material_revisions로 원본과 잇는다.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CheckpointError } from "../checkpoint/types.js";
import { hashOf } from "./repository.js";

export type Stage = "draft" | "in_review" | "changes_requested" | "approved" | "rejected";
export type MaterialAction = "created" | "submitted" | "commented" | "changes_requested" | "revised" | "approved" | "rejected" | "checked";
export const STAGE_LABEL: Record<Stage, string> = { draft: "초안", in_review: "검수 중", changes_requested: "수정 요청", approved: "승인", rejected: "반려" };

export interface MaterialRow { id: string; section: string; title: string; body: string; source_url: string; publisher: string; version: string; state: string; created_by: string; reviewed_by: string | null; created_at: string; reviewed_at: string | null }
export interface MaterialEvent { id: string; material_id: string; actor: string; action: MaterialAction; comment: string | null; created_at: string }

/** 기록으로 단계를 정한다. 승인·반려는 자료 상태가 정하고, 그 밖에는 마지막 단계 기록(검수 요청·수정 요청)을 따른다. */
export function stageOf(state: string, events: readonly Pick<MaterialEvent, "action">[]): Stage {
  if (state === "approved") return "approved";
  if (state === "rejected") return "rejected";
  const last = [...events].reverse().find((e) => e.action === "submitted" || e.action === "changes_requested");
  return last?.action === "submitted" ? "in_review" : last?.action === "changes_requested" ? "changes_requested" : "draft";
}

/** 줄 단위 비교(LCS). 수정본과 원본의 차이를 보여 준다. */
export function lineDiff(before: string, after: string): { op: "same" | "add" | "del"; text: string }[] {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  if (a.length * b.length > 400_000) return [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: "same" | "add" | "del"; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ op: "del", text: a[i++] });
  while (j < b.length) out.push({ op: "add", text: b[j++] });
  return out;
}

/**
 * 검수 도우미(오프라인 점검): 사람이 볼 곳을 짚는다. 승인 여부는 정하지 않는다.
 * 출처·분량·숫자(단위가 붙은 수치는 출처 확인)·문장 길이·공정 이름 언급을 본다.
 */
export function checkMaterial(m: Pick<MaterialRow, "title" | "body" | "source_url" | "publisher" | "section">, sectionName: string) {
  const notes: { level: "info" | "warn"; text: string }[] = [];
  const body = m.body.trim();
  const sentences = body.split(/(?<=[.!?。다요])\s+/).filter((x) => x.trim());
  if (body.length < 200) notes.push({ level: "warn", text: `본문이 짧아요(${body.length}자). 튜터 근거로 쓰기에 내용이 부족할 수 있어요.` });
  if (!m.source_url.startsWith("https://")) notes.push({ level: "warn", text: "출처 주소가 HTTPS가 아니에요." });
  const numbers = body.match(/\d[\d,.]*\s*(℃|°C|%|kg|t|톤|m|mm|분|시간|bar|MPa)/g) ?? [];
  if (numbers.length) notes.push({ level: "info", text: `단위가 붙은 수치 ${numbers.length}곳(${[...new Set(numbers)].slice(0, 5).join(", ")})은 출처 원문과 같은지 확인해 주세요.` });
  const long = sentences.filter((x) => x.length > 160).length;
  if (long) notes.push({ level: "info", text: `160자가 넘는 긴 문장이 ${long}개 있어요. 나누면 검색 근거로 쓰기 좋아요.` });
  if (!body.includes(sectionName) && !m.title.includes(sectionName)) notes.push({ level: "info", text: `제목·본문에 공정 이름(${sectionName})이 없어요. 다른 공정 자료가 아닌지 확인해 주세요.` });
  if (/(항상|절대|무조건|반드시)/.test(body)) notes.push({ level: "info", text: "단정하는 표현(항상·절대·무조건·반드시)이 있어요. 근거가 있는지 확인해 주세요." });
  if (!notes.length) notes.push({ level: "info", text: "눈에 띄는 문제는 없어요. 내용 정확성은 사람이 확인해 주세요." });
  return { notes, chars: body.length, sentences: sentences.length };
}

export class MaterialWorkflow {
  constructor(private readonly db: DatabaseSync) {}

  material(id: string): MaterialRow | null {
    return (this.db.prepare("SELECT * FROM education_materials WHERE id=?").get(id) as unknown as MaterialRow | undefined) ?? null;
  }
  events(materialId: string): MaterialEvent[] {
    return this.db.prepare("SELECT * FROM material_events WHERE material_id=? ORDER BY created_at, rowid").all(materialId) as unknown as MaterialEvent[];
  }
  log(materialId: string, actor: string, action: MaterialAction, comment: string | null = null): void {
    this.db.prepare("INSERT INTO material_events(id,material_id,actor,action,comment,created_at) VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), materialId, actor, action, comment, new Date().toISOString());
  }
  parentOf(id: string): string | null {
    return (this.db.prepare("SELECT parent_id FROM material_revisions WHERE material_id=?").get(id)?.parent_id as string | undefined) ?? null;
  }
  childrenOf(id: string): string[] {
    return this.db.prepare("SELECT material_id FROM material_revisions WHERE parent_id=?").all(id).map((r) => String(r.material_id));
  }
  stage(id: string): Stage {
    const m = this.material(id);
    if (!m) throw new CheckpointError(404, "자료를 찾지 못했어요.");
    return stageOf(m.state, this.events(id));
  }
  /** 목록: 자료마다 단계와 마지막 기록. stage로 거른다. */
  list(stage?: Stage) {
    const rows = this.db.prepare("SELECT * FROM education_materials ORDER BY created_at DESC").all() as unknown as MaterialRow[];
    return rows.map((m) => {
      const events = this.events(m.id);
      return { ...m, body: undefined, chars: m.body.length, stage: stageOf(m.state, events), last_event: events.at(-1) ?? null, parent_id: this.parentOf(m.id) };
    }).filter((m) => !stage || m.stage === stage);
  }
  detail(id: string) {
    const m = this.material(id);
    if (!m) throw new CheckpointError(404, "자료를 찾지 못했어요.");
    const events = this.events(id), parentId = this.parentOf(id), parent = parentId ? this.material(parentId) : null;
    return { material: m, stage: stageOf(m.state, events), events, parent_id: parentId, revisions: this.childrenOf(id),
      diff: parent ? lineDiff(parent.body, m.body) : null };
  }

  private need(id: string, allowed: Stage[], what: string): MaterialRow {
    const m = this.material(id);
    if (!m) throw new CheckpointError(404, "자료를 찾지 못했어요.");
    const stage = stageOf(m.state, this.events(id));
    if (!allowed.includes(stage)) throw new CheckpointError(409, `지금 단계(${STAGE_LABEL[stage]})에서는 ${what}할 수 없어요.`);
    return m;
  }
  submit(id: string, actor: string, comment?: string) { this.need(id, ["draft", "changes_requested"], "검수 요청"); this.log(id, actor, "submitted", comment ?? null); return this.detail(id); }
  comment(id: string, actor: string, comment: string) { this.need(id, ["draft", "in_review", "changes_requested"], "의견을 남길"); this.log(id, actor, "commented", comment); return this.detail(id); }
  requestChanges(id: string, actor: string, comment: string) { this.need(id, ["in_review"], "수정 요청"); this.log(id, actor, "changes_requested", comment); return this.detail(id); }
  /**
   * 승인·반려: 검수 중(또는 예전 방식대로 초안)인 자료만. 두 사람 검수(MATERIAL_TWO_PERSON=on)면 작성자는 자기 자료를 승인할 수 없다.
   * 기존 API(POST /api/admin/education/materials/:id/review)도 이 함수를 거친다.
   */
  decide(id: string, actor: string, decision: "approved" | "rejected", comment?: string) {
    const m = this.need(id, ["draft", "in_review"], decision === "approved" ? "승인" : "반려");
    if (decision === "approved" && process.env.MATERIAL_TWO_PERSON === "on" && m.created_by === actor) throw new CheckpointError(403, "작성자는 자기 자료를 승인할 수 없어요(두 사람 검수).");
    const changed = this.db.prepare("UPDATE education_materials SET state=?,reviewed_by=?,reviewed_at=? WHERE id=? AND state='draft'").run(decision, actor, new Date().toISOString(), id).changes;
    if (!changed) throw new CheckpointError(409, "이미 검수된 자료예요. 수정본은 새 자료로 등록해 주세요.");
    this.log(id, actor, decision, comment ?? null);
    return { ...this.detail(id), self_review: m.created_by === actor };
  }
  /** 수정본: 원본 글을 바탕으로 새 초안을 만든다(원본은 그대로). 수정 요청·반려·승인된 자료에서 만든다. */
  revise(id: string, actor: string, changes: Partial<Pick<MaterialRow, "title" | "body" | "source_url" | "publisher">>, comment?: string) {
    const m = this.need(id, ["changes_requested", "rejected", "approved"], "수정본을 만들");
    const next = { section: m.section, title: changes.title ?? m.title, body: changes.body ?? m.body, source_url: changes.source_url ?? m.source_url, publisher: changes.publisher ?? m.publisher };
    if (next.body === m.body && next.title === m.title && next.source_url === m.source_url && next.publisher === m.publisher) throw new CheckpointError(400, "바뀐 내용이 없어요.");
    const newId = randomUUID(), at = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO education_materials(id,section,title,body,source_url,publisher,version,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)")
        .run(newId, next.section, next.title, next.body, next.source_url, next.publisher, hashOf(next), actor, at);
      this.db.prepare("INSERT INTO material_revisions(material_id,parent_id) VALUES(?,?)").run(newId, id);
      this.log(id, actor, "revised", comment ?? null);
      this.log(newId, actor, "created", `수정본 · 원본 ${id.slice(0, 8)}`);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    return this.detail(newId);
  }
}
