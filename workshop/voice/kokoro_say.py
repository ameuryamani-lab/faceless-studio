"""Faceless Studio narrator voice: Kokoro-82M (Apache 2.0) through kokoro-onnx, on the CPU, no network.

Usage: kokoro_say.py <text_file> <voice> <out.wav> [speed]
Model files (kokoro-v1.0.onnx, voices-v1.0.bin): the folder named by STUDIO_KOKORO_MODELS, else "kokoro_models" in
config.local.json at the studio root, else <studio>/models/kokoro.
Run with the Kokoro Python (core/local-config.mjs KOKORO_PY) -I.
"""
import json
import os
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

STUDIO = Path(__file__).resolve().parents[2]


def models_dir() -> Path:
    env = os.environ.get("STUDIO_KOKORO_MODELS")
    if env:
        return Path(env)
    cfg = STUDIO / "config.local.json"
    if cfg.exists():
        try:
            value = json.loads(cfg.read_text(encoding="utf-8")).get("kokoro_models")
        except (OSError, ValueError):
            value = None
        if value:
            return Path(value)
    return STUDIO / "models" / "kokoro"


MODELS = models_dir()


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    text = Path(sys.argv[1]).read_text(encoding="utf-8").strip()
    voice, out = sys.argv[2], Path(sys.argv[3])
    speed = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    if not text:
        print("empty text")
        return 2
    kokoro = Kokoro(str(MODELS / "kokoro-v1.0.onnx"), str(MODELS / "voices-v1.0.bin"))
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out), samples, rate)
    print(f"{out} {len(samples) / rate:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
