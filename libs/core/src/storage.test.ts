import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CACHE_REVISION,
  AnalysisCacheKeySchema,
  ToolCallTraceSchema,
  type StoragePort,
} from "./index.ts";

const okTrace = {
  sessionId: "7f0c2b0e-5c4e-4a4b-9a55-0d6a3d1a9e11",
  step: 1,
  tool: "analyze_audio",
  args: { path: "demo/a.mp3" },
  ok: true,
  result: { schemaVersion: 2 },
  errorCode: null,
  durationMs: 12.5,
  startedAt: "2026-11-16T10:00:00.000Z",
  cacheHits: 0,
  taskId: null,
};

const failedTrace = { ...okTrace, ok: false, result: null, errorCode: "file_not_found" };

describe("AnalysisCacheKeySchema", () => {
  const key = { sha256: "a".repeat(64), targetBpm: null, revision: ANALYSIS_CACHE_REVISION };

  it("accepts a key with and without target", () => {
    expect(AnalysisCacheKeySchema.safeParse(key).success).toBe(true);
    expect(AnalysisCacheKeySchema.safeParse({ ...key, targetBpm: 190 }).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["bad sha256", { ...key, sha256: "xyz" }],
    ["zero target", { ...key, targetBpm: 0 }],
    ["missing target", { sha256: key.sha256, revision: key.revision }],
    ["empty revision", { ...key, revision: "" }],
    ["empty taskId", { ...okTrace, taskId: "" }],
    ["extra field", { ...key, extra: 1 }],
  ])("rejects %s", (_name, value) => {
    expect(AnalysisCacheKeySchema.safeParse(value).success).toBe(false);
  });

  it("builds the revision from the schema version and the analysis revision", () => {
    expect(ANALYSIS_CACHE_REVISION).toBe("2.1");
  });
});

describe("ToolCallTraceSchema", () => {
  it("accepts successful and failed traces", () => {
    expect(ToolCallTraceSchema.safeParse(okTrace).success).toBe(true);
    expect(ToolCallTraceSchema.safeParse(failedTrace).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["step 0", { ...okTrace, step: 0 }],
    ["negative duration", { ...okTrace, durationMs: -1 }],
    ["non ISO date", { ...okTrace, startedAt: "yesterday" }],
    ["negative cacheHits", { ...okTrace, cacheHits: -1 }],
    ["missing tool", { ...okTrace, tool: undefined }],
    ["extra field", { ...okTrace, cause: "boom" }],
    ["ok with errorCode", { ...okTrace, errorCode: "analysis_failed" }],
    ["failed without errorCode", { ...failedTrace, errorCode: null }],
    ["failed with result", { ...failedTrace, result: { a: 1 } }],
  ])("rejects %s", (_name, value) => {
    expect(ToolCallTraceSchema.safeParse(value).success).toBe(false);
  });
});

describe("StoragePort", () => {
  it("can be implemented with the contract types", () => {
    const port: StoragePort = {
      getCachedAnalysis: () => Promise.resolve(null),
      putCachedAnalysis: () => Promise.resolve(),
      recordToolCall: () => Promise.resolve(),
      listToolCalls: () => Promise.resolve([]),
      createTask: () => Promise.resolve(),
      getTask: () => Promise.resolve(null),
      recordVerification: (v) => Promise.resolve({ ...v, attempt: 1 }),
      listVerifications: () => Promise.resolve([]),
    };
    expect(typeof port.listToolCalls).toBe("function");
  });
});
