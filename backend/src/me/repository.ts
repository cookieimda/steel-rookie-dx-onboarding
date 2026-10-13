// 개인 페이지 저장소. SQL은 이 파일에만 둔다.
import type { DatabaseSync } from "node:sqlite";
import type { Section } from "../checkpoint/types.js";
import { MISCONCEPTION_SOURCE_LABEL, type MisconceptionSource } from "../learning/labels.js";

export interface MyMisconception {
  id: string;
  section: Section;
  concept_id: string;
  source: MisconceptionSource;
  /** 화면 라벨: 학습 모드는 "대화 중 감지됨", 체크포인트는 "이해도 확인". */
  label: (typeof MISCONCEPTION_SOURCE_LABEL)[MisconceptionSource];
  summary: string;
  /** 오개념이 드러난 본인의 답변(학습 모드는 질문) 원문. */
  answer_text: string;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
}

export interface MyConceptResult {
  section: string;
  concept_id: string;
  verdict: string;
  recheck_verdict: string | null;
  updated_at: string;
}

export class MeRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** 한 사용자의 완료된 체크포인트 개념 결과. 최근 것부터. 신입사원 대시보드의 복습할 개념에 쓴다. */
  conceptResults(userId: string): MyConceptResult[] {
    return this.db
      .prepare(
        `SELECT a.section, c.concept_id, c.verdict, c.recheck_verdict, c.updated_at
           FROM concept_results c JOIN attempts a ON a.id = c.attempt_id
          WHERE a.user_id = ? AND a.state = 'completed'
          ORDER BY c.updated_at DESC`,
      )
      .all(userId)
      .map((row) => ({
        section: String(row.section),
        concept_id: String(row.concept_id),
        verdict: String(row.verdict),
        recheck_verdict: row.recheck_verdict == null ? null : String(row.recheck_verdict),
        updated_at: String(row.updated_at),
      }));
  }

  /** 한 사용자의 오개념. 최근 것부터. section을 주면 그 섹션만. */
  listMisconceptions(userId: string, section?: Section): MyMisconception[] {
    const rows = section
      ? this.db.prepare("SELECT * FROM misconceptions WHERE user_id = ? AND section = ? ORDER BY created_at DESC, id").all(userId, section)
      : this.db.prepare("SELECT * FROM misconceptions WHERE user_id = ? ORDER BY created_at DESC, id").all(userId);
    return rows.map((row) => {
      const source: MisconceptionSource = row.source === "learning" ? "learning" : "checkpoint";
      return {
        id: String(row.id),
        section: row.section as Section,
        concept_id: String(row.concept_id),
        source,
        label: MISCONCEPTION_SOURCE_LABEL[source],
        summary: String(row.summary),
        answer_text: String(row.answer_text),
        resolved: Number(row.resolved) === 1,
        created_at: String(row.created_at),
        resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
      };
    });
  }

  /** 마이페이지 '설계도·필기'의 펜 필기. 공정 하나의 도면별 획 목록(JSON 문자열 그대로). 008_learner_sketches.sql이 없으면 빈 객체. */
  sketches(userId: string, processId: string): Record<string, string> {
    try {
      const rows = this.db.prepare("SELECT draw_mode, strokes FROM learner_sketches WHERE user_id = ? AND process_id = ?").all(userId, processId);
      return Object.fromEntries(rows.map((r) => [String(r.draw_mode), String(r.strokes)]));
    } catch {
      return {};
    }
  }

  /** 도면 하나의 필기를 통째로 바꾼다. 획이 없으면 행을 지운다. */
  saveSketch(userId: string, processId: string, drawMode: string, strokes: string | null, now: string): void {
    if (strokes === null) {
      this.db.prepare("DELETE FROM learner_sketches WHERE user_id = ? AND process_id = ? AND draw_mode = ?").run(userId, processId, drawMode);
      return;
    }
    this.db.prepare(`INSERT INTO learner_sketches (user_id, process_id, draw_mode, strokes, updated_at) VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (user_id, process_id, draw_mode) DO UPDATE SET strokes = excluded.strokes, updated_at = excluded.updated_at`)
      .run(userId, processId, drawMode, strokes, now);
  }
}
