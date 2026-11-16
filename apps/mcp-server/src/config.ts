import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_MODES, type ToolMode } from "@reaper-copilot/tools";

export interface ServerConfig {
  readonly mode: ToolMode;
  readonly workspaceRoot: string;
  /** Interpreter for the Python analyzer; undefined means the adapter's default (repository venv). */
  readonly pythonPath: string | undefined;
  /** Local data (SQLite database). Never committed. */
  readonly dataDir: string;
}

/** `<repository>/workspace`, used when COPILOT_WORKSPACE is not set. */
export const DEFAULT_WORKSPACE = fileURLToPath(new URL("../../../workspace", import.meta.url));

/** `<repository>/.copilot`, used when COPILOT_DATA_DIR is not set. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../.copilot", import.meta.url));

/** Database file inside the data directory. */
export const databasePath = (dataDir: string): string => path.join(dataDir, "copilot.db");

/** Reads the environment. A missing MODE means `mentor` (expose less); an invalid one is an error. */
export function readConfig(env: Record<string, string | undefined>): ServerConfig {
  const rawMode = env["MODE"]?.trim() || "mentor";
  const mode = TOOL_MODES.find((candidate) => candidate === rawMode);
  if (mode === undefined) {
    throw new Error(`invalid MODE "${rawMode}": expected ${TOOL_MODES.join(" or ")}`);
  }
  return {
    mode,
    workspaceRoot: env["COPILOT_WORKSPACE"]?.trim() || DEFAULT_WORKSPACE,
    pythonPath: env["COPILOT_PYTHON"]?.trim() || undefined,
    dataDir: env["COPILOT_DATA_DIR"]?.trim() || DEFAULT_DATA_DIR,
  };
}
