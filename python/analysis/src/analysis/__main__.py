import argparse

from analysis import __version__


def main() -> None:
    parser = argparse.ArgumentParser(prog="analysis")
    parser.add_argument("--version", action="version", version=__version__)
    parser.parse_args()


main()
