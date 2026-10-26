# Faceless Studio: word timestamps with faster-whisper (offline, cached models only).
# Called by workshop/transcribe.mjs. Input: one JSON line on stdin {"audio": path, "model": "small", "language": "en"}.
# Output: one ASCII-only JSON line on stdout (non-ASCII escaped), so Windows code pages never break it.
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")


def main():
    req = json.loads(sys.stdin.readline())
    from faster_whisper import WhisperModel

    model = WhisperModel(req.get("model", "medium"), device=req.get("device", "cpu"), compute_type=req.get("compute_type", "int8" if req.get("device", "cpu") == "cpu" else "float16"))
    segments, info = model.transcribe(req["audio"], language=req.get("language") or None, word_timestamps=True, vad_filter=False)
    words = []
    text = []
    for seg in segments:
        text.append(seg.text.strip())
        for w in seg.words or []:
            words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
    out = {"language": info.language, "duration": round(info.duration, 3), "text": " ".join(t for t in text if t), "words": words}
    sys.stdout.write(json.dumps(out, ensure_ascii=True) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # report, never hang
        sys.stdout.write(json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=True) + "\n")
        sys.exit(1)
