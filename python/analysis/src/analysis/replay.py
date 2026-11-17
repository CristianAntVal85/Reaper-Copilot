import os
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from analysis.audio import load
from analysis.errors import analysis_failed
from analysis.levels import FLOOR_DB, band_db, welch_density

MP3_SAMPLE_RATE = 44100
# libsndfile maps this CBR level to about 128 kbps (0.6 gives 160, 0.7 gives 112).
MP3_COMPRESSION_LEVEL = 0.65
WAVEFORM_POINTS = 800
SPECTRUM_POINTS = 96
SPECTRUM_MIN_HZ = 20.0
SPECTRUM_MAX_HZ = 20000.0


def _resampled_stereo(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    if samples.shape[1] == 1:
        samples = np.repeat(samples, 2, axis=1)
    elif samples.shape[1] > 2:
        samples = samples[:, :2]  # keep the front pair; the player only needs a stereo preview
    if sample_rate != MP3_SAMPLE_RATE:
        channels = [
            librosa.resample(samples[:, c], orig_sr=sample_rate, target_sr=MP3_SAMPLE_RATE)
            for c in range(2)
        ]
        samples = np.stack(channels, axis=1)
    return np.clip(samples, -1.0, 1.0).astype(np.float32)


def _write_mp3(stereo: np.ndarray, out: Path) -> None:
    temp = out.with_name(f".{out.name}.{os.getpid()}.tmp")
    try:
        sf.write(
            temp,
            stereo,
            MP3_SAMPLE_RATE,
            format="MP3",
            subtype="MPEG_LAYER_III",
            bitrate_mode="CONSTANT",
            compression_level=MP3_COMPRESSION_LEVEL,
        )
        if out.exists():
            raise analysis_failed("invalid arguments", "output exists")
        os.replace(temp, out)
    except (sf.LibsndfileError, RuntimeError, OSError) as error:
        raise analysis_failed("cannot write the mp3", f"{type(error).__name__}: {error}") from error
    finally:
        temp.unlink(missing_ok=True)


def _waveform(mono: np.ndarray) -> dict:
    edges = np.linspace(0, len(mono), WAVEFORM_POINTS + 1).astype(int)
    starts = edges[:-1]
    lows = np.minimum.reduceat(mono, starts)
    highs = np.maximum.reduceat(mono, starts)
    return {
        "min": [round(float(v), 3) + 0.0 for v in np.clip(lows, -1.0, 1.0)],
        "max": [round(float(v), 3) + 0.0 for v in np.clip(highs, -1.0, 1.0)],
    }


def _spectrum(mono: np.ndarray) -> dict:
    edges = SPECTRUM_MIN_HZ * (SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ) ** (
        np.arange(SPECTRUM_POINTS + 1) / SPECTRUM_POINTS
    )
    freqs, density, bin_width = welch_density(mono, MP3_SAMPLE_RATE)
    db = []
    for low, high in zip(edges[:-1], edges[1:]):
        if not np.any((freqs >= low) & (freqs < high)):
            # Band narrower than one bin: use the density at its centre over the band width.
            center = float(np.sqrt(low * high))
            interpolated = float(np.interp(center, freqs, density))
            value = band_db(np.array([center]), np.array([interpolated]), high - low, low, high)
        else:
            value = band_db(freqs, density, bin_width, low, high)
        db.append(round(max(FLOOR_DB, value), 1))
    centers = np.sqrt(edges[:-1] * edges[1:])
    return {"freqHz": [round(float(c), 2) for c in centers], "db": db}


def replay_assets(input_path: Path, out: Path) -> dict:
    if out.exists():
        raise analysis_failed("invalid arguments", "output exists")
    if not out.parent.is_dir():
        raise analysis_failed("invalid arguments", "output folder does not exist")
    audio = load(input_path)
    stereo = _resampled_stereo(audio.samples, audio.sample_rate)
    mono = stereo.astype(np.float64).mean(axis=1)
    result = {
        "durationSec": audio.duration_sec,
        "waveform": _waveform(mono),
        "spectrum": _spectrum(mono),
    }
    _write_mp3(stereo, out)
    return result
