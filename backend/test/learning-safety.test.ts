// 안전 질문 차단: 조작 방법·허락, 비상 대응만 막고 교육 질문은 통과시킨다.
import assert from "node:assert/strict";
import test from "node:test";
import { isSafetyQuestion } from "../src/learning/safety.js";

test("조작 방법·허락이나 비상 대응을 묻는 질문은 막는다", () => {
  for (const q of [
    "밸브를 열어도 돼요?",
    "스위치 눌러도 되나요?",
    "비상 정지 버튼은 어디 있어요?",
    "비상시 어떻게 해요?",
    "고로를 정지시키는 방법 알려줘",
    "설비를 조작해도 되나요?",
    "레버를 내려도 괜찮아요?",
    "차단기 끄는 순서가 뭐예요?",
  ]) assert.equal(isSafetyQuestion(q), true, q);
});

test("공정·설비를 이해하려는 교육 질문은 통과시킨다", () => {
  for (const q of [
    "고로가 정지하면 어떻게 되나요?",
    "출선구는 왜 열어요?",
    "점검 주기가 있나요?",
    "고로는 어떻게 작동되나요?",
    "열풍로는 무슨 일을 해요?",
    "가열로 온도는 왜 중요해요?",
    "전로에서 산소를 불면 왜 온도가 올라가요?",
    "코크스가 불순물 없애는 거죠?",
  ]) assert.equal(isSafetyQuestion(q), false, q);
});
