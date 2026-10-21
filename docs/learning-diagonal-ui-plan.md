# 학습 페이지 Diagonal UI 구현 계획

> **에이전트 작업자용:** 필수 하위 스킬: superpowers:subagent-driven-development(권장) 또는 superpowers:executing-plans로 작업 단위마다 진행한다. 단계는 체크박스(`- [ ]`)로 표시한다.

**목표:** 신입사원 학습 페이지(`Trainee Dashboard.dc.html`)를 비스듬한 모서리(Diagonal) UI로 바꾸고, 정보 순서를 "학습 → 내 현황 → 복습 → 평가 시험"으로 다시 짠다.

**구조:** 공용 스타일 `frontend/login_ui/diagonal.css`에 토큰(색·글꼴·`--cut`)과 `dg-` 접두사 클래스를 두고, 학습 페이지는 인라인 스타일 대신 이 클래스를 쓴다. 토큰 이름(`--bg`, `--text`, `--line` …)은 학습 페이지가 쓰던 이름을 그대로 두어 남는 인라인 스타일도 새 색을 따른다. 2D 모듈(`<process-2d>`)은 바깥에서 색 변수만 덮어쓴다.

**기술:** DC 템플릿(`support.js`, `{{ }}` 바인딩·`sc-for`·`sc-if`), CSS `clip-path`, `node:test`(구조 검사)

**설계 문서:** [docs/learning-diagonal-ui.md](learning-diagonal-ui.md)

## 공통 조건

- 작업 폴더 `C:/Users/COM2509/Desktop/posco/ST-ROOKIE-diagonal-ui`, 브랜치 `design/learning-diagonal-ui`(최신 `origin/dev` 기준). 매 작업 전에 `git branch --show-current`로 확인한다.
- 모서리 크기: `--cut-l: 22px`, `--cut: 14px`, `--cut-s: 8px`. 자르는 모서리는 왼쪽 위·오른쪽 아래(헤더만 오른쪽 아래 하나).
- 주황 `--orange: #ff6b35`(공정 화면 `--molten`과 같음). 라이트 바탕 `#f3f2ee`, 다크 바탕 `#141416`, 어두운 패널 라이트 `#1c1c1e`·다크 `#202024`.
- 글꼴: 영문 제목·숫자 Chakra Petch, 한글 Pretendard, 라벨 JetBrains Mono 대문자.
- 이 페이지 템플릿에서 둥근 모서리(`border-radius` 18px·22px·14px·999px)를 쓰지 않는다.
- 고치지 않는 파일: `frontend/3d-demo/process-2d.js`, `learning-chat.js`, `cp-character.js`, `sketch-pad.js`, `exam.*`, `steel-index*`, `backend/src/app.ts`.
- 커밋은 사용자가 요청할 때만 한다(작업마다 커밋하지 않는다). 커밋 메시지는 [agent.md](../agent.md) 형식이고 작업 주체(`Co-Authored-By`)를 쓰지 않는다.
- 테스트 한 파일 실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`(작업 폴더에서). 전체는 `npm test`.

## 파일 구조

| 파일 | 할 일 |
|---|---|
| `frontend/login_ui/diagonal.css` (새로 만듦) | 토큰, 모서리 자르기, 버튼·탭·칩·입력창, 헤더, 제목띠, 구역·카드, 숫자 카드, 복습 목록, 평가 시험 띠, 2D 모듈 색 덮어쓰기, 좁은 화면 |
| `frontend/login_ui/Trainee Dashboard.dc.html` (고침) | `<helmet>` 글꼴·스타일 정리, 템플릿을 6개 구역(`data-sec`)으로 다시 배치, 로직은 화면 값만 바꿈 |
| `backend/test/learning-page-layout.test.ts` (새로 만듦) | 스타일 토큰과 구역 순서·둥근 모서리 금지·링크 위치 검사 |
| `docs/learning-diagonal-ui.md` (고침) | 복습 줄 펼치기 범위(오개념만) 반영 |

---

### 작업 1: 공용 스타일 `diagonal.css`

**파일:**
- 만듦: `frontend/login_ui/diagonal.css`
- 만듦: `backend/test/learning-page-layout.test.ts`

**연결:**
- 만드는 것(다음 작업이 쓰는 이름): 클래스 `dg-cut`(+`dg-l`, `dg-s`), `dg-cut-br`, `dg-ink`, `dg-card`, `dg-btn`(+`dg-btn-primary`, `dg-btn-plain`, `dg-btn-ghost`), `dg-seg`(+`dg-sm`), `dg-chip`, `dg-input`, `dg-header`, `dg-logo`, `dg-logo-mark`, `dg-badge`, `dg-nav`, `dg-label`, `dg-title`, `dg-h2`, `dg-sub`, `dg-num`, `dg-main`, `dg-hero`, `dg-hero-text`, `dg-now`, `dg-now-name`, `dg-now-row`, `dg-side-head`, `dg-section`, `dg-section-head`, `dg-stats`, `dg-stat`, `dg-stat-value`, `dg-stat-label`, `dg-stat-sub`, `dg-secs`, `dg-sec`, `dg-sec-top`, `dg-sec-score`, `dg-bar`, `dg-two`, `dg-col`, `dg-col-head`, `dg-count`, `dg-empty`, `dg-list`, `dg-row`, `dg-row-main`, `dg-tag`, `dg-acc`, `dg-band`, `dg-band-text`. 토큰 `--orange`, `--orange-ink`, `--ink-panel`, `--ghost-fill`, `--cut-l`, `--cut`, `--cut-s`와 기존 이름 `--bg --nav --panel --panel2 --chip-on --line --text --muted --dim --accent --accent-ink --bubble-in --send --ok --mid --bad --font-ko --font-en --mono`.

- [ ] **1단계: 실패하는 테스트 쓰기**

`backend/test/learning-page-layout.test.ts`:

```ts
// 학습 페이지(frontend/login_ui/Trainee Dashboard.dc.html)의 비스듬한 모서리 UI. 설계: docs/learning-diagonal-ui.md
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "frontend", "login_ui");
const css = readFileSync(join(root, "diagonal.css"), "utf8");

test("diagonal.css: 모서리·주황 토큰, 라이트 테마, 2D 모듈 색 덮어쓰기", () => {
  for (const t of ["--cut-l: 22px", "--cut: 14px", "--cut-s: 8px", "--orange: #ff6b35", "--ink-panel:"]) assert.ok(css.includes(t), t);
  assert.match(css, /body\[data-theme="light"\]\s*\{/);
  assert.match(css, /\.dg-cut\s*\{[^}]*clip-path:\s*polygon/);
  assert.match(css, /^process-2d\s*\{/m);
  assert.match(css, /body\[data-theme="light"\] process-2d\s*\{/);
});
```

- [ ] **2단계: 실패 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: 실패 — `ENOENT: no such file or directory ... diagonal.css`

- [ ] **3단계: `frontend/login_ui/diagonal.css` 만들기**

```css
/* 비스듬한 모서리(Diagonal) UI 공용 스타일. 설계: docs/learning-diagonal-ui.md
   - 쓰는 화면: login_ui/Trainee Dashboard.dc.html(학습 페이지). /3d-demo/ 페이지는 ../login_ui/diagonal.css로 읽는다.
   - 토큰 이름(--bg, --text, --line …)은 학습 페이지 인라인 스타일이 쓰던 이름을 그대로 둔다. 테마는 body[data-theme](저장값 st-rookie-theme).
   - 모서리: .dg-cut은 왼쪽 위·오른쪽 아래를 --c만큼 자른다. 크기는 .dg-l(22px) · 기본(14px) · .dg-s(8px). 헤더는 .dg-cut-br(오른쪽 아래만).
   - clip-path는 테두리도 잘라 내므로, 선이 있는 버튼·칩·입력창은 선 색 바탕 위에 ::before(1px 안쪽, --ghost-fill)를 같은 모양으로 덮어 그린다. */

body {
  --font-ko: "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
  --font-en: "Chakra Petch", "Pretendard", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
  --cut-l: 22px; --cut: 14px; --cut-s: 8px;
  --orange: #ff6b35; --orange-ink: #1a0b03;
  --ink-panel: #202024;
  --bg: #141416; --nav: rgba(20, 20, 22, .92); --panel: #1d1d20; --panel2: rgba(255, 255, 255, .07); --chip-on: rgba(255, 255, 255, .16);
  --line: rgba(255, 255, 255, .13); --text: #f2f2f2; --muted: #b9b9be; --dim: #8e8e94;
  --accent: var(--orange); --accent-ink: var(--orange-ink); --bubble-in: #2a2a2e; --send: var(--orange);
  --ok: #6fcf97; --mid: #e8c25a; --bad: #ff6b6b;
  --ghost-fill: var(--bg);
  margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-ko); letter-spacing: -0.01em; -webkit-font-smoothing: antialiased;
}
body[data-theme="light"] {
  --ink-panel: #1c1c1e;
  --bg: #f3f2ee; --nav: rgba(243, 242, 238, .94); --panel: #ffffff; --panel2: rgba(0, 0, 0, .05); --chip-on: rgba(0, 0, 0, .1);
  --line: rgba(0, 0, 0, .14); --text: #141414; --muted: #4f4f55; --dim: #6b6b71;
  --bubble-in: #ececea; --ok: #177a42; --mid: #9a6200; --bad: #c53030;
  --ghost-fill: var(--bg);
}

/* 어두운 패널(AI 튜터·평가 시험 띠): 라이트 테마에서도 어둡다. 안쪽 인라인 스타일이 쓰는 토큰을 어두운 값으로 다시 정한다 */
.dg-ink {
  --bg: var(--ink-panel); --panel: #26262a; --panel2: rgba(255, 255, 255, .07); --chip-on: rgba(255, 255, 255, .16);
  --line: rgba(255, 255, 255, .14); --text: #f2f2f2; --muted: #b9b9be; --dim: #8e8e94; --bubble-in: #2c2c30;
  --ok: #6fcf97; --mid: #e8c25a; --bad: #ff6b6b; --ghost-fill: var(--ink-panel);
  background: var(--ink-panel); color: var(--text);
}

/* ---- 모서리 자르기 ---- */
.dg-cut { --c: var(--cut); clip-path: polygon(var(--c) 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%, 0 var(--c)); }
.dg-cut.dg-l { --c: var(--cut-l); }
.dg-cut.dg-s { --c: var(--cut-s); }
.dg-cut-br { --c: var(--cut); clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%); }

/* 선이 있는 요소: 선 색 바탕 + 1px 안쪽 덮개 */
.dg-btn-ghost, .dg-chip, .dg-input { position: relative; isolation: isolate; background: var(--line); }
.dg-btn-ghost::before, .dg-chip::before, .dg-input::before {
  content: ""; position: absolute; inset: 1px; z-index: -1; background: var(--ghost-fill);
  clip-path: polygon(calc(var(--c, 0px) - .4px) 0, 100% 0, 100% calc(100% - var(--c, 0px) + .4px), calc(100% - var(--c, 0px) + .4px) 100%, 0 100%, 0 calc(var(--c, 0px) - .4px));
}

/* ---- 글자 ---- */
.dg-label { font: 500 13px/1.2 var(--mono); letter-spacing: .26em; text-transform: uppercase; color: var(--muted); }
.dg-title { margin: 0; font: 700 clamp(32px, 4.4vw, 48px)/.95 var(--font-en); letter-spacing: .02em; text-transform: uppercase; }
.dg-h2 { margin: 0; font: 700 22px/1.2 var(--font-ko); }
.dg-sub { font-size: 15px; line-height: 1.5; color: var(--dim); }
.dg-num { margin-right: .4em; font: 700 1em/1 var(--font-en); color: var(--orange); }

/* ---- 버튼·탭·칩·입력창 ---- */
.dg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; padding: 0 18px; border: 0; background: transparent; color: var(--text); font: 700 15px/1 var(--font-ko); white-space: nowrap; cursor: pointer; text-decoration: none; }
.dg-btn-primary { background: var(--orange); color: var(--orange-ink); }
.dg-btn-primary:hover { filter: brightness(1.06); }
.dg-btn-plain { color: var(--muted); font-weight: 500; }
.dg-btn-plain:hover { background: var(--panel2); color: var(--text); }
.dg-btn-ghost { background: var(--line); }
.dg-btn-ghost:hover, .dg-btn-ghost:focus-visible, .dg-chip:hover, .dg-chip:focus-visible { background: var(--orange); outline: none; }
.dg-btn-primary:focus-visible, .dg-btn-plain:focus-visible, .dg-seg button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--orange); }

.dg-seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; background: var(--panel2); }
.dg-seg button { height: 34px; padding: 0 16px; border: 0; background: transparent; color: var(--muted); font: 700 14px/1 var(--font-ko); white-space: nowrap; cursor: pointer; }
.dg-seg button:hover { color: var(--text); }
.dg-seg button[aria-selected="true"] { background: var(--orange); color: var(--orange-ink); }
.dg-seg.dg-sm button { height: 30px; padding: 0 12px; font-size: 13px; }

.dg-chip { flex: none; padding: 7px 13px; border: 0; color: var(--text); font: 500 14px/1.35 var(--font-ko); white-space: nowrap; text-align: left; cursor: pointer; }
.dg-input { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 4px 6px 4px 16px; }
.dg-input:focus-within { background: var(--orange); }

/* ---- ① 헤더 ---- */
.dg-header { position: sticky; top: 12px; z-index: 20; width: min(1400px, calc(100% - 32px)); margin: 16px auto 0; min-height: 64px; padding: 10px 12px 10px 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; background: var(--nav); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); --ghost-fill: var(--bg); }
.dg-logo { display: flex; align-items: center; gap: 10px; color: var(--text); font: 700 19px/1 var(--font-en); letter-spacing: .06em; white-space: nowrap; text-decoration: none; }
.dg-logo-mark { flex: none; width: 18px; height: 18px; background: var(--orange); clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
.dg-badge { padding: 5px 8px; background: var(--panel2); font: 500 14px/1 var(--mono); letter-spacing: .08em; white-space: nowrap; }
.dg-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }

/* ---- ② 제목띠 ---- */
.dg-main { width: min(1400px, calc(100% - 32px)); margin: 0 auto; padding: 36px 0 72px; display: flex; flex-direction: column; gap: 32px; }
.dg-hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 400px); gap: 20px; align-items: stretch; }
.dg-hero-text { display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; }
.dg-now { display: flex; flex-direction: column; justify-content: space-between; gap: 14px; padding: 20px 24px; background: var(--orange); color: var(--orange-ink); }
.dg-now .dg-label { color: var(--orange-ink); opacity: .75; }
.dg-now .dg-num { color: var(--orange-ink); }
.dg-now-name { font: 700 26px/1.1 var(--font-ko); }
.dg-now-row { display: flex; align-items: baseline; gap: 10px; font-size: 15px; }
.dg-now-row b { font: 700 40px/1 var(--font-en); }

/* ---- ③ 학습 영역(튜터 머리 줄) ---- */
.dg-side-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; }

/* ---- ④ 내 현황 · ⑤ 복습: 구역은 1px 선과 양쪽 끝 + 표시로 나눈다 ---- */
.dg-section { position: relative; display: flex; flex-direction: column; gap: 18px; padding-top: 28px; border-top: 1px solid var(--line); }
.dg-section::before, .dg-section::after { content: "+"; position: absolute; top: -11px; padding: 2px 3px; background: var(--bg); color: var(--dim); font: 400 16px/1 var(--mono); }
.dg-section::before { left: -6px; }
.dg-section::after { right: -6px; }
.dg-section-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
.dg-card { --ghost-fill: var(--panel); background: var(--panel); }

.dg-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.dg-stat { display: flex; flex-direction: column; gap: 8px; min-height: 150px; padding: 20px 22px; background: var(--orange); color: var(--orange-ink); }
.dg-stat-value { margin-bottom: auto; font: 700 44px/1 var(--font-en); }
.dg-stat-value small { margin-left: 6px; font: 600 16px/1 var(--font-ko); }
.dg-stat-label { font: 700 15px/1.3 var(--font-ko); }
.dg-stat-sub { font: 500 12px/1.3 var(--mono); letter-spacing: .04em; opacity: .75; }

.dg-secs { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.dg-sec { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
.dg-sec-top { display: flex; align-items: center; gap: 4px; font-size: 16px; }
.dg-sec-score { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 15px; color: var(--muted); }
.dg-sec-score span:first-child { font: 700 28px/1 var(--font-en); }
.dg-bar { height: 6px; background: var(--line); }
.dg-bar span { display: block; height: 100%; }

.dg-two { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.dg-col { --ghost-fill: var(--panel); display: flex; flex-direction: column; gap: 8px; padding: 20px 22px; background: var(--panel); }
.dg-col-head { display: flex; align-items: center; justify-content: space-between; font-size: 17px; }
.dg-count { font: 700 24px/1 var(--font-en); }
.dg-empty { padding: 12px 0; font-size: 15px; color: var(--muted); }
.dg-list { display: flex; flex-direction: column; }
.dg-row { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
.dg-row-main { flex: 1; display: flex; flex-direction: column; gap: 3px; font-size: 16px; }
.dg-tag { padding: 4px 9px; font-size: 14px; font-weight: 600; white-space: nowrap; clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.dg-acc { border-top: 1px solid var(--line); }
.dg-acc summary { display: flex; align-items: center; gap: 12px; padding: 14px 0; list-style: none; font-size: 16px; cursor: pointer; }
.dg-acc summary::-webkit-details-marker { display: none; }
.dg-acc summary strong { flex: 1; }
.dg-acc summary span { font-size: 15px; font-weight: 600; white-space: nowrap; }
.dg-acc summary i { font: 400 20px/1 var(--mono); font-style: normal; color: var(--dim); transition: transform .2s; }
.dg-acc[open] summary i { transform: rotate(45deg); color: var(--orange); }
.dg-acc p { margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: var(--muted); }

/* ---- ⑥ 평가 시험 띠 ---- */
.dg-band { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 20px 32px; padding: 36px 40px; }
.dg-band-text { display: flex; flex-direction: column; gap: 12px; }

/* ---- 2D 학습 모듈(<process-2d>) 색: 바깥 문서 규칙이 모듈 안 :host 기본값보다 우선한다 ---- */
process-2d {
  --bg: #1d1d20; --panel: #17171a; --chip: rgba(255, 255, 255, .08); --chip-on: rgba(255, 255, 255, .16); --line: rgba(255, 255, 255, .13);
  --text: #f2f2f2; --muted: #b9b9be; --dim: #8e8e94; --accent: #ff6b35; --accent-ink: #1a0b03;
  --lit: #ff6b35; --lit-ink: #1a0b03; --lit-bg: rgba(255, 107, 53, .14);
}
body[data-theme="light"] process-2d {
  --bg: #ffffff; --panel: #f3f2ee; --chip: rgba(0, 0, 0, .05); --chip-on: rgba(0, 0, 0, .1); --line: rgba(0, 0, 0, .14);
  --text: #141414; --muted: #4f4f55; --dim: #6b6b71; --accent: #ff6b35; --accent-ink: #1a0b03;
  --lit: #d9531f; --lit-ink: #ffffff; --lit-bg: rgba(255, 107, 53, .12);
}

/* ---- 좁은 화면 ---- */
@media (max-width: 1100px) { .dg-hero, .dg-two { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .dg-band { padding: 24px; } .dg-stat-value { font-size: 36px; } .dg-now-row b { font-size: 32px; } }
@media (prefers-reduced-motion: reduce) { .dg-acc summary i { transition: none; } }
```

- [ ] **4단계: 통과 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: `# pass 1`, `# fail 0`

---

### 작업 2: 헤더 · 제목띠 · 학습 영역(튜터 포함)

**파일:**
- 고침: `frontend/login_ui/Trainee Dashboard.dc.html` — `<helmet>`(11–87줄), 템플릿 89–211줄, 로직 `dmMessages`(276–290줄)·`renderVals`(394–403줄 부근)
- 고침: `backend/test/learning-page-layout.test.ts`

**연결:**
- 쓰는 것: 작업 1의 `dg-` 클래스와 토큰
- 만드는 것: 템플릿 구역 표시 `data-sec="header"`, `data-sec="hero"`, `data-sec="workspace"`. 화면 값 `heroNum`, `heroName`, `heroScore`, `heroState`(모두 문자열).

- [ ] **1단계: 실패하는 테스트 덧붙이기**

`backend/test/learning-page-layout.test.ts` 끝에 덧붙인다:

```ts
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
```

- [ ] **2단계: 실패 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: 새 두 테스트 실패(`diagonal.css` 링크 없음, `data-sec` 없음)

- [ ] **3단계: `<helmet>` 바꾸기 (11–87줄 전체를 아래로)**

```html
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">
  <link rel="stylesheet" href="./diagonal.css">
  <script type="module" src="../3d-demo/process-2d.js"></script>
  <script type="module" src="./sketch-pad.js"></script>
  <style>
    /* 색·글꼴·모서리 토큰과 dg- 클래스는 공용 diagonal.css(설계: docs/learning-diagonal-ui.md). 여기에는 이 페이지 배치만 둔다.
       테마는 저장값(st-rookie-theme) → 시스템 설정 순서로 정한다 */
    html, body { margin: 0; min-height: 100%; }
    * { box-sizing: border-box; }
    /* 스크롤바(가로·세로): 화면 전체를 AI 튜터 채팅창과 같은 얇은 테마색으로. 페이지 스크롤바는 html에 있어 body 변수 대신 같은 값을 직접 쓴다 */
    body * { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
    html { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, .13) transparent; }
    html:has(body[data-theme="light"]) { scrollbar-color: rgba(0, 0, 0, .14) transparent; }
    a { color: inherit; text-decoration: none; }
    button, input { font-family: inherit; letter-spacing: inherit; }
    /* 학습 모듈(왼쪽) + AI 튜터(오른쪽). 좁은 화면에서는 세로로 쌓는다 */
    .learn { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; align-items: stretch; }
    /* 오른쪽 열(AI 튜터): 왼쪽 2D 모듈과 같은 줄 높이를 따르고, 튜터 패널은 남은 높이를 채운다(basis 0). 대화만 안에서 스크롤하며 머리·추천 질문·입력창은 늘 보인다(#142) */
    .side { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
    .side > .tutor { flex: 1 1 0; min-height: 0; overflow: hidden; }
    .tutor { display: flex; flex-direction: column; }
    .tutor [data-al="head"], .tutor [data-al="foot"] { flex: none; }
    .tutor [data-al="chat"] { overscroll-behavior: contain; }
    /* 포석호(<cp-character>, 튜터 패널 머리): 기본 220×260 대신 x-import의 style이 정한 상자(감싸는 div)를 채운다 */
    .tutor cp-character { display: block; width: 100%; height: 100%; background: var(--panel2); }
    /* 학습 모듈: 탭(작동 단계 / 설계도·필기) + 내용 */
    .module { display: flex; flex-direction: column; gap: 10px; min-width: 0; position: relative; z-index: 3; } /* 설비 미리보기 창이 오른쪽 AI 튜터 열 위에 뜨게 */
    @keyframes blink { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
    @media (max-width: 1100px) {
      .learn { grid-template-columns: 1fr; }
      .side > .tutor { flex: none; height: clamp(420px, calc(100dvh - 140px), 620px); }
    }
    /* 좁은 화면: 고정 헤더를 화면 폭에 붙이고 버튼을 줄인다 */
    @media (max-width: 600px) {
      .dashboard-header { top: 0 !important; width: 100% !important; margin-top: 0 !important; padding: 8px 12px !important; gap: 6px !important; }
      .dashboard-header > span { display: none; }
      .dashboard-header > a { font-size: 15px !important; }
      .dashboard-header nav { width: 100%; justify-content: flex-end; gap: 3px !important; }
      .dashboard-header nav a, .dashboard-header nav button { height: 30px !important; padding: 0 10px !important; font-size: 12px !important; }
    }
  </style>
```

- [ ] **4단계: 템플릿 89–211줄(`<div style="min-height:100vh;…">`부터 학습 영역 `</div>` 닫힘까지)을 아래로 바꾸기**

바뀌지 않는 x-import 세 줄(`process-2d`, `cp-character`, `sketch-pad`)과 설계도 iframe·표제란은 지금 줄을 그대로 둔다.

```html
<div style="min-height:100vh;color:var(--text);">
  <!-- ① 헤더: 오른쪽 아래 모서리를 자른 패널. 좁은 화면 규칙은 위 .dashboard-header -->
  <header class="dashboard-header dg-header dg-cut-br" data-sec="header">
    <a href="/" target="_top" class="dg-logo"><span class="dg-logo-mark"></span>ST-ROOKIE</a>
    <span class="dg-label">TRAINEE</span>
    <span class="dg-badge" style="color:{{ srcColor }};">● {{ srcLabel }}</span>
    <div style="flex:1;"></div>
    <nav class="dg-nav">
      <button type="button" onClick="{{ toggleTheme }}" aria-label="테마 전환" class="dg-btn dg-btn-plain dg-cut dg-s" style="width:40px;padding:0;">{{ themeIcon }}</button>
      <button type="button" onClick="{{ logout }}" class="dg-btn dg-btn-plain dg-cut dg-s">로그아웃</button>
      <a href="/3d-demo/steel-index.html" target="_top" class="dg-btn dg-btn-primary dg-cut dg-s">3D 공정 화면</a>
      <a href="/exam" target="_top" class="dg-btn dg-btn-ghost dg-cut dg-s">평가 시험</a>
    </nav>
  </header>

  <main class="dg-main">
    <!-- ② 제목띠: 왼쪽 제목, 오른쪽 주황 패널에 지금 공정 상태(2D 모듈에서 고른 공정의 이해도) -->
    <section class="dg-hero" data-sec="hero">
      <div class="dg-hero-text">
        <span class="dg-label">[ TRAINEE ]</span>
        <h1 class="dg-title">LEARN &amp; ASK.</h1>
        <span class="dg-sub">{{ profile }} · 2D 학습 모듈로 공정을 따라가고, 모르는 것은 옆의 AI 튜터에게 바로 물어보세요.</span>
        <span class="dg-label" style="letter-spacing:.08em;">{{ updatedLabel }}</span>
      </div>
      <div class="dg-now dg-cut dg-l" aria-label="지금 공정 상태">
        <span class="dg-label">NOW · 지금 공정</span>
        <strong class="dg-now-name"><span class="dg-num">{{ heroNum }}</span>{{ heroName }}</strong>
        <span class="dg-now-row"><b>{{ heroScore }}</b><span>이해도 · {{ heroState }}</span></span>
      </div>
    </section>
    <sc-if value="{{ loadError }}" hint-placeholder-val="{{ false }}">
      <div role="alert" class="dg-card dg-cut" style="padding:14px 18px;color:var(--bad);font-size:15px;">{{ loadError }}</div>
    </sc-if>

    <!-- ③ 학습 영역: 왼쪽 2D 모듈·설계도, 오른쪽 AI 튜터(어두운 패널) -->
    <div class="learn" id="learning-workspace" data-sec="workspace">
      <div class="module">
      <!-- 학습 모듈 탭: 작동 단계(2D 애니메이션 모듈) / 설계도·필기(3D 화면의 2D 도면 + 펜 필기). 탭을 바꿔도 두 화면은 상태를 유지하도록 숨기기만 한다 -->
      <div role="tablist" aria-label="학습 모듈" class="dg-seg dg-cut dg-s" style="align-self:flex-start;">
        <sc-for list="{{ moduleTabs }}" as="t" hint-placeholder-count="2">
          <button type="button" role="tab" aria-selected="{{ t.on }}" onClick="{{ t.onClick }}" class="dg-cut dg-s">{{ t.label }}</button>
        </sc-for>
      </div>
      <!-- 2D 학습 모듈(공정 4개·설비 24개). 색은 diagonal.css의 process-2d 규칙이 덮어쓴다 -->
      <div style="display:{{ stepsDisplay }};min-width:0;">
        <x-import component-from-global-scope="process-2d" process="{{ processId }}" selected="{{ selectedAttr }}" theme="{{ theme }}" hint-size="100%,100%" style="display:block;width:100%;height:auto;min-width:0;"></x-import>
      </div>
      <!-- 설계도·필기: 3D 화면(v4)의 2D 뷰를 도면 전용 페이지(/3d-demo/blueprint.html)로 띄우고 그 위에 펜 필기(sketch-pad.js)를 겹친다.
           도면 영역 비율을 16:10으로 고정해 필기 좌표(비율)가 화면 크기와 상관없이 같은 자리에 남는다. 도면은 이동·확대하지 않는다 -->
      <section class="dg-card dg-cut" aria-label="설계도·필기" style="display:{{ blueprintDisplay }};flex-direction:column;gap:12px;padding:14px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
          <div role="tablist" aria-label="공정" class="dg-seg dg-sm dg-cut dg-s">
            <sc-for list="{{ bpProcesses }}" as="p" hint-placeholder-count="4">
              <button type="button" role="tab" aria-selected="{{ p.on }}" onClick="{{ p.onClick }}" class="dg-cut dg-s">{{ p.label }}</button>
            </sc-for>
          </div>
          <div role="tablist" aria-label="도면" class="dg-seg dg-sm dg-cut dg-s">
            <sc-for list="{{ drawTabs }}" as="d" hint-placeholder-count="3">
              <button type="button" role="tab" aria-selected="{{ d.on }}" title="{{ d.tip }}" onClick="{{ d.onClick }}" class="dg-cut dg-s">{{ d.label }}</button>
            </sc-for>
          </div>
        </div>
        <div class="dg-cut" style="position:relative;width:100%;aspect-ratio:16 / 10;overflow:hidden;background:#0f2c4c;">
          <iframe id="bpFrame" title="공정 설계도" src="{{ bpSrc }}" style="position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;"></iframe>
          <!-- 표제란(3D 화면 2D 뷰와 같은 형식). 필기가 위에 올라갈 수 있게 펜 층보다 아래에 둔다 -->
          <div aria-hidden="true" style="position:absolute;right:12px;bottom:12px;display:grid;grid-template-columns:auto auto;font-size:11px;color:#d7ecff;background:rgba(15,44,76,.78);border:1px solid rgba(215,236,255,.6);">
            <span style="padding:5px 10px;border-right:1px solid rgba(215,236,255,.6);border-bottom:1px solid rgba(215,236,255,.6);opacity:.75;">도면명</span><span style="padding:5px 10px;border-bottom:1px solid rgba(215,236,255,.6);">{{ bpTitle }}</span>
            <span style="padding:5px 10px;border-right:1px solid rgba(215,236,255,.6);opacity:.75;">도면 번호</span><span style="padding:5px 10px;font-family:var(--mono);">{{ bpNo }}</span>
          </div>
          <x-import component-from-global-scope="sketch-pad" process="{{ processId }}" mode="{{ drawMode }}" hint-size="100%,100%" style="position:absolute;inset:0;"></x-import>
        </div>
        <span style="font-size:12px;color:var(--dim);">도면 위에 펜·형광펜으로 그리거나 텍스트(T)로 메모하면 공정·도면마다 내 계정에 저장돼요. 도면 이동·확대는 3D 화면의 2D 뷰에서 할 수 있어요.</span>
      </section>
      </div>

      <div class="side">
      <!-- AI 튜터는 학습 전용이며 평가 시험은 헤더와 맨 아래 평가 시험 띠에서 연다 -->
      <div class="dg-side-head"><span class="dg-label">AI TUTOR</span><span class="dg-label" style="letter-spacing:.08em;">학습 질문 전용</span></div>
      <sc-if value="{{ showAsk }}" hint-placeholder-val="{{ true }}">
      <!-- AI 튜터: 어두운 패널(dg-ink). 이름·상태 머리, 왼쪽 회색/오른쪽 주황 말풍선, 연속 말풍선 묶음, 입력 중 점, 비스듬한 입력창 -->
      <aside class="dg-ink dg-cut tutor" aria-label="AI 튜터">
        <!-- 머리: 포석호(튜터 캐릭터, cp-character.js) · 이름과 상태 · 효과음 켜기/끄기. 대화 칸이 넓도록 작게(68×80) 둔다(#142) -->
        <div data-al="head" style="display:flex;align-items:center;gap:12px;min-height:96px;padding:8px 14px 8px 12px;border-bottom:1px solid var(--line);box-sizing:border-box;flex:none;">
          <!-- 크기는 이 x-import의 style(감싸는 상자)로 정하고 위 .tutor cp-character 규칙이 상자를 채운다. 한 자리에 한 개만 두어 다시 그릴 때 같은 엘리먼트를 쓴다(WebGL 컨텍스트가 쌓이지 않게) -->
          <x-import component-from-global-scope="cp-character" motion="{{ tutorMotion }}" model="/3d-demo/models/character/tutor.glb" hint-size="68,80" style="width:68px;height:80px;flex:none;"></x-import>
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;"><strong style="font-size:15px;">{{ tutorName }}</strong><span style="font-size:13px;color:{{ tutorStatusColor }};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">AI 튜터 · {{ tutorStatus }}</span></span>
          <!-- 포석호 효과음(보충학습에서 맞히거나 틀릴 때 짧은 소리) 켜기·끄기. 지원하지 않는 브라우저에서는 숨긴다 -->
          <sc-if value="{{ tutorSfxSupported }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ onToggleTutorSfx }}" title="보충학습에서 맞히거나 틀릴 때 포석호가 짧게 소리를 내요" class="dg-btn dg-btn-ghost dg-cut dg-s" style="flex:none;height:32px;padding:0 12px;font-size:13px;font-weight:600;">{{ tutorSfxLabel }}</button></sc-if>
        </div>
        <div ref="{{ chatRef }}" data-al="chat" style="flex:1 1 0;min-height:0;overflow-y:auto;padding:16px 14px 10px;display:flex;flex-direction:column;scrollbar-width:thin;scrollbar-color:var(--line) transparent;">
          <sc-for list="{{ messages }}" as="m" hint-placeholder-count="0">
            <div style="display:flex;justify-content:{{ m.justify }};align-items:flex-end;gap:8px;margin-top:{{ m.gapTop }};">
              <div style="max-width:80%;display:flex;flex-direction:column;align-items:{{ m.align }};gap:4px;">
                <div class="dg-cut dg-s" style="padding:9px 14px;background:{{ m.bg }};border:{{ m.border }};color:{{ m.color }};font-size:15px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">{{ m.text }}</div>
                <sc-if value="{{ m.hasKeywordCard }}" hint-placeholder-val="{{ false }}">
                  <div class="dg-cut dg-s" style="padding:9px 12px;background:var(--panel2);display:flex;flex-direction:column;gap:6px;"><span style="font-size:13px;color:var(--muted);">핵심 용어 · {{ m.keywordCard.title }}</span><div style="display:flex;flex-wrap:wrap;gap:4px;"><sc-for list="{{ m.keywordCard.keywords }}" as="k" hint-placeholder-count="0"><span style="font-size:13px;padding:2px 8px;background:var(--panel2);">{{ k.text }}</span></sc-for></div></div>
                </sc-if>
                <sc-for list="{{ m.citations }}" as="c" hint-placeholder-count="0"><span style="font-size:13px;color:var(--muted);padding:0 6px;line-height:1.45;">근거 · {{ c.title }}</span></sc-for>
                <sc-if value="{{ m.hasFollowUp }}" hint-placeholder-val="{{ false }}"><button type="button" onClick="{{ m.askFollowUp }}" class="dg-chip dg-cut dg-s" style="white-space:normal;">{{ m.followUp }}</button></sc-if>
              </div>
            </div>
          </sc-for>
          <sc-if value="{{ pending }}" hint-placeholder-val="{{ false }}">
            <div style="display:flex;align-items:flex-end;gap:8px;margin-top:10px;">
              <div aria-label="튜터가 답을 쓰고 있어요" class="dg-cut dg-s" style="display:flex;gap:4px;padding:13px 16px;background:var(--bubble-in);"><span style="width:7px;height:7px;border-radius:50%;background:var(--muted);animation:blink 1s infinite;"></span><span style="width:7px;height:7px;border-radius:50%;background:var(--muted);animation:blink 1s .2s infinite;"></span><span style="width:7px;height:7px;border-radius:50%;background:var(--muted);animation:blink 1s .4s infinite;"></span></div>
              <span style="font-size:13px;color:var(--dim);">{{ pendingText }}</span>
            </div>
          </sc-if>
        </div>
        <!-- 아래 묶음(추천 질문 + 입력창): 카드 아래에 늘 보인다(#142). 대화만 위에서 스크롤한다 -->
        <div data-al="foot" style="display:flex;flex-direction:column;justify-content:space-between;flex:none;">
        <!-- 추천 질문: 입력창 위 가로 스크롤 칩 -->
        <div style="display:flex;gap:6px;overflow-x:auto;padding:0 14px 8px;scrollbar-width:none;">
          <sc-for list="{{ chips }}" as="c" hint-placeholder-count="3">
            <button type="button" onClick="{{ c.onClick }}" class="dg-chip dg-cut dg-s">{{ c.text }}</button>
          </sc-for>
        </div>
        <!-- 이해도 확인에 답하는 중 학습 질문을 하려 하면: [멈추고 질문하기] (checkpoint-chat.js) -->
        <form onSubmit="{{ send }}" data-al="form" style="padding:0 14px 14px;">
          <div class="dg-input dg-cut dg-s">
            <input id="tutorInput" value="{{ input }}" onChange="{{ onInput }}" placeholder="메시지 보내기…" aria-label="질문" style="flex:1;min-width:0;height:32px;padding:0;border:none;background:transparent;color:var(--text);font-size:15px;outline:none;">
            <button type="submit" disabled="{{ cantSend }}" style="height:32px;padding:0 12px;border:none;background:transparent;color:var(--orange);font-size:15px;font-weight:700;cursor:pointer;opacity:{{ sendOpacity }};">보내기</button>
          </div>
        </form>
        </div>
      </aside>
      </sc-if>
      </div>
    </div>
```

입력창 포커스 때 `.dg-input:focus-within`이 테두리를 주황으로 바꾸므로 보내기 버튼 글자는 주황 그대로 둔다.

- [ ] **5단계: 로직 `dmMessages` 바꾸기 (276–290줄)**

말풍선 모양은 템플릿의 `dg-cut dg-s`가 맡으므로 `radius` 계산을 빼고, 내가 보낸 말풍선 색을 주황으로 바꾼다.

```js
// AI 튜터 말풍선: 맨 앞에 튜터 인사를 넣고, 같은 쪽 연속 말풍선은 간격을 좁힌다. 모양(비스듬한 모서리)은 템플릿의 dg-cut이 맡는다.
const WELCOME = '궁금한 설비를 고르고 물어보세요. 제선·제강·연주·열간압연 모두 공개 자료를 근거로 답해요.';
function dmMessages(list) {
  const all = [{ role: 'assistant', isAssistant: true, text: WELCOME, citations: [] }, ...list];
  const side = m => (m.isUser ? 'out' : 'in');
  return all.map((m, i) => {
    const out = side(m) === 'out', first = i === 0 || side(all[i - 1]) !== side(m);
    const safety = m.isSafety, error = m.isAssistant && m.evidence === 'error';
    return { ...m, isIn: !out, justify: out ? 'flex-end' : 'flex-start', align: out ? 'flex-end' : 'flex-start', gapTop: i === 0 ? '0' : first ? '12px' : '2px',
      bg: out ? 'var(--orange)' : safety || error ? 'transparent' : 'var(--bubble-in)',
      border: safety ? '1px solid var(--bad)' : error ? '1px solid var(--line)' : '0', color: out ? 'var(--orange-ink)' : safety ? 'var(--bad)' : error ? 'var(--muted)' : 'var(--text)',
      hasKeywordCard: !!m.hasKeywordCard, keywordCard: m.keywordCard || { title: '', keywords: [] }, citations: m.citations || [], hasFollowUp: !!m.hasFollowUp };
  });
}
```

- [ ] **6단계: 로직 `renderVals` 바꾸기**

(a) `const chat = chat0;` 줄 바로 아래에 지금 공정 상태를 계산한다.

```js
    // 제목띠 주황 패널: 2D 모듈에서 고른 공정(S.processId)의 이해도와 통과 여부
    const nowInfo = T?.sections[S.processId], nowP = process(S.processId);
```

(b) `return {` 안의 `profile:` 줄 아래에 덧붙인다.

```js
      heroNum: nowP.num || '', heroName: nowP.name, heroScore: nowInfo ? pct(nowInfo.understanding) : '—',
      heroState: !nowInfo ? (D ? '이해도 확인 전' : S.error ? '불러오지 못함' : '불러오는 중') : nowInfo.passed ? '통과' : '재도전 필요',
```

(c) 탭 세 묶음은 모양을 CSS(`aria-selected`)가 정하므로 색 값을 뺀다.

```js
      moduleTabs: [['steps', '작동 단계'], ['blueprint', '설계도·필기']].map(([k, label]) => ({ label, on: S.moduleTab === k,
        onClick: () => (k === 'blueprint' ? this.openBlueprint() : this.setState({ moduleTab: k })) })),
```

```js
      bpProcesses: S.processes.map(x => ({ label: `${x.num} ${x.name}`, on: x.id === S.processId, onClick: () => this.goProcess(x.id) })),
      drawTabs: Object.entries(DRAW_MODES).map(([m, [label, tip]]) => ({ label, tip, on: S.drawMode === m, onClick: () => this.setState({ drawMode: m }) })),
```

- [ ] **7단계: 통과 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: `# pass 3`, `# fail 0`

---

### 작업 3: 내 현황 · 복습 · 평가 시험 띠

**파일:**
- 고침: `frontend/login_ui/Trainee Dashboard.dc.html` — 템플릿의 `<!-- 내 기록 -->` 구역(213–268줄, 작업 2 뒤 줄 번호는 달라진다. `<section class="folder"`부터 그 `</section>`까지), 로직 `state`(306줄)·`renderVals`의 기록 값
- 고침: `backend/test/learning-page-layout.test.ts`
- 고침: `docs/learning-diagonal-ui.md`

**연결:**
- 쓰는 것: 작업 1 클래스, 작업 2의 구역 표시
- 만드는 것: `data-sec="status"`, `data-sec="review"`, `data-sec="exam"`. 화면 값 `reviewCount`, `reviewCountColor`, `misCount`, `misCountColor`(문자열). 지우는 값: `recordTabs`, `folderRadius`, `showProgress`, `showReview`, `showMis`, state `recordTab`, `kpis[].color`.

- [ ] **1단계: 실패하는 테스트 덧붙이기**

```ts
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
```

- [ ] **2단계: 실패 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: 새 세 테스트 실패(`status` 없음, `class="folder` 있음 등)

- [ ] **3단계: 기록 구역을 아래로 바꾸기**

`<!-- 내 기록: … -->` 주석과 `<section class="folder" aria-label="내 기록">` … `</section>` 전체를 바꾼다. `</main>`은 그대로 둔다.

```html
    <!-- ④ 내 현황: 주황 숫자 카드 4칸(KPI) + 공정 카드 4칸 -->
    <section class="dg-section" data-sec="status" aria-label="내 현황">
      <div class="dg-section-head">
        <span class="dg-label">[ MY STATUS ]</span>
        <h2 class="dg-h2">내 현황</h2>
        <span class="dg-sub">{{ statsSummary }}</span>
      </div>
      <div class="dg-stats">
        <sc-for list="{{ kpis }}" as="k" hint-placeholder-count="4">
          <div class="dg-stat dg-cut">
            <span class="dg-stat-value">{{ k.value }}<small>{{ k.unit }}</small></span>
            <span class="dg-stat-label">{{ k.label }}</span>
            <span class="dg-stat-sub">{{ k.sub }}</span>
          </div>
        </sc-for>
      </div>
      <div class="dg-secs">
        <sc-for list="{{ secCards }}" as="s" hint-placeholder-count="4">
          <div class="dg-card dg-cut dg-sec">
            <div class="dg-sec-top"><span class="dg-num">{{ s.num }}</span><strong>{{ s.name }}</strong></div>
            <div class="dg-sec-score"><span style="color:{{ s.color }};">{{ s.score }}</span><span>{{ s.status }}</span></div>
            <div class="dg-bar"><span style="width:{{ s.width }};background:{{ s.color }};"></span></div>
            <span class="dg-sub">{{ s.attempts }}</span>
          </div>
        </sc-for>
      </div>
    </section>

    <!-- ⑤ 복습: 다시 볼 개념 · 내 오개념을 두 칸으로. 오개념은 줄을 눌러 설명을 펼친다(본인 화면에만 보임) -->
    <section class="dg-section" data-sec="review" aria-label="복습">
      <div class="dg-section-head"><span class="dg-label">[ REVIEW ]</span><h2 class="dg-h2">복습</h2></div>
      <div class="dg-two">
        <div class="dg-col dg-cut">
          <div class="dg-col-head"><strong>다시 볼 개념</strong><span class="dg-count" style="color:{{ reviewCountColor }};">{{ reviewCount }}</span></div>
          <span class="dg-sub">이해도 확인에서 최근에 받은 결과 기준</span>
          <sc-if value="{{ reviewEmpty }}" hint-placeholder-val="{{ false }}"><span class="dg-empty">복습할 개념이 없습니다.</span></sc-if>
          <div class="dg-list">
            <sc-for list="{{ reviews }}" as="r" hint-placeholder-count="3">
              <div class="dg-row">
                <span class="dg-row-main"><strong>{{ r.name }}</strong><span class="dg-sub">{{ r.section }} · {{ r.date }}</span></span>
                <span class="dg-tag" style="color:{{ r.color }};background:color-mix(in srgb, {{ r.color }} 14%, transparent);">{{ r.verdict }}</span>
              </div>
            </sc-for>
          </div>
        </div>
        <div class="dg-col dg-cut">
          <div class="dg-col-head"><strong>내 오개념</strong><span class="dg-count" style="color:{{ misCountColor }};">{{ misCount }}</span></div>
          <span class="dg-sub">내용과 답변은 본인에게만 표시됩니다</span>
          <sc-if value="{{ misEmpty }}" hint-placeholder-val="{{ false }}"><span class="dg-empty">기록된 오개념이 없습니다.</span></sc-if>
          <div class="dg-list">
            <sc-for list="{{ misconceptions }}" as="m" hint-placeholder-count="3">
              <details class="dg-acc">
                <summary><strong>{{ m.name }}</strong><span style="color:{{ m.color }};">{{ m.status }}</span><i aria-hidden="true">+</i></summary>
                <p>{{ m.summary }}</p>
              </details>
            </sc-for>
          </div>
        </div>
      </div>
    </section>

    <!-- ⑥ 평가 시험 띠: 학습을 마치고 내려오면 바로 평가로 -->
    <section class="dg-band dg-ink dg-cut dg-l" data-sec="exam" aria-label="평가 시험">
      <div class="dg-band-text">
        <span class="dg-label">[ NEXT ]</span>
        <h2 class="dg-title" style="font-size:clamp(32px,5vw,56px);">PROVE &amp; PASS.</h2>
        <span class="dg-sub">학습한 공정의 이해도를 확인해요. 이해도 80% 이상이면 다음 공정이 열려요.</span>
      </div>
      <a href="/exam" target="_top" class="dg-btn dg-btn-primary dg-cut dg-s" style="height:48px;padding:0 24px;font-size:16px;">평가 시험 응시 →</a>
    </section>
```

- [ ] **4단계: 로직 정리**

(a) `state`에서 `recordTab: 'progress', `를 지운다.

```js
  state = { data: null, processes: [], error: null, theme: savedTheme() || systemTheme(), loadedAt: null, ai: null, sideTab: 'ask',
```

(b) `renderVals`에서 `// 아래 내 기록(폴더형 탭)…` 주석부터 `showProgress: …, showMis: S.recordTab === 'mis',` 줄까지를 아래로 바꾼다.

```js
      // 복습 두 칸의 개수: 다시 볼 개념 수, 미해결 오개념 수(체크포인트 기록 기준, /api/me/dashboard)
      reviewCount: D ? String(reviews.length) : '—', reviewCountColor: D && reviews.length ? 'var(--mid)' : 'var(--muted)',
      misCount: D ? String(open) : '—', misCountColor: D && open ? 'var(--bad)' : 'var(--muted)',
```

(c) `kpis` 네 줄에서 `, color: …` 부분을 지운다(주황 카드라 글자색이 하나다).

```js
      kpis: [
        { label: '통과한 섹션', value: T ? String(T.passed_sections) : '—', unit: `/ ${secs.length || '—'}`, sub: '이해도 80% 이상' },
        { label: '평균 이해도', value: avg == null ? '—' : pct(avg), unit: '', sub: '응시한 섹션의 마지막 결과' },
        { label: '미해결 오개념', value: D ? String(open) : '—', unit: '개', sub: '본인 기록만 표시' },
        { label: '다시 볼 개념', value: D ? String(reviews.length) : '—', unit: '개', sub: '최근 이해도 확인 결과' },
      ],
```

- [ ] **5단계: 설계 문서 고치기**

`docs/learning-diagonal-ui.md` 2절 5번 줄을 아래로 바꾼다.

```md
5. **복습**: 다시 볼 개념 · 내 오개념을 폴더 탭 대신 **두 칸으로 나란히** 둔다. 오개념 줄은 `+`로 펼쳐 설명을 본다(`<details>`). 다시 볼 개념 줄은 펼칠 설명이 없어 한 줄(개념 · 공정 · 날짜 · 판정)로 둔다. 오개념 내용은 지금처럼 본인 화면에만 보인다.
```

- [ ] **6단계: 통과 확인**

실행: `npm run build && node --test .build/backend/test/learning-page-layout.test.js`
예상: `# pass 6`, `# fail 0`

실행: `npm test`
예상: 실패 0(학습 페이지 외 테스트는 바뀐 파일이 없으므로 그대로 통과). 알려진 간헐 실패 [#14](https://github.com/steel-rookie/ST-ROOKIE/issues/14)가 나오면 그 테스트만 단독으로 다시 돌려 확인한다.

---

### 작업 4: 브라우저 확인과 PR 준비

**파일:**
- 고침: `C:/Users/COM2509/Desktop/posco/ST-ROOKIE/.claude/launch.json`(Git 제외 파일, 확인 서버 설정만)

- [ ] **1단계: 확인 서버 준비**

작업 폴더에 `node_modules`가 없으면 메인 폴더 것을 연결한다(PowerShell).

```powershell
New-Item -ItemType Junction -Path "C:\Users\COM2509\Desktop\posco\ST-ROOKIE-diagonal-ui\node_modules" -Target "C:\Users\COM2509\Desktop\posco\ST-ROOKIE\node_modules"
```

`.claude/launch.json`의 `configurations`에 덧붙인다.

```json
    {
      "name": "diagonal-ui",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "../ST-ROOKIE-diagonal-ui", "run", "start"],
      "env": { "PORT": "3003" },
      "port": 3003
    }
```

시연 기록을 넣는다(작업 폴더의 DB `data/st-rookie.sqlite`에만 들어간다).

```bash
npm --prefix ../ST-ROOKIE-diagonal-ui run db:seed-demo
```

- [ ] **2단계: 서버 띄우고 로그인**

`preview_start` 이름 `diagonal-ui`. `http://127.0.0.1:3003/login`에서 시연 기록이 있는 계정(`trainee11`, 비밀번호는 `backend/src/auth/demo-accounts.ts`의 기본값)으로 로그인한다.

- [ ] **3단계: 완료 기준 확인** (각 항목을 화면·콘솔로 확인하고 결과를 적는다)

1. 위에서부터 헤더 → 제목띠(주황 패널) → 학습 영역 → 내 현황(주황 카드 4칸 + 공정 카드 4칸) → 복습 두 칸 → 평가 시험 띠 순서다.
2. 라이트·다크(헤더 ☾/☀) 둘 다 글자가 읽히고, 튜터 패널과 평가 시험 띠는 두 테마 모두 어둡다.
3. 화면 폭 1400 / 1000 / 560에서 겹치거나 가로 스크롤이 생기지 않는다. 1000에서 학습 영역·복습이 세로로 쌓인다.
4. 2D 모듈에서 공정·설비를 고르면 제목띠 주황 패널의 공정 이름과 이해도가 바뀐다. 2D 모듈 강조색이 주황이다.
5. 설계도·필기 탭이 열리고 공정·도면 탭이 바뀐다.
6. 튜터 입력창에 글자를 넣으면 보내기가 켜지고, 추천 질문 칩을 누르면 질문이 들어간다(`.env`가 없으면 답변은 오류 말풍선).
7. 오개념 줄을 누르면 설명이 펼쳐지고 `+`가 돌아간다.
8. 헤더 `3D 공정 화면` → `/3d-demo/steel-index.html`, `평가 시험`과 띠의 `평가 시험 응시 →` → `/exam`, 로그아웃 → 홈.
9. 콘솔 오류가 없다(`read_console_messages` 오류만).

- [ ] **4단계: 사용자에게 보고하고 커밋 여부 묻기**

확인 결과(스크린샷 포함)를 보고하고, 사용자가 요청하면 커밋한다. 커밋 메시지 예(agent.md 형식):

```
design(web): move the learning page onto the shared diagonal UI

화면마다 모양이 달라 공정 화면의 비스듬한 모서리 UI로 맞추기 시작했고, 학습 페이지의 순서를 학습 → 내 현황 → 복습 → 평가 시험으로 다시 짰습니다.

- 공용 스타일 login_ui/diagonal.css 추가(모서리 22/14/8px, 주황 #ff6b35, Chakra Petch, 라이트·다크, 2D 모듈 색 덮어쓰기)
- 학습 페이지를 헤더 · 제목띠(지금 공정 상태) · 학습 영역 · 내 현황 · 복습 두 칸 · 평가 시험 띠로 배치하고 폴더 탭을 없앰
- 헤더 '학습 화면' 버튼을 '3D 공정 화면'으로 바꾸고 튜터 위 평가 시험 링크를 아래 띠로 옮김
```

PR은 dev로 열고 리뷰어 팀원B, 팀원A을 넣는다. 본문에 열린 초안 PR #126이 튜터 대기 표시 한 줄(`pendingText`)과 겹친다는 점을 적는다.
