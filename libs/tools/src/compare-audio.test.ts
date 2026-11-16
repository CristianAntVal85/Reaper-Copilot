import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FeatureDiffSchema, type AudioFeatures } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compareAudio, CompareAudioInputSchema } from "./compare-audio.ts";
import { createToolSession, invokeTool, type ToolSession } from "./invoke-tool.ts";
import type { ToolContext } from "./tool-definition.ts";
import { ALL_TOOLS } from "./tools.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-compare-")));
  // Different bytes: the cache is keyed by content hash.
  await writeFile(path.join(ws, "v1.wav"), "one");
  await writeFile(path.join(ws, "v2.wav"), "two");
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const louder: AudioFeatures = {
  ...SAMPLE_AUDIO_FEATURES,
  file: { ...SAMPLE_AUDIO_FEATURES.file, sha256: "b".repeat(64) },
  loudness: { integratedLufs: -9, peakDb: -0.5 },
};

let analyzer: FakeAnalyzer;
let storage: FakeStorage;
let ctx: ToolContext;
let session: ToolSession;

beforeEach(() => {
  analyzer = new FakeAnalyzer({
    resultFor: (p) => (p === path.join(ws, "v2.wav") ? louder : SAMPLE_AUDIO_FEATURES),
  });
  storage = new FakeStorage();
  ctx = { workspaceRoot: ws, analyzer, storage, log: () => {} };
  session = createToolSession("session-1");
});

const compare = (input: unknown) => invokeTool(compareAudio, input, ctx, session);

describe("compare_audio", () => {
  it("is a read tool and part of ALL_TOOLS", () => {
    expect(compareAudio.risk).toBe("read");
    expect(ALL_TOOLS).toContain(compareAudio);
  });

  it("returns a valid diff with delta = b - a, no absolute paths", async () => {
    const result = await compare({ a: { path: "v1.wav" }, b: { path: "v2.wav" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diff = FeatureDiffSchema.parse(result.output);
    expect(diff.a.path).toBe("v1.wav");
    expect(diff.b.path).toBe("v2.wav");
    expect(diff.metrics["loudness.integratedLufs"]).toEqual({ a: -14, b: -9, delta: 5 });
    expect(JSON.stringify(result.output)).not.toContain(ws);
  });

  it.each([
    ["a", { a: { path: "../outside.wav" }, b: { path: "v2.wav" } }],
    ["b", { a: { path: "v1.wav" }, b: { path: "../outside.wav" } }],
  ])("rejects a path outside the workspace in %s without calling the analyzer", async (_side, input) => {
    const result = await compare(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/^path_outside_workspace: /);
    expect(storage.traces[0]?.errorCode).toBe("path_outside_workspace");
    expect(analyzer.calls).toEqual([]);
  });

  it("passes each targetBpm to its own analysis", async () => {
    await compare({ a: { path: "v1.wav", targetBpm: 100 }, b: { path: "v2.wav" } });
    expect(analyzer.calls).toEqual([
      { path: path.join(ws, "v1.wav"), options: { targetBpm: 100 } },
      { path: path.join(ws, "v2.wav"), options: {} },
    ]);
  });

  it("serves a repeated comparison from the cache and traces two hits", async () => {
    await compare({ a: { path: "v1.wav" }, b: { path: "v2.wav" } });
    expect(analyzer.calls).toHaveLength(2);
    const again = await compare({ a: { path: "v1.wav" }, b: { path: "v2.wav" } });
    expect(again.ok).toBe(true);
    expect(analyzer.calls).toHaveLength(2);
    expect(storage.traces.map((t) => t.cacheHits)).toEqual([0, 2]);
  });

  it("rejects unknown or invalid input", () => {
    const ok = { a: { path: "a.wav" }, b: { path: "b.wav" } };
    expect(CompareAudioInputSchema.safeParse(ok).success).toBe(true);
    expect(CompareAudioInputSchema.safeParse({ ...ok, c: 1 }).success).toBe(false);
    expect(CompareAudioInputSchema.safeParse({ a: ok.a }).success).toBe(false);
    expect(
      CompareAudioInputSchema.safeParse({ ...ok, b: { path: "b.wav", targetBpm: 999 } }).success,
    ).toBe(false);
  });
});
