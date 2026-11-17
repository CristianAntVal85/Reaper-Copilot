import { describe, expect, it } from "vitest";
import {
  AudioFeaturesSchema,
  type AnalysisCacheKey,
  type StoragePort,
  type Task,
  type ToolCallTrace,
  type Verification,
} from "@reaper-copilot/core";

// This adapter may depend only on core, so it cannot import FakeStorage's suite from
// @reaper-copilot/testing. libs/testing/src/storage-behaviour.ts holds the same suite: keep both
// in sync.

export const FEATURES = AudioFeaturesSchema.parse({
  schemaVersion: 2,
  file: { sha256: "a".repeat(64), durationSec: 12.5, sampleRate: 44100, channels: 2 },
  tempo: { bpm: 120, confidence: 0.9, alternatives: [60, 240], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.8 },
  loudness: { integratedLufs: -14, peakDb: -1 },
  bands: { sub: -30, bass: -20, lowMid: -22, mid: -24, highMid: -28, high: -35 },
  dynamics: { crestFactorDb: 12 },
});

const KEY: AnalysisCacheKey = { sha256: "a".repeat(64), targetBpm: null, revision: "r1" };

function trace(step: number, overrides: Partial<ToolCallTrace> = {}): ToolCallTrace {
  return {
    sessionId: "s1",
    step,
    tool: "analyze_audio",
    args: { path: "a.wav", nested: [1, null, "x"] },
    ok: true,
    result: { bpm: 120 },
    errorCode: null,
    durationMs: 12.5,
    startedAt: "2026-01-01T00:00:00.000Z",
    cacheHits: 0,
    taskId: null,
    ...overrides,
  };
}

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function task(overrides: Partial<Task> = {}): Task {
  return {
    taskId: TASK_ID,
    createdAt: "2026-01-01T00:00:00.000Z",
    request: "make it 170 bpm",
    source: "loop.wav",
    target: { bpm: 170 },
    criteria: [
      { id: "tempo", derived: true, metric: "tempo.bpm", basis: "absolute", min: 169, max: 171 },
    ],
    ...overrides,
  };
}

function verification(attempt: number, overrides: Partial<Verification> = {}): Verification {
  return {
    taskId: TASK_ID,
    attempt,
    verifiedAt: "2026-01-01T00:01:00.000Z",
    render: { path: "out/render.wav", sha256: "c".repeat(64) },
    pass: true,
    results: [
      {
        id: "tempo",
        derived: true,
        metric: "tempo.bpm",
        basis: "absolute",
        status: "pass",
        measured: 170,
        min: 169,
        max: 171,
        sourceValue: null,
        renderValue: null,
      },
    ],
    ...overrides,
  };
}

/** Behaviour every `StoragePort` implementation must have. */
export function describeStorageBehaviour(name: string, create: () => Promise<StoragePort>): void {
  describe(`${name} StoragePort behaviour`, () => {
    it("returns null for a missing analysis", async () => {
      const storage = await create();
      expect(await storage.getCachedAnalysis(KEY)).toBeNull();
    });

    it("returns what was stored", async () => {
      const storage = await create();
      await storage.putCachedAnalysis(KEY, FEATURES);
      expect(await storage.getCachedAnalysis(KEY)).toEqual(FEATURES);
    });

    it("overwrites the same key", async () => {
      const storage = await create();
      const other = { ...FEATURES, tempo: { ...FEATURES.tempo, bpm: 100 } };
      await storage.putCachedAnalysis(KEY, FEATURES);
      await storage.putCachedAnalysis(KEY, other);
      expect(await storage.getCachedAnalysis(KEY)).toEqual(other);
    });

    it("keeps keys that differ in sha256, targetBpm (null included) or revision apart", async () => {
      const storage = await create();
      const keys: AnalysisCacheKey[] = [
        KEY,
        { ...KEY, targetBpm: 120 },
        { ...KEY, targetBpm: 121 },
        { ...KEY, revision: "r2" },
        { ...KEY, sha256: "b".repeat(64) },
      ];
      for (const [i, key] of keys.entries()) {
        await storage.putCachedAnalysis(key, { ...FEATURES, tempo: { ...FEATURES.tempo, bpm: 100 + i } });
      }
      for (const [i, key] of keys.entries()) {
        expect((await storage.getCachedAnalysis(key))?.tempo.bpm).toBe(100 + i);
      }
      expect(await storage.getCachedAnalysis({ ...KEY, targetBpm: 122 })).toBeNull();
    });

    it("lists no calls on an empty store", async () => {
      const storage = await create();
      expect(await storage.listToolCalls()).toEqual([]);
    });

    it("lists calls most recent first and honours limit", async () => {
      const storage = await create();
      for (const step of [1, 2, 3]) await storage.recordToolCall(trace(step));
      expect((await storage.listToolCalls()).map((t) => t.step)).toEqual([3, 2, 1]);
      expect((await storage.listToolCalls({ limit: 2 })).map((t) => t.step)).toEqual([3, 2]);
      expect(await storage.listToolCalls({ limit: 0 })).toEqual([]);
    });

    it("round-trips successful and failed traces", async () => {
      const storage = await create();
      const failed = trace(2, { ok: false, result: null, errorCode: "invalid_input", cacheHits: 1 });
      await storage.recordToolCall(trace(1));
      await storage.recordToolCall(failed);
      expect(await storage.listToolCalls()).toEqual([failed, trace(1)]);
    });

    it("rejects an invalid trace without storing it", async () => {
      const storage = await create();
      await expect(storage.recordToolCall(trace(1, { errorCode: "oops" }))).rejects.toThrow();
      await expect(storage.recordToolCall(trace(0))).rejects.toThrow();
      expect(await storage.listToolCalls()).toEqual([]);
    });

    it("round-trips a trace attributed to a task", async () => {
      const storage = await create();
      const attributed = trace(1, { taskId: TASK_ID });
      await storage.recordToolCall(attributed);
      expect(await storage.listToolCalls()).toEqual([attributed]);
    });

    it("creates and reads a task; an unknown one is null", async () => {
      const storage = await create();
      expect(await storage.getTask(TASK_ID)).toBeNull();
      await storage.createTask(task());
      expect(await storage.getTask(TASK_ID)).toEqual(task());
      expect(await storage.getTask("22222222-2222-4222-8222-222222222222")).toBeNull();
    });

    it("rejects a repeated taskId and keeps the first task", async () => {
      const storage = await create();
      await storage.createTask(task());
      await expect(storage.createTask(task({ request: "other" }))).rejects.toThrow();
      expect(await storage.getTask(TASK_ID)).toEqual(task());
    });

    it("rejects a task outside the schema without storing it", async () => {
      const storage = await create();
      await expect(storage.createTask(task({ criteria: [] }))).rejects.toThrow();
      await expect(storage.createTask(task({ taskId: "not-a-uuid" }))).rejects.toThrow();
      expect(await storage.getTask(TASK_ID)).toBeNull();
    });

    it("lists verifications by ascending attempt, per task", async () => {
      const storage = await create();
      const other = "22222222-2222-4222-8222-222222222222";
      await storage.recordVerification(verification(2, { pass: false }));
      await storage.recordVerification(verification(1));
      await storage.recordVerification(verification(1, { taskId: other }));
      expect(await storage.listVerifications(TASK_ID)).toEqual([
        verification(1),
        verification(2, { pass: false }),
      ]);
      expect(await storage.listVerifications("33333333-3333-4333-8333-333333333333")).toEqual([]);
    });

    it("rejects a repeated attempt and a verification outside the schema", async () => {
      const storage = await create();
      await storage.recordVerification(verification(1));
      await expect(storage.recordVerification(verification(1, { pass: false }))).rejects.toThrow();
      await expect(storage.recordVerification(verification(0))).rejects.toThrow();
      await expect(
        storage.recordVerification(verification(2, { render: { path: "", sha256: "x" } })),
      ).rejects.toThrow();
      expect(await storage.listVerifications(TASK_ID)).toEqual([verification(1)]);
    });
  });
}
