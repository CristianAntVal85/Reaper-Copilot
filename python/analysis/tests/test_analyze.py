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


@pytest.mark.parametrize("bpm", [120, 135, 150, 174, 200])
@pytest.mark.parametrize("use_target", [False, True])
def test_click_track_tempo_within_half_bpm(write_wav, bpm, use_target):
    path = write_wav(f"clicks{bpm}.wav", click_track(bpm))
    extra = ["--target-bpm", str(bpm + 3)] if use_target else []
    result = run("analyze", str(path), *extra)
    assert result.returncode == 0, result.stderr
    tempo = json.loads(result.stdout)["tempo"]
    assert abs(tempo["bpm"] - bpm) <= 0.5
    measured = tempo["bpm"]
    expected = {round(measured * ratio, 2) for ratio in (1 / 2, 2, 2 / 3, 3 / 2, 3 / 4, 4 / 3)}
    assert len(tempo["alternatives"]) == 6
    assert set(tempo["alternatives"]) == expected
    assert 0 <= tempo["confidence"] <= 1
    assert (tempo["target"] is None) == (not use_target)


def test_alternatives_are_ordered_from_most_to_least_likely():
    import librosa

    from analysis.tempo import HOP_LENGTH, SAMPLE_RATE, _comb_scores, estimate_tempo

    mono = click_track(135, sr=SAMPLE_RATE)
    tempo = estimate_tempo(mono)
    envelope = librosa.onset.onset_strength(y=mono, sr=SAMPLE_RATE, hop_length=HOP_LENGTH)
    scores = _comb_scores(envelope, np.array(tempo.alternatives, dtype=float))
    assert len(scores) == 6
    assert all(a >= b - 1e-9 for a, b in zip(scores, scores[1:]))


def test_without_target_a_ternary_confusion_is_listed(write_wav):
    # A tempo outside the default octave is reported in an octave of its own, and the true tempo
    # shows up among the alternatives.
    tempo = _tempo(write_wav, 90)
    assert abs(tempo["bpm"] - 180) <= 0.5
    assert any(abs(alt - 90) <= 0.5 for alt in tempo["alternatives"])


def _tempo(write_wav, bpm, *extra):
    path = write_wav(f"clicks{bpm}.wav", click_track(bpm))
    result = run("analyze", str(path), *extra)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)["tempo"]


def test_without_target_the_tempo_target_is_null(write_wav):
    assert _tempo(write_wav, 160)["target"] is None


def test_target_that_disagrees_does_not_drag_the_measurement(write_wav):
    tempo = _tempo(write_wav, 160, "--target-bpm", "190")
    assert abs(tempo["bpm"] - 160) <= 0.5
    target = tempo["target"]
    assert target["bpm"] == 190
    assert target["matches"] is False
    assert target["deviationBpm"] == pytest.approx(tempo["bpm"] - 190, abs=0.01)
    assert abs(target["deviationBpm"] + 30) <= 0.5


def test_target_that_agrees_matches(write_wav):
    tempo = _tempo(write_wav, 160, "--target-bpm", "160")
    assert abs(tempo["bpm"] - 160) <= 0.5
    assert tempo["target"]["matches"] is True
    assert abs(tempo["target"]["deviationBpm"]) <= 1


def test_target_picks_the_octave(write_wav):
    tempo = _tempo(write_wav, 160, "--target-bpm", "80")
    assert abs(tempo["bpm"] - 80) <= 0.25
    assert tempo["target"]["matches"] is True


def test_output_has_file_data_in_contract_format(write_wav):
    path = write_wav("stereo.wav", np.stack([click_track(170)] * 2, axis=1))
    output = json.loads(run("analyze", str(path)).stdout)
    assert output["schemaVersion"] == 2
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


def test_non_audio_error_message_has_no_path(tmp_path: Path):
    path = tmp_path / "text.wav"
    path.write_text("this is not audio")
    result = run("analyze", str(path))
    first_line = result.stderr.splitlines()[0]
    assert first_line == "unsupported_format: cannot decode as audio"
    assert str(tmp_path) not in first_line


def test_missing_file_error_message_has_no_path(tmp_path: Path):
    result = run("analyze", str(tmp_path / "nope.wav"))
    assert result.stderr.splitlines()[0] == "file_not_found: file does not exist"


def test_audio_shorter_than_half_second_exits_3(write_wav):
    path = write_wav("short.wav", click_track(170, seconds=0.4))
    result = run("analyze", str(path))
    assert result.returncode == 3
    assert result.stderr.startswith("unsupported_format:")


def test_invalid_target_bpm_exits_1_not_2(write_wav):
    path = write_wav("c.wav", click_track(170))
    result = run("analyze", str(path), "--target-bpm", "-5")
    assert result.returncode == 1
