# Faceless Studio promo music (2026-10-22): an original soft electro-cinematic bed, synthesized here, nothing downloaded.
# The clicks of the first promo were disturbing: no hi-hats, no clicks, no beeps. Every note has a smooth attack
# (>= 8 ms) and release, the chords cross-fade, and soft whooshes mark the cuts.
#   python -I music.py <out.wav> <seconds> [whoosh_times_comma_separated]
import sys
import wave

import numpy as np

SR = 48000
BPM = 100
BEAT = 60 / BPM
# A minor: Am - F - C - G, two bars each.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, attack, release, sustain=1.0):
    """Linear-in, cosine-out envelope of n samples: never a step, so never a click."""
    e = np.full(n, sustain, dtype=np.float64)
    a = min(n, max(1, int(attack * SR)))
    r = min(n, max(1, int(release * SR)))
    e[:a] = np.linspace(0, sustain, a)
    e[-r:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, r)))
    return e


def tone(f, dur, harmonics=(1.0,), detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for k, amp in enumerate(harmonics, start=1):
        out += amp * np.sin(2 * np.pi * f * k * t)
        if detune:
            out += amp * np.sin(2 * np.pi * f * k * (1 + detune) * t + 1.3)
    return out


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[: j - i]


def lowpass(x, cutoff):
    """Smooth spectral low-pass (Gaussian roll-off), no ringing."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec *= np.exp(-0.5 * (np.maximum(f - cutoff, 0) / (cutoff * 0.5)) ** 2)
    return np.fft.irfft(spec, len(x))


def reverb(x, seconds=2.2, mix=0.28, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 6, n))
    ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    ir = lowpass(ir, 4000)
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[: len(x)]
    return (1 - mix) * x + mix * wet


def main():
    out = sys.argv[1]
    total = float(sys.argv[2])
    whooshes = [float(v) for v in sys.argv[3].split(",")] if len(sys.argv) > 3 and sys.argv[3] else []
    n = int(total * SR)
    pad = np.zeros(n)
    bass = np.zeros(n)
    pluck = np.zeros(n)
    kick = np.zeros(n)
    seg = 8 * BEAT
    t = 0.0
    k = 0
    while t < total:
        chord = CHORDS[k % 4]
        dur = seg + 1.2  # overlap: the chords cross-fade
        for m in chord + [chord[0] + 12]:
            s = tone(hz(m), dur, harmonics=(1.0, 0.35, 0.12), detune=0.003) * env(int(dur * SR), 1.4, 1.6)
            add(pad, t, s, 0.07)
        for b in range(0, 8, 2):  # bass on beats 1 and 3, soft, rising in over the first 6 s
            bt = t + b * BEAT
            if bt >= total:
                break
            d = BEAT * 1.6
            s = tone(hz(ROOTS[k % 4]), d, harmonics=(1.0, 0.2)) * env(int(d * SR), 0.012, 0.35, 0.9)
            add(bass, bt, s, 0.22 * min(1.0, bt / 6))
        notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 12]
        for e8 in range(16):  # arpeggio of eighths from 7 s to 3 s before the end
            et = t + e8 * BEAT / 2
            if et < 7 or et >= total - 3:
                continue
            d = BEAT * 0.9
            s = tone(hz(notes[e8 % 4]), d, harmonics=(1.0, 0.25)) * np.exp(-np.linspace(0, 5, int(d * SR))) * env(int(d * SR), 0.008, 0.08)
            add(pluck, et, s, 0.06)
        for b in range(8):  # soft low kick (10 ms attack, 50-90 Hz) in the middle section only
            bt = t + b * BEAT
            if bt < 12 or bt > total - 6:
                continue
            d = 0.42
            tt = np.arange(int(d * SR)) / SR
            f = 50 + 40 * np.exp(-tt * 18)
            s = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(tt), 0.01, 0.3)
            add(kick, bt, s, 0.30)
        t += seg
        k += 1
    rng = np.random.default_rng(3)
    whoosh = np.zeros(n)
    for w in whooshes:  # noise through a soft band, 0.9 s, peaking on the cut
        d = 0.9
        sweep = lowpass(rng.standard_normal(int(d * SR)), 1800) * np.hanning(int(d * SR))
        add(whoosh, max(0.0, w - d * 0.6), sweep, 0.10)
    mix = lowpass(pad, 3200) + bass + lowpass(pluck, 5000) + kick + whoosh
    mix = reverb(mix) * env(n, 1.5, 3.0)
    mix /= np.max(np.abs(mix)) + 1e-9
    mix = np.tanh(mix * 1.1) * 0.8  # soft limiter, no hard clip
    stereo = np.stack([mix, np.roll(mix, int(0.011 * SR))], axis=1)
    with wave.open(out, "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((stereo * 32767).astype(np.int16).tobytes())
    print(f"music: {out} {total:.1f}s")


if __name__ == "__main__":
    main()
