import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CopilotError } from "@reaper-copilot/core";
import type { AnyToolDefinition, ToolContext, ToolRegistry } from "@reaper-copilot/tools";

export interface CreateServerOptions {
  readonly registry: ToolRegistry;
  readonly context: ToolContext;
  /** Diagnostics sink. stdout is the protocol, so the default writes to stderr. */
  readonly log?: (message: string) => void;
}

const logToStderr = (message: string): void => {
  console.error(`[reaper-copilot] ${message}`);
};

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function runTool(
  tool: AnyToolDefinition,
  input: unknown,
  context: ToolContext,
  log: (message: string) => void,
): Promise<CallToolResult> {
  try {
    const output = await tool.handler(input as never, context);
    const checked = tool.outputSchema.safeParse(output);
    if (!checked.success) {
      log(`tool ${tool.name} produced output that does not match its schema: ${checked.error.message}`);
      return errorResult("invalid_analysis_output: the tool result did not match its contract");
    }
    return {
      content: [{ type: "text", text: JSON.stringify(checked.data) }],
      structuredContent: checked.data as Record<string, unknown>,
    };
  } catch (error) {
    // Domain errors carry a client-safe message that already starts with its code.
    if (error instanceof CopilotError) return errorResult(error.message);
    // Anything else may hold stacks or internal paths: keep it on stderr, not in the reply.
    log(`tool ${tool.name} failed unexpectedly: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    return errorResult("internal_error: the tool failed unexpectedly");
  }
}

/** Builds an MCP server exposing the registry's tools. Transport-agnostic: connect it yourself. */
export function createServer(options: CreateServerOptions): McpServer {
  const { registry, context } = options;
  const log = options.log ?? logToStderr;
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
      (async (input: unknown) => runTool(tool, input, context, log)) as never,
    );
  }
  return server;
}
