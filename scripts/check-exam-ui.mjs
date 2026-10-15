// Optional local browser QA. Install playwright under ignored data/browser-tools before running.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../data/browser-tools/node_modules/playwright/index.mjs';

const base = process.env.EXAM_QA_URL || 'http://localhost:3011';
const browser = await chromium.launch({ executablePath: join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
const errors = [], stamp = Date.now();
try {
  const response = await context.request.post(`${base}/api/auth/signup`, { data: { username: `qa_${stamp}`, password: `exam-qa-${stamp}`, name: '시연 학습자', employee_no: `QA${stamp}` } });
  assert.equal(response.status(), 201);
  const { token } = await response.json();
  await context.addInitScript((auth) => { sessionStorage.setItem('st-rookie-token', auth); localStorage.setItem('st-rookie-theme', 'dark'); }, token);
  const page = await context.newPage(); page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('docs/screenshots/exam', { recursive: true });
  await page.goto(`${base}/exam`);
  await page.locator('#sections .process-card').first().waitFor();
  assert.match(await page.locator('h1').textContent(), /PROVE & PASS/); // 제목은 영어(학습 기록의 LEARN & ASK.와 같은 체계), '평가 시험'은 <title>·현재 위치 알약에 있다
  assert.equal(await page.locator('#sections .process-card').count(), 4);
  await page.screenshot({ path: 'docs/screenshots/exam/desktop.png', fullPage: true });
  await page.locator('#sections .process-card').first().getByRole('button').click();
  await page.getByRole('button', { name: '시험 시작하기 →' }).waitFor();
  let commandJob = null;
  page.on('response', async (r) => { if (r.url().endsWith('/commands') && r.status() === 202) commandJob = await r.json(); });
  await page.getByRole('button', { name: '시험 시작하기 →' }).click();
  await page.locator('#forge').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#forge-phase').textContent.includes('문제'));
  const first = await page.locator('.hammer').evaluate((node) => getComputedStyle(node).transform);
  await page.waitForTimeout(300);
  const second = await page.locator('.hammer').evaluate((node) => getComputedStyle(node).transform);
  assert.notEqual(first, second, 'hammer animation changes over time');
  await page.screenshot({ path: 'docs/screenshots/exam/loading-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/exam/loading-mobile.png' });
  await page.getByRole('button', { name: '요청 취소', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#forge').open, { timeout: 20000 });
  assert.equal(await page.locator('#forge').evaluate((n) => getComputedStyle(n).display), 'none', 'closed forge dialog stays hidden (exam.css overrides the UA display rule)');
  assert.match(await page.locator('#notice').textContent(), /취소/);
  assert.ok(commandJob);
  const job = await context.request.get(`${base}/api/exam-jobs/${commandJob.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await job.json()).state, 'cancelled');
  const sections = await context.request.get(`${base}/api/exams/sections`, { headers: { Authorization: `Bearer ${token}` } });
  const attemptId = (await sections.json()).sections[0].progress.in_progress_attempt_id;
  const attempt = await context.request.get(`${base}/api/exams/${attemptId}`, { headers: { Authorization: `Bearer ${token}` } });
  const originalView = await attempt.json();
  assert.equal(originalView.state, 'awaiting_ready', 'cancellation must not advance the exam through question fallback');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'mobile page must not overflow horizontally');
  await page.screenshot({ path: 'docs/screenshots/exam/mobile.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.hammer').evaluate((node) => getComputedStyle(node).animationName), 'none');
  // Rendering fixtures only: actual grading/state transitions are covered by HTTP integration tests.
  let fixture = { ...originalView, state: 'awaiting_answer', concept: { id: 'blast_furnace', name: '고로', index: 1, total: 3 },
    progress: [{ concept_id: 'blast_furnace', status: 'current' }, { concept_id: 'coke', status: 'pending' }, { concept_id: 'hot_stove', status: 'pending' }],
    history: [{ role: 'tutor', type: 'question', text: '고로에서 철광석이 철로 바뀌는 과정을 자신의 말로 설명해 주세요.' }] };
  await page.route(`**/api/exams/${attemptId}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.reload(); await page.locator('#answer').waitFor();
  assert.equal(await page.getByRole('button', { name: '답안 제출 →' }).isDisabled(), true);
  await page.locator('#answer').fill('코크스는 고로 안에서 열원과 환원가스의 공급원으로 작용합니다.');
  assert.equal(await page.getByRole('button', { name: '답안 제출 →' }).isDisabled(), false);
  await page.reload(); await page.locator('#answer').waitFor();
  assert.match(await page.locator('#answer').inputValue(), /환원가스/, 'draft survives refresh');
  await page.screenshot({ path: 'docs/screenshots/exam/question-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'docs/screenshots/exam/question-desktop.png', fullPage: true });
  fixture = { ...fixture, state: 'completed', concept: null, progress: fixture.progress.map((p) => ({ ...p, status: 'done' })),
    result: { understanding: 1, unlocked: true, threshold: .8, retry_concept_ids: [], concepts: [
      { concept_id: 'blast_furnace', name: '고로', score: 1, final_verdict: 'correct' },
      { concept_id: 'coke', name: '코크스', score: 1, final_verdict: 'correct' },
      { concept_id: 'hot_stove', name: '열풍로', score: 1, final_verdict: 'correct' }] } };
  await page.reload(); await page.locator('.score-number').waitFor();
  assert.equal(await page.locator('.concept-result').count(), 3);
  await page.screenshot({ path: 'docs/screenshots/exam/result-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'docs/screenshots/exam/result-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('실제 시험 요청·망치 모션·취소 상태 유지·모바일·동작 축소·답안/결과 렌더링·답안 복원 검증 통과');
} finally { await context.close(); await browser.close(); }
