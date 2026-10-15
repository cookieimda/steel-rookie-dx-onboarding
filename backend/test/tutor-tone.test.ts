// 튜터 말투(해요체) 통일: 핵심 정리 문장 변환(polite.ts)과 고정 문장.
import assert from "node:assert/strict";
import test from "node:test";
import { politeText, toPolite, withObject } from "../../llm/src/polite.js";
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

test("politeText: 오늘 튜터가 실제로 낸 문장 끝 '~답니다'·'~입니다'·'~다'를 해요체로", () => {
  const cases: [string, string][] = [
    ["모양이 어뢰와 닮아서 어뢰차라고도 부른답니다.", "모양이 어뢰와 닮아서 어뢰차라고도 불러요."],
    ["고로에 열풍을 끊김 없이 공급한답니다.", "고로에 열풍을 끊김 없이 공급해요."],
    ["미리 덩어리로 만들어 통기성을 높여야 한답니다.", "미리 덩어리로 만들어 통기성을 높여야 해요."],
    ["다음 제강 공정과 긴밀하게 연결된답니다.", "다음 제강 공정과 긴밀하게 연결돼요."],
    ["쇳물을 만들고 있답니다.", "쇳물을 만들고 있어요."],
    ["2차 정련은 성분과 온도를 미세하게 조정하기 위해 진행합니다.", "2차 정련은 성분과 온도를 미세하게 조정하기 위해 진행해요."],
    ["RH 공정에서는 수소나 질소 같은 불순물을 제거하기도 합니다.", "RH 공정에서는 수소나 질소 같은 불순물을 제거하기도 해요."],
    ["재가열로에서 다시 데워져서 가공을 거치게 됩니다.", "재가열로에서 다시 데워져서 가공을 거치게 돼요."],
    ["이것이 어뢰차랍니다.", "이것이 어뢰차예요."],
    ["핵심 설비입니다.", "핵심 설비예요."],
    ["온도가 높습니다.", "온도가 높아요."],
    ["불순물이 줄었습니다.", "불순물이 줄었어요."],
    ["코크스를 만듭니다.", "코크스를 만들어요."],
    ["가스를 회수한다!", "가스를 회수해요!"],
  ];
  for (const [input, expected] of cases) assert.equal(politeText(input), expected, input);
});

test("politeText: 문장 끝만 바꾸고, 질문·인용·이미 해요체인 문장·모르는 어미는 그대로", () => {
  const keep = [
    "코크스는 어떻게 만들어지나요?",
    "학습 화면에는 '가루(반광)는 1번으로 되돌린다'라고 나와요.",
    "열풍로는 열풍을 만드는 설비예요. 고로 옆에 있어요.",
    "가열하다 보면 녹아요.",
    "바다.",
  ];
  for (const text of keep) assert.equal(politeText(text), text, text);
  assert.equal(politeText("소결은 전처리 공정이다. 코크스는 환원제랍니다.\n- 용선이 된다"), "소결은 전처리 공정이에요. 코크스는 환원제예요.\n- 용선이 돼요", "여러 문장·줄 끝");
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

test("withObject: 받침이 있으면 '을', 없으면 '를'. 따옴표 안 마지막 글자를 보고, 한글이 아니면 '를'", () => {
  assert.equal(withObject("소결기"), "소결기를");
  assert.equal(withObject("고로·장입 장치"), "고로·장입 장치를");
  assert.equal(withObject("출선구·주상"), "출선구·주상을");
  assert.equal(withObject("'고로에서 코크스의 역할'"), "'고로에서 코크스의 역할'을");
  assert.equal(withObject("'소결의 목적'"), "'소결의 목적'을");
  assert.equal(withObject("FINEX"), "FINEX를");
});
