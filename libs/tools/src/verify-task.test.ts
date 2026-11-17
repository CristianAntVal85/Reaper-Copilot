import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AudioFeatures } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createToolSession, invokeTool, type ToolSession } from "./invoke-tool.ts";
import { startTask } from "./start-task.ts";
import type { ToolContext } from "./tool-definition.ts";
import { verifyTask } from "./verify-task.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-verify-")));
  await writeFile(path.join(ws, "song.wav"), "source-bytes");
  await writeFile(path.join(ws, "render1.wav"), "render-one");
  await writeFile(path.join(ws, "render2.wav"), "render-two");
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const withLufs = (lufs: number, sha: string): AudioFeatures => ({
  ...SAMPLE_AUDIO_FEATURES,
  file: { ...SAMPLE_AUDIO_FEATURES.file, sha256: sha.repeat(64) },
  loudness: { ...SAMPLE_AUDIO_FEATURES.loudness, integratedLufs: lufs },
});

let storage: FakeStorage;
let analyzer: FakeAnalyzer;
let ctx: ToolContext;
let session: ToolSession;

beforeEach(() => {
  storage = new FakeStorage();
  analyzer = new FakeAnalyzer({
    resultFor: (p) =>
      p.endsWith("song.wav")
        ? withLufs(-16, "1")
        : p.endsWith("render1.wav")
          ? withLufs(-15.5, "2")
          : withLufs(-14, "3"),
  });
  ctx = { workspaceRoot: ws, analyzer, storage, log: () => {} };
  session = createToolSession("session-1");
});

async function start(input: Record<string, unknown>): Promise<string> {
  const result = await invokeTool(
    startTask,
    { request: "louder", source: "song.wav", ...input },
    ctx,
    session,
  );
  if (!result.ok) throw new Error(result.message);
  return startTask.outputSchema.parse(result.output).taskId;
}

const deltaCriteria = [
  { id: "louder", metric: "loudness.integratedLufs", basis: "delta", min: 1 },
];

describe("verify_task", () => {
  it("fails then passes on a second attempt, storing both", async () => {
    const taskId = await start({ criteria: deltaCriteria });
    const first = await invokeTool(verifyTask, { taskId, path: "render1.wav" }, ctx, session);
    if (!first.ok) throw new Error(first.message);
    const out1 = verifyTask.outputSchema.parse(first.output);
    expect(out1).toMatchObject({ attempt: 1, pass: false });
    expect(out1.results[0]?.id).toBe("louder");
    expect(out1.results[0]?.status).toBe("fail");

    const second = await invokeTool(verifyTask, { taskId, path: "render2.wav" }, ctx, session);
    if (!second.ok) throw new Error(second.message);
    const out2 = verifyTask.outputSchema.parse(second.output);
    expect(out2).toMatchObject({ attempt: 2, pass: true });
    expect(out2.results[0]?.status).toBe("pass");
    expect(out2.render).toEqual({ path: "render2.wav", sha256: "3".repeat(64) });
    expect(storage.verifications.map((v) => v.attempt)).toEqual([1, 2]);
    expect(JSON.stringify(second.output)).not.toContain(ws);
  });

  it("rejects a criteria field in the input", async () => {
    const taskId = await start({ criteria: deltaCriteria });
    const result = await invokeTool(
      verifyTask,
      { taskId, path: "render1.wav", criteria: [] },
      ctx,
      session,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("invalid_input");
  });

  it("reports task_not_found for an unknown taskId", async () => {
    const result = await invokeTool(verifyTask, { taskId: "nope", path: "render1.wav" }, ctx, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("task_not_found");
      expect(result.message).not.toContain("nope");
    }
    expect(storage.verifications).toEqual([]);
  });

  it("does not analyze the source without delta criteria", async () => {
    const taskId = await start({
      criteria: [{ id: "peak", metric: "loudness.peakDb", basis: "absolute", max: 0 }],
    });
    const result = await invokeTool(verifyTask, { taskId, path: "render1.wav" }, ctx, session);
    expect(result.ok).toBe(true);
    expect(analyzer.calls.map((c) => path.basename(c.path))).toEqual(["render1.wav"]);
  });

  it("analyzes the source without targetBpm when a delta exists, and the render with it", async () => {
    const taskId = await start({ criteria: deltaCriteria, target: { bpm: 120, bars: 4 } });
    await invokeTool(verifyTask, { taskId, path: "render1.wav" }, ctx, session);
    const byName = Object.fromEntries(
      analyzer.calls.map((c) => [path.basename(c.path), c.options]),
    );
    expect(byName["render1.wav"]).toEqual({ targetBpm: 120 });
    expect(byName["song.wav"]?.targetBpm).toBeUndefined();
  });

  it("attributes the trace to the task", async () => {
    const taskId = await start({ criteria: deltaCriteria });
    await invokeTool(verifyTask, { taskId, path: "render2.wav" }, ctx, session);
    expect(storage.traces.at(-1)).toMatchObject({ tool: "verify_task", taskId });
  });

  it("rejects a render outside the workspace", async () => {
    const taskId = await start({ criteria: deltaCriteria });
    const result = await invokeTool(verifyTask, { taskId, path: "../x.wav" }, ctx, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("path_outside_workspace");
  });
});
