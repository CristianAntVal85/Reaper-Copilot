import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AudioFeaturesSchema, CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
import {
  ALL_TOOLS,
  createToolRegistry,
  defineTool,
  type ToolMode,
} from "@reaper-copilot/tools";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "./server.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-mcp-")));
  await writeFile(path.join(ws, "song.wav"), "x");
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const setTempo = defineTool({
  name: "set_tempo",
  description: "Test-only write tool.",
  risk: "write",
  inputSchema: z.strictObject({ bpm: z.number() }),
  outputSchema: z.strictObject({ ok: z.literal(true) }),
  handler: async () => ({ ok: true as const }),
});

const failing = (name: string, error: Error) =>
  defineTool({
    name,
    description: "Test-only failing tool.",
    risk: "read",
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({ ok: z.literal(true) }),
    handler: async () => {
      throw error;
    },
  });

const badOutput = defineTool({
  name: "bad_output",
  description: "Test-only tool whose result breaks its own contract.",
  risk: "read",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ ok: z.literal(true) }),
  handler: async () => ({ ok: false }) as never,
});

async function connect(options: {
  mode: ToolMode;
  analyzer?: FakeAnalyzer;
  extraTools?: Parameters<typeof createToolRegistry>[0];
  log?: (message: string) => void;
}) {
  const analyzer = options.analyzer ?? new FakeAnalyzer();
  const registry = createToolRegistry([...ALL_TOOLS, ...(options.extraTools ?? [])], options.mode);
  const server = createServer({
    registry,
    context: { workspaceRoot: ws, analyzer },
    log: options.log ?? (() => {}),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, analyzer, close: () => client.close() };
}

const textOf = (result: object): string => {
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  const first = content?.[0];
  return first?.text ?? "";
};

describe("MCP server", () => {
  it("lists analyze_audio as read-only", async () => {
    const { client, close } = await connect({ mode: "mentor" });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["analyze_audio"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.outputSchema).toBeDefined();
    await close();
  });

  it("returns structuredContent that satisfies the contract, and the same JSON as text", async () => {
    const { client, analyzer, close } = await connect({ mode: "mentor" });
    const result = await client.callTool({
      name: "analyze_audio",
      arguments: { path: "song.wav", targetBpm: 190 },
    });
    expect(result.isError).toBeFalsy();
    expect(AudioFeaturesSchema.parse(result.structuredContent)).toEqual(SAMPLE_AUDIO_FEATURES);
    expect(JSON.parse(textOf(result))).toEqual(SAMPLE_AUDIO_FEATURES);
    expect(analyzer.calls).toEqual([
      { path: path.join(ws, "song.wav"), options: { targetBpm: 190 } },
    ]);
    await close();
  });

  it("returns isError with path_outside_workspace and never reaches the analyzer", async () => {
    const { client, analyzer, close } = await connect({ mode: "mentor" });
    const result = await client.callTool({
      name: "analyze_audio",
      arguments: { path: "../../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^path_outside_workspace: /);
    expect(analyzer.calls).toEqual([]);
    await close();
  });

  it("rejects invalid input before the handler runs", async () => {
    const { client, analyzer, close } = await connect({ mode: "mentor" });
    const outcome = await client
      .callTool({ name: "analyze_audio", arguments: { path: "song.wav", targetBpm: 999 } })
      .then((result) => ({ isError: result.isError === true }))
      .catch(() => ({ isError: true }));
    expect(outcome.isError).toBe(true);
    expect(analyzer.calls).toEqual([]);
    await close();
  });

  it("returns a domain error from the analyzer with its code", async () => {
    const analyzer = new FakeAnalyzer({ error: new CopilotError("analysis_timeout", "too slow") });
    const { client, close } = await connect({ mode: "mentor", analyzer });
    const result = await client.callTool({ name: "analyze_audio", arguments: { path: "song.wav" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^analysis_timeout: /);
    await close();
  });

  it("does not leak unexpected error details to the client; it logs them", async () => {
    const logged: string[] = [];
    const secret = new Error("secret /home/someone/internal path");
    const { client, close } = await connect({
      mode: "mentor",
      extraTools: [failing("explodes", secret)],
      log: (message) => logged.push(message),
    });
    const result = await client.callTool({ name: "explodes", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^internal_error: /);
    expect(textOf(result)).not.toContain("secret");
    expect(logged.join("\n")).toContain("secret /home/someone/internal path");
    await close();
  });

  it("reports a result that breaks its output schema as an error", async () => {
    const { client, close } = await connect({ mode: "mentor", extraTools: [badOutput] });
    const result = await client.callTool({ name: "bad_output", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^invalid_analysis_output: /);
    await close();
  });

  it("exposes no write tool in mentor mode", async () => {
    const { client, close } = await connect({ mode: "mentor", extraTools: [setTempo] });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("set_tempo");
    await close();
  });

  it("exposes write tools in agent mode, not marked read-only", async () => {
    const { client, close } = await connect({ mode: "agent", extraTools: [setTempo] });
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "set_tempo");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    await close();
  });
});
