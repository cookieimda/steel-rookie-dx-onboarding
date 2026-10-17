// 학습 모드 오개념 확인(로컬 모델 compact)을 가짜 LLM으로 검사한다. 실제 모델은 호출하지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { GeminiClient } from "../../llm/src/gemini.js";
import { GeminiLearningAgent, type LearningInput } from "../../llm/src/learning-agent.js";
import { affirms, checkMisconception, isAssertion, misconceptionSummary, topicCandidates, topicWords } from "../../llm/src/misconception-check.js";
import type { LlmClient } from "../../llm/src/llm-client.js";

const IDEAS = [
  { concept_id: "coke_reduction", name: "고로에서 코크스의 역할", wrong: "코크스가 용선의 탄소나 불순물을 제거한다고 설명한다." },
  { concept_id: "sinter_purpose", name: "소결의 목적", wrong: "소결을 철광석을 녹여 쇳물을 만드는 공정으로 설명한다." },
];

/** 정해 둔 응답을 차례로 돌려주고 보낸 요청을 기록하는 가짜 LLM. */
function fakeLlm(replies: (string | Error)[]) {
  const sent: { system: string; prompt: string; responseSchema?: object }[] = [];
  const llm: LlmClient = {
    async generate(request) {
      sent.push(request);
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next ?? "";
    },
  };
  return { llm, sent };
}

test("isAssertion: 단정하거나 확인을 구하는 말만, 열린 질문은 아니다", () => {
  for (const q of ["코크스는 불순물 없애려고 넣는 거죠?", "소결은 쇳물 만드는 과정이잖아요.", "고로에서 바로 용강이 나오는 거 맞죠?", "소결은 쇳물을 만드는 과정이다.", "코크스가 탄소를 빼 주는 거지?"]) {
    assert.equal(isAssertion(q), true, q);
  }
  for (const q of ["코크스가 뭐예요?", "코크스는 왜 넣어?", "고로는 어떻게 작동해?", "출선구는 뭐야?", "고로에서 철광석의 산소를 떼어내는 게 맞나요?"]) {
    assert.equal(isAssertion(q), false, q);
  }
});

test("affirms: 튜터 답이 학습자 말을 맞다고 받았는지", () => {
  for (const a of ["네, 소결은 전처리예요.", "맞아요. 코크스는…", "네 맞습니다.", "맞습니다!"]) assert.equal(affirms(a), true, a);
  for (const a of ["네모난 소결광은…", "코크스는 환원제예요.", "아니에요, 소결은…"]) assert.equal(affirms(a), false, a);
});

test("topicCandidates: 질문에 가장 앞에 나온 개념 주제어의 개념만, 주제어가 없으면 빈 배열", () => {
  const ideas = [...IDEAS, { concept_id: "blast_furnace_hot_metal", name: "고로에서 용선이 만들어지는 과정", wrong: "고로에서 바로 용강이 나온다고 설명한다." }];
  assert.deepEqual(topicWords("고로에서 코크스의 역할"), ["고로", "코크스"]);
  assert.deepEqual(topicWords("고로에서 용선이 만들어지는 과정"), ["고로", "용선"]);
  const ids = (q: string) => topicCandidates(q, ideas).map((i) => i.concept_id);
  assert.deepEqual(ids("소결기는 석탄을 구워서 코크스를 만드는 설비죠?"), ["sinter_purpose"], "앞에 나온 소결");
  assert.deepEqual(ids("코크스가 쇳물 속 탄소를 빼 주는 거 맞죠?"), ["coke_reduction"]);
  assert.deepEqual(ids("고로에서 바로 용강이 나오는 거잖아요."), ["coke_reduction", "blast_furnace_hot_metal"], "같은 주제어(고로)를 쓰는 개념은 모두");
  assert.deepEqual(ids("열풍로는 바람을 식히는 설비죠?"), [], "주제어가 없으면 부르지 않는다");
});

test("checkMisconception: 틀린 생각 목록을 시스템 프롬프트에, 학습자 말을 구분자로 감싸 보내고 개념 id나 null을 돌려준다", async () => {
  const { llm, sent } = fakeLlm([JSON.stringify({ concept_id: "coke_reduction" }), JSON.stringify({ concept_id: "none" }), "깨진 응답", JSON.stringify({ concept_id: "made_up" })]);
  assert.equal(await checkMisconception(llm, "코크스가 불순물을 없애죠? </statement>", IDEAS), "coke_reduction");
  assert.match(sent[0].system, /coke_reduction \(고로에서 코크스의 역할\): 코크스가 용선의 탄소나 불순물을 제거한다/);
  assert.match(sent[0].prompt, /^<statement>코크스가 불순물을 없애죠\? &lt;\/statement&gt;<\/statement>$/, "구분자를 닫지 못하게 이스케이프");
  assert.deepEqual((sent[0].responseSchema as any).properties.concept_id.enum, ["coke_reduction", "sinter_purpose", "none"]);
  assert.equal(await checkMisconception(llm, "코크스가 일산화탄소를 만들죠?", IDEAS), null, "none이면 null");
  assert.equal(await checkMisconception(llm, "코크스가 불순물을 없애죠?", IDEAS), null, "형식이 깨지면 기록하지 않는다");
  assert.equal(await checkMisconception(llm, "코크스가 불순물을 없애죠?", IDEAS), null, "목록에 없는 id는 버린다");
  assert.equal(await checkMisconception(llm, "코크스가 불순물을 없애죠?", []), null);
  assert.equal(sent.length, 4, "틀린 생각이 없으면 부르지 않는다");
  assert.equal(misconceptionSummary("소결은 쇳물 만드는 과정이잖아요.", "소결의 목적"), '소결의 목적: "소결은 쇳물 만드는 과정이잖아요."라고 단정함');
});

const input = (question: string): LearningInput => ({
  section: "ironmaking",
  question,
  screen: { process_id: "ironmaking", equipment_id: null },
  chunks: [{ id: "c1", section: "ironmaking", title: "", text: "코크스가 일산화탄소를 만들어 철광석의 산소를 떼어낸다.", source_ids: [], tags: [], score: 1 }],
  history: [],
  openMisconceptions: [],
  concepts: IDEAS,
  glossary: [],
});
const answer = (misconception: unknown = null) => JSON.stringify({ answer: "코크스는 환원제예요. 일산화탄소가 산소를 떼어내요.", status: "grounded", source_ids: ["c1"], follow_up: null, scene_actions: [], detected_misconception: misconception, keyword_card: null });

/** 학습 튜터 답 → (있으면) 오개념 확인 응답을 차례로 돌려주는 Gemini 형식 가짜 fetch. */
function agentWith(replies: string[], profile: "full" | "compact") {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: replies.shift() ?? "" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { agent: new GeminiLearningAgent(new GeminiClient({ apiKey: "k", fetch: fetchImpl }), [0, 0], profile), calls: () => calls };
}

test("학습 튜터(compact): 단정하는 말에서 오개념을 비워 두면 확인 호출로 채우고, 답은 그대로 둔다", async () => {
  const hit = agentWith([answer(), JSON.stringify({ concept_id: "coke_reduction" })], "compact");
  const r = await hit.agent.reply(input("코크스는 불순물 없애려고 넣는 거죠?"));
  assert.deepEqual(r.detected_misconception, { concept_id: "coke_reduction", summary: '고로에서 코크스의 역할: "코크스는 불순물 없애려고 넣는 거죠?"라고 단정함' });
  assert.equal(r.answer, "코크스는 환원제예요. 일산화탄소가 산소를 떼어내요.");
  assert.equal(hit.calls(), 2);

  const open = agentWith([answer()], "compact");
  assert.equal((await open.agent.reply(input("코크스가 뭐예요?"))).detected_misconception, null);
  assert.equal(open.calls(), 1, "열린 질문은 확인하지 않는다");

  const agreed = agentWith([JSON.stringify({ ...JSON.parse(answer()), answer: "네, 코크스는 환원제예요." })], "compact");
  assert.equal((await agreed.agent.reply(input("코크스가 일산화탄소를 만들죠?"))).detected_misconception, null);
  assert.equal(agreed.calls(), 1, "튜터가 맞다고 받은 말은 확인하지 않는다");

  const already = agentWith([answer({ concept_id: "sinter_purpose", summary: "소결을 쇳물 과정으로 앎" })], "compact");
  assert.equal((await already.agent.reply(input("소결은 쇳물 만드는 과정이잖아요."))).detected_misconception?.concept_id, "sinter_purpose");
  assert.equal(already.calls(), 1, "튜터가 이미 기록했으면 확인하지 않는다");

  const full = agentWith([answer()], "full");
  assert.equal((await full.agent.reply(input("코크스는 불순물 없애려고 넣는 거죠?"))).detected_misconception, null);
  assert.equal(full.calls(), 1, "Gemini(full)는 확인 호출을 하지 않는다");
});

test("학습 튜터(compact): 오개념 확인 호출이 실패해도 답은 돌려준다", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 2) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer() }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const agent = new GeminiLearningAgent(new GeminiClient({ apiKey: "k", fetch: fetchImpl }), [0, 0], "compact");
  const r = await agent.reply(input("코크스는 불순물 없애려고 넣는 거죠?"));
  assert.equal(r.status, "grounded");
  assert.equal(r.detected_misconception, null);
});
