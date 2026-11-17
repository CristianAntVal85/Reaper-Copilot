import { randomUUID } from "node:crypto";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PythonAnalyzer } from "@reaper-copilot/adapter-analysis-py";
import { ReaperDaw } from "@reaper-copilot/adapter-reaper";
import { SqliteStorage } from "@reaper-copilot/adapter-storage-sqlite";
import { ALL_TOOLS, createToolRegistry, loadPresets } from "@reaper-copilot/tools";
import { DEFAULT_WORKSPACE, databasePath, readConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = readConfig(process.env);
const analyzer = new PythonAnalyzer(
  config.pythonPath === undefined ? {} : { pythonPath: config.pythonPath },
);
const storage = new SqliteStorage({ path: databasePath(config.dataDir) });
const log = (message: string): void => console.error(`[reaper-copilot] ${message}`);
// An invalid preset stops the start; Reaper being closed does not (the tools answer daw_unavailable).
const presets = await loadPresets(config.presetsDir);
const daw = new ReaperDaw({ ipcDir: config.reaperIpcDir, pathStyle: config.reaperPathStyle, log });
if (path.resolve(config.workspaceRoot) !== path.resolve(DEFAULT_WORKSPACE)) {
  log(
    `warning: COPILOT_WORKSPACE (${config.workspaceRoot}) differs from ${DEFAULT_WORKSPACE}; the Reaper bridge only accepts paths under the latter`,
  );
}
const registry = createToolRegistry(ALL_TOOLS, config.mode);
const server = createServer({
  registry,
  sessionId: randomUUID(),
  context: { workspaceRoot: config.workspaceRoot, analyzer, storage, daw, presets, log },
});

// Close the database when the client goes away or the process is stopped.
let closed = false;
const shutdown = (): void => {
  if (closed) return;
  closed = true;
  storage.close();
};
server.server.onclose = shutdown;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown();
    process.exit(0);
  });
}

log(
  `starting: mode=${config.mode} workspace=${config.workspaceRoot} dataDir=${config.dataDir} tools=${registry
    .list()
    .map((tool) => tool.name)
    .join(",")}`,
);
await server.connect(new StdioServerTransport());
