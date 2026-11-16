import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AudioFeaturesSchema, CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
import { z } from "zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeAudio } from "./analyze-audio.ts";
import { createToolSession, invokeTool, type ToolSession } from "./invoke-tool.ts";
import { defineTool, type ToolContext } from "./tool-definition.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-invoke-")));
  await writeFile(path.join(ws, "song.wav"), "x");
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

let analyzer: FakeAnalyzer;
let storage: FakeStorage;
let logs: string[];
let ctx: ToolContext;
let session: ToolSession;

beforeEach(() => {
  analyzer = new FakeAnalyzer();
  storage = new FakeStorage();
  logs = [];
  ctx = { workspaceRoot: ws, analyzer, storage, log: (m) => logs.push(m) };
  session = createToolSession("session-1");
});

const throwing = (error: unknown) =>
  defineTool({
    name: "throws",
    description: "Test-only.",
    risk: "read",
    inputSchema: z.strictObject({}),
    outputSchema: z.strictObject({ ok: z.literal(true) }),
    handler: async () => {
      throw error;
    },
  });

const badOutput = defineTool({
  name: "bad_output",
  description: "Test-only.",
  risk: "read",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ ok: z.literal(true) }),
  handler: async () => ({ ok: false }) as never,
});

describe("invokeTool", () => {
  it("returns the validated output and records an ok trace", async () => {
    const result = await invokeTool(analyzeAudio, { path: "song.wav", targetBpm: 190 }, ctx, session);
    expect(result.ok).toBe(true);
    if (result.ok) expect(AudioFeaturesSchema.parse(result.output)).toEqual(SAMPLE_AUDIO_FEATURES);
    expect(storage.traces).toHaveLength(1);
    const trace = storage.traces[0];
    expect(trace).toMatchObject({
      sessionId: "session-1",
      step: 1,
      tool: "analyze_audio",
      args: { path: "song.wav", targetBpm: 190 },
      ok: true,
      errorCode: null,
      cacheHits: 0,
      result: SAMPLE_AUDIO_FEATURES,
    });
    expect(trace?.durationMs).toBeGreaterThanOrEqual(0);
    expect(new Date(trace?.startedAt ?? "").toISOString()).toBe(trace?.startedAt);
  });

  it("rejects invalid input with a fixed message, never calls the handler and traces it", async () => {
    const result = await invokeTool(analyzeAudio, { path: "song.wav", targetBpm: 999 }, ctx, session);
    expect(result).toEqual({
      ok: false,
      message: "invalid_input: the tool input does not match its schema",
    });
    expect(analyzer.calls).toEqual([]);
    expect(storage.traces[0]).toMatchObject({
      ok: false,
      errorCode: "invalid_input",
      result: null,
      args: { path: "song.wav", targetBpm: 999 },
    });
  });

  it("traces non-JSON input as null args", async () => {
    await invokeTool(analyzeAudio, undefined, ctx, session);
    expect(storage.traces[0]).toMatchObject({ ok: false, args: null, errorCode: "invalid_input" });
  });

  it("returns a CopilotError message and code, keeping its cause out of reply and trace", async () => {
    const cause = new Error("stderr said /home/someone/secret-dir/take.wav");
    analyzer = new FakeAnalyzer({
      error: new CopilotError("unsupported_format", "the file is not decodable audio", { cause }),
    });
    ctx = { ...ctx, analyzer };
    const result = await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    expect(result).toEqual({
      ok: false,
      message: "unsupported_format: the file is not decodable audio",
    });
    expect(storage.traces[0]).toMatchObject({
      ok: false,
      errorCode: "unsupported_format",
      result: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret-dir");
    expect(JSON.stringify(storage.traces)).not.toContain("secret-dir");
    expect(logs.join("\n")).toContain("secret-dir");
  });

  it("maps a domain error from a path check to its own code", async () => {
    const result = await invokeTool(analyzeAudio, { path: "../../etc/passwd" }, ctx, session);
    expect(result).toMatchObject({ ok: false });
    expect(storage.traces[0]).toMatchObject({ errorCode: "path_outside_workspace" });
    expect(analyzer.calls).toEqual([]);
  });

  it("hides unexpected errors as internal_error and logs the details", async () => {
    const tool = throwing(new Error("secret /home/someone/internal path"));
    const result = await invokeTool(tool, {}, ctx, session);
    expect(result).toEqual({ ok: false, message: "internal_error: the tool failed unexpectedly" });
    expect(storage.traces[0]).toMatchObject({ ok: false, errorCode: "internal_error", result: null });
    expect(JSON.stringify(storage.traces)).not.toContain("secret");
    expect(logs.join("\n")).toContain("secret /home/someone/internal path");
  });

  it("treats output outside the schema as internal_error", async () => {
    const result = await invokeTool(badOutput, {}, ctx, session);
    expect(result).toEqual({ ok: false, message: "internal_error: the tool failed unexpectedly" });
    expect(storage.traces[0]).toMatchObject({ ok: false, errorCode: "internal_error", result: null });
    expect(logs.join("\n")).toContain("does not match its schema");
  });

  it("still answers, and logs, when the trace cannot be written", async () => {
    storage.errors.record = new Error("disk full");
    const result = await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    expect(result.ok).toBe(true);
    expect(logs.join("\n")).toContain("could not record the trace");
    expect(logs.join("\n")).toContain("disk full");
    expect(storage.traces).toHaveLength(0);
  });

  it("numbers steps 1, 2, 3 across calls, failed ones included", async () => {
    await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    await invokeTool(analyzeAudio, { path: "nope" }, ctx, session);
    await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    expect(storage.traces.map((t) => t.step)).toEqual([1, 2, 3]);
  });

  it("counts cache hits per call", async () => {
    await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    expect(analyzer.calls).toHaveLength(1);
    expect(storage.traces.map((t) => t.cacheHits)).toEqual([0, 1]);
  });
});
