"""Spike: fine tempo refinement by comb search on the onset autocorrelation. Throwaway."""
import csv, json, sys, time
from pathlib import Path
import librosa, numpy as np

HERE = Path(__file__).parent
SR, HOP = 22050, 64
FPS = SR / HOP

def comb_scores(env, bpms, ks=(1, 2, 4, 8)):
    env = env - env.mean()
    ac = librosa.autocorrelate(env)
    ac = ac / (ac[0] + 1e-9)
    lags = np.arange(len(ac))
    out = np.zeros(len(bpms))
    for k in ks:
        lag = k * 60.0 * FPS / bpms
        ok = lag < len(ac) - 1
        out += np.where(ok, np.interp(lag, lags, ac), 0.0)
    return out / len(ks)

def refine(y, lo, hi, step=0.05):
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    bpms = np.arange(lo, hi + step, step)
    s = comb_scores(env, bpms)
    i = int(np.argmax(s))
    return round(float(bpms[i]), 2), round(float(s[i]), 3)

rows = list(csv.DictReader(open(HERE / "ground-truth.csv")))
files = sorted((HERE.parent.parent / ".mp3").glob("*.mp3"))
res = []
for row in rows:
    f = [x for x in files if row["title"].lower() in x.name.lower()][0]
    truth = float(row["bpm"])
    y, _ = librosa.load(f, sr=SR, mono=True)
    dur = len(y) / SR
    t0 = time.perf_counter()
    g = refine(y, 140, 230)
    tg = time.perf_counter() - t0
    l = refine(y, truth * 0.96, truth * 1.04)
    e = {"title": row["title"], "truth": truth, "fullGlobal": g, "fullLocal": l, "fullSec": round(tg, 2), "seg": []}
    for bars in (4, 16):
        n = bars * 4 * 60.0 / truth
        for pos in (0.25, 0.5, 0.75):
            seg = y[int(pos * dur * SR): int(pos * dur * SR) + int(n * SR)]
            t0 = time.perf_counter()
            sg = refine(seg, 140, 230)
            ts = time.perf_counter() - t0
            sl = refine(seg, truth * 0.96, truth * 1.04)
            e["seg"].append({"bars": bars, "global": sg, "local": sl, "sec": round(ts, 3)})
    res.append(e)
json.dump(res, open(HERE / "refine.json", "w"), indent=1)
for e in res:
    print(f"{e['title'][:25]:26} truth {e['truth']:.0f}  full global {e['fullGlobal']}  full local(±4%) {e['fullLocal']}  ({e['fullSec']}s)")
for bars in (4, 16):
    for key in ("global", "local"):
        errs = [(abs(s[key][0] - e["truth"]), e["title"][:10]) for e in res for s in e["seg"] if s["bars"] == bars]
        w1 = sum(1 for x, _ in errs if x <= 1.0); w05 = sum(1 for x, _ in errs if x <= 0.5)
        bad = [(t, round(x, 1)) for x, t in errs if x > 1.0]
        print(f"segments {bars} bars, {key:6}: within ±0.5 = {w05}/18, within ±1 = {w1}/18, misses: {bad}")
print("max seconds per segment:", max(s["sec"] for e in res for s in e["seg"]))
print("scores 4-bar local:", [(e["title"][:8], [s["local"][1] for s in e["seg"] if s["bars"] == 4]) for e in res])
