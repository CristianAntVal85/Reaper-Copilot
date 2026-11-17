import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeAnalyzer, FakeStorage } from "@reaper-copilot/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeAudio } from "./analyze-audio.ts";
import { createToolSession, invokeTool, type ToolSession } from "./invoke-tool.ts";
import { startTask } from "./start-task.ts";
import type { ToolContext } from "./tool-definition.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-task-")));
  await writeFile(path.join(ws, "song.wav"), "x");
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

let storage: FakeStorage;
let ctx: ToolContext;
let session: ToolSession;

beforeEach(() => {
  storage = new FakeStorage();
  ctx = { workspaceRoot: ws, analyzer: new FakeAnalyzer(), storage, log: () => {} };
  session = createToolSession("session-1");
});

const base = {
  request: "make it louder",
  source: "song.wav",
  criteria: [{ id: "louder", metric: "loudness.integratedLufs", basis: "delta", min: 1 }],
};

describe("start_task", () => {
  it("rejects a source outside the workspace and stores nothing", async () => {
    const result = await invokeTool(startTask, { ...base, source: "../outside.wav" }, ctx, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("path_outside_workspace");
    expect(storage.tasks).toEqual([]);
  });

  it("derives duration and tempo criteria from the target and returns no absolute paths", async () => {
    const result = await invokeTool(startTask, { ...base, criteria: [], target: { bpm: 170, bars: 4 } }, ctx, session);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = startTask.outputSchema.parse(result.output);
    expect(output.criteria.map((c) => c.id)).toEqual(["duration", "tempo"]);
    expect(output.criteria.every((c) => c.derived)).toBe(true);
    expect(JSON.stringify(result.output)).not.toContain(ws);
    expect(storage.tasks).toHaveLength(1);
    expect(storage.tasks[0]).toMatchObject({
      taskId: output.taskId,
      source: "song.wav",
      target: { bpm: 170, bars: 4, beatsPerBar: 4 },
      criteria: output.criteria,
    });
  });

  it("reports internal_error when saving fails", async () => {
    storage.errors.createTask = new Error("disk full");
    const result = await invokeTool(startTask, base, ctx, session);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("internal_error");
    expect(session.activeTaskId).toBeNull();
  });

  it("attributes its own trace and later calls in the session to the task", async () => {
    const result = await invokeTool(startTask, base, ctx, session);
    if (!result.ok) throw new Error(result.message);
    const { taskId } = startTask.outputSchema.parse(result.output);
    await invokeTool(analyzeAudio, { path: "song.wav" }, ctx, session);
    expect(storage.traces.map((t) => t.taskId)).toEqual([taskId, taskId]);
    expect(session.activeTaskId).toBe(taskId);
  });
});
