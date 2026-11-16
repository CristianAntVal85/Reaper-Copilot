import type { AnalyzerPort } from "@reaper-copilot/core";
import type { z } from "zod";

export const TOOL_MODES = ["mentor", "agent"] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

export type ToolRisk = "read" | "write";

/** What a handler may use. Transport-agnostic: nothing here knows about MCP. */
export interface ToolContext {
  /** Directory every asset path must stay inside (constitution, rule 13). */
  readonly workspaceRoot: string;
  readonly analyzer: AnalyzerPort;
}

export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: TInput;
  readonly outputSchema: TOutput;
  readonly handler: (input: z.output<TInput>, ctx: ToolContext) => Promise<z.output<TOutput>>;
}

/** Identity helper that infers the handler types from the schemas. */
export function defineTool<TInput extends z.ZodType, TOutput extends z.ZodType>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return definition;
}

/** Erased form used by registries; the transport validates input/output with the schemas. */
export interface AnyToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly risk: ToolRisk;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly handler: (input: never, ctx: ToolContext) => Promise<unknown>;
}
