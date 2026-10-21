# 사람 답변 수집용 질문 (제선)

신입사원이나 팀원에게 아래 질문을 보여 주고 답변을 그대로 받아 주세요. 정답이나 루브릭은 보여 주지 않습니다.

- 맞춤법, 말투, 길이를 고치지 말고 받은 그대로 옮깁니다.
- "모르겠어요", 되묻기, 엉뚱한 답도 그대로 남깁니다. 이런 답변이 평가에 가장 쓸모 있습니다.
- 개인정보(이름, 사번 등)는 넣지 않습니다.

| question_id | 개념 | 질문 |
|---|---|---|
| sinter-1 | sinter_purpose | 소결 공정은 왜 필요할까요? |
| sinter-2 | sinter_purpose | 철광석을 가루 상태 그대로 고로에 넣지 않는 이유는 무엇일까요? |
| coke-1 | coke_reduction | 고로에서 코크스는 어떤 역할을 하나요? |
| coke-2 | coke_reduction | 고로 안에서 철광석의 산소는 어떻게 없어질까요? |
| bf-1 | blast_furnace_hot_metal | 고로에서 용선은 어떻게 만들어지고, 그다음 어디로 가나요? |
| bf-2 | blast_furnace_hot_metal | 고로에서 나온 쇳물을 그대로 제품으로 쓰지 않는다면, 쇳물은 어떤 과정을 거쳐 어디로 가나요? |

## 평가 세트에 넣는 방법

모은 답변은 `llm/eval/hard/ironmaking.human.jsonl`에 한 줄에 하나씩 넣습니다. `expected_verdict`는 팀이 루브릭(`content/rubrics/final/01_제선.json`)으로 판정해서 채웁니다.

```json
{"concept_id":"coke_reduction","phase":"initial","question":"고로에서 코크스는 어떤 역할을 하나요?","answer":"(받은 답변 그대로)","expected_verdict":"partial","source":"human","question_id":"coke-1"}
```

- `phase`는 `initial`로 둡니다. 재확인 질문은 부가 설명을 들은 뒤에 하는 질문이라 수집 방식이 다릅니다.
- 같은 사람이 같은 뜻을 다르게 쓴 답변이 있으면 같은 `pair_id`를 붙여도 됩니다.
- 판정이 팀 안에서 갈린 답변은 `note`에 이유를 적어 둡니다.
