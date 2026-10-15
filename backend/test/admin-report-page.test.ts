// 관리자 그림 보고서(frontend/login_ui/admin-report.js): 숫자 모으기·상태 규칙·그리기를 브라우저 없이 확인한다.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const { statusOf, summarize, renderReport } = await import(pathToFileURL(join(process.cwd(), "frontend", "login_ui", "admin-report.js")).href);

const empty = { ironmaking: null, steelmaking: null, continuous_casting: null, rolling: null };
const person = (over: Record<string, unknown>) => ({ id: "u", username: "trainee01", name: "김신입", employee_no: "T1", is_demo: false, created_at: "2026-10-01T00:00:00Z",
  last_activity: null, sections: empty, passed_sections: 0, in_progress_sections: [], misconceptions: { open: 0, resolved: 0 }, ...over });
const secs = ["ironmaking", "steelmaking"];
const trainees = {
  sections: secs, demo_sections: ["steelmaking"], include_demo: true, checkpoint_data: true,
  trainees: [
    person({ username: "trainee01", name: "<b>김</b>", passed_sections: 2, last_activity: "2026-10-14T06:05:00Z",
      sections: { ...empty, ironmaking: { understanding: 1, passed: true, attempts: 2 }, steelmaking: { understanding: 0.83, passed: true, attempts: 1 } } }),
    person({ username: "trainee02", sections: { ...empty, ironmaking: { understanding: 0.5, passed: false, attempts: 1 } }, misconceptions: { open: 2, resolved: 1 } }),
    person({ username: "trainee03", in_progress_sections: ["ironmaking"] }),
    person({ username: "trainee04" }),
  ],
};
const concepts = { concepts: [
  { section: "ironmaking", concept_id: "a", name: "소결의 목적", asked: 4, partial: 1, wrong: 1, assisted: 0, final_wrong: 0, open: 0 },
  { section: "ironmaking", concept_id: "b", name: "열풍로", asked: 2, partial: 0, wrong: 2, assisted: 0, final_wrong: 1, open: 1 },
  { section: "ironmaking", concept_id: "c", asked: 0, partial: 0, wrong: 0, assisted: 0, final_wrong: 0, open: 0 },
] };

test("상태 규칙은 관리자 화면과 같다: 수료 · 재도전 필요 · 진행 중 · 미시작", () => {
  assert.deepEqual(trainees.trainees.map((t) => statusOf(t, secs)), ["done", "retry", "active", "idle"]);
});

test("숫자 모으기: 상태 분포, 공정별 평균 이해도·통과율(전체 인원 대비), 오답률 순 개념", () => {
  const R = summarize(trainees, concepts);
  assert.equal(R.N, 4);
  assert.deepEqual(R.status, { done: 1, active: 1, retry: 1, idle: 1 });
  assert.equal(R.avg, (1 + 0.83 + 0.5) / 3);
  assert.equal(R.openMis, 2);
  const [ir, st] = R.bySection;
  assert.deepEqual([ir.taken, ir.avg, ir.passRate, ir.going], [2, 0.75, 0.25, 1]);
  assert.deepEqual([st.taken, st.avg, st.passRate, st.demo], [1, 0.83, 0.25, true]);
  assert.deepEqual(R.top.map((c: { concept_id: string }) => c.concept_id), ["b", "a"], "오답률 100% → 50%, 아직 안 물어본 개념은 뺌");
});

test("그리기: 차트 3개와 표, 이름은 HTML로 해석되지 않게 바꾼다", () => {
  const html = renderReport(summarize(trainees, concepts), new Date("2026-10-14T08:00:00Z"));
  assert.match(html, /작성 2026-10-14 17:00 \(한국 시간\)/);
  assert.equal((html.match(/<svg /g) || []).length, 3);
  assert.match(html, /통과 기준 80%/);
  assert.match(html, /1\. 열풍로/);
  assert.ok(html.includes("&lt;b&gt;김&lt;/b&gt;") && !html.includes("<b>김</b>"));
  assert.match(html, /재도전 필요/);
});
