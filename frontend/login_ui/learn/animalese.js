// 포석호 말투(모여봐요 동물의 숲처럼 글자마다 짧은 '뾱' 소리를 빠르게 이어 붙인 동물어). 녹음 파일 없이 Web Audio로 만든다.
// - 소리는 부드러운 사인파 두 개(기음 + 한 옥타브 위 약하게)로 만든다. 톱니파 + 좁은 필터는 '지지직' 기계음이 나서 쓰지 않는다(2026-10-21).
// - 한글 글자는 모음(ㅏ·ㅔ·ㅣ·ㅗ·ㅜ 계열)마다 높이·밝기를 조금씩 바꿔 말하는 것처럼 들리게 한다.
// - 목소리는 아기처럼 높게, 글자마다 '뽀용' 하고 살짝 올라갔다 내려오며, 문장 끝(?·!)은 올린다.
// - 소리가 동그랗게 커졌다 작아지게(setTargetAtTime) 해서 글자 사이 '딱' 소리가 나지 않게 한다.
// - say(text, onChar)는 한 글자씩 소리를 내며 onChar(지금까지 글자)를 불러 자막을 맞춘다. 끝나면 resolve.

// 모음 계열 → [높이 배율, 밝기(저역 통과 Hz)]: ㅣ는 높고 밝게, ㅜ·ㅗ는 낮고 둥글게
const VOWEL = { a: [1.0, 2600], e: [1.05, 3000], i: [1.12, 3400], o: [0.94, 1900], u: [0.9, 1700] };
// 한글 중성(21개) → 모음 계열
const JUNG = ['a', 'e', 'a', 'e', 'o', 'e', 'o', 'e', 'o', 'a', 'e', 'e', 'o', 'u', 'o', 'e', 'i', 'u', 'u', 'i', 'i'];
const LATIN = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' };

let ctx = null;
const audio = () => { if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = AC ? new AC() : null; } if (ctx?.state === 'suspended') ctx.resume(); return ctx; };

function vowelOf(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return JUNG[Math.floor(((c - 0xac00) % 588) / 28)];
  return LATIN[ch.toLowerCase()] || (/[0-9a-z]/i.test(ch) ? 'a' : null);
}

/** 한 글자 소리. t: 시작 시각, f0: 목소리 높이, v: 모음 계열 */
function blip(ac, out, t, f0, v, dur) {
  const [mul, bright] = VOWEL[v], f = f0 * mul;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bright; lp.Q.value = 0.5;
  const g = ac.createGain();
  // 동그란 소리: 0에서 부드럽게 올라갔다(12ms) 천천히 사라진다. 끝까지 0으로 내려 딱 소리가 없다
  g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(1, t, 0.012); g.gain.setTargetAtTime(0, t + dur * 0.45, dur * 0.22);
  g.connect(lp); lp.connect(out);
  for (const [type, ratio, level] of [['sine', 1, 1], ['sine', 2, 0.18], ['triangle', 1, 0.12]]) {
    const o = ac.createOscillator(); o.type = type;
    // '뽀용': 조금 낮게 시작해 살짝 올라갔다 제자리로
    o.frequency.setValueAtTime(f * ratio * 0.92, t); o.frequency.linearRampToValueAtTime(f * ratio * 1.04, t + dur * 0.35); o.frequency.linearRampToValueAtTime(f * ratio, t + dur);
    const lv = ac.createGain(); lv.gain.value = level; o.connect(lv); lv.connect(g);
    o.start(t); o.stop(t + dur * 1.6);
  }
}

/** 모든 글자 소리가 지나가는 출력: 작은 볼륨 → 고역 정리(5kHz 위 잘라 쇳소리 제거) → 압축(겹쳐도 깨지지 않게). 한 번만 만든다 */
let masterNode = null;
function master(ac) {
  if (masterNode) return masterNode;
  const vol = ac.createGain(); vol.gain.value = 0.16;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000; lp.Q.value = 0.4;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
  vol.connect(lp); lp.connect(comp); comp.connect(ac.destination);
  return (masterNode = vol);
}

export function createVoice({ pitch = 560, speed = 1 } = {}) {
  let token = 0;
  return {
    /** 한 줄을 말한다. muted면 소리 없이 같은 속도로 글자만 넘긴다. */
    say(text, onChar = () => {}, { muted = false } = {}) {
      const my = ++token;
      const ac = muted ? null : audio();
      const out = ac ? master(ac) : null;
      const chars = [...text];
      const step = 62 / speed, gapWord = 70 / speed, gapStop = 260 / speed; // ms
      return new Promise((res) => {
        let i = 0; const end = text.match(/[?？]\s*$/) ? 1.25 : text.match(/[!！]\s*$/) ? 1.12 : 1;
        const next = () => {
          if (my !== token) return res();
          if (i >= chars.length) return setTimeout(res, 180);
          const ch = chars[i++]; onChar(chars.slice(0, i).join(''));
          const v = vowelOf(ch);
          let wait = step;
          if (v && ac) {
            const tail = i > chars.length - 4 ? end : 1; // 문장 끝 몇 글자는 올리거나 그대로
            const f0 = pitch * tail * (0.96 + Math.random() * 0.08); // 글자마다 살짝만 흔든다(많이 흔들면 삐걱거림)
            blip(ac, out, ac.currentTime + 0.01, f0, v, (step / 1000) * 1.1);
          }
          if (!v) wait = /[.,!?。…·:;]/.test(ch) ? gapStop : /\s/.test(ch) ? gapWord : step * 0.5;
          setTimeout(next, wait);
        };
        next();
      });
    },
    stop() { token++; },
  };
}
