// 학습 페이지(frontend/login_ui/Trainee Dashboard.dc.html)의 비스듬한 모서리 UI. 설계: docs/learning-diagonal-ui.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "frontend", "login_ui");
const css = readFileSync(join(root, "diagonal.css"), "utf8");

test("diagonal.css: 모서리·주황 토큰, 라이트 테마, 2D 모듈 색 덮어쓰기", () => {
  for (const t of ["--cut-l: 22px", "--cut: 14px", "--cut-s: 8px", "--orange: #ff9e64", "--ink-panel:"]) assert.ok(css.includes(t), t);
  assert.match(css, /body\[data-theme="light"\]\s*\{/);
  assert.match(css, /\.dg-cut\s*\{[^}]*clip-path:\s*polygon/);
  assert.match(css, /^process-2d\s*\{/m);
  assert.match(css, /body\[data-theme="light"\] process-2d\s*\{/);
});

test("diagonal.css: 포커스 테두리는 글자색, 라이트 테마 주황 글자는 진하게", () => {
  assert.match(css, /focus-visible\s*\{\s*outline:\s*none;\s*box-shadow:\s*inset 0 0 0 2px var\(--text\)/);
  assert.match(css, /body\[data-theme="light"\]\s*\{[^}]*--orange-text:\s*#c25a1c/);
  assert.match(css, /\.dg-num\s*\{[^}]*color:\s*var\(--orange-text\)/);
});

const page = readFileSync(join(root, "Trainee Dashboard.dc.html"), "utf8");
const template = page.slice(0, page.indexOf('<script type="text/x-dc"'));

test("학습 페이지가 diagonal.css와 Chakra Petch 글꼴을 읽는다", () => {
  assert.match(page, /<link rel="stylesheet" href="\.\/diagonal\.css">/);
  assert.match(page, /family=Chakra\+Petch/);
});

test("헤더·제목띠·학습 영역: 구역 표시, 버튼 이름, 튜터 패널", () => {
  for (const k of ["header", "hero", "workspace"]) assert.ok(template.includes(`data-sec="${k}"`), k);
  assert.match(template, />3D 공정 화면</);
  assert.doesNotMatch(template, /평가 시험 응시 ↗/);
  assert.match(template, /class="dg-ink dg-cut tutor"/);
  assert.match(template, /\{\{ heroName \}\}/);
});

test("구역 순서: 헤더 → 제목띠 → 학습 영역 → 내 현황 → 복습 → 평가 시험 띠", () => {
  const at = ["header", "hero", "workspace", "status", "review", "exam"].map(k => template.indexOf(`data-sec="${k}"`));
  at.forEach((n, i) => assert.ok(n > 0, `data-sec ${i}번째 없음`));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("둥근 알약·카드 모서리를 쓰지 않는다(점 표시의 50%만 허용)", () => {
  assert.doesNotMatch(template, /border-radius:\s*(999px|22px|18px|16px|14px|12px|10px)/);
  assert.doesNotMatch(template, /class="(card|folder|ftab)/);
});

test("평가 시험 띠에 /exam 버튼, 오개념은 펼쳐 보기", () => {
  assert.match(template, /data-sec="exam"[\s\S]*href="\/exam"[\s\S]*평가 시험 응시 →/);
  assert.match(template, /<details class="dg-acc">/);
});

test("최종 검토 반영: 제목띠 문구 중복 없음, 고스트 요소 포커스 2px, 펼침 줄 포커스, 지금 공정 패널 role", () => {
  assert.doesNotMatch(page, /'이해도 확인 전'/);
  assert.match(css, /\.dg-chip:focus-visible::before[^{]*\{\s*inset:\s*2px/);
  assert.match(css, /\.dg-acc summary:focus-visible\s*\{\s*outline:\s*2px solid var\(--text\)/);
  assert.match(template, /class="dg-now dg-cut dg-l" role="group" aria-label="지금 공정 상태"|class="dg-now dg-cut dg-l" aria-label="지금 공정 상태" role="group"/);
});

test("UI 편집 반영: 내 현황·복습 한 줄, 불러오기 오류는 제목띠 한 줄, 튜터 칸 348px", () => {
  const split = template.slice(template.indexOf('class="dg-split"'), template.indexOf('data-sec="exam"'));
  assert.ok(split.includes('data-sec="status"') && split.includes('data-sec="review"'), "dg-split 안에 내 현황과 복습");
  assert.match(css, /\.dg-split\s*\{[^}]*grid-template-columns/);
  assert.match(template, /class="dg-hero-meta"[\s\S]*role="alert" class="dg-alert"[\s\S]*data-sec="workspace"/);
  assert.match(page, /\.learn\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 348px/);
  assert.match(css, /\.dg-hero\s*\{[^}]*minmax\(0, 1fr\) 348px/);
});
