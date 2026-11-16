import subprocess
import sys

from analysis import __version__


def test_version_flag_prints_package_version():
    result = subprocess.run(
        [sys.executable, "-m", "analysis", "--version"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == __version__


def test_unexpected_failure_message_is_fixed_and_detail_goes_on_its_own_line(
    monkeypatch, capsys, tmp_path
):
    from analysis import cli

    def boom(path, target_bpm):
        raise RuntimeError(f"internal failure at {tmp_path}/secret")

    monkeypatch.setattr(cli, "analyze", boom)
    assert cli.main(["analyze", str(tmp_path / "x.wav")]) == 1
    lines = capsys.readouterr().err.splitlines()
    assert lines[0] == "analysis_failed: unexpected error"
    assert str(tmp_path) not in lines[0]
    assert lines[1].startswith("detail: RuntimeError:")
