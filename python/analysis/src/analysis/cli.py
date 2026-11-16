import argparse
import json
import math
import sys
from pathlib import Path

from analysis import __version__
from analysis.audio import load, to_mono
from analysis.errors import AnalysisError, analysis_failed
from analysis.tempo import SAMPLE_RATE, estimate_tempo

SCHEMA_VERSION = 1


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # argparse exits with 2, which means "file not found" here
        self.print_usage(sys.stderr)
        sys.stderr.write(f"analysis_failed: {message}\n")
        raise SystemExit(1)


def _positive_finite(text: str) -> float:
    value = float(text)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("must be a positive finite number")
    return value


def _build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="analysis")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="analyze an audio file and print JSON")
    analyze.add_argument("path", type=Path)
    analyze.add_argument("--target-bpm", type=_positive_finite, default=None)
    return parser


def analyze(path: Path, target_bpm: float | None) -> dict:
    audio = load(path)
    tempo = estimate_tempo(to_mono(audio, SAMPLE_RATE), target_bpm)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "file": {
            "sha256": audio.sha256,
            "durationSec": audio.duration_sec,
            "sampleRate": audio.sample_rate,
            "channels": audio.channels,
        },
        "tempo": {
            "bpm": tempo.bpm,
            "confidence": tempo.confidence,
            "alternatives": tempo.alternatives,
        },
    }


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        try:
            result = analyze(args.path, args.target_bpm)
        except AnalysisError:
            raise
        except Exception as error:
            raise analysis_failed(f"{type(error).__name__}: {error}") from error
    except AnalysisError as error:
        sys.stderr.write(f"{error.code}: {error}\n")
        return error.exit_code
    sys.stdout.write(json.dumps(result, allow_nan=False) + "\n")
    return 0
