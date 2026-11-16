import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PythonAnalyzer } from "@reaper-copilot/adapter-analysis-py";
import type { StoragePort } from "@reaper-copilot/core";
import { ALL_TOOLS, createToolRegistry } from "@reaper-copilot/tools";
import { readConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = readConfig(process.env);
const analyzer = new PythonAnalyzer(
  config.pythonPath === undefined ? {} : { pythonPath: config.pythonPath },
);
// No persistence yet: every lookup misses and nothing is kept. T7 swaps in SqliteStorage.
const storage: StoragePort = {
  getCachedAnalysis: async () => null,
  putCachedAnalysis: async () => {},
  recordToolCall: async () => {},
  listToolCalls: async () => [],
};
const log = (message: string): void => console.error(`[reaper-copilot] ${message}`);
const registry = createToolRegistry(ALL_TOOLS, config.mode);
const server = createServer({
  registry,
  context: { workspaceRoot: config.workspaceRoot, analyzer, storage, log },
});

console.error(
  `[reaper-copilot] starting: mode=${config.mode} workspace=${config.workspaceRoot} tools=${registry
    .list()
    .map((tool) => tool.name)
    .join(",")}`,
);
await server.connect(new StdioServerTransport());
