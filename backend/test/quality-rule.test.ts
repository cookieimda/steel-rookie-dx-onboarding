// 자동 화질 판단(frontend/3d-demo/quality-rule.js): 순간 멈춤 하나로 해상도를 낮추지 않는다
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { shouldLowerQuality } = await import(pathToFileURL(join(process.cwd(), "frontend", "3d-demo", "quality-rule.js")).href);
const frames = (n: number, ms: number) => Array.from({ length: n }, () => ms);

test("60fps에 긴 멈춤 하나(실제 기기: 1.17초)가 섞여도 낮추지 않는다", () => {
  assert.equal(shouldLowerQuality([...frames(89, 16.7), 1166]), false);
  assert.equal(shouldLowerQuality([...frames(80, 16.7), ...frames(10, 300)]), false); // 모델 올리는 동안 몇 번 끊겨도
});

test("꾸준히 느리면(약 30fps) 낮춘다", () => {
  assert.equal(shouldLowerQuality(frames(90, 33)), true);
  assert.equal(shouldLowerQuality([...frames(60, 33), ...frames(30, 16.7)]), true);
});

test("탭을 숨겼던 간격은 빼고, 표본이 적으면 판단하지 않는다", () => {
  assert.equal(shouldLowerQuality([...frames(20, 40), ...frames(70, 900)]), false);
  assert.equal(shouldLowerQuality([]), false);
});
