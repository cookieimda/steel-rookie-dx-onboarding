// 튜터 질문 정답 유출 검사와 재생성·대체 질문.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadFinalRubrics, loadRubric, type Rubric, type RubricConcept } from "../src/rubrics.js";
import { GeminiClient } from "../../llm/src/gemini.js";
import { answerTerms, answerTermsInName, findLeaks, hasLeak } from "../../llm/src/question-check.js";
import { genericQuestion, GeminiTutor } from "../../llm/src/tutor.js";

const rubric = JSON.parse(readFileSync(join(process.cwd(), "content", "rubrics", "final", "01_제선.json"), "utf8")) as Rubric;
const concept = (id: string) => rubric.concepts.find((c) => c.concept_id === id)!;
const coke = concept("coke_reduction");
/** 질문 은행을 비운 개념: LLM 질문 생성(대체 경로)을 검사할 때 쓴다. */
const noBank = (c: RubricConcept): RubricConcept => ({ ...c, questions: undefined, recheck_questions: undefined });

test("정답 용어: answer_terms와 용어집 동의어를 막고, 개념 이름의 말은 허용한다", () => {
  assert.deepEqual(answerTerms(rubric, coke).sort(), ["CO", "일산화탄소", "환원"].sort());
  assert.deepEqual(findLeaks("코크스가 만드는 CO는 무슨 일을 하나요?", rubric, coke).terms, ["CO"]);
  assert.deepEqual(findLeaks("COKE를 영어로 뭐라고 하나요?", rubric, coke).terms, []);
  assert.deepEqual(findLeaks("일산화 탄소는 어디서 생기나요?", rubric, coke).terms, ["일산화탄소"]); // 띄어 써도 잡는다
  assert.ok(!hasLeak(findLeaks("고로에서 코크스는 어떤 역할을 하나요?", rubric, coke)));
});

test("근거 문장: 두 단어 이상에 걸친 4글자 이상 구는 막고, 한 단어 안의 겹침은 허용한다", () => {
  const leaked = findLeaks("코크스가 철광석에서 산소를 떼어내는 과정을 설명해 주세요.", rubric, coke);
  assert.ok(leaked.phrases.length > 0);
  // "철광석을", "고로에서"는 quote와 4글자가 겹치지만 한 단어 안이라 허용(엄격 모드에서는 걸린다)
  const sinter = concept("sinter_purpose");
  const natural = "철광석을 가루 그대로 고로에 넣지 않는 이유는 무엇인가요?";
  assert.ok(!hasLeak(findLeaks(natural, rubric, sinter)));
  assert.ok(hasLeak(findLeaks(natural, rubric, sinter, { crossWordOnly: false })));
});

test("개념 이름: 질문 속 개념 이름과 그 바로 뒤 말에 걸친 구간은 유출로 보지 않는다", () => {
  const c = { ...coke, key_points: [{ point: "예시", quote: "고로에서 코크스의 역할은 무엇보다 환원 반응에 있다." }] };
  // 이름("고로에서 코크스의 역할") 뒤의 "은 무엇"만 겹친다. 이름을 지우지 않으면 "할은무엇"이 걸린다.
  assert.ok(!hasLeak(findLeaks("고로에서 코크스의 역할은 무엇인가요?", rubric, c)));
  // 이름 밖에서 겹치는 구는 그대로 잡는다.
  const outside = findLeaks("고로에서 코크스의 역할은 무엇보다 환원 반응인가요?", rubric, c).phrases;
  assert.ok(outside.includes("보다환원"), JSON.stringify(outside));
  assert.ok(!outside.includes("할은무엇"), JSON.stringify(outside));
});

test("모든 final 루브릭: answer_terms(용어집 동의어 포함)에 개념 이름에 든 말이 없다", (t) => {
  t.mock.method(console, "warn", () => {});
  // 개념 이름에 든 말은 유출 검사에서 빠지므로, answer_terms에 있으면 검사하는 줄 알았던 말이 조용히 빠진다.
  for (const r of loadFinalRubrics()) {
    for (const c of r.concepts) assert.deepEqual(answerTermsInName(r, c), [], `${r.section}/${c.concept_id} (${c.name})`);
  }
});

test("모든 fallback_question은 유출 검사를 통과한다", () => {
  for (const c of rubric.concepts) {
    assert.ok(c.fallback_question, `${c.concept_id}: fallback_question 없음`);
    const leaks = findLeaks(c.fallback_question!, rubric, c);
    assert.ok(!hasLeak(leaks), `${c.concept_id}: ${JSON.stringify(leaks)}`);
    assert.ok(!hasLeak(findLeaks(genericQuestion(c), rubric, c)), `${c.concept_id}: 고정 문장 유출`);
  }
});

test("질문 은행: 모든 final 루브릭의 은행 질문은 정답 용어·근거 문장·핵심 요소 문장 표현이 없고, 첫 질문과 재확인 질문이 겹치지 않는다", (t) => {
  t.mock.method(console, "warn", () => {});
  for (const r of loadFinalRubrics()) {
    for (const c of r.concepts) {
      // 핵심 요소 문장(point)도 근거 문장처럼 보고 겹치는 구를 찾는다.
      const points = { ...c, key_points: c.key_points.map((k) => ({ point: k.point, quote: k.point })) };
      for (const q of [...(c.questions ?? []), ...(c.recheck_questions ?? [])]) {
        assert.ok(!hasLeak(findLeaks(q, r, c)), `${c.concept_id}: ${q} ${JSON.stringify(findLeaks(q, r, c))}`);
        assert.ok(!hasLeak(findLeaks(q, r, points)), `${c.concept_id}(핵심 요소 문장): ${q} ${JSON.stringify(findLeaks(q, r, points))}`);
      }
      assert.ok(!(c.recheck_questions ?? []).some((q) => c.questions?.includes(q)), `${c.concept_id}: 첫 질문과 재확인 질문 중복`);
    }
  }
});

test("질문 은행: 루브릭 로드 때 questions와 recheck_questions가 겹치면 오류", (t) => {
  t.mock.method(console, "warn", () => {});
  const c = { ...coke, questions: ["같은 질문입니다?", "다른 질문입니다?"], recheck_questions: ["같은 질문입니다?", "세 번째 질문?"] };
  const path = join(mkdtempSync(join(tmpdir(), "rubric-")), "r.json");
  writeFileSync(path, JSON.stringify({ ...rubric, concepts: [c] }));
  assert.throws(() => loadRubric(path), /질문 은행 중복/);
});

function fakeTutor(replies: string[]) {
  const prompts: string[] = [];
  const client = new GeminiClient({
    apiKey: "test",
    fetch: (async (_url: string, init: RequestInit) => {
      prompts.push((JSON.parse(String(init.body)) as { contents: { parts: { text: string }[] }[] }).contents[0]!.parts[0]!.text);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies.shift() ?? "" }] } }] }));
    }) as typeof fetch,
  });
  return { prompts, tutor: new GeminiTutor(client, { random: () => 0.99 }) };
}

test("질문 은행: 은행에서 고른 질문의 말투만 다듬고, 다듬기 프롬프트에는 정답을 주지 않는다", async () => {
  const polished = "고로 안에서 코크스가 무엇을 만나 어떤 물질을 만들고, 그 물질이 원료에 어떤 화학적 작용을 하는지 말해 줄래요?";
  const { prompts, tutor } = fakeTutor([polished]);
  const q = await tutor.questionDetailed({ rubric, concept: coke });
  assert.equal(q.source, "bank");
  assert.equal(q.bank!.original, coke.questions!.at(-1)); // random 0.99 → 마지막 후보
  assert.equal(q.text, polished);
  assert.equal(q.bank!.used, "polished");
  assert.match(prompts[0]!, /말투\(어미, 존댓말, 연결 표현, 어순\)만 바꾸세요/);
  assert.doesNotMatch(prompts[0]!, /일산화탄소|환원|열풍/); // 핵심 요소·정답 용어를 주지 않는다
});

test("질문 은행: 다듬은 문장이 유출 검사에 걸리거나 호출이 실패하면 원문을 쓴다", async () => {
  const leaked = await fakeTutor(["코크스가 만든 일산화탄소는 원료에 무엇을 하나요?"]).tutor.questionDetailed({ rubric, concept: coke });
  assert.equal(leaked.text, coke.questions!.at(-1));
  assert.equal(leaked.bank!.reason, "leak");
  assert.deepEqual(leaked.bank!.polishedLeaks!.terms, ["일산화탄소"]);

  const failed = await fakeTutor([""]).tutor.questionDetailed({ rubric, concept: coke }); // 빈 응답
  assert.equal(failed.text, coke.questions!.at(-1));
  assert.equal(failed.bank!.reason, "error");
  assert.equal(failed.bank!.error!.infra, false);
});

test("질문 은행: 재확인은 recheck_questions에서 고르고, 직전 질문과 같은 후보는 고르지 않는다", async () => {
  const [first, second] = coke.recheck_questions!;
  const { tutor } = fakeTutor(["", ""]);
  const q = await tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: coke.questions![0]! });
  assert.equal(q.bank!.original, second); // random 0.99 → 두 후보 중 마지막
  const avoid = await tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: second! });
  assert.equal(avoid.bank!.original, first);
});

test("이어 풀기: exclude에 든 은행 질문은 고르지 않고, 은행을 다 쓰면 fallback_question을 다시 쓴다(다듬기 호출 없음)", async () => {
  const [q1, q2] = coke.questions!;
  const { prompts, tutor } = fakeTutor(["", "", ""]);
  const other = await tutor.questionDetailed({ rubric, concept: coke, exclude: [q2!] });
  assert.equal(other.bankQuestion, q1); // random 0.99여도 남은 후보는 q1 하나
  const asked = await tutor.question({ rubric, concept: coke, exclude: [q1!] });
  assert.deepEqual(asked, { text: q2, bank: q2 }); // 다듬기 실패 → 원문, bank는 원문
  const calls = prompts.length;
  const used = await tutor.questionDetailed({ rubric, concept: coke, exclude: [q1!, q2!] });
  assert.deepEqual([used.source, used.text, used.bankQuestion, used.usedFallback], ["fallback", coke.fallback_question, coke.fallback_question, true]);
  const again = await tutor.question({ rubric, concept: coke, exclude: [q1!, q2!, coke.fallback_question!] });
  assert.deepEqual(again, { text: coke.fallback_question, bank: coke.fallback_question }); // fallback은 다시 쓴다
  assert.equal(prompts.length, calls); // 대체 질문은 다듬지 않는다
});

test("이어 풀기: 재확인 은행을 다 쓰면 fallback_question, 직전 질문이 fallback이면 고정 문장", async () => {
  const [r1, r2] = coke.recheck_questions!;
  const { tutor } = fakeTutor([""]);
  const left = await tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: coke.questions![0]!, exclude: [r2!] });
  assert.equal(left.bankQuestion, r1);
  const used = await tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: coke.questions![0]!, exclude: [r1!, r2!] });
  assert.deepEqual([used.text, used.usedFallback], [coke.fallback_question, true]);
  const generic = await tutor.recheckQuestionDetailed({ rubric, concept: coke, previousQuestion: coke.fallback_question!, exclude: [r1!, r2!] });
  assert.deepEqual([generic.text, generic.bankQuestion], [genericQuestion(coke), null]);
});

test("은행이 빈 개념: 질문이 유출 검사에 걸리면 걸린 표현을 알려 주고 1회 다시 만든다", async () => {
  const { prompts, tutor } = fakeTutor(["코크스가 만드는 일산화탄소는 무슨 일을 하나요?", "고로에서 코크스가 하는 일을 설명해 주세요."]);
  const q = await tutor.questionDetailed({ rubric, concept: noBank(coke) });
  assert.equal(q.text, "고로에서 코크스가 하는 일을 설명해 주세요.");
  assert.equal(q.attempts.length, 2);
  assert.equal(q.usedFallback, false);
  assert.match(prompts[1]!, /직전 질문에 정답 표현이 들어 있었습니다: 일산화탄소/);
  assert.match(prompts[0]!, /정답 용어와 그 동의어를 질문에 쓰지 마세요: .*일산화탄소/);
  assert.doesNotMatch(prompts[0]!, /근거:/); // 질문 생성에는 근거 문장을 주지 않는다
});

test("은행이 빈 개념: 두 번 모두 걸리면 fallback_question을, 재확인에서 직전 질문과 같으면 고정 문장을 쓴다", async () => {
  const leaky = ["CO가 어디서 생기나요?", "환원은 무엇인가요?"];
  const first = await fakeTutor([...leaky]).tutor.questionDetailed({ rubric, concept: noBank(coke) });
  assert.equal(first.usedFallback, true);
  assert.equal(first.text, coke.fallback_question);

  const recheck = await fakeTutor([...leaky]).tutor.recheckQuestionDetailed({ rubric, concept: noBank(coke), previousQuestion: coke.fallback_question! });
  assert.equal(recheck.text, genericQuestion(coke));
});
