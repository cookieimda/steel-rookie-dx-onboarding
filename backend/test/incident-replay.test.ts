import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "frontend", ...p), "utf8");

test("사고 사례 갈림길 3D 재현: 학습 기록 링크는 새 3D 화면(steel-index)으로 가고, 같은 쿼리를 incident-replay.js가 받는다", () => {
  const extras = read("login_ui", "lab-extras.js");
  assert.match(extras, /brHref: opt \? `\/3d-demo\/steel-index\.html\?p=\$\{cur\.section\}&lab=incident&scenario=\$\{cur\.id\}&at=\$\{i\}&pick=\$\{pick\}`/);
  assert.doesNotMatch(extras, /Steel%20Academy%20v4\.dc\.html\?p=\$\{cur\.section\}&lab=incident/);

  const index = read("3d-demo", "steel-index.js");
  const hook = index.split("\n").find((l) => l.includes("import('./incident-replay.js')")) ?? "";
  assert.match(hook, /q\.get\('lab'\) === 'incident'/, "lab=incident일 때만 불러온다");
  assert.match(hook, /readIncidentQuery\(q\)/);
  assert.match(hook, /attachIncidentReplay\(\{ api, scene, camera, hud, stage, reduced: REDUCED, current: \(\) => cur, focusEquipment/);

  const replay = read("3d-demo", "incident-replay.js");
  assert.match(replay, /export function readIncidentQuery\(q\)/);
  assert.match(replay, /export function attachIncidentReplay\(/);
  assert.match(replay, /\/api\/lab\/incidents\/\$\{encodeURIComponent\(query\.scenario\)\}/);
  assert.match(replay, /\/api\/lab\/incidents\/\$\{encodeURIComponent\(sc\.id\)\}\/branch/);
  // 사례 패널은 What-if 열 자리에 겹치고, 닫으면 What-if 열이 돌아온다
  assert.match(replay, /body\.ir-on \.lab-inputs:not\(\.ir-pane\) \{ visibility: hidden !important; \}/);
  assert.match(replay, /document\.body\.classList\.remove\('ir-on'\)/);
  // 화면 문장은 textContent로만 넣는다(사례 문장·출처를 innerHTML에 넣지 않는다)
  assert.doesNotMatch(replay, /innerHTML/);
});
