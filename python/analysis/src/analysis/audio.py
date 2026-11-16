import hashlib
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

from analysis.errors import file_not_found, unsupported_format

MIN_DURATION_SEC = 0.5


@dataclass(frozen=True)
class LoadedAudio:
    sha256: str
    duration_sec: float
    sample_rate: int
    channels: int
    samples: np.ndarray  # float32, shape (frames, channels), original sample rate


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path) -> LoadedAudio:
    if not path.exists():
        raise file_not_found("file does not exist")
    if not path.is_file():
        raise file_not_found("not a regular file")
    try:
        sha256 = sha256_of(path)
    except OSError as error:
        raise file_not_found("cannot read file", error.strerror) from error
    try:
        samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    except (sf.LibsndfileError, RuntimeError) as error:
        raise unsupported_format("cannot decode as audio", str(error)) from error
    frames, channels = samples.shape
    duration = frames / sample_rate
    if duration < MIN_DURATION_SEC:
        raise unsupported_format(
            f"audio is shorter than {MIN_DURATION_SEC} s", f"{duration:.3f} s"
        )
    return LoadedAudio(sha256, duration, int(sample_rate), int(channels), samples)


def to_mono(audio: LoadedAudio, target_sr: int) -> np.ndarray:
    mono = audio.samples.mean(axis=1)
    if audio.sample_rate == target_sr:
        return mono
    return librosa.resample(mono, orig_sr=audio.sample_rate, target_sr=target_sr)
