// 긴 평가 실행의 연결 재시도와 결과 파일 이어 하기(llm/eval/run-log.ts). 실제 Gemini는 부르지 않는다.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GeminiCallError } from "../../llm/src/gemini.js";
import { isInfraError, RecordFile, RetryingGeminiClient, type RunRecord } from "../../llm/eval/run-log.js";

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "답" }] } }] }));
const req = { system: "s", prompt: "p", temperature: 0, maxOutputTokens: 10 };

function client(replies: (() => Response)[]) {
  let calls = 0;
  const c = new RetryingGeminiClient({
    apiKey: "test",
    fetch: (async () => {
      calls++;
      return replies.shift()!();
    }) as unknown as typeof fetch,
  }, 0);
  return { c, calls: () => calls };
}

test("연결 재시도: 429·시간 초과·fetch failed는 다시 호출하고, 최대 3회까지만 한다", async (t) => {
  t.mock.method(process.stdout, "write", () => true);
  const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };
  const fetchFailed = () => { throw new TypeError("fetch failed"); };
  const a = client([() => new Response("", { status: 429 }), timeout, fetchFailed, ok]);
  assert.equal(await a.c.generate(req), "답");
  assert.equal(a.calls(), 4);
  assert.equal(a.c.retries.length, 3);

  const b = client([...Array(4)].map(() => () => new Response("", { status: 429 })));
  const error = await b.c.generate(req).catch((e: unknown) => e);
  assert.ok(error instanceof GeminiCallError && error.reason === "rate_limit" && isInfraError(error));
  assert.equal(b.calls(), 4); // 처음 1회 + 재시도 3회
});

test("연결 재시도: 429가 아닌 HTTP 오류는 다시 호출하지 않는다", async () => {
  const a = client([() => new Response("", { status: 400 }), ok]);
  const error = await a.c.generate(req).catch((e: unknown) => e);
  assert.ok(error instanceof GeminiCallError && error.reason === "http" && !error.retryable);
  assert.equal(a.calls(), 1);
});

test("결과 파일: 기존 파일은 --resume 없이 덮어쓰지 않고, 같은 설정으로 끝난 케이스만 건너뛴다", (t) => {
  t.mock.method(console, "warn", () => {});
  const path = join(mkdtempSync(join(tmpdir(), "eval-")), "r.jsonl");
  const first = new RecordFile<RunRecord>(path, false);
  first.append({ key: "a", fingerprint: "f1", infra_error: false });
  first.append({ key: "b", fingerprint: "f1", infra_error: true });
  writeFileSync(path, readFileSync(path, "utf8") + '{"key":"c","finger'); // 쓰는 도중 끊긴 줄

  assert.throws(() => new RecordFile<RunRecord>(path, false), /--resume/);
  const resumed = new RecordFile<RunRecord>(path, true);
  assert.ok(resumed.done("a", "f1"));
  assert.equal(resumed.done("a", "f2"), undefined); // 프롬프트·모델이 바뀌면 다시 한다
  assert.ok(resumed.stale("a", "f2"));
  assert.equal(resumed.done("b", "f1"), undefined); // 연결 오류는 다시 한다
  assert.equal(resumed.done("c", "f1"), undefined);

  resumed.append({ key: "c", fingerprint: "f1", infra_error: false });
  assert.ok(new RecordFile<RunRecord>(path, true).done("c", "f1")); // 끊긴 줄 뒤에 붙지 않는다
});
