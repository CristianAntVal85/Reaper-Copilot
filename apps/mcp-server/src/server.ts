import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createToolSession,
  invokeTool,
  type AnyToolDefinition,
  type ToolContext,
  type ToolRegistry,
  type ToolSession,
} from "@reaper-copilot/tools";

export interface CreateServerOptions {
  readonly registry: ToolRegistry;
  /** `context.log` is the diagnostics sink (stderr in `main.ts`; stdout is the protocol). */
  readonly context: ToolContext;
  /** Identifies this server run in the traces; one per start (`crypto.randomUUID()`). */
  readonly sessionId: string;
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function runTool(
  tool: AnyToolDefinition,
  input: unknown,
  context: ToolContext,
  session: ToolSession,
): Promise<CallToolResult> {
  const result = await invokeTool(tool, input, context, session);
  if (!result.ok) return errorResult(result.message);
  return {
    content: [{ type: "text", text: JSON.stringify(result.output) }],
    structuredContent: result.output as Record<string, unknown>,
  };
}

/** Builds an MCP server exposing the registry's tools. Transport-agnostic: connect it yourself. */
export function createServer(options: CreateServerOptions): McpServer {
  const { registry, context } = options;
  const session = createToolSession(options.sessionId);
  const server = new McpServer({ name: "reaper-copilot", version: "0.0.0" });

  for (const tool of registry.list()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // The SDK validates input against this schema before the callback runs.
        inputSchema: tool.inputSchema as never,
        outputSchema: tool.outputSchema as never,
        annotations: { readOnlyHint: tool.risk === "read" },
      },
      (async (input: unknown) => runTool(tool, input, context, session)) as never,
    );
  }
  return server;
}
