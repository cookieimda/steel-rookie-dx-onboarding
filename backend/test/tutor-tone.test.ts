// 튜터 말투(해요체) 통일: 핵심 정리 문장 변환(polite.ts)과 고정 문장.
import assert from "node:assert/strict";
import test from "node:test";
import { toPolite } from "../src/checkpoint/polite.js";
import { loadFinalRubrics } from "../src/rubrics.js";
import { UNVERIFIED_ANSWER } from "../../llm/src/learning-agent.js";

test("toPolite: 루브릭 평서형 문장을 해요체로 바꾼다", () => {
  assert.equal(toPolite("소결은 철광석을 고로에 넣기 좋은 소결광으로 만드는 전처리 공정이다."), "소결은 철광석을 고로에 넣기 좋은 소결광으로 만드는 전처리 공정이에요.");
  assert.equal(toPolite("용선을 옮기는 차다."), "용선을 옮기는 차다.", "모르는 어미는 그대로");
  assert.equal(toPolite("핵심은 토페도카이다."), "핵심은 토페도카예요.", "받침이 없으면 예요");
  assert.equal(toPolite("코크스는 열풍과 반응해 일산화탄소를 만든다."), "코크스는 열풍과 반응해 일산화탄소를 만들어요.");
  assert.equal(toPolite("일산화탄소가 철광석에서 산소를 떼어내는 환원에 관여한다."), "일산화탄소가 철광석에서 산소를 떼어내는 환원에 관여해요.");
  assert.equal(toPolite("고로에서 환원과 용융이 일어나 용선이 된다."), "고로에서 환원과 용융이 일어나 용선이 돼요.");
  assert.equal(toPolite("이미 해요체예요."), "이미 해요체예요.");
});

test("final 루브릭의 핵심 요소는 모두 해요체로 바뀐다(핵심 정리에 '~다'가 남지 않게)", () => {
  for (const rubric of loadFinalRubrics()) {
    for (const concept of rubric.concepts) {
      for (const k of concept.key_points) {
        assert.match(toPolite(k.point), /요[.!?]?$/, `${concept.concept_id}: ${k.point}`);
      }
    }
  }
});

test("근거 없는 답 대신 보여 줄 문장도 해요체", () => {
  assert.match(UNVERIFIED_ANSWER, /요\.$/);
  assert.doesNotMatch(UNVERIFIED_ANSWER, /니다/);
});
