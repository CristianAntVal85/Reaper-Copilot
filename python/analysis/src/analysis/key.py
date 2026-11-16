from dataclasses import dataclass

import librosa
import numpy as np

from analysis.audio import LoadedAudio, to_mono

SAMPLE_RATE = 22050
TONICS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

# Krumhansl-Kessler probe-tone profiles, tonic first.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass(frozen=True)
class KeyEstimate:
    tonic: str
    mode: str
    confidence: float


def estimate_key(audio: LoadedAudio) -> KeyEstimate:
    mono = to_mono(audio, SAMPLE_RATE)
    chroma = librosa.feature.chroma_cqt(y=mono, sr=SAMPLE_RATE).mean(axis=1)
    if not np.all(np.isfinite(chroma)) or np.std(chroma) < 1e-9:
        return KeyEstimate("C", "major", 0.0)
    best = (-2.0, 0, "major")
    for mode, profile in (("major", _MAJOR), ("minor", _MINOR)):
        for tonic in range(12):
            score = float(np.corrcoef(chroma, np.roll(profile, tonic))[0, 1])
            if score > best[0]:
                best = (score, tonic, mode)
    score, tonic, mode = best
    return KeyEstimate(TONICS[tonic], mode, float(np.clip(score, 0.0, 1.0)))
