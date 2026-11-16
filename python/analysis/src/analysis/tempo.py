import math
from dataclasses import dataclass

import librosa
import numpy as np

SAMPLE_RATE = 22050
HOP_LENGTH = 64
FRAMES_PER_SEC = SAMPLE_RATE / HOP_LENGTH
STEP_BPM = 0.05
BEAT_MULTIPLES = (1, 2, 4, 8)
DEFAULT_RANGE = (140.0, 230.0)
MATCH_TOLERANCE_BPM = 1.0


@dataclass(frozen=True)
class TempoTarget:
    bpm: float
    deviation_bpm: float
    matches: bool


@dataclass(frozen=True)
class Tempo:
    bpm: float
    confidence: float
    alternatives: list[float]
    target: TempoTarget | None = None


def _comb_scores(envelope: np.ndarray, bpms: np.ndarray) -> np.ndarray:
    centered = envelope - envelope.mean()
    autocorr = librosa.autocorrelate(centered)
    autocorr = autocorr / (autocorr[0] + 1e-9)
    lags = np.arange(len(autocorr))
    scores = np.zeros(len(bpms))
    for multiple in BEAT_MULTIPLES:
        lag = multiple * 60.0 * FRAMES_PER_SEC / bpms
        in_range = lag < len(autocorr) - 1
        scores += np.where(in_range, np.interp(lag, lags, autocorr), 0.0)
    return scores / len(BEAT_MULTIPLES)


def estimate_tempo(mono_22050: np.ndarray, target_bpm: float | None = None) -> Tempo:
    if target_bpm is None:
        low, high = DEFAULT_RANGE
    else:
        # The target only picks the octave: the search is one octave wide, centered on it,
        # so the measurement is not pulled towards the target.
        low = target_bpm / math.sqrt(2)
        high = target_bpm * math.sqrt(2)
    envelope = librosa.onset.onset_strength(
        y=mono_22050, sr=SAMPLE_RATE, hop_length=HOP_LENGTH
    )
    bpms = np.arange(low, high + STEP_BPM, STEP_BPM)
    scores = _comb_scores(envelope, bpms)
    best = int(np.argmax(scores))
    bpm = round(float(bpms[best]), 2)
    confidence = float(np.clip(np.nan_to_num(scores[best]), 0.0, 1.0))
    target = None
    if target_bpm is not None:
        deviation = round(bpm - target_bpm, 2)
        target = TempoTarget(target_bpm, deviation, abs(deviation) <= MATCH_TOLERANCE_BPM)
    return Tempo(bpm, round(confidence, 3), [round(bpm / 2, 2), round(bpm * 2, 2)], target)
