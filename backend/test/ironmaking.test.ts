import assert from "node:assert/strict";
import test from "node:test";
import { getPublicSources, publicSources, sectionOf } from "../../llm/src/ironmaking-sources.js";
import { SECTION_ORDER } from "../src/checkpoint/types.js";

// 근거로 쓰지 않는 곳: 누구나 고치는 위키·개인 블로그·카페.
const BLOCKED_HOSTS = [/namu\.wiki$/, /(^|\.)blog\.naver\.com$/, /(^|\.)tistory\.com$/, /(^|\.)cafe\.naver\.com$/, /(^|\.)brunch\.co\.kr$/, /(^|\.)velog\.io$/];

test("공개 자료 목록은 제선 필수 주제를 포함한다", () => {
  const topics = new Set(publicSources.filter((s) => sectionOf(s) === "ironmaking").flatMap((source) => source.topics));
  for (const topic of ["제선의 목적", "철광석", "코크스", "고로", "용선", "제강 연결", "소결", "화성", "FINEX"]) {
    assert.ok(topics.has(topic), `${topic} 누락`);
  }
  assert.ok(publicSources.some((source) => source.route === "고로"));
  assert.ok(publicSources.some((source) => source.route === "FINEX"));
});

test("자료마다 날짜·https 주소·공정·메모가 있고, 막힌 곳(위키·블로그)이 아니며, evidence는 메모마다 하나씩이다", () => {
  const ids = new Set<string>();
  for (const source of publicSources) {
    assert.ok(!ids.has(source.id), `id 중복: ${source.id}`);
    ids.add(source.id);
    assert.match(source.date, /^\d{4}(?:-\d{2}-\d{2})?$/, source.id);
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:", source.id);
    assert.ok(!BLOCKED_HOSTS.some((h) => h.test(url.hostname)), `${source.id}: ${url.hostname}`);
    assert.ok(SECTION_ORDER.includes(sectionOf(source)), source.id);
    assert.ok(source.notes.length > 0 && source.notes.every((n) => n.trim().length > 0), source.id);
    if (source.evidence) {
      assert.equal(source.evidence.length, source.notes.length, `${source.id}: evidence 수`);
      assert.ok(source.evidence.every((e) => e.trim().length > 0), source.id);
    }
  }
});

test("출처 조회는 목록에 있는 id만 중복 없이 돌려준다", () => {
  const id = publicSources[0]!.id;
  assert.deepEqual(getPublicSources([id, "made-up", id]).map((source) => source.id), [id]);
});
