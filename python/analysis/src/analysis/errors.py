class AnalysisError(Exception):
    """Failure with a stable code and the process exit status that reports it.

    `message` is fixed per failure and safe to show a client: no paths, no library text.
    `detail` is for debugging only; the CLI writes it to stderr on a separate line.
    """

    def __init__(self, code: str, message: str, exit_code: int, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code
        self.detail = detail


def file_not_found(message: str, detail: str | None = None) -> AnalysisError:
    return AnalysisError("file_not_found", message, 2, detail)


def unsupported_format(message: str, detail: str | None = None) -> AnalysisError:
    return AnalysisError("unsupported_format", message, 3, detail)


def analysis_failed(message: str, detail: str | None = None) -> AnalysisError:
    return AnalysisError("analysis_failed", message, 1, detail)
