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
