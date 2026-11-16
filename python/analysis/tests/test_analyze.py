import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from conftest import SR, click_track


def run(*args: str):
    return subprocess.run(
        [sys.executable, "-m", "analysis", *args], capture_output=True, text=True
    )


@pytest.mark.parametrize("bpm", [150, 174, 200])
@pytest.mark.parametrize("use_target", [False, True])
def test_click_track_tempo_within_half_bpm(write_wav, bpm, use_target):
    path = write_wav(f"clicks{bpm}.wav", click_track(bpm))
    extra = ["--target-bpm", str(bpm + 3)] if use_target else []
    result = run("analyze", str(path), *extra)
    assert result.returncode == 0, result.stderr
    tempo = json.loads(result.stdout)["tempo"]
    assert abs(tempo["bpm"] - bpm) <= 0.5
    assert tempo["alternatives"] == [round(tempo["bpm"] / 2, 2), round(tempo["bpm"] * 2, 2)]
    assert 0 <= tempo["confidence"] <= 1


def test_output_has_file_data_in_contract_format(write_wav):
    path = write_wav("stereo.wav", np.stack([click_track(170)] * 2, axis=1))
    output = json.loads(run("analyze", str(path)).stdout)
    assert output["schemaVersion"] == 1
    file = output["file"]
    assert len(file["sha256"]) == 64 and file["sha256"] == file["sha256"].lower()
    assert file["sampleRate"] == SR and file["channels"] == 2
    assert file["durationSec"] == pytest.approx(30.0)


def test_white_noise_has_low_confidence(write_wav):
    noise = np.random.default_rng(0).uniform(-0.5, 0.5, 30 * SR).astype(np.float32)
    output = json.loads(run("analyze", str(write_wav("noise.wav", noise))).stdout)
    assert output["tempo"]["confidence"] < 0.10


def test_missing_file_exits_2(tmp_path: Path):
    result = run("analyze", str(tmp_path / "nope.wav"))
    assert result.returncode == 2
    assert result.stderr.startswith("file_not_found:")


def test_non_audio_file_exits_3(tmp_path: Path):
    path = tmp_path / "text.wav"
    path.write_text("this is not audio")
    result = run("analyze", str(path))
    assert result.returncode == 3
    assert result.stderr.startswith("unsupported_format:")


def test_audio_shorter_than_half_second_exits_3(write_wav):
    path = write_wav("short.wav", click_track(170, seconds=0.4))
    result = run("analyze", str(path))
    assert result.returncode == 3
    assert result.stderr.startswith("unsupported_format:")


def test_invalid_target_bpm_exits_1_not_2(write_wav):
    path = write_wav("c.wav", click_track(170))
    result = run("analyze", str(path), "--target-bpm", "-5")
    assert result.returncode == 1
