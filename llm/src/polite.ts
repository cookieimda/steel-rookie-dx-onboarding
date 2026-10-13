// 튜터 말투를 해요체로 맞춘다. 프롬프트에 해요체 규칙을 넣어도 모델이 '~답니다', '~입니다', '~다'를 섞어서,
// 화면에 보내기 전에 문장 끝 어미만 바꾼다. 모델을 바꿔도(자체 LLM 포함) 같은 결과가 나오게 서버에서 한다.
// - 문장 끝 단어(뒤에 마침표·느낌표 하나와 공백·줄 끝만 오는 단어)만 본다. 따옴표 안 인용('…되돌린다'라고)과 질문(?)은 건드리지 않는다.
// - 바꿀 줄 모르는 어미는 그대로 둔다(틀리게 바꾸는 것보다 낫다).
// - 루브릭 핵심 요소(평가자 입력)는 고치지 않고 화면에 보여 줄 때만 바꾼다(checkpoint engine의 핵심 정리).

const BASE = 0xac00;
const isSyllable = (ch: string) => {
  const c = ch.charCodeAt(0) - BASE;
  return c >= 0 && c < 11172;
};
const parts = (ch: string) => {
  const c = ch.charCodeAt(0) - BASE;
  return { initial: Math.floor(c / 588), medial: Math.floor((c % 588) / 28), final: c % 28 };
};
const compose = (initial: number, medial: number, final = 0) => String.fromCharCode(BASE + initial * 588 + medial * 28 + final);

// 모음(중성) 번호
const A = 0, AE = 1, YA = 2, EO = 4, E = 5, YEO = 6, O = 8, WA = 9, WAE = 10, OE = 11, U = 13, WO = 14, EU = 18, I = 20;
// 초성 번호
const RIEUL = 5, HIEUH = 18;
// 종성 번호
const F_NIEUN = 4, F_RIEUL = 8, F_BIEUP = 17, F_SSANG_SIOT = 20;

/** 받침 있는 줄기 뒤의 '-아요/-어요'(밝은 모음 ㅏ·ㅗ·ㅑ면 아요). */
const ayo = (medial: number) => (medial === A || medial === O || medial === YA ? "아요" : "어요");

/**
 * 'X+ㄴ다'의 X(받침 없는 줄기 끝 음절)를 해요체로. prev는 그 앞 글자(르 불규칙에 씀). 모르면 null.
 * 가→가요, 하→해요, 오→와요, 주→줘요, 지→져요, 되→돼요, 쓰→써요, 부르→불러요
 */
function conjugateOpen(syllable: string, prev: string): string | null {
  const { initial, medial } = parts(syllable);
  if (initial === HIEUH && medial === A) return "해요";
  if (medial === A || medial === AE || medial === EO || medial === E || medial === YEO) return `${syllable}요`;
  if (medial === O) return `${compose(initial, WA)}요`;
  if (medial === U) return `${compose(initial, WO)}요`;
  if (medial === I) return `${compose(initial, YEO)}요`;
  if (medial === OE) return `${compose(initial, WAE)}요`;
  if (medial === EU) {
    if (initial === RIEUL && prev && isSyllable(prev) && parts(prev).final === 0) {
      // 르 불규칙: 부르 → 불러, 고르 → 골라
      const p = parts(prev);
      return `\u0000${compose(p.initial, p.medial, F_RIEUL)}${p.medial === A || p.medial === O ? "라" : "러"}요`;
    }
    return `${compose(initial, EO)}요`;
  }
  return null;
}

/** 평서형 '~다'로 끝나는 단어를 해요체로. 모르면 null. */
function plainToPolite(word: string): string | null {
  if (!word.endsWith("다") || word.length < 2) return null;
  const stem = word.slice(0, -1);
  const last = stem.at(-1)!;
  const before = stem.slice(0, -1);
  if (!isSyllable(last)) return null;
  // 명사 + 이다: 공정이다 → 공정이에요, 토페도카이다 → 토페도카예요
  if (last === "이" && before && isSyllable(before.at(-1)!)) {
    return `${before}${parts(before.at(-1)!).final ? "이에요" : "예요"}`;
  }
  if (last === "있" || last === "없") return `${stem}어요`;
  if (last === "하") return `${before}해요`;
  // ㄹ 줄기 + ㄴ다: 만든다 → 만들어요
  if (stem.endsWith("든")) return `${stem.slice(0, -1)}들어요`;
  const { medial, final } = parts(last);
  // 받침 줄기 + 는다: 먹는다 → 먹어요, 녹는다 → 녹아요
  if (last === "는" && before && isSyllable(before.at(-1)!) && parts(before.at(-1)!).final) {
    return `${before}${ayo(parts(before.at(-1)!).medial)}`;
  }
  // 과거: 했다 → 했어요, 갔다 → 갔어요
  if (final === F_SSANG_SIOT) return `${stem}어요`;
  // 받침 없는 줄기 + ㄴ다: 한다 → 해요, 부른다 → 불러요
  if (final === F_NIEUN) {
    const open = conjugateOpen(compose(parts(last).initial, medial), before.at(-1) ?? "");
    if (!open) return null;
    // 르 불규칙은 앞 글자까지 바꾼다(표시 \u0000).
    return open.startsWith("\u0000") ? `${before.slice(0, -1)}${open.slice(1)}` : `${before}${open}`;
  }
  // 받침 줄기 + 다(형용사·동사 원형): 높다 → 높아요, 같다 → 같아요
  if (final) return `${stem}${ayo(medial)}`;
  return null;
}

/** '~답니다', '~입니다', '~합니다' 같은 어미를 평서형 '~다'로 되돌린다. */
function toPlain(word: string): string {
  if (/이랍니다$/.test(word)) return word.replace(/이랍니다$/, "이다");
  if (/랍니다$/.test(word)) return word.replace(/랍니다$/, "이다");
  if (/답니다$/.test(word)) return word.replace(/답니다$/, "다");
  if (/입니다$/.test(word)) return word.replace(/입니다$/, "이다");
  if (/습니다$/.test(word)) return word.replace(/습니다$/, "다");
  // 받침 ㅂ + 니다: 합니다 → 한다, 됩니다 → 된다, 만듭니다 → 만든다
  const m = /(.)니다$/.exec(word);
  if (m && isSyllable(m[1]) && parts(m[1]).final === F_BIEUP) {
    const p = parts(m[1]);
    return `${word.slice(0, m.index)}${compose(p.initial, p.medial, F_NIEUN)}다`;
  }
  return word;
}

/** 문장 끝 단어 하나를 해요체로. 바꿀 수 없으면 그대로. */
export function politeWord(word: string): string {
  return plainToPolite(toPlain(word)) ?? word;
}

/** 여러 문장의 끝 어미를 해요체로. 바꿀 수 없는 문장은 그대로 둔다. */
export function politeText(text: string): string {
  // 문장 끝: 단어 뒤에 마침표·느낌표가 오고 그다음이 공백·줄 끝이거나, 단어가 줄 끝에 있을 때만(중간의 '~하다 보면'은 그대로).
  return text.replace(/[가-힣]+(?=[.!](?=\s|$)|$)/gm, (word) => politeWord(word));
}

/** 루브릭 핵심 요소 한 문장('소결은 … 공정이다.')을 해요체로. 바꿀 수 없으면 원문 그대로. */
export function toPolite(sentence: string): string {
  return politeText(sentence);
}
