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
  assert.match(src, /\['map', 'quiz', 'fault', 'whatif', 'incident'(, '[a-z]+')*\]\.includes\(lab\)/);
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
  assert.ok(src.includes("if (c.only && !c.only.has(h) && c.ups[h] !== undefined)") && src.includes("(지난번에 맞힌 칸)"));
  assert.ok(src.includes("c.ups[hop] = r.answer === 'up';"), "칸마다 방향을 기억해 다시 풀 때 맞힌 칸은 답만 보여 준다");
});

test("공장 전체 물류 흐름: 용선 → 용강 → 슬래브 → 코일 경로의 설비가 모두 화면 설비 목록(data_v2.js)에 있고, 앞 물질의 끝 설비에서 다음 물질이 시작한다", () => {
  const data = readFileSync(join(process.cwd(), "frontend", "3d-demo", "data_v2.js"), "utf8");
  const block = src.slice(src.indexOf("const MATERIAL_FLOW = ["), src.indexOf("let flowOn"));
  const routes = [...block.matchAll(/route: \[([^\]]+)\]/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  assert.equal(routes.length, 4);
  for (const id of routes.flat()) assert.ok(data.includes(`id: '${id}'`) || data.includes(`id: "${id}"`), `설비 ${id}`);
  for (let i = 1; i < routes.length; i++) assert.equal(routes[i][0], routes[i - 1].at(-1), `${i}번째 물질이 앞 물질 끝에서 시작`);
  assert.ok(src.includes("if (flowOn) { flowOn = false; bPlant.setAttribute('aria-pressed', 'false'); }"), "실습 패널을 열면 흐름 표시 상태를 끈다");
});

test("3D 이름표 겹침 정리: 아래 이름표부터 놓고 겹치면 위로 올린다(놓인 이름표 수만큼만 다시 본다)", () => {
  assert.ok(src.includes("shown.sort((a, b) => b.y - a.y)"));
  assert.ok(src.includes("guard <= placed.length"));
  assert.ok(src.includes("y = hit.t - 4;"));
});
