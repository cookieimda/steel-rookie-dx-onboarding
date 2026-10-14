import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Rubric } from "../rubrics.js";
import type { CheckpointView, Section } from "../checkpoint/types.js";
import { parseSectionMarkdown, type Chunk } from "../../../llm/src/retrieval.js";
import type { PublicSource } from "../../../llm/src/ironmaking-sources.js";

export const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const koreanDay = (date = new Date()) => date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
const afterDays = (iso: string, days: number) => {
  const date = new Date(`${koreanDay(new Date(iso))}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export interface MaterialInput { section: Section; title: string; body: string; source_url: string; publisher: string }

export class EducationRepository {
  readonly rubricVersions = new Map<Section, string>();
  constructor(readonly db: DatabaseSync, readonly rubrics: readonly Rubric[]) {
    const add = db.prepare("INSERT OR IGNORE INTO rubric_versions(id,section,snapshot_json,created_at) VALUES(?,?,?,?)");
    for (const rubric of rubrics) {
      const version = hashOf(rubric);
      add.run(version, rubric.section, JSON.stringify(rubric), new Date().toISOString());
      this.rubricVersions.set(rubric.section, version);
    }
  }
  recordExam(userId: string, jobId: string, view: CheckpointView, metadata: Record<string, unknown>) {
    this.db.prepare("INSERT INTO exam_events(id,user_id,attempt_id,job_id,rubric_version,metadata_json,view_json,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), userId, view.attempt_id, jobId, this.rubricVersions.get(view.section)!, JSON.stringify(metadata), JSON.stringify(view), new Date().toISOString());
    if (view.state === "completed") this.syncReviews(userId);
  }
  history(userId: string, attemptId?: string, includeRubric = false) {
    const rows = attemptId
      ? this.db.prepare("SELECT e.*,v.snapshot_json FROM exam_events e JOIN rubric_versions v ON e.rubric_version=v.id WHERE e.user_id=? AND e.attempt_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 60").all(userId, attemptId)
      : this.db.prepare("SELECT e.*,v.snapshot_json FROM exam_events e JOIN rubric_versions v ON e.rubric_version=v.id WHERE e.user_id=? ORDER BY e.created_at DESC,e.rowid DESC LIMIT 30").all(userId);
    return rows.map((r) => ({ id: r.id, attempt_id: r.attempt_id, job_id: r.job_id, rubric_version: r.rubric_version,
      metadata: JSON.parse(String(r.metadata_json)), view: JSON.parse(String(r.view_json)),
      ...(includeRubric ? { rubric: JSON.parse(String(r.snapshot_json)) } : {}), created_at: r.created_at }));
  }
  syncReviews(userId: string) {
    const rows = this.db.prepare("SELECT r.*,a.section,a.completed_at FROM concept_results r JOIN attempts a ON r.attempt_id=a.id WHERE a.user_id=? AND a.state='completed' AND a.origin='live' ORDER BY a.completed_at DESC,a.rowid DESC").all(userId);
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.section}:${r.concept_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const concept = this.rubrics.find((rubric) => rubric.section === r.section)?.concepts.find((c) => c.concept_id === r.concept_id);
      if (!concept) continue;
      const verdict = r.recheck_verdict ?? r.verdict;
      const days = verdict !== "correct" ? 1 : r.recheck_verdict ? 3 : 7;
      const reason = verdict !== "correct" ? "다시 확인이 필요한 개념" : r.recheck_verdict ? "재확인 뒤 맞힌 개념" : "정답 개념의 간격 복습";
      const prior = this.db.prepare("SELECT based_attempt FROM review_tasks WHERE user_id=? AND section=? AND concept_id=?").get(userId, r.section, r.concept_id);
      if (prior?.based_attempt === r.attempt_id) continue;
      this.db.prepare("INSERT INTO review_tasks(id,user_id,section,concept_id,concept_name,due_date,reason,based_attempt,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,section,concept_id) DO UPDATE SET concept_name=excluded.concept_name,due_date=excluded.due_date,reason=excluded.reason,based_attempt=excluded.based_attempt,completed_at=NULL")
        .run(randomUUID(), userId, r.section, r.concept_id, concept.name, afterDays(String(r.completed_at), days), reason, r.attempt_id, new Date().toISOString());
    }
  }
  reviews(userId: string) {
    this.syncReviews(userId);
    return this.db.prepare("SELECT * FROM review_tasks WHERE user_id=? ORDER BY completed_at IS NOT NULL,due_date,concept_name").all(userId)
      .map((r) => ({ ...r, due: String(r.due_date) <= koreanDay(), completed: r.completed_at !== null }));
  }
  completeReview(userId: string, id: string) {
    return this.db.prepare("UPDATE review_tasks SET completed_at=? WHERE user_id=? AND id=?").run(new Date().toISOString(), userId, id).changes > 0;
  }
  createMaterial(userId: string, input: MaterialInput) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO education_materials(id,section,title,body,source_url,publisher,version,state,created_by,created_at) VALUES(?,?,?,?,?,?,?,'draft',?,?)")
      .run(id, input.section, input.title, input.body, input.source_url, input.publisher, hashOf(input), userId, new Date().toISOString());
    return this.db.prepare("SELECT * FROM education_materials WHERE id=?").get(id)!;
  }
  reviewMaterial(userId: string, id: string, state: "approved" | "rejected") {
    // Revisions create a new draft. Approved text and its version are immutable.
    return this.db.prepare("UPDATE education_materials SET state=?,reviewed_by=?,reviewed_at=? WHERE id=? AND state='draft'")
      .run(state, userId, new Date().toISOString(), id).changes > 0;
  }
  materials() { return this.db.prepare("SELECT * FROM education_materials ORDER BY created_at DESC").all(); }
  approvedSources(): PublicSource[] {
    return this.db.prepare("SELECT * FROM education_materials WHERE state='approved'").all().map((r) => ({
      id: `material-${r.id}`, title: String(r.title), url: String(r.source_url), publisher: String(r.publisher),
      date: koreanDay(new Date(String(r.reviewed_at))), date_type: "확인일", route: "비교", topics: [String(r.section)], notes: [],
    }));
  }
  approvedChunks(section: Section): Chunk[] {
    return this.db.prepare("SELECT * FROM education_materials WHERE state='approved' AND section=?").all(section).flatMap((r) => {
      const sourceId = `material-${r.id}`;
      const md = /^#{2,3}\s/m.test(String(r.body)) ? String(r.body) : `## ${String(r.title).replace(/[\r\n{}]/g, " ")}\n${r.body}`;
      const parts = parseSectionMarkdown(section, md).flatMap((c) => {
        const paragraphs = c.text.split(/\n\s*\n/).flatMap((p) => p.length > 900 ? p.split(/(?<=[.!?。])\s+/) : [p]);
        const text: string[] = [];
        let pending = "";
        for (const paragraph of paragraphs) {
          if (pending && pending.length + paragraph.length > 900) { text.push(pending); pending = ""; }
          pending = pending ? `${pending}\n\n${paragraph}` : paragraph;
        }
        if (pending) text.push(pending);
        return text.map((body) => ({ ...c, text: body }));
      });
      return parts.map((c, i) => ({ ...c, id: `${sourceId}-${String(r.version).slice(0, 12)}#${i + 1}`, source_ids: [sourceId] }));
    });
  }
}
