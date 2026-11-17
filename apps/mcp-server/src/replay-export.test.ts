import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ReplayIndexSchema,
  ReplayRunSchema,
  type AssetPath,
  type ReplayAssets,
  type Task,
} from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage } from "@reaper-copilot/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportReplayRun } from "./replay-export.ts";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

/** FakeAnalyzer does not write the MP3; this one writes a small placeholder at `output`. */
class WritingAnalyzer extends FakeAnalyzer {
  override async replayAssets(input: AssetPath, output: string): Promise<ReplayAssets> {
    const assets = await super.replayAssets(input, output);
    await writeFile(output, "mp3");
    return assets;
  }
}

let ws: string;
let out: string;
let storage: FakeStorage;
let analyzer: WritingAnalyzer;

function task(taskId: string, source: string, createdAt: string): Task {
  return {
    taskId,
    createdAt,
    request: "Make a loop at 170 BPM",
    source,
    target: { bpm: 170, bars: 4, beatsPerBar: 4 },
    criteria: [{ id: "tempo", derived: true, metric: "tempo.bpm", basis: "absolute", min: 169, max: 171 }],
  };
}

async function seed(taskId: string, source: string, createdAt: string, attempts = 1): Promise<void> {
  await storage.createTask(task(taskId, source, createdAt));
  for (let i = 0; i < attempts; i++) {
    await storage.recordVerification({
      taskId,
      render: { path: "render.wav", sha256: "b".repeat(64) },
      pass: i === attempts - 1,
      results: [],
      verifiedAt: `2026-01-01T00:0${i + 1}:00.000Z`,
    });
  }
  await storage.recordToolCall({
    sessionId: "s1",
    step: 2,
    tool: "verify_task",
    args: { taskId, note: `see ${ws}/render.wav` },
    ok: true,
    result: { path: `${ws}/render.wav` },
    errorCode: null,
    durationMs: 3,
    startedAt: "2026-01-01T00:00:02.000Z",
    cacheHits: 1,
    taskId,
  });
  await storage.recordToolCall({
    sessionId: "s1",
    step: 1,
    tool: "start_task",
    args: {},
    ok: true,
    result: {},
    errorCode: null,
    durationMs: 3,
    startedAt: "2026-01-01T00:00:01.000Z",
    cacheHits: 0,
    taskId,
  });
}

const run = (taskId = TASK_ID, title?: string) =>
  exportReplayRun({ storage, analyzer, workspaceRoot: ws, outDir: out, taskId, title, log: () => undefined });

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "replay-export-"));
  ws = path.join(base, "workspace");
  out = path.join(base, "runs");
  await mkdir(ws);
  await writeFile(path.join(ws, "source.wav"), "x");
  await writeFile(path.join(ws, "render.wav"), "x");
  storage = new FakeStorage();
  analyzer = new WritingAnalyzer();
});

afterEach(async () => {
  await rm(path.dirname(ws), { recursive: true, force: true });
});

describe("exportReplayRun", () => {
  it("writes a valid run.json, the MP3s and index.json", async () => {
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z", 2);
    const result = await run(TASK_ID, "My loop");

    expect((await readdir(path.join(out, TASK_ID))).sort()).toEqual([
      "render-1.mp3",
      "render-2.mp3",
      "run.json",
      "source.mp3",
    ]);
    const parsed = ReplayRunSchema.parse(JSON.parse(await readFile(path.join(out, TASK_ID, "run.json"), "utf8")));
    expect(parsed.title).toBe("My loop");
    expect(parsed.verifications.map((v) => v.render.file)).toEqual(["render-1.mp3", "render-2.mp3"]);
    expect(parsed.steps.map((s) => s.step)).toEqual([1, 2]);
    expect(parsed.steps[0]).not.toHaveProperty("taskId");
    expect(parsed.steps[0]).not.toHaveProperty("cacheHits");

    const bpms = analyzer.calls.map((c) => [path.basename(c.path), c.options?.targetBpm]);
    expect(bpms).toEqual([["source.wav", undefined], ["render.wav", 170]]); // same render file: second is a cache hit

    const index = ReplayIndexSchema.parse(JSON.parse(await readFile(path.join(out, "index.json"), "utf8")));
    expect(index.runs).toEqual([
      { taskId: TASK_ID, title: "My loop", createdAt: "2026-01-01T00:00:00.000Z", pass: true, attempts: 2 },
    ]);
    expect(result.files.map((f) => f.path)).toContain("index.json");
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it("defaults the title to the request and orders the index newest first", async () => {
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z");
    await seed(OTHER_ID, "source.wav", "2026-02-01T00:00:00.000Z");
    await run(TASK_ID);
    await run(OTHER_ID);
    const index = ReplayIndexSchema.parse(JSON.parse(await readFile(path.join(out, "index.json"), "utf8")));
    expect(index.runs.map((r) => r.taskId)).toEqual([OTHER_ID, TASK_ID]);
    expect(index.runs[1]?.title).toBe("Make a loop at 170 BPM");
  });

  it("rejects a source outside the workspace and writes nothing", async () => {
    await writeFile(path.join(path.dirname(ws), "outside.wav"), "x");
    await seed(TASK_ID, "../outside.wav", "2026-01-01T00:00:00.000Z");
    await expect(run()).rejects.toMatchObject({ code: "path_outside_workspace" });
    await expect(readdir(out)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails for an unknown task and for one without verifications", async () => {
    await expect(run()).rejects.toThrow(/task not found/);
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z", 0);
    await expect(run()).rejects.toThrow(/no verifications/);
    await expect(readdir(out)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces the folder when exported again", async () => {
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z");
    await run();
    await writeFile(path.join(out, TASK_ID, "stale.txt"), "old");
    await run();
    expect(await readdir(path.join(out, TASK_ID))).not.toContain("stale.txt");
    expect((await readdir(out)).sort()).toEqual([TASK_ID, "index.json"]);
  });

  it("keeps the previous export and cleans up when the analyzer fails", async () => {
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z");
    await run();
    analyzer.error = new Error("boom");
    await expect(run()).rejects.toThrow("boom");
    expect((await readdir(out)).sort()).toEqual([TASK_ID, "index.json"]);
    expect(await readdir(path.join(out, TASK_ID))).toContain("run.json");
  });

  it("leaves no absolute workspace paths in run.json", async () => {
    await seed(TASK_ID, "source.wav", "2026-01-01T00:00:00.000Z");
    await run();
    const text = await readFile(path.join(out, TASK_ID, "run.json"), "utf8");
    expect(text).not.toContain(ws);
    expect(text).toContain("see render.wav");
  });
});
