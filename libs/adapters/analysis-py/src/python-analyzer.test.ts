import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAssetPath,
  CopilotError,
  type AudioFeatures,
  type ReplayAssets,
} from "@reaper-copilot/core";
import { childEnv, PythonAnalyzer } from "./python-analyzer.ts";

const VALID: AudioFeatures = {
  schemaVersion: 2,
  file: {
    sha256: "a".repeat(64),
    durationSec: 12.4,
    sampleRate: 44100,
    channels: 2,
  },
  tempo: { bpm: 128, confidence: 0.82, alternatives: [64, 256], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.61 },
  loudness: { integratedLufs: -9.3, peakDb: -0.4 },
  bands: {
    sub: -18.2,
    bass: -12.1,
    lowMid: -14,
    mid: -15.3,
    highMid: -17.8,
    high: -22.5,
  },
  dynamics: { crestFactorDb: 7.9 },
};

let dir: string;
let counter = 0;

/** A fake "python": a shell script that ignores `-m analysis analyze` and runs `body`. */
async function fakePython(body: string): Promise<string> {
  const file = join(dir, `fake-${counter++}.sh`);
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return file;
}

async function failure(promise: Promise<unknown>): Promise<CopilotError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CopilotError);
  return error as CopilotError;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const audio = asAssetPath("/workspace/take.wav");

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "analysis-py-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PythonAnalyzer", () => {
  it("returns the validated features for a valid output", async () => {
    const pythonPath = await fakePython(`echo '${JSON.stringify(VALID)}'`);
    const result = await new PythonAnalyzer({ pythonPath }).analyze(audio);
    expect(result).toEqual(VALID);
  });

  it("passes arguments verbatim, without a shell, with the target tempo", async () => {
    const argsFile = join(dir, "args.txt");
    const pythonPath = await fakePython(
      `for a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\necho '${JSON.stringify(VALID)}'`,
    );
    const nasty = asAssetPath("/workspace/a b; touch pwned $(id) `id`.wav");
    await new PythonAnalyzer({ pythonPath }).analyze(nasty, { targetBpm: 190 });
    const args = (await readFile(argsFile, "utf8")).split("\n").slice(0, -1);
    expect(args).toEqual(["-m", "analysis", "analyze", "--target-bpm", "190", "--", nasty]);
  });

  it("omits --target-bpm when no target is given", async () => {
    const argsFile = join(dir, "args-plain.txt");
    const pythonPath = await fakePython(
      `for a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\necho '${JSON.stringify(VALID)}'`,
    );
    await new PythonAnalyzer({ pythonPath }).analyze(audio);
    const args = (await readFile(argsFile, "utf8")).split("\n").slice(0, -1);
    expect(args).toEqual(["-m", "analysis", "analyze", "--", audio]);
  });

  it("rejects an invalid targetBpm before starting a process", async () => {
    const analyzer = new PythonAnalyzer({ pythonPath: "/nonexistent/python" });
    for (const targetBpm of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await failure(analyzer.analyze(audio, { targetBpm }))).code).toBe("analysis_failed");
    }
  });

  it("maps output that is not JSON to invalid_analysis_output", async () => {
    const pythonPath = await fakePython("echo 'not json at all'");
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("invalid_analysis_output");
  });

  it("maps JSON outside the schema to invalid_analysis_output", async () => {
    const broken = { ...VALID, tempo: { ...VALID.tempo, bpm: "fast" } };
    const pythonPath = await fakePython(`echo '${JSON.stringify(broken)}'`);
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("invalid_analysis_output");
    expect(error.message).toContain("tempo.bpm");
  });

  it("maps exit code 2 to file_not_found with a fixed message", async () => {
    const pythonPath = await fakePython("echo 'file_not_found: no such file: x.wav' >&2; exit 2");
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("file_not_found");
    expect(error.message).toBe("file_not_found: the file does not exist or cannot be read");
  });

  it("maps exit code 3 to unsupported_format", async () => {
    const pythonPath = await fakePython("echo 'unsupported_format: not audio' >&2; exit 3");
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("unsupported_format");
  });

  it("maps any other non-zero exit to analysis_failed", async () => {
    const pythonPath = await fakePython("echo 'Traceback: boom' >&2; exit 1");
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("analysis_failed");
    expect(error.message).toBe("analysis_failed: the analysis failed unexpectedly");
  });

  it("does not forward stderr or paths to the message; keeps them in the cause", async () => {
    const secret = "/home/someone/secret-dir/take.wav";
    const pythonPath = await fakePython(
      `echo 'unsupported_format: cannot decode as audio: ${secret}' >&2; exit 3`,
    );
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("unsupported_format");
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("secret-dir");
    expect((error.cause as Error).message).toContain(secret);
  });

  it("does not leak the system error when the interpreter cannot start", async () => {
    const missing = join(dir, "no-such-python");
    const error = await failure(new PythonAnalyzer({ pythonPath: missing }).analyze(audio));
    expect(error.message).toBe("analysis_failed: cannot start the analyzer");
    expect(error.message).not.toContain(dir);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("does not pass secrets from the environment to the child", async () => {
    const envFile = join(dir, "env.txt");
    const pythonPath = await fakePython(`env > '${envFile}'\necho '${JSON.stringify(VALID)}'`);
    process.env["ANTHROPIC_API_KEY"] = "sk-test-secret";
    try {
      await new PythonAnalyzer({ pythonPath }).analyze(audio);
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
    const seen = await readFile(envFile, "utf8");
    expect(seen).not.toContain("ANTHROPIC_API_KEY");
    expect(seen).not.toContain("sk-test-secret");
    expect(seen).toContain("PYTHONIOENCODING=utf-8");
    expect(seen).toContain("PATH=");
  });

  it("maps a missing interpreter to analysis_failed", async () => {
    const analyzer = new PythonAnalyzer({
      pythonPath: join(dir, "does-not-exist"),
    });
    expect((await failure(analyzer.analyze(audio))).code).toBe("analysis_failed");
  });

  it("kills the process and reports analysis_timeout when time runs out", async () => {
    const pidFile = join(dir, "pid.txt");
    const pythonPath = await fakePython(`echo $$ > '${pidFile}'\nexec sleep 30`);
    const started = Date.now();
    const error = await failure(new PythonAnalyzer({ pythonPath, timeoutMs: 300 }).analyze(audio));
    expect(error.code).toBe("analysis_timeout");
    expect(Date.now() - started).toBeLessThan(5_000);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    await expect.poll(() => isAlive(pid), { timeout: 3_000 }).toBe(false);
  });

  it("kills the process when stdout exceeds the limit", async () => {
    const pythonPath = await fakePython("yes x | head -c 100000; exec sleep 30");
    const error = await failure(
      new PythonAnalyzer({
        pythonPath,
        maxOutputBytes: 1_000,
        timeoutMs: 10_000,
      }).analyze(audio),
    );
    expect(error.code).toBe("analysis_failed");
    expect(error.message).toContain("exceeds");
  });

  it("truncates a huge stderr instead of failing on its size", async () => {
    const pythonPath = await fakePython("yes warning | head -c 200000 >&2; exit 1");
    const error = await failure(new PythonAnalyzer({ pythonPath }).analyze(audio));
    expect(error.code).toBe("analysis_failed");
    expect((error.cause as Error).message.length).toBeLessThan(700);
  });

  it("rejects nonsensical limits", () => {
    expect(() => new PythonAnalyzer({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new PythonAnalyzer({ maxOutputBytes: 1.5 })).toThrow(RangeError);
  });
});

describe("PythonAnalyzer.replayAssets", () => {
  const ASSETS: ReplayAssets = {
    durationSec: 12.4,
    waveform: {
      min: Array<number>(800).fill(-0.5),
      max: Array<number>(800).fill(0.5),
    },
    spectrum: {
      freqHz: Array.from({ length: 96 }, (_, i) => 20 + i * 100),
      db: Array<number>(96).fill(-40),
    },
  };

  it("passes the output and input verbatim and returns the validated assets", async () => {
    const argsFile = join(dir, "replay-args.txt");
    const pythonPath = await fakePython(
      `for a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\necho '${JSON.stringify(ASSETS)}'`,
    );
    const result = await new PythonAnalyzer({ pythonPath }).replayAssets(audio, "/out dir/a b.mp3");
    expect(result).toEqual(ASSETS);
    const args = (await readFile(argsFile, "utf8")).split("\n").slice(0, -1);
    expect(args).toEqual([
      "-m",
      "analysis",
      "replay-assets",
      "--out",
      "/out dir/a b.mp3",
      "--",
      audio,
    ]);
  });

  it("maps JSON outside the schema to invalid_analysis_output", async () => {
    const broken = { ...ASSETS, waveform: { min: [0], max: [0] } };
    const pythonPath = await fakePython(`echo '${JSON.stringify(broken)}'`);
    const error = await failure(new PythonAnalyzer({ pythonPath }).replayAssets(audio, "/o.mp3"));
    expect(error.code).toBe("invalid_analysis_output");
  });

  it("maps exit codes like analyze", async () => {
    const missing = await fakePython("exit 2");
    expect(
      (await failure(new PythonAnalyzer({ pythonPath: missing }).replayAssets(audio, "/o.mp3")))
        .code,
    ).toBe("file_not_found");
    const format = await fakePython("exit 3");
    expect(
      (await failure(new PythonAnalyzer({ pythonPath: format }).replayAssets(audio, "/o.mp3")))
        .code,
    ).toBe("unsupported_format");
    const other = await fakePython("exit 1");
    expect(
      (await failure(new PythonAnalyzer({ pythonPath: other }).replayAssets(audio, "/o.mp3"))).code,
    ).toBe("analysis_failed");
  });

  it("times out like analyze", async () => {
    const pythonPath = await fakePython("exec sleep 30");
    const error = await failure(
      new PythonAnalyzer({ pythonPath, timeoutMs: 300 }).replayAssets(audio, "/o.mp3"),
    );
    expect(error.code).toBe("analysis_timeout");
  });
});

describe("childEnv", () => {
  it("keeps only the allowed variables and LC_*", () => {
    const env = childEnv({
      PATH: "/bin",
      HOME: "/home/u",
      LC_CTYPE: "C.UTF-8",
      ANTHROPIC_API_KEY: "x",
      GITHUB_TOKEN: "y",
      NUMBA_CACHE_DIR: "/cache",
    });
    expect(Object.keys(env).sort()).toEqual(
      ["HOME", "LC_CTYPE", "NUMBA_CACHE_DIR", "PATH", "PYTHONIOENCODING"].sort(),
    );
  });
});
