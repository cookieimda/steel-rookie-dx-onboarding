// 루브릭 문장(평서형 '~다')을 튜터 말투(해요체)로 바꾼다. 핵심 정리(key_points 발화)를 화면에 보여 줄 때만 쓴다.
// 루브릭 원문은 평가자 입력이라 고치지 않는다. 바꿀 수 없는 어미는 원문 그대로 둔다(테스트로 final 루브릭 문장이 모두 바뀌는지 확인).

/** 마지막 글자에 받침이 있는지(한글 음절만). */
const hasFinal = (ch: string) => {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};

// 어미 → 해요체. 위에서부터 처음 맞는 것 하나만 바꾼다.
const ENDINGS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/(.)이다$/, (m) => `${m[1]}${hasFinal(m[1]) ? "이에요" : "예요"}`],
  [/한다$/, () => "해요"],
  [/된다$/, () => "돼요"],
  [/있다$/, () => "있어요"],
  [/없다$/, () => "없어요"],
  [/든다$/, () => "들어요"],
  [/진다$/, () => "져요"],
  [/난다$/, () => "나요"],
  [/준다$/, () => "줘요"],
  [/낸다$/, () => "내요"],
  [/간다$/, () => "가요"],
  [/온다$/, () => "와요"],
];

/** '소결은 … 공정이다.' → '소결은 … 공정이에요.' 바꿀 수 없으면 원문 그대로. */
export function toPolite(sentence: string): string {
  const match = /^(.*?)([.!]?)\s*$/s.exec(sentence)!;
  const body = match[1];
  for (const [pattern, replace] of ENDINGS) {
    const m = pattern.exec(body);
    if (m) return `${body.slice(0, m.index)}${replace(m)}${match[2] || "."}`;
  }
  return sentence;
}
