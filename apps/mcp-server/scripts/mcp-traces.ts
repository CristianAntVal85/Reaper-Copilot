// Usage: pnpm mcp:traces [n]
// Prints the last n tool-call traces (default 10), newest first, one line each.
// Reads <COPILOT_DATA_DIR>/copilot.db; never creates it. Exit code 1 if it does not exist.
import { existsSync } from "node:fs";
import { SqliteStorage } from "@reaper-copilot/adapter-storage-sqlite";
import { databasePath, readConfig } from "../src/config.ts";

const rawLimit = process.argv[2] ?? "10";
const limit = Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1) {
  console.error("usage: pnpm mcp:traces [n]  (n is a positive integer)");
  process.exit(2);
}

const dbPath = databasePath(readConfig(process.env).dataDir);
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}: run a tool first (e.g. pnpm mcp:call analyze_audio ...)`);
  process.exit(1);
}

const storage = new SqliteStorage({ path: dbPath });
try {
  const traces = await storage.listToolCalls({ limit });
  if (traces.length === 0) console.error("no traces yet");
  for (const trace of traces) {
    console.log(
      [
        trace.startedAt,
        trace.tool.padEnd(14),
        `ok=${trace.ok}`,
        `errorCode=${trace.errorCode ?? "-"}`,
        `durationMs=${Math.round(trace.durationMs)}`,
        `cacheHits=${trace.cacheHits}`,
        `step=${trace.step}`,
        `session=${trace.sessionId.slice(0, 8)}`,
        `task=${trace.taskId?.slice(0, 8) ?? "-"}`,
      ].join(" "),
    );
  }
} finally {
  storage.close();
}
