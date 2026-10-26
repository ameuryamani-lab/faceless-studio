# Faceless Studio promo: keeps, for each narration line, the Chatterbox take that Whisper hears exactly (2026-10-22: short lines
# came out as "brighten it" or "Boi set"). Score = share of the line's words heard, minus words heard twice or invented; ties go
# to the take closest to a natural length. Copies the winner to lNN.wav and prints what was heard.
#   python -I pick_takes.py <lines.json> <takes_dir>      (faster-whisper venv)
import glob
import json
import os
import re
import shutil
import sys

from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

NUMBERS = {"22": "twenty two", "10": "ten", "0": "zero", "ai": "ai", "a.i.": "ai"}


def words(s):
    s = s.lower().replace("-", " ")
    out = []
    for w in re.findall(r"[a-z0-9.]+", s):
        w = w.strip(".")
        out.extend(NUMBERS.get(w, w).split())
    return out


def seconds(f):
    # Chatterbox writes float WAVs, which the wave module cannot read: decode like Whisper does (16 kHz).
    return len(decode_audio(f)) / 16000


def main():
    lines = json.load(open(sys.argv[1], encoding="utf-8"))
    d = sys.argv[2]
    model = WhisperModel("small", device="cpu", compute_type="int8")
    for i, text in enumerate(lines):
        want = words(text)
        best = None
        for f in sorted(glob.glob(os.path.join(d, f"l{i:02d}_t*.wav"))):
            segs, _ = model.transcribe(f, language="en")
            heard = words(" ".join(s.text for s in segs))
            hit = sum(1 for w in want if w in heard) / max(1, len(want))
            extra = max(0, len(heard) - len(want)) / max(1, len(want))
            natural = 0.38 * len(want) + 0.4  # about 2.6 words a second, energetic
            score = hit - extra - 0.05 * abs(seconds(f) - natural)
            if best is None or score > best[0]:
                best = (score, f, " ".join(heard))
        if best:
            shutil.copyfile(best[1], os.path.join(d, f"l{i:02d}.wav"))
            print(f"l{i:02d} {best[0]:+.2f} {os.path.basename(best[1])} | {best[2]}")


if __name__ == "__main__":
    main()
