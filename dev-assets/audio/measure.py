"""Measures candidate SFX the way `scripts/measure-art.mjs` measures sprites: it asserts nothing and
reports the handful of numbers a choice can actually be made on.

Nobody here can listen to these files, so the pick has to be made on properties that stand in for
what an ear would judge: how long it lasts, how bright it is, and whether it is a *tone* or a
*noise*. Those three separate a coin from a thud without hearing either.

Usage:  py -3.11 measure.py <zip>:<name> [...]
"""
import io
import subprocess
import sys
import wave
import zipfile

import numpy as np


def load(spec):
    archive, name = spec.split(':', 1)
    zf = zipfile.ZipFile(archive)
    path = next(n for n in zf.namelist() if n.endswith('/' + name + '.ogg') or n == name + '.ogg')
    raw = zf.read(path)
    out = subprocess.run(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'wav', '-ac', '1', '-ar', '44100', 'pipe:1'],
        input=raw,
        stdout=subprocess.PIPE,
        check=True,
    ).stdout
    with wave.open(io.BytesIO(out)) as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
        return frames, w.getframerate()


def measure(spec):
    x, sr = load(spec)
    if x.size == 0:
        return None
    peak = np.abs(x).max()
    # Trim the silent tail so the duration is the sound rather than the file.
    loud = np.nonzero(np.abs(x) > peak * 0.02)[0]
    x = x[loud[0]:loud[-1] + 1] if loud.size else x
    ms = len(x) / sr * 1000

    window = np.hanning(len(x)) if len(x) > 1 else np.ones(1)
    spectrum = np.abs(np.fft.rfft(x * window))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    centroid = float((spectrum * freqs).sum() / max(spectrum.sum(), 1e-9))

    # **Tonality: how much of the energy sits in the few loudest bins.** A struck metal object puts
    # most of it in a handful of partials; a thud spreads it across the whole band. This is the one
    # number that separates "coin" from "impact" without hearing them.
    power = spectrum ** 2
    top = np.sort(power)[::-1][: max(1, len(power) // 200)]
    tonality = float(top.sum() / max(power.sum(), 1e-9))

    # **How much of it a phone can actually reproduce.** A phone speaker rolls off hard below about
    # 500Hz, so a thud whose energy is all at 126Hz is a sound most players never hear — which is the
    # one thing a damage cue may not be. This is the number that decides between two impacts that
    # look equally good on every other row.
    phone = float(power[freqs >= 500].sum() / max(power.sum(), 1e-9))

    return dict(ms=ms, peak=float(peak), centroid=centroid, tonality=tonality, phone=phone)


print(f'{"sound":42} {"ms":>6} {"peak":>5} {"centroid":>9} {"tonal":>6} {"phone":>6}')
for spec in sys.argv[1:]:
    m = measure(spec)
    if not m:
        print(f'{spec:42} (empty)')
        continue
    print(
        f'{spec.split(":")[1]:42} {m["ms"]:6.0f} {m["peak"]:5.2f} {m["centroid"]:8.0f}Hz {m["tonality"]:6.2f} {m["phone"]:6.2f}'
    )
