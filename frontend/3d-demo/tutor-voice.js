// 포석호 목소리: 브라우저 음성 합성(Web Speech API)으로 이해도 확인 말풍선을 읽는다. 서버·비용 없이 브라우저의 한국어 음성을 쓴다.
// - 켜짐 여부는 이 브라우저에만 저장한다(st-rookie-voice, 기본 꺼짐). 자동 재생을 막는 브라우저가 있어서 사용자가 켠 뒤에만 읽는다.
// - 브라우저나 테스트(Node)처럼 speechSynthesis가 없으면 아무것도 하지 않는다.

const KEY = 'st-rookie-voice';

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function voiceOn() {
  try { return voiceSupported() && localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setVoiceOn(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* 저장이 막혀도 이번 화면에서는 동작한다 */ }
  if (!on) stopVoice();
}

/** 읽기 좋게 다듬는다: 목록 기호·마크다운 기호를 빼고 줄바꿈은 쉼으로. */
export const speakableText = (text) => String(text || '').replace(/^\s*[-•]\s*/gm, '').replace(/[*#`]/g, '').replace(/\n+/g, '. ').trim();

function koreanVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /^ko(-|_|$)/i.test(v.lang)) || null;
}

/** 지금 읽던 것을 멈추고 새 문장을 읽는다. */
export function speak(text) {
  const line = speakableText(text);
  if (!voiceSupported() || !line) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(line);
  u.lang = 'ko-KR';
  const voice = koreanVoice();
  if (voice) u.voice = voice;
  u.rate = 1.05;
  u.pitch = 1.1;
  synth.speak(u);
}

export function stopVoice() {
  if (voiceSupported()) window.speechSynthesis.cancel();
}
