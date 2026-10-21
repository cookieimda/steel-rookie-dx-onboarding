// 학습자 메모 계약(backend/src/learning/notes.ts): 체크포인트 엔진의 options.notes가 이 타입을 받는다.
import assert from "node:assert/strict";
import test from "node:test";
import { buildLearnerNotes, MAX_NOTE_ITEMS, useLearnerNotesSource, type LearnerNotes } from "../src/learning/notes.js";
import type { EngineOptions } from "../src/checkpoint/engine.js";
import { openDatabase } from "../src/db/database.js";
import { LearningRepository } from "../src/learning/repository.js";

test("buildLearnerNotes: 저장소가 없으면 빈 메모를 돌려주고, 그 결과를 엔진 options.notes에 그대로 넘길 수 있다", async () => {
  useLearnerNotesSource(null);
  const notes: LearnerNotes = await buildLearnerNotes("demo-user", "ironmaking");
  assert.deepEqual(notes, {});
  const options: EngineOptions = { notes };
  assert.equal(options.notes, notes);
});

test("buildLearnerNotes: 섹션의 미해결 오개념을 출처 라벨과 함께 context로 요약하고, conceptOrder는 넣지 않는다", async () => {
  const db = openDatabase(":memory:");
  const repo = new LearningRepository(db);
  useLearnerNotesSource(repo);
  try {
    assert.deepEqual(await buildLearnerNotes("minsu", "ironmaking"), {}); // 기록 없음

    repo.recordMisconception({ user_id: "minsu", section: "ironmaking", concept_id: "coke_reduction", answer_text: "a", summary: "코크스를 연료로만 앎" }, "2026-10-02T01:00:00Z");
    repo.recordMisconception({ user_id: "minsu", section: "ironmaking", concept_id: "coke_reduction", answer_text: "b", summary: "코크스를 불순물 제거로 앎" }, "2026-10-02T02:00:00Z");
    db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, created_at) VALUES ('cp', 'minsu', 'ironmaking', 'sinter_purpose', 'checkpoint', 'x', '소결을 쇳물 만드는 과정으로 앎', '2026-10-02T03:00:00Z')").run();
    db.prepare("INSERT INTO misconceptions (id, user_id, section, concept_id, source, answer_text, summary, resolved, created_at) VALUES ('done', 'minsu', 'ironmaking', 'hot_stove', 'checkpoint', 'x', '해결된 오해', 1, '2026-10-02T04:00:00Z')").run();
    repo.recordMisconception({ user_id: "minsu", section: "steelmaking", concept_id: "bof", answer_text: "c", summary: "다른 섹션" }, "2026-10-02T05:00:00Z");
    repo.recordMisconception({ user_id: "jiwoo", section: "ironmaking", concept_id: "x", answer_text: "d", summary: "다른 사람" }, "2026-10-02T06:00:00Z");

    const notes = await buildLearnerNotes("minsu", "ironmaking");
    assert.equal(notes.conceptOrder, undefined);
    const lines = notes.context!.split("\n");
    assert.deepEqual(lines.slice(1), [
      "- sinter_purpose (이해도 확인): 소결을 쇳물 만드는 과정으로 앎",
      "- coke_reduction (대화 중 감지됨): 코크스를 불순물 제거로 앎", // 같은 개념은 최근 것 하나
    ]);
  } finally {
    useLearnerNotesSource(null);
  }
});

test("buildLearnerNotes: 오개념이 많아도 최근 것부터 5개까지만", async () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ concept_id: `c${i}`, summary: `오해 ${i}`, source: "learning" as const, created_at: `2026-10-02T0${i}:00:00Z` }));
  useLearnerNotesSource({ openMisconceptions: () => items });
  try {
    const lines = (await buildLearnerNotes("minsu", "ironmaking")).context!.split("\n").slice(1);
    assert.equal(lines.length, MAX_NOTE_ITEMS);
    assert.ok(lines[0].startsWith("- c7 "));
  } finally {
    useLearnerNotesSource(null);
  }
});
