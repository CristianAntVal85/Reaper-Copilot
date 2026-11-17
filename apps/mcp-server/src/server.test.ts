import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ReaperDaw } from "@reaper-copilot/adapter-reaper";
import { AudioFeaturesSchema, CopilotError, JobStatusSchema, VerifyTaskOutputSchema, type DawPort } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeDaw, FakeStorage, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
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
  name: "test_write",
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
  daw?: DawPort;
}) {
  const analyzer = options.analyzer ?? new FakeAnalyzer();
  const storage = new FakeStorage();
  const registry = createToolRegistry([...ALL_TOOLS, ...(options.extraTools ?? [])], options.mode);
  const server = createServer({
    registry,
    sessionId: "test-session",
    context: {
      workspaceRoot: ws,
      analyzer,
      storage,
      daw: options.daw ?? new FakeDaw(),
      presets: [],
      log: options.log ?? (() => {}),
    },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, analyzer, storage, close: () => client.close() };
}

const textOf = (result: object): string => {
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  const first = content?.[0];
  return first?.text ?? "";
};

describe("MCP server", () => {
  const READ_TOOLS = ["get_project_state", "list_presets", "get_job_status", "analyze_audio", "compare_audio", "start_task", "verify_task"];
  const WRITE_TOOLS = [
    "import_audio",
    "set_tempo",
    "slice_loop",
    "time_stretch",
    "apply_fx_chain",
    "render_selection",
    "undo_last",
  ];

  it("lists only the 7 read tools in mentor mode, all read-only", async () => {
    const { client, close } = await connect({ mode: "mentor" });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.outputSchema !== undefined || tool.name === "get_job_status").toBe(true);
    }
    await close();
  });

  it("lists the 14 tools in agent mode, with readOnlyHint matching the risk", async () => {
    const { client, close } = await connect({ mode: "agent" });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(READ_TOOLS.includes(tool.name));
      // get_job_status returns a discriminated union: not an object schema, so MCP advertises none.
      expect(tool.outputSchema !== undefined || tool.name === "get_job_status").toBe(true);
    }
    await close();
  });

  it("announces an object inputSchema and an outputSchema for the task tools", async () => {
    const { client, close } = await connect({ mode: "mentor" });
    const { tools } = await client.listTools();
    for (const name of ["start_task", "verify_task"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.outputSchema, name).toBeDefined();
      expect(tool?.inputSchema.type, name).toBe("object");
    }
    const start = tools.find((candidate) => candidate.name === "start_task");
    expect(Object.keys(start?.inputSchema.properties ?? {}).sort()).toEqual(
      ["criteria", "request", "source", "target"],
    );
    expect(start?.inputSchema.required).toEqual(expect.arrayContaining(["request", "source"]));
    await close();
  });

  it("answers daw_unavailable in under a second when the bridge is not running", async () => {
    const ipcDir = await mkdtemp(path.join(tmpdir(), "rca-ipc-"));
    try {
      const daw = new ReaperDaw({ ipcDir, pathStyle: "identity" });
      const { client, close } = await connect({ mode: "mentor", daw });
      const started = performance.now();
      const result = await client.callTool({ name: "get_project_state", arguments: {} });
      expect(performance.now() - started).toBeLessThan(1000);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^daw_unavailable: /);
      await close();
    } finally {
      await rm(ipcDir, { recursive: true, force: true });
    }
  });

  it("leaves one trace per call, successful or not", async () => {
    const { client, storage, close } = await connect({ mode: "mentor" });
    await client.callTool({ name: "analyze_audio", arguments: { path: "song.wav" } });
    await client.callTool({
      name: "compare_audio",
      arguments: { a: { path: "song.wav" }, b: { path: "song.wav" } },
    });
    await client.callTool({ name: "analyze_audio", arguments: { path: "../../etc/passwd" } });
    expect(storage.traces.map((t) => [t.sessionId, t.step, t.tool, t.ok, t.errorCode])).toEqual([
      ["test-session", 1, "analyze_audio", true, null],
      ["test-session", 2, "compare_audio", true, null],
      ["test-session", 3, "analyze_audio", false, "path_outside_workspace"],
    ]);
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

  it("answers get_job_status over MCP in every state, despite its union output schema", async () => {
    const daw = new FakeDaw();
    const { client, close } = await connect({ mode: "agent", daw });
    const imported = await client.callTool({ name: "import_audio", arguments: { path: "song.wav" } });
    const itemId = (imported.structuredContent as { item: { id: string } }).item.id;

    const status = async (jobId: string) => {
      const result = await client.callTool({ name: "get_job_status", arguments: { jobId } });
      expect(result.isError, textOf(result)).toBeFalsy();
      const parsed = JobStatusSchema.parse(result.structuredContent);
      expect(JSON.parse(textOf(result))).toEqual(parsed);
      return parsed;
    };
    const render = async () => {
      const result = await client.callTool({ name: "render_selection", arguments: { itemId } });
      return (result.structuredContent as { jobId: string }).jobId;
    };

    const ok = await render();
    expect((await status(ok)).status).toBe("rendering");
    daw.completeJob(ok, 5.647);
    const done = await status(ok);
    expect(done).toMatchObject({ status: "done", output: { durationSec: 5.647 }, errorCode: null });
    expect(done.output?.path).toMatch(/^renders\/.+\.wav$/);

    const bad = await render();
    daw.failJob(bad);
    expect(await status(bad)).toEqual({ jobId: bad, status: "failed", output: null, errorCode: "render_failed" });
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

  it("does not send the cause of a domain error to the client; it logs it", async () => {
    const logged: string[] = [];
    const cause = new Error("stderr said /home/someone/secret-dir/take.wav");
    const analyzer = new FakeAnalyzer({
      error: new CopilotError("unsupported_format", "the file is not decodable audio", { cause }),
    });
    const { client, close } = await connect({
      mode: "mentor",
      analyzer,
      log: (message) => logged.push(message),
    });
    const result = await client.callTool({ name: "analyze_audio", arguments: { path: "song.wav" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("unsupported_format: the file is not decodable audio");
    expect(JSON.stringify(result)).not.toContain("secret-dir");
    expect(logged.join("\n")).toContain("secret-dir");
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
    expect(textOf(result)).toMatch(/^internal_error: /);
    await close();
  });

  it("exposes no write tool in mentor mode", async () => {
    const { client, close } = await connect({ mode: "mentor", extraTools: [setTempo] });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain("test_write");
    await close();
  });

  it("exposes write tools in agent mode, not marked read-only", async () => {
    const { client, close } = await connect({ mode: "agent", extraTools: [setTempo] });
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "test_write");
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    await close();
  });

  describe("tasks", () => {
    const withTaskFiles = async () => {
      await writeFile(path.join(ws, "source.wav"), "s");
      await writeFile(path.join(ws, "render.wav"), "r");
      return new FakeAnalyzer({
        resultFor: (assetPath) =>
          path.basename(assetPath) === "render.wav"
            ? {
                ...SAMPLE_AUDIO_FEATURES,
                file: { ...SAMPLE_AUDIO_FEATURES.file, sha256: "b".repeat(64), durationSec: 5.647 },
                tempo: { ...SAMPLE_AUDIO_FEATURES.tempo, bpm: 170 },
                dynamics: { crestFactorDb: SAMPLE_AUDIO_FEATURES.dynamics.crestFactorDb - 3 },
              }
            : SAMPLE_AUDIO_FEATURES,
      });
    };

    it("verifies a task end to end in mentor mode and attributes traces to it", async () => {
      const analyzer = await withTaskFiles();
      const { client, storage, close } = await connect({ mode: "mentor", analyzer });
      await client.callTool({ name: "analyze_audio", arguments: { path: "source.wav" } });
      const started = await client.callTool({
        name: "start_task",
        arguments: {
          request: "loop of 4 bars at 170 bpm, less peaky",
          source: "source.wav",
          target: { bpm: 170, bars: 4 },
          criteria: [
            { id: "crest", metric: "dynamics.crestFactorDb", basis: "delta", max: -1 },
          ],
        },
      });
      expect(started.isError, textOf(started)).toBeFalsy();
      const { taskId } = started.structuredContent as { taskId: string };
      const verified = await client.callTool({
        name: "verify_task",
        arguments: { taskId, path: "render.wav" },
      });
      expect(verified.isError, textOf(verified)).toBeFalsy();
      const output = VerifyTaskOutputSchema.parse(verified.structuredContent);
      expect(output).toMatchObject({ taskId, attempt: 1, pass: true });
      expect(output.results.map((r) => [r.id, r.status])).toEqual([
        ["duration", "pass"],
        ["tempo", "pass"],
        ["crest", "pass"],
      ]);
      expect(storage.traces.map((t) => [t.tool, t.taskId])).toEqual([
        ["analyze_audio", null],
        ["start_task", taskId],
        ["verify_task", taskId],
      ]);
      await close();
    });

    it("rejects a delta criterion whose interval includes 0, naming the rule", async () => {
      await writeFile(path.join(ws, "source.wav"), "s");
      const { client, close } = await connect({ mode: "mentor" });
      const outcome = await client
        .callTool({
          name: "start_task",
          arguments: {
            request: "r",
            source: "source.wav",
            criteria: [{ id: "c", metric: "dynamics.crestFactorDb", basis: "delta", min: -1, max: 1 }],
          },
        })
        .then((result) => ({ isError: result.isError === true, text: textOf(result) }))
        .catch((error: unknown) => ({ isError: true, text: String(error) }));
      expect(outcome.isError).toBe(true);
      expect(outcome.text).toContain("cannot include 0");
      await close();
    });

    it("rejects criteria passed to verify_task", async () => {
      const { client, close } = await connect({ mode: "mentor" });
      const outcome = await client
        .callTool({
          name: "verify_task",
          arguments: { taskId: "t", path: "song.wav", criteria: [] },
        })
        .then((result) => ({ isError: result.isError === true }))
        .catch(() => ({ isError: true }));
      expect(outcome.isError).toBe(true);
      await close();
    });
  });
});
