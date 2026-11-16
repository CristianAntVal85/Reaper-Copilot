export const COPILOT_ERROR_CODES = [
  "path_outside_workspace",
  "file_not_found",
  "unsupported_format",
  "analysis_failed",
  "analysis_timeout",
  "invalid_analysis_output",
] as const;

export type CopilotErrorCode = (typeof COPILOT_ERROR_CODES)[number];

export class CopilotError extends Error {
  readonly code: CopilotErrorCode;

  constructor(code: CopilotErrorCode, message: string, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = "CopilotError";
    this.code = code;
  }
}
