"""Faceless Studio: word timestamps of narration clips for word-synced captions (faster-whisper, local, CPU).

Usage: words.py <out.json> <clip1.wav> [<clip2.wav> ...]
Writes [{"file": ..., "words": [{"w": "What", "s": 0.12, "e": 0.40}, ...], "match_ratio": 0.93, "source": "script"}, ...].

Captions once showed "RAHANG", "THAN IT HAPPENS", "A POOR DARTS": the words shown on screen are the SCRIPT's
words, never what the model thinks it heard. For each clip, the narration text is read from the sibling .txt file
(media/<id>/audio/NN.txt, written by make-short.mjs before the voice is recorded); whisper only provides the timing.
Script words are aligned to the heard words (difflib on normalised tokens); an unmatched script word gets a time
interpolated between its matched neighbours. "match_ratio" says how much of the script was actually heard: below 0.6
the voice may have skipped or garbled a line (make-short.mjs flags it). Without a .txt the heard words are kept
("source": "whisper"), as before.
Run with the faster-whisper Python (workshop/transcribe.mjs PYTHON), -I.
"""
import difflib
import json
import re
import sys
from pathlib import Path

from faster_whisper import WhisperModel

NORM = re.compile(r"[^a-z0-9']+")


def norm(word: str) -> str:
    return NORM.sub("", word.lower().replace("’", "'"))


def heard_words(model: WhisperModel, clip: str) -> list[dict]:
    segments, _ = model.transcribe(clip, word_timestamps=True, language="en")
    return [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)}
            for seg in segments for w in (seg.words or []) if w.word.strip()]


def align(script: list[str], heard: list[dict]) -> tuple[list[dict], float]:
    """Script words with times taken from the matched heard words; gaps interpolated. Returns (words, match_ratio)."""
    if not script:
        return [], 0.0
    a = [norm(w) for w in script]
    b = [norm(h["w"]) for h in heard]
    times: list = [None] * len(script)
    matched = 0
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["s"], heard[j1 + k]["e"])
                matched += 1
        elif tag == "replace" and (i2 - i1) == (j2 - j1):
            # Same count on both sides (e.g. "rehang" heard as "rahang"): keep the heard timing, show the script word.
            for k in range(i2 - i1):
                times[i1 + k] = (heard[j1 + k]["s"], heard[j1 + k]["e"])
        elif tag == "replace" and j2 > j1:
            # Different counts: spread the heard span over the script words.
            s0, e0 = heard[j1]["s"], heard[j2 - 1]["e"]
            n = i2 - i1
            for k in range(n):
                times[i1 + k] = (s0 + (e0 - s0) * k / n, s0 + (e0 - s0) * (k + 1) / n)
    # Interpolate the words still without a time between their timed neighbours (or the clip's edges).
    clip_start = heard[0]["s"] if heard else 0.0
    clip_end = heard[-1]["e"] if heard else 0.0
    i = 0
    while i < len(times):
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < len(times) and times[j] is None:
            j += 1
        s0 = times[i - 1][1] if i > 0 else clip_start
        e0 = times[j][0] if j < len(times) else max(clip_end, s0 + 0.3 * (j - i))
        if e0 <= s0:
            e0 = s0 + 0.3 * (j - i)
        n = j - i
        for k in range(n):
            times[i + k] = (s0 + (e0 - s0) * k / n, s0 + (e0 - s0) * (k + 1) / n)
        i = j
    words = [{"w": script[k], "s": round(times[k][0], 3), "e": round(max(times[k][1], times[k][0] + 0.05), 3)} for k in range(len(script))]
    return words, round(matched / len(script), 3)


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    out = []
    for clip in sys.argv[2:]:
        heard = heard_words(model, clip)
        txt = Path(clip).with_suffix(".txt")
        if txt.exists():
            script = [w for w in txt.read_text(encoding="utf-8").split() if norm(w)]
            words, ratio = align(script, heard)
            out.append({"file": clip, "words": words, "match_ratio": ratio, "source": "script", "heard": len(heard)})
        else:
            out.append({"file": clip, "words": heard, "match_ratio": None, "source": "whisper", "heard": len(heard)})
    Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=True), encoding="utf-8")
    low = [c for c in out if c["match_ratio"] is not None and c["match_ratio"] < 0.6]
    print(f"{len(out)} clip(s), {sum(len(c['words']) for c in out)} words" + (f", {len(low)} clip(s) poorly heard" if low else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
