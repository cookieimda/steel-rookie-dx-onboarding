// 포석호 효과음: 판정 반응 순간에만 짧고 귀여운 짐승 소리 같은 효과음을 낸다. 문장은 읽지 않는다.
// - 녹음 파일 없이 Web Audio로 합성한다(라이선스·파일 없음). 톱니파를 대역 통과 필터(목소리 울림)에 통과시키고,
//   음높이를 빠르게 미끄러뜨리고 떨림(비브라토)을 넣어 "뀨잇!" "뿌잉~" 같은 소리를 만든다.
// - 켜짐 여부는 이 브라우저에만 저장한다(st-rookie-sfx, 기본 켜짐). 브라우저는 사용자가 한 번 누른 뒤에야 소리를 내므로
//   [학습하기]·[준비됐어요] 같은 클릭 뒤에 난다.
// - AudioContext가 없는 곳(테스트·Node)에서는 아무것도 하지 않는다.

const KEY = 'st-rookie-sfx';

/** 말풍선 발화 type → 효과음. 반응이 아닌 발화(질문·설명 등)는 소리 없음. */
export function sfxFor(type, { unlocked = false } = {}) {
  if (type === 'feedback') return 'correct';
  if (type === 'almost') return 'almost';
  if (type === 'miss' || type === 'key_points') return 'miss';
  if (type === 'result') return unlocked ? 'celebrate' : 'cheer';
  return null;
}

export const sfxSupported = () => typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

export function sfxOn() {
  if (!sfxSupported()) return false;
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setSfxOn(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 저장이 막혀도 이번 화면에서는 동작한다 */ }
}

let ctx = null;
function audio() {
  if (!sfxSupported()) return null;
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * 짐승 울음 한 마디. pitch는 [시간(초), 주파수] 점들(음높이 곡선), vowel은 목소리 울림 중심(Hz, 높을수록 '이'·낮을수록 '우').
 * 톱니파 + 대역 통과(울림) + 사인파(맑은 몸통)를 섞고, 빠른 비브라토를 건다.
 */
function chirp(ac, at, { pitch, vowel = 1800, vibrato = 9, depth = 0.02, gain = 0.18 }) {
  const end = at + pitch[pitch.length - 1][0];
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  out.gain.setValueAtTime(gain, Math.max(at + 0.02, end - 0.05));
  out.gain.exponentialRampToValueAtTime(0.0001, end);
  out.connect(ac.destination);

  const formant = ac.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = vowel;
  formant.Q.value = 5;
  formant.connect(out);

  const body = ac.createGain();
  body.gain.value = 0.55;
  body.connect(out);

  for (const [type, dest] of [['sawtooth', formant], ['sine', body]]) {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(pitch[0][1], at);
    for (const [t, f] of pitch.slice(1)) osc.frequency.exponentialRampToValueAtTime(f, at + t);
    // 비브라토: 음높이를 빠르게 살짝 흔든다(귀여운 떨림).
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    lfo.frequency.value = vibrato;
    lfoGain.gain.value = pitch[0][1] * depth;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(dest);
    osc.start(at); lfo.start(at);
    osc.stop(end + 0.02); lfo.stop(end + 0.02);
  }
  return end;
}

/** 효과음 이름 → 짐승 울음 마디들. */
const SOUNDS = {
  // 정답: "뀨잇!" 위로 두 번 톡톡
  correct: (ac, t) => {
    const a = chirp(ac, t, { pitch: [[0, 900], [0.09, 1500]], vowel: 2400 });
    chirp(ac, a + 0.03, { pitch: [[0, 1200], [0.13, 1900]], vowel: 2600 });
  },
  // 거의 맞음: "음~?" 고개 갸웃, 끝이 올라감
  almost: (ac, t) => {
    chirp(ac, t, { pitch: [[0, 620], [0.18, 560], [0.38, 860]], vowel: 1300, vibrato: 7, depth: 0.03, gain: 0.15 });
  },
  // 틀림: "뿌잉~" 내려가는 시무룩한 소리
  miss: (ac, t) => {
    chirp(ac, t, { pitch: [[0, 760], [0.12, 820], [0.5, 380]], vowel: 1000, vibrato: 6, depth: 0.04, gain: 0.15 });
  },
  // 통과: 짧은 팡파르(톡톡톡 뀨잇!)
  celebrate: (ac, t) => {
    let at = t;
    for (const f of [1047, 1319, 1568]) at = chirp(ac, at, { pitch: [[0, f], [0.08, f * 1.06]], vowel: 2400, gain: 0.14 }) + 0.02;
    chirp(ac, at, { pitch: [[0, 2093], [0.1, 2350], [0.22, 2200]], vowel: 2800, gain: 0.16 });
  },
  // 미달: "힘내!" 응원 두 번
  cheer: (ac, t) => {
    const a = chirp(ac, t, { pitch: [[0, 700], [0.12, 950]], vowel: 1700, gain: 0.15 });
    chirp(ac, a + 0.06, { pitch: [[0, 750], [0.16, 1100]], vowel: 1900, gain: 0.16 });
  },
};

/** 효과음 이름 목록. */
export const SFX_NAMES = Object.keys(SOUNDS);

/** 주어진 오디오 컨텍스트(실시간·OfflineAudioContext)에 효과음을 at초에 예약한다. 미리 듣기 파일을 만들 때도 쓴다. */
export function scheduleSfx(ac, name, at = 0) {
  SOUNDS[name]?.(ac, at);
}

/** 효과음을 낸다. 꺼져 있거나 지원하지 않으면 아무것도 하지 않는다. */
export function playSfx(name, { force = false } = {}) {
  if (!name || !SOUNDS[name] || (!force && !sfxOn())) return;
  const ac = audio();
  if (!ac) return;
  SOUNDS[name](ac, ac.currentTime + 0.02);
}
