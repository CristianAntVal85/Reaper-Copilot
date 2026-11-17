// Usage: pnpm replay:export <taskId> [--title "<text>"]
// Writes apps/web/public/runs/<taskId>/ (run.json, source.mp3, render-<n>.mp3) and regenerates
// apps/web/public/runs/index.json. Reads <COPILOT_DATA_DIR>/copilot.db; never creates it.
// Development only: REPLAY_OUT_DIR replaces the output folder (to try it without publishing).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PythonAnalyzer } from "@reaper-copilot/adapter-analysis-py";
import { SqliteStorage } from "@reaper-copilot/adapter-storage-sqlite";
import { z } from "zod";
import { databasePath, readConfig } from "../src/config.ts";
import { exportReplayRun } from "../src/replay-export.ts";

const WARN_BYTES = 15 * 1024 * 1024;
const USAGE = 'usage: pnpm replay:export <taskId> [--title "<text>"]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let positionals: string[];
let title: string | undefined;
try {
  const parsed = parseArgs({ allowPositionals: true, options: { title: { type: "string" } } });
  positionals = parsed.positionals;
  title = parsed.values.title;
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`);
}
const taskId = positionals[0];
if (positionals.length !== 1 || taskId === undefined || !z.uuid().safeParse(taskId).success) {
  fail(`taskId must be a uuid\n${USAGE}`);
}

const config = readConfig(process.env);
const dbPath = databasePath(config.dataDir);
if (!existsSync(dbPath)) fail(`no database at ${dbPath}: run a task first`);

const outDir =
  process.env["REPLAY_OUT_DIR"]?.trim() ||
  fileURLToPath(new URL("../../web/public/runs", import.meta.url));

// SqliteStorage has no read-only option; the exporter only reads tasks, verifications and
// traces (it does write analysis-cache entries through analyzeWithCache).
const storage = new SqliteStorage({ path: dbPath });
const analyzer = new PythonAnalyzer(config.pythonPath === undefined ? {} : { pythonPath: config.pythonPath });
try {
  const result = await exportReplayRun({
    storage,
    analyzer,
    workspaceRoot: config.workspaceRoot,
    outDir,
    taskId,
    title,
    log: (message) => console.error(`[replay-export] ${message}`),
  });
  for (const file of result.files) {
    console.log(`${path.join(outDir, file.path)}  ${(file.bytes / 1024).toFixed(1)} KiB`);
  }
  const runBytes = result.files.filter((f) => f.path.startsWith(`${taskId}/`)).reduce((s, f) => s + f.bytes, 0);
  console.log(`run total: ${(runBytes / 1024 / 1024).toFixed(2)} MiB`);
  if (runBytes > WARN_BYTES) console.error("warning: this run exceeds 15 MB; consider a shorter clip");
} catch (error) {
  const code = (error as { code?: unknown }).code;
  fail(`replay:export failed${typeof code === "string" ? ` (${code})` : ""}: ${(error as Error).message}`);
} finally {
  storage.close();
}
