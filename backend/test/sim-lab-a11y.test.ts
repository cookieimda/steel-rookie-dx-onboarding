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
