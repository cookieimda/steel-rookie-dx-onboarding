// 학습 페이지(frontend/login_ui/Trainee Dashboard.dc.html)의 공용 스타일 UI(둥근 모서리·Montserrat, 2026-10-15). 설계: docs/learning-diagonal-ui.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "frontend", "login_ui");
const css = readFileSync(join(root, "diagonal.css"), "utf8");

test("diagonal.css: 모서리·주황 토큰, 라이트 테마, 2D 모듈 색 덮어쓰기", () => {
  for (const t of ["--cut-l: 20px", "--cut: 14px", "--cut-s: 10px", "--orange: #ff9e64", "--ink-panel:"]) assert.ok(css.includes(t), t);
  assert.match(css, /body\[data-theme="light"\]\s*\{/);
  assert.match(css, /\.dg-cut\s*\{[^}]*border-radius:\s*var\(--c\)/);
  assert.doesNotMatch(css.replace(/@keyframes dg-pop\s*\{[\s\S]*?\n\}/, ""), /clip-path/); // 모서리는 자르지 않고 둥글린다(창이 뜨는 움직임에서만 쓴다)
  assert.match(css, /^process-2d\s*\{/m);
  assert.match(css, /body\[data-theme="light"\] process-2d\s*\{/);
});

test("diagonal.css: 포커스 테두리는 글자색, 라이트 테마 주황 글자는 진하게", () => {
  assert.match(css, /focus-visible\s*\{\s*outline:\s*none;\s*box-shadow:\s*inset 0 0 0 2px var\(--text\)/);
  assert.match(css, /body\[data-theme="light"\]\s*\{[^}]*--orange-text:\s*#9a4512/);
  assert.match(css, /\.dg-num\s*\{[^}]*color:\s*var\(--orange-text\)/);
});

const page = readFileSync(join(root, "Trainee Dashboard.dc.html"), "utf8");
const template = page.slice(0, page.indexOf('<script type="text/x-dc"'));

test("학습 페이지가 diagonal.css와 Montserrat 글꼴을 읽고, 영문·숫자는 Montserrat·한글은 Pretendard", () => {
  assert.match(page, /<link rel="stylesheet" href="\.\/diagonal\.css">/);
  assert.match(page, /family=Montserrat/);
  assert.doesNotMatch(page, /Chakra/);
  assert.match(css, /--font-ko:\s*"Montserrat",\s*"Pretendard"/);
  assert.match(css, /--font-en:\s*"Montserrat",\s*"Pretendard"/);
});

test("헤더·학습 영역: 구역 표시, 버튼 이름, 튜터 패널, 헤더는 LEARN & ASK·출처 배지 없음", () => {
  for (const k of ["header", "hero", "workspace"]) assert.ok(template.includes(`data-sec="${k}"`), k);
  assert.match(template, /<span class="dg-label">LEARN &amp; ASK<\/span>/);
  assert.doesNotMatch(template, /dg-badge|srcLabel/);
  assert.doesNotMatch(template, /\{\{ profile \}\}/);
  assert.match(template, />3D 공정 화면</);
  assert.doesNotMatch(template, /평가 시험 응시 ↗/);
  assert.match(template, /class="dg-ink dg-cut tutor[ "]/);
});

test("구역 순서: 헤더 → 불러오기 오류 줄 → 학습 영역(사원증 → 그 안의 복습)", () => {
  const at = ["header", "hero", "workspace", "card", "review"].map(k => template.indexOf(`data-sec="${k}"`));
  at.forEach((n, i) => assert.ok(n > 0, `data-sec ${i}번째 없음`));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test("템플릿에 모서리 값을 직접 쓰지 않는다(모서리는 공용 스타일의 dg-cut이 정한다, 점 표시의 50%만 허용)", () => {
  assert.doesNotMatch(template, /border-radius:\s*(999px|22px|18px|16px|14px|12px|10px)/);
  assert.doesNotMatch(template, /class="(card|folder|ftab)/);
});

test("평가 시험은 헤더 버튼 하나(아래 띠 없음), 내 오개념 탭 없음", () => {
  assert.match(template, /<a href="\/exam" target="_top" class="dg-btn dg-btn-primary[^"]*">평가 시험<\/a>/);
  assert.doesNotMatch(template, /data-sec="exam"|PROVE &amp; PASS/);
  assert.doesNotMatch(template, /data-sec="misconceptions"/);
  assert.doesNotMatch(page, /\['mis', /);
});

test("최종 검토 반영: 칩 포커스 2px, 펼침 줄 포커스", () => {
  assert.doesNotMatch(page, /'이해도 확인 전'/);
  assert.match(css, /\.dg-chip:focus-visible\s*\{\s*outline:\s*none;\s*box-shadow:\s*inset 0 0 0 2px var\(--text\)/);
  assert.match(css, /\.dg-acc summary:focus-visible\s*\{\s*outline:\s*2px solid var\(--text\)/);
});

test("UI 편집 반영: 튜터 칸 348px", () => {
  assert.match(page, /\.learn\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 348px/);
});

test("사원증(복습 포함)·학습 랩은 학습 모듈 탭에서 연다(내 현황·복습 탭 없음)", () => {
  assert.match(page, /\['steps', '작동 단계'\], \['lab', '학습 랩'\], \['blueprint', '설계도·필기'\], \['card', '사원증'\]\]/);
  const card = template.slice(template.indexOf('data-sec="card"'), template.indexOf('data-sec="lab"'));
  assert.ok(card.includes('data-sec="review"'), "복습은 사원증 판 안에");
  assert.doesNotMatch(template, /data-sec="status"/);
  const learn = template.slice(template.indexOf('data-sec="workspace"'), template.indexOf('<div class="side">'));
  for (const k of ["review", "card", "lab"]) assert.ok(learn.includes(`data-sec="${k}"`), `학습 모듈 안에 ${k}`);
  assert.doesNotMatch(template, /dg-split/);
});

test("등장 움직임: 창이 뜨듯 열리고, 움직임 줄이기 설정을 따른다", () => {
  assert.match(css, /\.dg-pop\s*\{\s*animation:\s*dg-pop/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^\n]*\.dg-pop \{ animation: none/);
  assert.match(page, /animationend[^;]*dg-pop[^;]*this\._align\(\)/);
});

test("학습 모듈: 탭이 판에 이어지고, 2D 모듈 판은 왼쪽 위만 각진 둥근 판, 글꼴 Montserrat, 튜터는 모듈 선에 맞춘다", () => {
  const mod = readFileSync(join(process.cwd(), "frontend", "3d-demo", "process-2d.js"), "utf8");
  const modCss = mod.slice(mod.indexOf("const CSS"), mod.indexOf("const DEFS"));
  assert.doesNotMatch(modCss, /clip-path/);
  assert.match(modCss, /\.root::before\{[^}]*border-radius:0 var\(--c\) var\(--c\) var\(--c\)/);
  assert.match(modCss, /:host\{display:block;font-family:"Montserrat","Pretendard"/);
  assert.doesNotMatch(modCss, /JetBrains/);
  // 배치(2026-10-15): 공정 토글은 제목 줄 오른쪽, 그림은 모듈 폭 전체, 설비 목록은 단계 설명 아래 가로 한 줄
  assert.match(modCss, /\.tabs\{[^}]*height:34px/);
  assert.match(mod, /<span class="hint">[^<]*<\/span><div class="tabs" id="tabs"/);
  assert.match(modCss, /\.layout\{display:flex;flex-direction:column/);
  assert.match(modCss, /\.ch-row\{display:grid;grid-auto-flow:column/);
  assert.match(mod, /<div id="stepcard"><\/div><\/div>\s*<aside class="chapters" id="chapters"/);
  assert.doesNotMatch(mod, /side2|class="ch next"/);
  assert.match(mod, /'다음 공정 →' : '← 이전 공정'/);
  assert.match(page, /step = sr\?\.querySelector\('#chapters'\)/); // 튜터 추천 질문·입력창은 설비 목록 줄에 맞춘다
  assert.match(template, /role="tablist" aria-label="학습 모듈" class="dg-ftabs"/);
  assert.match(template, /class="dg-mframe[^"]*" aria-label="설계도·필기"/);
  assert.match(css, /--module-bg:\s*rgba\(36, 33, 30, \.52\)/);
  assert.match(page, /alignTutor\(\)\s*\{/);
});

test("반투명 판·주황 버튼·선 없음: 배경 빛 번짐, 판 외곽선·고른 탭 주황 줄·구역 나눔 선 없음", () => {
  assert.match(css, /--blur:\s*blur\(18px\)/);
  assert.match(css, /\.dg-ink\s*\{[^}]*backdrop-filter:\s*var\(--blur\)/);
  // 검증 반영(2026-10-15): 주황으로 채운 버튼은 주 행동(평가 시험) 하나, 버튼에는 흐림 없음, 라이트 튜터는 그라데이션 대신 단색
  assert.match(css, /\.dg-btn-primary\s*\{\s*background:\s*var\(--orange\)/);
  assert.match(template, /class="dg-btn dg-btn-soft[^"]*">3D 공정 시연</); // 공정 화면(steel-index). '3D 공정 화면'은 처음 지도(steel-intro)로 가는 버튼(2026-10-19)
  assert.doesNotMatch(css, /\.dg-btn[^{]*\{[^}]*backdrop-filter/);
  assert.match(css, /body\[data-theme="light"\] \.dg-ink\s*\{[^}]*background:\s*#c9bab3/);
  assert.doesNotMatch(css, /\.dg-ftabs button\[aria-selected="true"\]::after/);
  assert.doesNotMatch(css, /\.dg-section\s*\{[^}]*border-top/);
  assert.match(css, /process-2d\s*\{\s*--frame:\s*transparent/);
});

test("제목띠 없음(2026-10-15): 제목·지금 공정 판·도넛 없이 헤더 바로 아래에서 학습 모듈이 시작하고, 불러오기 오류만 한 줄", () => {
  assert.doesNotMatch(template, /dg-title|dg-now|dg-donut|FORGE THE BASICS/);
  assert.doesNotMatch(css, /\.dg-hero|\.dg-now|dg-donut/);
  assert.match(template, /<span role="alert" class="dg-alert" data-sec="hero">\{\{ loadError \}\}<\/span>[\s\S]*data-sec="workspace"/);
});

test("검증 반영: 15px 미만 글자 없음, 탭 옆 개수, 추천 질문 두 개씩·화살표, 보내기는 흐리지 않게, 포석호 얼굴 가까이·따라 보기", () => {
  const mod = readFileSync(join(process.cwd(), "frontend", "3d-demo", "process-2d.js"), "utf8");
  const modCss = mod.slice(mod.indexOf("const CSS"), mod.indexOf("const DEFS"));
  assert.doesNotMatch(css, /font(-size)?:[^;]*\b1[0-4]px/);
  // 도면 표제란(그림의 일부, aria-hidden)은 2D 그림 라벨처럼 따로 정한다
  for (const line of template.split("\n").filter(l => !l.includes('aria-hidden="true"'))) assert.doesNotMatch(line, /font-size:\s*1[0-4]px/, line.trim().slice(0, 60));
  assert.doesNotMatch(modCss.slice(0, modCss.indexOf("const SCENE_CSS") > 0 ? modCss.indexOf("const SCENE_CSS") : undefined), /\.(tabs button|ch-go|ch \.k)\{[^}]*font-size:1[0-4]px/);
  assert.match(template, /<span class="dg-tab-count">\{\{ t\.count \}\}<\/span>/);
  assert.match(page, /chipsPage: all\.slice\(p \* 2, p \* 2 \+ 2\)/);
  assert.match(css, /\.dg-chips-row \.dg-chip\s*\{[^}]*white-space:\s*normal/);
  assert.match(page, /sendColor: S\.pending/);
  assert.doesNotMatch(template, /opacity:\{\{ sendOpacity \}\}/);
  assert.match(template, /framing="face" gaze="on"/);
  assert.match(css, /\.dg-input-field::placeholder\s*\{\s*color:\s*var\(--muted\);\s*opacity:\s*1/);
});
