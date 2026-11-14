"""Spike: librosa tempo detection on 160-210 BPM tracks. Throwaway code.

Usage: .venv/bin/python bpm_test.py > results.json
"""
import csv
import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import scipy.stats

HERE = Path(__file__).parent
MP3_DIR = HERE.parent.parent / ".mp3"
SR = 22050


def classify(est: float, truth: float) -> str:
    for label, factor in (("ok", 1.0), ("half", 0.5), ("double", 2.0), ("2/3", 2 / 3), ("3/2", 1.5), ("3/4", 0.75), ("4/3", 4 / 3)):
        if abs(est - truth * factor) <= max(1.0, 0.02 * truth * factor):
            return label
    return "wrong"


def estimate(y: np.ndarray, truth: float) -> dict:
    out = {}
    for hop in (512, 128):
        t0 = time.perf_counter()
        env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop)
        variants = {
            "default": dict(start_bpm=120.0),
            "hint": dict(start_bpm=truth),
            "genre_prior": dict(prior=scipy.stats.uniform(140, 90)),
        }
        for name, kwargs in variants.items():
            bpm = float(librosa.feature.tempo(onset_envelope=env, sr=SR, hop_length=hop, max_tempo=320.0, **kwargs)[0])
            out[f"{name}@{hop}"] = {"bpm": round(bpm, 2), "class": classify(bpm, truth), "errBpm": round(bpm - truth, 2)}
        # beat tracking with the hint, tempo from the median inter-beat interval
        _, beats = librosa.beat.beat_track(onset_envelope=env, sr=SR, hop_length=hop, start_bpm=truth, units="time")
        if len(beats) > 2:
            bpm = float(60.0 / np.median(np.diff(beats)))
            out[f"beats_hint@{hop}"] = {
                "bpm": round(bpm, 2), "class": classify(bpm, truth), "errBpm": round(bpm - truth, 2),
                "firstBeatSec": round(float(beats[0]), 3), "beats": int(len(beats)),
            }
        out[f"seconds@{hop}"] = round(time.perf_counter() - t0, 2)
    return out


def main() -> None:
    truth = list(csv.DictReader(open(HERE / "ground-truth.csv")))
    files = sorted(MP3_DIR.glob("*.mp3"))
    results = []
    for row in truth:
        match = [f for f in files if row["title"].lower() in f.name.lower()]
        if not match:
            print(f"missing file for {row['title']}", file=sys.stderr)
            continue
        bpm = float(row["bpm"])
        t0 = time.perf_counter()
        y, _ = librosa.load(match[0], sr=SR, mono=True)
        load_sec = round(time.perf_counter() - t0, 2)
        dur = len(y) / SR
        print(f"{row['title']}: {dur:.0f}s loaded in {load_sec}s", file=sys.stderr)
        entry = {"title": row["title"], "truthBpm": bpm, "durationSec": round(dur, 1), "loadSec": load_sec,
                 "full": estimate(y, bpm), "segments": []}
        for bars in (4, 16):
            seg_len = bars * 4 * 60.0 / bpm
            for pos in (0.25, 0.5, 0.75):
                start = int(pos * dur * SR)
                seg = y[start:start + int(seg_len * SR)]
                entry["segments"].append({"bars": bars, "startSec": round(pos * dur, 1), "lenSec": round(seg_len, 2),
                                          "est": estimate(seg, bpm)})
        results.append(entry)
    json.dump(results, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
