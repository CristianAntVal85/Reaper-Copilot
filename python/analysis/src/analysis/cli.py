import argparse
import json
import math
import sys
from pathlib import Path

from analysis import __version__
from analysis.audio import load, to_mono
from analysis.errors import AnalysisError, analysis_failed
from analysis.key import estimate_key
from analysis.replay import replay_assets
from analysis.levels import band_energies_db, crest_factor_db, integrated_lufs, peak_db
from analysis.tempo import SAMPLE_RATE, estimate_tempo

SCHEMA_VERSION = 2


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):  # argparse exits with 2, which means "file not found" here
        self.print_usage(sys.stderr)
        sys.stderr.write(f"analysis_failed: invalid arguments\ndetail: {message}\n")
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
    replay = commands.add_parser("replay-assets", help="write an mp3 and print waveform and spectrum JSON")
    replay.add_argument("--out", type=Path, required=True)
    replay.add_argument("path", type=Path)
    return parser


def analyze(path: Path, target_bpm: float | None) -> dict:
    audio = load(path)
    tempo = estimate_tempo(to_mono(audio, SAMPLE_RATE), target_bpm)
    key = estimate_key(audio)
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
            "target": None
            if tempo.target is None
            else {
                "bpm": tempo.target.bpm,
                "deviationBpm": tempo.target.deviation_bpm,
                "matches": tempo.target.matches,
            },
        },
        "key": {
            "tonic": key.tonic,
            "mode": key.mode,
            "confidence": round(key.confidence, 3),
        },
        "loudness": {
            "integratedLufs": round(integrated_lufs(audio), 2),
            "peakDb": round(peak_db(audio), 2),
        },
        "bands": {name: round(value, 2) for name, value in band_energies_db(audio).items()},
        "dynamics": {"crestFactorDb": round(crest_factor_db(audio), 2)},
    }


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        try:
            if args.command == "replay-assets":
                result = replay_assets(args.path, args.out)
            else:
                result = analyze(args.path, args.target_bpm)
        except AnalysisError:
            raise
        except Exception as error:
            raise analysis_failed("unexpected error", f"{type(error).__name__}: {error}") from error
    except AnalysisError as error:
        sys.stderr.write(f"{error.code}: {error}\n")
        if error.detail:  # debugging aid for a person at the terminal; callers must not forward it
            sys.stderr.write(f"detail: {error.detail}\n")
        return error.exit_code
    sys.stdout.write(json.dumps(result, allow_nan=False) + "\n")
    return 0
