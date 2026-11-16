import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ANALYSIS_CACHE_REVISION, asAssetPath, CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage, SAMPLE_AUDIO_FEATURES } from "@reaper-copilot/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyzeWithCache } from "./analyze-with-cache.ts";
import type { ToolContext } from "./tool-definition.ts";

let ws: string;
let file: ReturnType<typeof asAssetPath>;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-cache-")));
  file = asAssetPath(path.join(ws, "song.wav"));
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

let analyzer: FakeAnalyzer;
let storage: FakeStorage;
let logs: string[];
let hits: number;
let ctx: ToolContext;

beforeEach(async () => {
  await writeFile(file, "audio-bytes");
  analyzer = new FakeAnalyzer();
  storage = new FakeStorage();
  logs = [];
  hits = 0;
  ctx = {
    workspaceRoot: ws,
    analyzer,
    storage,
    log: (m) => logs.push(m),
    trace: {
      cacheHit: () => {
        hits += 1;
      },
    },
  };
});

describe("analyzeWithCache", () => {
  it("analyzes on a miss, stores the result and reports no hit", async () => {
    const out = await analyzeWithCache(ctx, file, { targetBpm: 190 });
    expect(out).toEqual({ features: SAMPLE_AUDIO_FEATURES, cacheHit: false });
    expect(analyzer.calls).toEqual([{ path: file, options: { targetBpm: 190 } }]);
    const put = storage.calls.find((c) => c.method === "putCachedAnalysis");
    expect(put).toMatchObject({
      key: { targetBpm: 190, revision: ANALYSIS_CACHE_REVISION },
    });
    expect(hits).toBe(0);
  });

  it("serves the second call from the cache without calling the analyzer", async () => {
    await analyzeWithCache(ctx, file);
    const second = await analyzeWithCache(ctx, file);
    expect(second).toEqual({ features: SAMPLE_AUDIO_FEATURES, cacheHit: true });
    expect(analyzer.calls).toHaveLength(1);
    expect(hits).toBe(1);
  });

  it("keys on the real sha256 of the bytes and null for a missing targetBpm", async () => {
    await analyzeWithCache(ctx, file);
    const expected = createHash("sha256").update("audio-bytes").digest("hex");
    expect(storage.calls[0]).toMatchObject({
      method: "getCachedAnalysis",
      key: { sha256: expected, targetBpm: null, revision: ANALYSIS_CACHE_REVISION },
    });
  });

  it("re-analyzes when one byte of the file changes", async () => {
    await analyzeWithCache(ctx, file);
    await writeFile(file, "audio-bytez");
    const again = await analyzeWithCache(ctx, file);
    expect(again.cacheHit).toBe(false);
    expect(analyzer.calls).toHaveLength(2);
  });

  it("re-analyzes when targetBpm changes", async () => {
    await analyzeWithCache(ctx, file, { targetBpm: 120 });
    expect((await analyzeWithCache(ctx, file, { targetBpm: 121 })).cacheHit).toBe(false);
    expect((await analyzeWithCache(ctx, file)).cacheHit).toBe(false);
    expect((await analyzeWithCache(ctx, file, { targetBpm: 120 })).cacheHit).toBe(true);
    expect(analyzer.calls).toHaveLength(3);
  });

  it("re-analyzes when the cache revision changes", async () => {
    await analyzeWithCache(ctx, file);
    const bumped = await analyzeWithCache(ctx, file, {}, `${ANALYSIS_CACHE_REVISION}-next`);
    expect(bumped.cacheHit).toBe(false);
    expect(analyzer.calls).toHaveLength(2);
  });

  it("re-analyzes when the stored value does not satisfy the schema", async () => {
    const invalid = { ...SAMPLE_AUDIO_FEATURES, schemaVersion: 1 };
    storage.getCachedAnalysis = async () => invalid as never;
    const out = await analyzeWithCache(ctx, file);
    expect(out.cacheHit).toBe(false);
    expect(analyzer.calls).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(hits).toBe(0);
  });

  it("analyzes and logs when the cache read throws", async () => {
    storage.errors.get = new Error("db locked");
    const out = await analyzeWithCache(ctx, file);
    expect(out.cacheHit).toBe(false);
    expect(analyzer.calls).toHaveLength(1);
    expect(logs).toEqual([expect.stringContaining("db locked")]);
  });

  it("returns the analysis and logs when the cache write throws", async () => {
    storage.errors.put = new Error("disk full");
    const out = await analyzeWithCache(ctx, file);
    expect(out).toEqual({ features: SAMPLE_AUDIO_FEATURES, cacheHit: false });
    expect(logs).toEqual([expect.stringContaining("disk full")]);
  });

  it("works without ctx.trace", async () => {
    const bare: ToolContext = { workspaceRoot: ws, analyzer, storage, log: ctx.log };
    await analyzeWithCache(bare, file);
    expect((await analyzeWithCache(bare, file)).cacheHit).toBe(true);
  });

  it("propagates a CopilotError from the analyzer and stores nothing", async () => {
    const error = new CopilotError("analysis_timeout", "too slow");
    analyzer.error = error;
    await expect(analyzeWithCache(ctx, file)).rejects.toBe(error);
    expect(storage.calls.some((c) => c.method === "putCachedAnalysis")).toBe(false);
  });

  it("wraps an unexpected analyzer error as analysis_failed", async () => {
    const cause = new Error("boom");
    analyzer.error = cause;
    await expect(analyzeWithCache(ctx, file)).rejects.toMatchObject({
      code: "analysis_failed",
      cause,
    });
  });

  it("turns an unreadable file into file_not_found without the absolute path", async () => {
    const missing = asAssetPath(path.join(ws, "gone.wav"));
    const failure = analyzeWithCache(ctx, missing);
    await expect(failure).rejects.toMatchObject({ code: "file_not_found" });
    await expect(failure).rejects.not.toThrow(ws);
    expect(analyzer.calls).toEqual([]);
  });
});
