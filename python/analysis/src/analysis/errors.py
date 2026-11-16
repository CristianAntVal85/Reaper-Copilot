class AnalysisError(Exception):
    """Failure with a stable code and the process exit status that reports it."""

    def __init__(self, code: str, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code


def file_not_found(message: str) -> AnalysisError:
    return AnalysisError("file_not_found", message, 2)


def unsupported_format(message: str) -> AnalysisError:
    return AnalysisError("unsupported_format", message, 3)


def analysis_failed(message: str) -> AnalysisError:
    return AnalysisError("analysis_failed", message, 1)
