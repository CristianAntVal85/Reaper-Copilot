import type { AnyToolDefinition, ToolMode } from "./tool-definition.ts";

export interface ToolRegistry {
  readonly mode: ToolMode;
  /** Tools exposed in this mode: `mentor` only gets `read` tools. */
  list(): readonly AnyToolDefinition[];
  get(name: string): AnyToolDefinition | undefined;
}

export function createToolRegistry(
  tools: readonly AnyToolDefinition[],
  mode: ToolMode,
): ToolRegistry {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`duplicate tool name: ${tool.name}`);
    names.add(tool.name);
  }
  const exposed = tools.filter((tool) => mode === "agent" || tool.risk === "read");
  return {
    mode,
    list: () => exposed,
    get: (name) => exposed.find((tool) => tool.name === name),
  };
}
