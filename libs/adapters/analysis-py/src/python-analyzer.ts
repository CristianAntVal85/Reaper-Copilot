import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AudioFeaturesSchema,
  CopilotError,
  type AnalyzeOptions,
  type AnalyzerPort,
  type AssetPath,
  type AudioFeatures,
} from "@reaper-copilot/core";

export interface PythonAnalyzerOptions {
  /** Python interpreter that can `import analysis`. Defaults to the repository venv. */
  pythonPath?: string;
  /** Wall-clock limit per analysis. librosa takes seconds just to import. */
  timeoutMs?: number;
  /** Cap on the bytes accepted from stdout; the process is killed beyond it. */
  maxOutputBytes?: number;
}

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
const STDERR_CAP_BYTES = 8_192;
const DETAIL_CAP_CHARS = 500;

/** Variables the child may inherit. Everything else (API keys, tokens) stays out. */
const ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "NUMBA_CACHE_DIR",
  "VIRTUAL_ENV",
]);

export function childEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && (ENV_ALLOWLIST.has(name) || name.startsWith("LC_"))) env[name] = value;
  }
  env["PYTHONIOENCODING"] = "utf-8";
  return env;
}

// Client-facing text per exit code. Never built from stderr: that can hold paths and library text.
const EXIT_MESSAGES = {
  file_not_found: "the file does not exist or cannot be read",
  unsupported_format: "the file is not decodable audio or is shorter than 0.5 s",
  analysis_failed: "the analysis failed unexpectedly",
} as const;

export const DEFAULT_PYTHON_PATH = fileURLToPath(
  new URL("../../../../python/analysis/.venv/bin/python", import.meta.url),
);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class PythonAnalyzer implements AnalyzerPort {
  readonly #pythonPath: string;
  readonly #timeoutMs: number;
  readonly #maxOutputBytes: number;

  constructor(options: PythonAnalyzerOptions = {}) {
    this.#pythonPath = options.pythonPath ?? DEFAULT_PYTHON_PATH;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be a positive finite number");
    }
    if (!Number.isInteger(this.#maxOutputBytes) || this.#maxOutputBytes <= 0) {
      throw new RangeError("maxOutputBytes must be a positive integer");
    }
  }

  async analyze(path: AssetPath, options: AnalyzeOptions = {}): Promise<AudioFeatures> {
    const args = ["-m", "analysis", "analyze"];
    if (options.targetBpm !== undefined) {
      if (!Number.isFinite(options.targetBpm) || options.targetBpm <= 0) {
        throw new CopilotError("analysis_failed", "targetBpm must be a positive finite number");
      }
      args.push("--target-bpm", String(options.targetBpm));
    }
    // "--" keeps a path that starts with "-" from being read as an option.
    args.push("--", path);

    const result = await this.#run(args);
    if (result.code !== 0) throw this.#exitError(result);

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (cause) {
      throw new CopilotError("invalid_analysis_output", "analyzer output is not valid JSON", {
        cause,
      });
    }
    const checked = AudioFeaturesSchema.safeParse(parsed);
    if (!checked.success) {
      const issues = checked.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new CopilotError(
        "invalid_analysis_output",
        `analyzer output does not match the contract (${issues})`,
        { cause: checked.error },
      );
    }
    return checked.data;
  }

  #exitError(result: RunResult): CopilotError {
    const code = result.code === 2 ? "file_not_found" : result.code === 3 ? "unsupported_format" : "analysis_failed";
    const exit = result.code === null ? "a signal" : `code ${result.code}`;
    const detail = result.stderr.trim().slice(0, DETAIL_CAP_CHARS);
    // The stderr goes in `cause`, which only reaches the server log, never the client.
    return new CopilotError(code, EXIT_MESSAGES[code], {
      cause: new Error(`analyzer exited with ${exit}: ${detail}`),
    });
  }

  #run(args: string[]): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      // No shell: the arguments reach Python verbatim, whatever the file name contains.
      const child = spawn(this.#pythonPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv(),
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };
      const kill = () => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.kill("SIGKILL");
      };

      const timer = setTimeout(() => {
        finish(() => {
          kill();
          reject(new CopilotError("analysis_timeout", `analysis exceeded ${this.#timeoutMs} ms`));
        });
      }, this.#timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.#maxOutputBytes) {
          finish(() => {
            kill();
            reject(
              new CopilotError(
                "analysis_failed",
                `analyzer output exceeds ${this.#maxOutputBytes} bytes`,
              ),
            );
          });
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderrBytes >= STDERR_CAP_BYTES) return; // diagnostics only: truncate, do not fail
        stderr.push(chunk.subarray(0, STDERR_CAP_BYTES - stderrBytes));
        stderrBytes += chunk.length;
      });
      child.on("error", (cause) => {
        finish(() =>
          reject(
            new CopilotError("analysis_failed", "cannot start the analyzer", { cause }),
          ),
        );
      });
      child.on("close", (code) => {
        finish(() =>
          resolve({
            code,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          }),
        );
      });
    });
  }
}
