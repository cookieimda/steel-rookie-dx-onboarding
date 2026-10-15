// 관리자 보고서: 신입사원 통계(traineeStats)를 엑셀에서 바로 열리는 CSV로 만든다(GET /api/admin/report.csv).
// 화면의 신입사원 명단과 같은 숫자를 쓴다. 오개념은 개수만 넣고 내용·답변 원문은 넣지 않는다(CLAUDE.md '오개념 기록').
import { SECTION_NAMES } from "../checkpoint/types.js";
import type { TraineeStat, TraineeStats } from "./trainee-stats.js";

/** 관리자 화면(Admin Dashboard.dc.html의 statusOf)과 같은 상태 규칙. */
export function traineeStatus(t: TraineeStat, sections: TraineeStats["sections"]): string {
  if (sections.length && t.passed_sections === sections.length) return "수료";
  if (sections.some((s) => t.sections[s] && !t.sections[s]!.passed)) return "재도전 필요";
  if (sections.some((s) => t.sections[s]) || t.in_progress_sections.length) return "진행 중";
  return "미시작";
}

/** 한국 시간 'YYYY-MM-DD HH:mm'. 값이 없으면 빈칸. */
const kst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul", hour12: false }).slice(0, 16) : "";

/** CSV 칸. 쉼표·따옴표·줄바꿈은 따옴표로 감싸고, =·+·-·@로 시작하는 글은 엑셀이 수식으로 읽지 않게 '를 붙인다. */
function cell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function traineeReportCsv(stats: TraineeStats): string {
  const secs = stats.sections;
  const header = [
    "이름", "아이디", "사번", "시연 계정", "상태", "통과 공정",
    ...secs.flatMap((s) => [`${SECTION_NAMES[s]} 이해도(%)`, `${SECTION_NAMES[s]} 결과`, `${SECTION_NAMES[s]} 시도 횟수`]),
    "미해결 오개념(개념 수)", "해결한 오개념(개념 수)", "마지막 학습", "가입일",
  ];
  const rows = stats.trainees.map((t) => [
    t.name, t.username, t.employee_no, t.is_demo ? "예" : "아니오", traineeStatus(t, secs), `${t.passed_sections}/${secs.length}`,
    ...secs.flatMap((s) => {
      const x = t.sections[s];
      if (x) return [Math.round(x.understanding * 100), x.passed ? "통과" : "미통과", x.attempts];
      return ["", t.in_progress_sections.includes(s) ? "진행 중" : "미응시", 0];
    }),
    t.misconceptions.open, t.misconceptions.resolved, kst(t.last_activity), kst(t.created_at).slice(0, 10),
  ]);
  // 엑셀이 한글을 UTF-8로 읽도록 BOM을 붙이고 줄 끝은 CRLF로 둔다.
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
