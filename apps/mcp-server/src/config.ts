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
  /** Directory shared with the Reaper bridge. */
  readonly reaperIpcDir: string;
  /** How paths are translated for Reaper: `unc` (Reaper on Windows, server in WSL) or `identity`. */
  readonly reaperPathStyle: "unc" | "identity";
  /** Directory with the FX preset files. */
  readonly presetsDir: string;
}

/** `<repository>/workspace`, used when COPILOT_WORKSPACE is not set. */
export const DEFAULT_WORKSPACE = fileURLToPath(new URL("../../../workspace", import.meta.url));

/** `<repository>/.copilot`, used when COPILOT_DATA_DIR is not set. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL("../../../.copilot", import.meta.url));

/** `<repository>/.copilot/reaper-ipc`, used when COPILOT_REAPER_IPC is not set. */
export const DEFAULT_REAPER_IPC_DIR = path.join(DEFAULT_DATA_DIR, "reaper-ipc");

/** `<repository>/reaper/presets`, used when COPILOT_PRESETS is not set. */
export const DEFAULT_PRESETS_DIR = fileURLToPath(new URL("../../../reaper/presets", import.meta.url));

const PATH_STYLES = ["unc", "identity"] as const;

/** Database file inside the data directory. */
export const databasePath = (dataDir: string): string => path.join(dataDir, "copilot.db");

/** Reads the environment. A missing MODE means `mentor` (expose less); an invalid one is an error. */
export function readConfig(env: Record<string, string | undefined>): ServerConfig {
  const rawMode = env["MODE"]?.trim() || "mentor";
  const mode = TOOL_MODES.find((candidate) => candidate === rawMode);
  if (mode === undefined) {
    throw new Error(`invalid MODE "${rawMode}": expected ${TOOL_MODES.join(" or ")}`);
  }
  const rawStyle = env["COPILOT_REAPER_PATH_STYLE"]?.trim() || (env["WSL_DISTRO_NAME"] ? "unc" : "identity");
  const reaperPathStyle = PATH_STYLES.find((candidate) => candidate === rawStyle);
  if (reaperPathStyle === undefined) {
    throw new Error(`invalid COPILOT_REAPER_PATH_STYLE "${rawStyle}": expected ${PATH_STYLES.join(" or ")}`);
  }
  return {
    mode,
    workspaceRoot: env["COPILOT_WORKSPACE"]?.trim() || DEFAULT_WORKSPACE,
    pythonPath: env["COPILOT_PYTHON"]?.trim() || undefined,
    dataDir: env["COPILOT_DATA_DIR"]?.trim() || DEFAULT_DATA_DIR,
    reaperIpcDir: env["COPILOT_REAPER_IPC"]?.trim() || DEFAULT_REAPER_IPC_DIR,
    reaperPathStyle,
    presetsDir: env["COPILOT_PRESETS"]?.trim() || DEFAULT_PRESETS_DIR,
  };
}
