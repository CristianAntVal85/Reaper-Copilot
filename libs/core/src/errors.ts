export const COPILOT_ERROR_CODES = [
  "path_outside_workspace",
  "file_not_found",
  "unsupported_format",
  "analysis_failed",
  "analysis_timeout",
  "invalid_analysis_output",
  "daw_unavailable",
  "daw_timeout",
  "daw_busy",
  "daw_error",
  "invalid_daw_output",
  "item_not_found",
  "track_not_found",
  "preset_not_found",
  "job_not_found",
  "out_of_range",
  "nothing_to_undo",
  "render_failed",
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
