import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PythonAnalyzer } from "@reaper-copilot/adapter-analysis-py";
import { ALL_TOOLS, createToolRegistry } from "@reaper-copilot/tools";
import { readConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = readConfig(process.env);
const analyzer = new PythonAnalyzer(
  config.pythonPath === undefined ? {} : { pythonPath: config.pythonPath },
);
const registry = createToolRegistry(ALL_TOOLS, config.mode);
const server = createServer({
  registry,
  context: { workspaceRoot: config.workspaceRoot, analyzer },
});

console.error(
  `[reaper-copilot] starting: mode=${config.mode} workspace=${config.workspaceRoot} tools=${registry
    .list()
    .map((tool) => tool.name)
    .join(",")}`,
);
await server.connect(new StdioServerTransport());
