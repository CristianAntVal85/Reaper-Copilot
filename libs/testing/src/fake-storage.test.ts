import { describe, expect, it } from "vitest";
import { SAMPLE_AUDIO_FEATURES } from "./fake-analyzer.ts";
import { FakeStorage } from "./fake-storage.ts";
import { describeStorageBehaviour } from "./storage-behaviour.ts";

describeStorageBehaviour("FakeStorage", async () => new FakeStorage());

const KEY = { sha256: "a".repeat(64), targetBpm: null, revision: "r1" };

describe("FakeStorage", () => {
  it("logs every call, in order", async () => {
    const storage = new FakeStorage();
    await storage.getCachedAnalysis(KEY);
    await storage.putCachedAnalysis(KEY, SAMPLE_AUDIO_FEATURES);
    await storage.listToolCalls({ limit: 1 });
    expect(storage.calls.map((c) => c.method)).toEqual([
      "getCachedAnalysis",
      "putCachedAnalysis",
      "listToolCalls",
    ]);
  });

  it("fails per method while an error is set, and recovers when it is cleared", async () => {
    const storage = new FakeStorage({ errors: { get: new Error("boom") } });
    await expect(storage.getCachedAnalysis(KEY)).rejects.toThrow("boom");
    await expect(storage.putCachedAnalysis(KEY, SAMPLE_AUDIO_FEATURES)).resolves.toBeUndefined();
    storage.errors.get = undefined;
    expect(await storage.getCachedAnalysis(KEY)).toEqual(SAMPLE_AUDIO_FEATURES);
    storage.errors.record = new Error("disk full");
    await expect(
      storage.recordToolCall({
        sessionId: "s",
        step: 1,
        tool: "t",
        args: null,
        ok: true,
        result: null,
        errorCode: null,
        durationMs: 0,
        startedAt: "2026-01-01T00:00:00Z",
        cacheHits: 0,
        taskId: null,
      }),
    ).rejects.toThrow("disk full");
    expect(storage.traces).toEqual([]);
  });
});
