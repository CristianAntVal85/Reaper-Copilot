// Usage: pnpm mcp:call <tool> '<json arguments>'
// Starts the server over stdio (same environment: MODE, COPILOT_WORKSPACE, COPILOT_PYTHON),
// calls one tool and prints the result as JSON. Exit code 1 if the tool reports an error.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [toolName, rawArgs = "{}"] = process.argv.slice(2);
if (toolName === undefined) {
  console.error("usage: pnpm mcp:call <tool> '<json arguments>'");
  process.exit(2);
}

let args: unknown;
try {
  args = JSON.parse(rawArgs);
} catch {
  console.error("the arguments must be a JSON object, e.g. '{\"path\":\"song.wav\"}'");
  process.exit(2);
}
if (typeof args !== "object" || args === null || Array.isArray(args)) {
  console.error("the arguments must be a JSON object");
  process.exit(2);
}

const mainPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
// Server logs go straight to this terminal's stderr.
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mainPath],
  env,
  stderr: "inherit",
});
const client = new Client({ name: "mcp-call", version: "0.0.0" });

const started = performance.now();
let exitCode = 1;
try {
  await client.connect(transport);
  const result = await client.callTool({ name: toolName, arguments: args as Record<string, unknown> });
  const isError = result.isError === true;
  exitCode = isError ? 1 : 0;
  const text = (result.content as { type: string; text?: string }[] | undefined)?.[0]?.text;
  console.log(
    isError
      ? JSON.stringify({ isError: true, message: text }, null, 2)
      : JSON.stringify(result.structuredContent ?? text, null, 2),
  );
} catch (error) {
  console.error(`call failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.close();
}
console.error(`[mcp:call] ${Math.round(performance.now() - started)} ms`);
process.exit(exitCode);
