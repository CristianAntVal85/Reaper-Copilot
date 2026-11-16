from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

SR = 44100


def click_track(bpm: float, seconds: float = 30.0, sr: int = SR) -> np.ndarray:
    samples = np.zeros(int(seconds * sr), dtype=np.float32)
    burst = (np.hanning(220) * np.sin(2 * np.pi * 1500 * np.arange(220) / sr)).astype(np.float32)
    period = 60.0 * sr / bpm
    position = 0.0
    while int(position) + len(burst) < len(samples):
        start = int(round(position))
        samples[start : start + len(burst)] += burst
        position += period
    return samples * 0.8


@pytest.fixture
def write_wav(tmp_path: Path):
    def _write(name: str, samples: np.ndarray, sr: int = SR) -> Path:
        path = tmp_path / name
        sf.write(path, samples, sr, subtype="PCM_16")
        return path

    return _write
