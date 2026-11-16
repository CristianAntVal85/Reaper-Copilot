import { randomUUID } from "node:crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PythonAnalyzer } from "@reaper-copilot/adapter-analysis-py";
import { SqliteStorage } from "@reaper-copilot/adapter-storage-sqlite";
import { ALL_TOOLS, createToolRegistry } from "@reaper-copilot/tools";
import { databasePath, readConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = readConfig(process.env);
const analyzer = new PythonAnalyzer(
  config.pythonPath === undefined ? {} : { pythonPath: config.pythonPath },
);
const storage = new SqliteStorage({ path: databasePath(config.dataDir) });
const log = (message: string): void => console.error(`[reaper-copilot] ${message}`);
const registry = createToolRegistry(ALL_TOOLS, config.mode);
const server = createServer({
  registry,
  sessionId: randomUUID(),
  context: { workspaceRoot: config.workspaceRoot, analyzer, storage, log },
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
