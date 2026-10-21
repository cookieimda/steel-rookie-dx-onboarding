// 테스트 이름은 Python 버전(test_scoring.py)의 케이스 이름을 그대로 쓴다.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadFinalRubrics, loadRubric } from "../src/rubrics.js";
import {
  applyRetry,
  conceptResult,
  conceptScore,
  conceptsToRetry,
  isConfirmed,
  isUnlocked,
  recordRecheck,
  sectionStatus,
  understanding,
  type ConceptResult,
  type Verdict,
} from "../src/scoring.js";

const IRONMAKING_RUBRIC = join(process.cwd(), "content", "rubrics", "final", "01_제선.json");

const results = (...items: ConceptResult[]) => new Map(items.map((r) => [r.conceptId, r]));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
const correct = (id: string) => conceptResult(id, "correct");
const readIronmakingRubric = () => JSON.parse(readFileSync(IRONMAKING_RUBRIC, "utf8"));

function writeRubric(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "rubric-")), "rubric.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

// --- 80% 경계값 ---

test("test_exactly_80_percent_unlocks", () => {
  const conceptIds = ids(5);
  const r = results(...conceptIds.slice(0, 4).map(correct), conceptResult("c5", "wrong", "wrong"));
  assert.equal(understanding(conceptIds, r), 4 / 5);
  assert.ok(isUnlocked(conceptIds, r));
});

test("test_80_percent_made_of_partials_unlocks_without_float_error", () => {
  // 1 + 1 + 1 + 0.5 + 0.5 = 4 / 5. 부동소수점이면 0.7999…로 떨어질 수 있는 조합.
  const conceptIds = ids(5);
  const r = results(
    ...conceptIds.slice(0, 3).map(correct),
    conceptResult("c4", "partial", "partial"),
    conceptResult("c5", "wrong", "partial"),
  );
  assert.equal(understanding(conceptIds, r), 4 / 5);
  assert.ok(isUnlocked(conceptIds, r));
});

test("test_just_below_80_percent_stays_locked", () => {
  const conceptIds = ids(4);
  const r = results(...conceptIds.slice(0, 3).map(correct), conceptResult("c4", "wrong", "wrong"));
  assert.equal(understanding(conceptIds, r), 3 / 4);
  assert.ok(!isUnlocked(conceptIds, r));
});

test("test_unasked_concept_blocks_unlock_even_with_high_score", () => {
  const conceptIds = ids(5);
  const r = results(...conceptIds.slice(0, 4).map(correct));
  assert.equal(understanding(conceptIds, r), 4 / 5);
  assert.ok(!isUnlocked(conceptIds, r));
});

test("test_concept_waiting_for_recheck_blocks_unlock", () => {
  const conceptIds = ids(5);
  const r = results(...conceptIds.slice(0, 4).map(correct), conceptResult("c5", "partial"));
  assert.ok(!sectionStatus(conceptIds, r).allConfirmed);
  assert.ok(!isUnlocked(conceptIds, r));
});

// --- 재확인: 최종 점수는 재확인 판정 그대로 ---

test("test_correct_is_confirmed_without_recheck", () => {
  const r = correct("c1");
  assert.ok(isConfirmed(r));
  assert.equal(conceptScore(r), 1);
});

for (const verdict of ["partial", "wrong", "assisted"] satisfies Verdict[]) {
  test(`test_non_correct_verdict_waits_for_recheck[${verdict}]`, () => {
    const r = conceptResult("c1", verdict);
    assert.ok(!isConfirmed(r));
    assert.equal(conceptScore(r), 0);
  });
}

test("test_partial_then_recheck_correct_scores_1", () => {
  const r = recordRecheck(conceptResult("c1", "partial"), "correct");
  assert.ok(isConfirmed(r));
  assert.equal(conceptScore(r), 1);
});

test("test_partial_then_recheck_partial_scores_half", () => {
  assert.equal(conceptScore(recordRecheck(conceptResult("c1", "partial"), "partial")), 0.5);
});

test("test_wrong_then_recheck_partial_scores_half", () => {
  assert.equal(conceptScore(recordRecheck(conceptResult("c1", "wrong"), "partial")), 0.5);
});

test("test_assisted_then_recheck_correct_scores_1", () => {
  const r = recordRecheck(conceptResult("c1", "assisted"), "correct");
  assert.ok(isConfirmed(r));
  assert.equal(conceptScore(r), 1);
});

test("test_assisted_then_recheck_wrong_scores_0", () => {
  const r = recordRecheck(conceptResult("c1", "assisted"), "wrong");
  assert.ok(isConfirmed(r));
  assert.equal(conceptScore(r), 0);
});

test("test_second_recheck_raises", () => {
  const r = recordRecheck(conceptResult("c1", "wrong"), "partial");
  assert.throws(() => recordRecheck(r, "correct"));
});

test("test_correct_cannot_be_rechecked", () => {
  assert.throws(() => recordRecheck(correct("c1"), "correct"));
  assert.throws(() => conceptResult("c1", "correct", "correct"));
});

test("test_recheck_verdict_cannot_be_assisted", () => {
  // @ts-expect-error 타입으로도 막지만, JSON 등에서 들어온 값도 런타임에 거부해야 한다.
  assert.throws(() => conceptResult("c1", "wrong", "assisted"));
});

test("test_section_with_assisted_recheck_success_unlocks_and_needs_no_retry", () => {
  const conceptIds = ids(3);
  const r = results(correct("c1"), conceptResult("c2", "assisted", "correct"), conceptResult("c3", "wrong", "correct"));
  const status = sectionStatus(conceptIds, r);
  assert.equal(status.understanding, 1);
  assert.ok(status.unlocked);
  assert.deepEqual(status.retryConceptIds, []);
});

// --- 재도전 ---

test("test_partial_final_score_is_asked_again_on_retry", () => {
  const conceptIds = ids(3);
  const r = results(correct("c1"), conceptResult("c2", "partial", "partial"), conceptResult("c3", "wrong", "wrong"));
  assert.deepEqual(conceptsToRetry(conceptIds, r), ["c2", "c3"]);
});

test("test_retry_keeps_correct_concepts_and_overwrites_retried_ones", () => {
  const conceptIds = ids(3);
  const first = results(correct("c1"), conceptResult("c2", "wrong", "wrong"), conceptResult("c3", "partial", "partial"));
  assert.ok(!isUnlocked(conceptIds, first));
  assert.deepEqual(conceptsToRetry(conceptIds, first), ["c2", "c3"]);

  const second = applyRetry(conceptIds, first, results(correct("c2"), conceptResult("c3", "wrong", "wrong")));
  assert.equal(second.get("c1"), first.get("c1"));
  assert.equal(conceptScore(second.get("c3")!), 0); // 재도전 결과로 덮어쓴다
  assert.equal(understanding(conceptIds, second), 2 / 3);
});

test("test_retry_rejects_results_for_concepts_already_correct", () => {
  const conceptIds = ids(2);
  const first = results(correct("c1"), conceptResult("c2", "wrong", "wrong"));
  assert.throws(() => applyRetry(conceptIds, first, results(conceptResult("c1", "wrong", "wrong"))));
});

test("test_retry_list_keeps_rubric_order", () => {
  const conceptIds = ["c3", "c1", "c2"];
  const r = results(conceptResult("c1", "wrong", "wrong"), correct("c2"), conceptResult("c3", "wrong", "wrong"));
  assert.deepEqual(conceptsToRetry(conceptIds, r), ["c3", "c1"]);
});

// --- 루브릭 파일 ---

test("test_final_rubrics_match_schema", (t) => {
  t.mock.method(console, "warn", () => {});
  // loadRubric이 스키마 검증과 concept_id 중복 검사를 하고, 실패하면 예외를 던진다.
  const rubrics = loadFinalRubrics();
  assert.ok(rubrics.length > 0);
});

test("test_unreviewed_rubric_logs_warning", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const rubric = loadRubric(IRONMAKING_RUBRIC);
  assert.equal(rubric.reviewed, false);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]!.arguments[0]), /검수 전 루브릭/);
});

test("test_reviewed_rubric_logs_nothing", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  loadRubric(writeRubric({ ...readIronmakingRubric(), reviewed: true }));
  assert.equal(warn.mock.callCount(), 0);
});

// --- 새로 추가: 실행 중 스키마 검증 ---

test("[new] invalid_rubric_throws", () => {
  assert.throws(() => loadRubric(writeRubric({ section: "ironmaking", concepts: [] })), /루브릭 형식 오류/);
});

test("[new] duplicated_concept_id_throws", () => {
  const rubric = readIronmakingRubric();
  const dup = { ...rubric, concepts: [rubric.concepts[0], rubric.concepts[0]] };
  assert.throws(() => loadRubric(writeRubric(dup)), /concept_id 중복/);
});
