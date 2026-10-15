// 3D 실습 패널(frontend/3d-demo/sim-lab.js) 접근성: 키보드·포커스·읽기 프로그램 문구가 빠지지 않게 소스로 확인한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const src = readFileSync(join(process.cwd(), "frontend", "3d-demo", "sim-lab.js"), "utf8");

test("3D 실습 패널: 전체 aria-live 대신 이름 있는 영역 + 상태 줄, Esc로 닫고 연 버튼으로 포커스를 돌려준다", () => {
  assert.doesNotMatch(src, /panel\.setAttribute\('aria-live'/, "패널 전체를 aria-live로 두지 않는다(슬라이더마다 다 읽음)");
  assert.match(src, /panel\.setAttribute\('role', 'region'\)/);
  assert.match(src, /live\.setAttribute\('role', 'status'\)/);
  assert.match(src, /e\.key === 'Escape' && mode/);
  assert.match(src, /launcherOf\[prev\]\?\.focus\(\)/);
  assert.match(src, /setAttribute\('aria-expanded'/);
  assert.match(src, /setAttribute\('aria-controls', 'sl-panel'\)/);
});

test("3D 실습 패널: 슬라이더는 단위 붙은 값을 읽고, 색으로만 보이던 '정상 범위 밖'을 글로도 둔다, 판정은 say로 읽는다", () => {
  assert.ok((src.match(/aria-valuetext/g) ?? []).length >= 5, "인과 지도·조업 실험 슬라이더 모두");
  assert.ok((src.match(/'sl-sr', ' · 정상 범위 밖'/g) ?? []).length >= 2, "인과 지도 값·이상 상황 계기");
  for (const where of ["verdict.replace", "say(`아니에요. ${res.hint}`)", "say(`맞아요. ${res3.explain}"]) assert.ok(src.includes(where), where);
  assert.match(src, /setAttribute\('aria-label', `\$\{n\.label\} 설명 닫기`\)/, "✕ 버튼에 이름");
  assert.match(src, /prefers-reduced-motion: reduce/);
});

test("3D 실습 패널 배치: 닫힌 패널은 숨기고(빈 띠 방지), 좁은 화면에서는 패널 아래 끝을 실행 버튼 묶음 위로 맞춘다", () => {
  assert.match(src, /\.sl-panel\[hidden\] \{ display: none !important; \}/);
  assert.match(src, /bottom: var\(--sl-panel-bottom, 152px\)/);
  assert.match(src, /new ResizeObserver\(fitPanel\)\.observe\(launch\)/);
  assert.match(src, /2D 보기에서는 공장 전체 보기를 쓸 수 없어요/);
});

test("사고 사례 갈림길 3D 재현: 학습 기록 링크(lab=incident)와 3D 패널이 같은 주소 규칙을 쓴다", () => {
  const extras = readFileSync(join(process.cwd(), "frontend", "login_ui", "lab-extras.js"), "utf8");
  assert.match(extras, /lab=incident&scenario=\$\{cur\.id\}&at=\$\{i\}&pick=\$\{pick\}/);
  assert.match(src, /\['map', 'quiz', 'fault', 'whatif', 'incident'\]\.includes\(lab\)/);
  assert.match(src, /incidentPanel\(opt\.scenario, Number\(opt\.at\), Number\(opt\.pick\)\)/);
  const dash = readFileSync(join(process.cwd(), "frontend", "login_ui", "Trainee Dashboard.dc.html"), "utf8");
  assert.match(dash, /<a class="ic-br-3d" href="\{\{ t\.brHref \}\}">/);
});

test("틀린 연결 → 튜터 질문: 3D 실습이 steel-tutor-draft를 보내고 v4가 입력창만 채운다(자동으로 보내지 않음)", () => {
  assert.match(src, /new CustomEvent\('steel-tutor-draft', \{ detail: \{ text \} \}\)/);
  assert.ok(src.includes("if (!r.correct) {") && src.includes("tutorBtn(hop === 1"), "인과 퀴즈 틀린 칸");
  assert.ok(src.includes("tutorBtn(step === 'cause'"), "이상 상황 틀린 원인·조치");
  const v4 = readFileSync(join(process.cwd(), "frontend", "3d-demo", "Steel Academy v4.dc.html"), "utf8");
  const hook = v4.split("\n").find((l) => l.includes("'steel-tutor-draft'")) ?? "";
  assert.match(hook, /this\.setState\(\{ input: t \}\); this\.openTutor\(\);/);
  assert.doesNotMatch(hook, /\.ask\(/, "질문을 바로 보내지 않는다(LLM 호출은 학습자가 보낼 때만)");
});

test("인과 지도 조건 링크: 바꾼 조정 값만 set=id:값으로 담고, 주소를 읽을 때 id·숫자를 검사하고 tour=1이면 따라가기를 시작한다", () => {
  assert.match(src, /&lab=map&set=\$\{changed\.join\(','\)\}\$\{tourToo \? '&tour=1' : ''\}/);
  assert.match(src, /\/\^\[a-z0-9_\]\{1,40\}\$\/\.test\(k \|\| ''\) && Number\.isFinite\(Number\(v\)\)/);
  assert.match(src, /if \(autoTour\) tour\.start\(\);/);
  assert.match(src, /linkOut\.select\(\)/, "클립보드가 막히면 주소 칸을 보여 주고 선택");
});

test("인과 퀴즈 틀린 칸만 다시 풀기: 틀린 칸을 길·칸으로 모으고, 다시 풀 때 맞힌 첫 칸은 답을 보여 주고 건너뛴다", () => {
  assert.ok(src.includes("↻ 틀린 칸만 다시 풀기 (${misses}칸)"));
  assert.match(src, /chains = \[\.\.\.wrong\.values\(\)\]\.map\(\(w\) => \(\{ \.\.\.w\.c, only: new Set\(w\.hops\) \}\)\)/);
  assert.ok(src.includes("if (c.only && !c.only.has(1))") && src.includes("(지난번에 맞힌 칸)"));
  assert.ok(src.includes("hop1_up: c.hop1_up"), "둘째 칸만 틀린 길도 첫 칸 방향을 기억");
});
