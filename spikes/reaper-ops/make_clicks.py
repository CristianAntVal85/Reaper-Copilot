# Spike: click track at 150 BPM, 16 bars of 4/4, 0.5 s leading silence, accented downbeats.
import numpy as np, soundfile as sf, sys
sr, bpm, bars, lead = 44100, 150.0, 16, 0.5
beat = 60.0 / bpm
n = int(sr * (lead + bars * 4 * beat + 0.5))
y = np.zeros(n)
for b in range(bars * 4):
    t0 = int(sr * (lead + b * beat))
    f, amp = (1500.0, 0.9) if b % 4 == 0 else (800.0, 0.5)
    k = np.arange(int(sr * 0.03))
    y[t0:t0 + k.size] += amp * np.sin(2 * np.pi * f * k / sr) * np.exp(-k / (sr * 0.008))
# a low drone so the bands are not all silence
t = np.arange(n) / sr
y += 0.1 * np.sin(2 * np.pi * 55 * t) * (t > lead)
sf.write(sys.argv[1], np.stack([y, y], 1), sr, subtype="PCM_24")
print(n / sr, "s")
