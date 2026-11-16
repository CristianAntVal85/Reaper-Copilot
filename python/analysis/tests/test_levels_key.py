import json
import math
import subprocess
import sys

import numpy as np
import pytest

from conftest import SR


def run_json(path):
    result = subprocess.run(
        [sys.executable, "-m", "analysis", "analyze", str(path)], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def sine(freq, dbfs, seconds=5.0):
    t = np.arange(int(seconds * SR)) / SR
    return (10 ** (dbfs / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def chord(midi_notes, seconds=2.0):
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for note in midi_notes:
        freq = 440.0 * 2 ** ((note - 69) / 12)
        for harmonic, gain in ((1, 1.0), (2, 0.5), (3, 0.33), (4, 0.25)):
            out += gain * np.sin(2 * np.pi * freq * harmonic * t)
    out *= np.minimum(1, np.minimum(t, seconds - t) * 20)  # fade in and out
    return out / len(midi_notes)


def test_sine_peak_crest_and_bands(write_wav):
    output = run_json(write_wav("sine.wav", sine(1000, -12)))
    assert output["loudness"]["peakDb"] == pytest.approx(-12, abs=0.1)
    assert output["dynamics"]["crestFactorDb"] == pytest.approx(3.0, abs=0.1)
    bands = output["bands"]
    assert max(bands, key=bands.get) == "mid"
    assert bands["mid"] == pytest.approx(-12, abs=0.5)


def test_six_db_quieter_lowers_lufs_six_db(write_wav):
    loud = run_json(write_wav("loud.wav", sine(1000, -12)))
    quiet = run_json(write_wav("quiet.wav", sine(1000, -18)))
    drop = loud["loudness"]["integratedLufs"] - quiet["loudness"]["integratedLufs"]
    assert drop == pytest.approx(6, abs=0.1)


def test_stereo_input_is_supported(write_wav):
    stereo = np.stack([sine(1000, -12), sine(1000, -12)], axis=1)
    output = run_json(write_wav("stereo.wav", stereo))
    assert output["file"]["channels"] == 2
    assert output["loudness"]["peakDb"] == pytest.approx(-12, abs=0.1)


def test_a_minor_progression_gives_a_minor(write_wav):
    # Am, Dm, E, Am (MIDI notes)
    progression = [[57, 60, 64], [50, 57, 62, 65], [52, 56, 59], [57, 60, 64]]
    audio = np.concatenate([chord(c) for c in progression]).astype(np.float32) * 0.5
    key = run_json(write_wav("aminor.wav", audio))["key"]
    assert (key["tonic"], key["mode"]) == ("A", "minor")
    assert 0 < key["confidence"] <= 1


def test_silence_gives_finite_values(write_wav):
    output = run_json(write_wav("silence.wav", np.zeros(SR * 2, dtype=np.float32)))
    assert output["loudness"] == {"integratedLufs": -120.0, "peakDb": -120.0}
    assert set(output["bands"].values()) == {-120.0}
    assert output["key"]["confidence"] == 0.0


def _numbers(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _numbers(item)
    elif isinstance(value, list):
        for item in value:
            yield from _numbers(item)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


def test_output_has_exactly_the_contract_keys_and_finite_numbers(write_wav):
    output = run_json(write_wav("sine.wav", sine(440, -6)))
    assert {k: set(v) if isinstance(v, dict) else None for k, v in output.items()} == {
        "schemaVersion": None,
        "file": {"sha256", "durationSec", "sampleRate", "channels"},
        "tempo": {"bpm", "confidence", "alternatives", "target"},
        "key": {"tonic", "mode", "confidence"},
        "loudness": {"integratedLufs", "peakDb"},
        "bands": {"sub", "bass", "lowMid", "mid", "highMid", "high"},
        "dynamics": {"crestFactorDb"},
    }
    assert all(math.isfinite(n) for n in _numbers(output))
