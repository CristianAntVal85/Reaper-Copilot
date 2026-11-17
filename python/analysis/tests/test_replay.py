import json
import subprocess
import sys

import numpy as np
import pytest
import soundfile as sf

from analysis import cli

SR = 44100


def sine(seconds=3.0, freq=1000.0, level_db=-12.0, sr=SR):
    t = np.arange(int(seconds * sr)) / sr
    return (10 ** (level_db / 20) * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def run_replay(inp, out):
    return subprocess.run(
        [sys.executable, "-m", "analysis", "replay-assets", "--out", str(out), "--", str(inp)],
        capture_output=True,
        text=True,
    )


def test_sine_gives_readable_mp3_waveform_and_spectrum(write_wav, tmp_path):
    wav = write_wav("sine.wav", sine())
    out = tmp_path / "out.mp3"
    result = run_replay(wav, out)
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)

    info = sf.info(out)
    assert info.samplerate == SR and info.channels == 2
    assert abs(info.duration - 3.0) < 0.05
    assert abs(data["durationSec"] - 3.0) < 0.001
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []

    freqs, db = np.array(data["spectrum"]["freqHz"]), np.array(data["spectrum"]["db"])
    assert len(freqs) == len(db) == 96
    assert np.all(np.diff(freqs) > 0) and freqs[0] >= 20 and freqs[-1] <= 20000
    peak = int(np.argmax(db))
    edges = 20 * 1000 ** (np.arange(97) / 96)
    assert edges[peak] <= 1000 < edges[peak + 1]
    assert abs(db[peak] - (-12)) <= 3
    assert db.min() >= -120

    wave = data["waveform"]
    assert len(wave["min"]) == len(wave["max"]) == 800
    assert abs(max(wave["max"]) - 0.25) <= 0.05
    assert abs(min(wave["min"]) + 0.25) <= 0.05


def test_mono_and_other_sample_rate_are_converted(write_wav, tmp_path):
    wav = write_wav("mono.wav", sine(sr=22050), sr=22050)
    out = tmp_path / "out.mp3"
    result = run_replay(wav, out)
    assert result.returncode == 0, result.stderr
    info = sf.info(out)
    assert info.samplerate == SR and info.channels == 2
    assert abs(info.duration - 3.0) < 0.05


def test_existing_output_is_an_argument_error_and_is_kept(write_wav, tmp_path):
    out = tmp_path / "out.mp3"
    out.write_bytes(b"keep")
    result = run_replay(write_wav("a.wav", sine()), out)
    assert result.returncode == 1
    assert out.read_bytes() == b"keep"


def test_missing_input_exits_2_and_leaves_no_output(tmp_path):
    out = tmp_path / "out.mp3"
    assert run_replay(tmp_path / "nope.wav", out).returncode == 2
    assert not out.exists()


def test_not_audio_exits_3(tmp_path):
    bad = tmp_path / "bad.wav"
    bad.write_text("not audio")
    assert run_replay(bad, tmp_path / "out.mp3").returncode == 3


def test_missing_out_option_is_an_argument_error(tmp_path):
    with pytest.raises(SystemExit) as raised:
        cli.main(["replay-assets", str(tmp_path / "a.wav")])
    assert raised.value.code == 1
