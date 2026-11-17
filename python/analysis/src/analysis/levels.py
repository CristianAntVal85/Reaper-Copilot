import warnings

import numpy as np
import pyloudnorm
from scipy import signal

from analysis.audio import LoadedAudio

FLOOR_DB = -120.0
# Hz, [low, high). Energy is relative to a full-scale sine (mean square 0.5).
BANDS = {
    "sub": (20, 60),
    "bass": (60, 250),
    "lowMid": (250, 500),
    "mid": (500, 2000),
    "highMid": (2000, 6000),
    "high": (6000, 20000),
}
_FULL_SCALE_POWER = 0.5
_MAX_LUFS_CHANNELS = 5


def _db(power: float) -> float:
    if not np.isfinite(power) or power <= 0:
        return FLOOR_DB
    return max(FLOOR_DB, 10.0 * np.log10(power))


def _amplitude_db(amplitude: float) -> float:
    return _db(amplitude * amplitude)


def peak_db(audio: LoadedAudio) -> float:
    return _amplitude_db(float(np.max(np.abs(audio.samples))))


def crest_factor_db(audio: LoadedAudio) -> float:
    rms = float(np.sqrt(np.mean(np.square(audio.samples.astype(np.float64)))))
    if rms == 0.0:
        return 0.0
    return max(0.0, peak_db(audio) - _amplitude_db(rms))


def integrated_lufs(audio: LoadedAudio) -> float:
    samples = audio.samples.astype(np.float64)
    if samples.shape[1] > _MAX_LUFS_CHANNELS:
        samples = samples.mean(axis=1, keepdims=True)
    meter = pyloudnorm.Meter(audio.sample_rate)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        value = float(meter.integrated_loudness(samples))
    if not np.isfinite(value):
        return FLOOR_DB
    return max(FLOOR_DB, value)


def welch_density(mono: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Power density of a mono signal: frequencies, density and the bin width."""
    nperseg = min(8192, len(mono))
    freqs, density = signal.welch(mono, fs=sample_rate, nperseg=nperseg, scaling="density")
    return freqs, density, float(freqs[1] - freqs[0])


def band_db(freqs: np.ndarray, density: np.ndarray, bin_width: float, low: float, high: float) -> float:
    """dB re a full-scale sine of the density integrated over [low, high).

    Integrating the density keeps the window leakage from inflating the power.
    """
    selected = density[(freqs >= low) & (freqs < high)]
    return _db(float(selected.sum() * bin_width) / _FULL_SCALE_POWER)


def band_energies_db(audio: LoadedAudio) -> dict[str, float]:
    mono = audio.samples.astype(np.float64).mean(axis=1)
    freqs, density, bin_width = welch_density(mono, audio.sample_rate)
    return {
        name: band_db(freqs, density, bin_width, low, high) for name, (low, high) in BANDS.items()
    }
