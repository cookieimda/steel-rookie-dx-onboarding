# 포석호 첫 안내(frontend/login_ui/tutor-tour/tour.js) 음성 만들기. 무료 로컬 TTS Supertonic으로 scripts/tutor-tour-lines.json의
# 발음용 문장(speak)을 읽어 frontend/login_ui/tutor-tour/audio/{id}.mp3로 저장한다. 자막은 tour.js에 따로 있다.
# - 목소리: 기본 목소리 M1을 반음 7개 올려(리샘플링) 어린 남자아이처럼, 말 빠르기 1.15배. 앞뒤 무음은 앞 0.12초·뒤 0.25초만 남긴다.
# - 이미 있는 파일은 건너뛴다(같은 문장도 만들 때마다 조금씩 달라진다). 다시 만들 줄은 mp3를 지우고 실행한다.
# - 준비: Python 3.11 이상, pip install supertonic scipy soundfile. 처음 실행 때 모델(Supertonic 3)을 Hugging Face에서 내려받는다.
#   Windows에서는 경로가 짧은 가상환경을 쓴다(긴 경로에서 numpy 설치가 실패한다).
# 실행: python scripts/tutor-tour-tts.py
import json
import sys
from fractions import Fraction
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from supertonic import TTS

ROOT = Path(__file__).resolve().parent.parent
LINES = ROOT / "scripts" / "tutor-tour-lines.json"
OUT = ROOT / "frontend" / "login_ui" / "tutor-tour" / "audio"
VOICE, SEMIS, TEMPO, SR = "M1", 7, 1.15, 44100
MP3_LEVEL = 0.75  # 약 96kbps(libsndfile 압축 수준)


def trim(y, lead=0.12, trail=0.25, floor=0.01):
    """앞뒤 무음을 잘라 앞 lead초·뒤 trail초만 남긴다(생성 결과에 최대 2초 넘는 공백이 붙는다)."""
    idx = np.nonzero(np.abs(y) > floor)[0]
    if len(idx) == 0:
        return y
    return y[max(0, idx[0] - int(lead * SR)): idx[-1] + int(trail * SR)]


def main():
    lines = json.loads(LINES.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    tts = TTS(auto_download=True)
    style = tts.get_voice_style(voice_name=VOICE)
    # 리샘플링은 음높이와 음색을 같은 비율(r)로 올리고 그만큼 빨라진다. 생성할 때 speed를 r로 나눠 최종 빠르기를 TEMPO로 맞춘다
    r = 2 ** (SEMIS / 12)
    ratio = Fraction(1 / r).limit_denominator(400)
    for line in lines:
        path = OUT / f"{line['id']}.mp3"
        if path.exists():
            print(f"SKIP {line['id']}", flush=True)
            continue
        wav, _ = tts.synthesize(line["speak"], voice_style=style, total_steps=10, speed=TEMPO / r, lang="ko")
        y = resample_poly(np.asarray(wav, dtype=np.float64).ravel(), ratio.numerator, ratio.denominator)
        y = trim(y / (np.abs(y).max() or 1) * 0.89)
        sf.write(str(path), y, SR, format="MP3", compression_level=MP3_LEVEL, bitrate_mode="CONSTANT")
        print(f"OK {line['id']} {len(y) / SR:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
