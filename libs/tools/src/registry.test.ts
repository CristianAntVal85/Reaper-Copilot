import { FakeStorage } from "@reaper-copilot/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createToolRegistry } from "./registry.ts";
import { defineTool, type ToolRisk } from "./tool-definition.ts";

const tool = (name: string, risk: ToolRisk) =>
  defineTool({
    name,
    description: name,
    risk,
    inputSchema: z.object({ n: z.number() }),
    outputSchema: z.object({ doubled: z.number() }),
    handler: async ({ n }) => ({ doubled: n * 2 }),
  });

const tools = [tool("reader", "read"), tool("writer", "write")];

describe("createToolRegistry", () => {
  it("mentor mode exposes read tools only", () => {
    const registry = createToolRegistry(tools, "mentor");
    expect(registry.list().map((t) => t.name)).toEqual(["reader"]);
    expect(registry.get("writer")).toBeUndefined();
    expect(registry.get("reader")?.risk).toBe("read");
  });

  it("agent mode exposes every tool", () => {
    const registry = createToolRegistry(tools, "agent");
    expect(registry.list().map((t) => t.name)).toEqual(["reader", "writer"]);
    expect(registry.get("writer")).toBeDefined();
  });

  it("rejects duplicate names", () => {
    expect(() => createToolRegistry([tool("a", "read"), tool("a", "write")], "agent")).toThrow(
      /duplicate/,
    );
  });

  it("keeps handler types inferred from the schemas", async () => {
    const t = tool("reader", "read");
    const ctx = {
      workspaceRoot: "/ws",
      analyzer: { analyze: async () => Promise.reject(), replayAssets: async () => Promise.reject() },
      storage: new FakeStorage(),
      log: () => {},
    };
    expect(await t.handler({ n: 2 }, ctx)).toEqual({ doubled: 4 });
  });
});
