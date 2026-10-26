# Faceless Studio promo narration with Chatterbox (resemble-ai, MIT), in its own venv (pip install chatterbox-tts).
# Never a real person's voice: the reference is a synthetic Kokoro sample (data, made on this PC). One WAV per line, so the
# edit can place each line on its shot.
#   python -I voice_cb.py <lines.json> <reference.wav> <out_dir> [exaggeration] [cfg_weight] [takes]
#   lines.json: ["Meet the studio that never sleeps.", ...]  ->  out_dir/l00_t0.wav, l00_t1.wav, ... (pick_takes.py keeps the
#   take Whisper hears right: short lines are unstable, 2026-10-22)
import json
import os
import sys

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS


def main():
    lines = json.load(open(sys.argv[1], encoding="utf-8"))
    ref, out = sys.argv[2], sys.argv[3]
    exaggeration = float(sys.argv[4]) if len(sys.argv) > 4 else 0.8
    cfg = float(sys.argv[5]) if len(sys.argv) > 5 else 0.35
    takes = int(sys.argv[6]) if len(sys.argv) > 6 else 1
    os.makedirs(out, exist_ok=True)
    model = ChatterboxTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")
    for i, text in enumerate(lines):
        for k in range(takes):
            torch.manual_seed(7 + 101 * k)
            wav = model.generate(text, audio_prompt_path=ref, exaggeration=exaggeration, cfg_weight=cfg, temperature=0.7)
            torchaudio.save(os.path.join(out, f"l{i:02d}_t{k}.wav"), wav, model.sr)
            print(f"l{i:02d}_t{k} {wav.shape[-1] / model.sr:.2f}s {text}")


if __name__ == "__main__":
    main()
