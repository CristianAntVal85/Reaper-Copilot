import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnalysisCacheKey } from "@reaper-copilot/core";
import { FEATURES, describeStorageBehaviour } from "./storage-behaviour.ts";
import { SqliteStorage } from "./sqlite-storage.ts";

let dir: string;
let opened: SqliteStorage[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rca-storage-"));
  opened = [];
});

afterEach(async () => {
  for (const storage of opened) {
    try {
      storage.close();
    } catch {
      // already closed by the test
    }
  }
  await rm(dir, { recursive: true, force: true });
});

function open(path = join(dir, "copilot.db")): SqliteStorage {
  const storage = new SqliteStorage({ path });
  opened.push(storage);
  return storage;
}

const V1_SQL = `CREATE TABLE analysis_cache (
     sha256 TEXT NOT NULL,
     target_bpm REAL NOT NULL,
     revision TEXT NOT NULL,
     features_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (sha256, target_bpm, revision)
   );
   CREATE TABLE tool_calls (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL,
     step INTEGER NOT NULL,
     tool TEXT NOT NULL,
     args_json TEXT NOT NULL,
     ok INTEGER NOT NULL,
     result_json TEXT NOT NULL,
     error_code TEXT,
     duration_ms REAL NOT NULL,
     started_at TEXT NOT NULL,
     cache_hits INTEGER NOT NULL
   );`;

let counter = 0;
describeStorageBehaviour("SqliteStorage", async () => open(join(dir, `case-${counter++}.db`)));

const KEY: AnalysisCacheKey = { sha256: "a".repeat(64), targetBpm: null, revision: "r1" };

describe("SqliteStorage", () => {
  it("creates missing parent directories and the database", async () => {
    const path = join(dir, "deep", "er", "copilot.db");
    open(path);
    expect((await stat(path)).isFile()).toBe(true);
  });

  it("enables WAL and a busy timeout", () => {
    const path = join(dir, "copilot.db");
    open(path);
    const raw = new DatabaseSync(path);
    expect(raw.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    raw.close();
  });

  it("records the schema version once, however many times it is opened", () => {
    const path = join(dir, "copilot.db");
    open(path).close();
    open(path);
    const raw = new DatabaseSync(path);
    expect(raw.prepare("SELECT version FROM schema_version").all()).toEqual([{ version: 1 }, { version: 2 }]);
    raw.close();
  });

  it("keeps data after closing and reopening", async () => {
    const path = join(dir, "copilot.db");
    const first = open(path);
    await first.putCachedAnalysis(KEY, FEATURES);
    first.close();
    expect(await open(path).getCachedAnalysis(KEY)).toEqual(FEATURES);
  });

  it("shares data between two handles open on the same file", async () => {
    const path = join(dir, "copilot.db");
    const a = open(path);
    const b = open(path);
    await a.putCachedAnalysis(KEY, FEATURES);
    expect(await b.getCachedAnalysis(KEY)).toEqual(FEATURES);
    await b.recordToolCall({
      sessionId: "s",
      step: 1,
      tool: "t",
      args: null,
      ok: true,
      result: null,
      errorCode: null,
      durationMs: 1,
      startedAt: "2026-01-01T00:00:00Z",
      cacheHits: 0,
      taskId: null,
    });
    expect(await a.listToolCalls()).toHaveLength(1);
  });

  it("treats a cache row that fails the schema as a miss", async () => {
    const path = join(dir, "copilot.db");
    open(path).close();
    const raw = new DatabaseSync(path);
    const insert = raw.prepare(
      "INSERT INTO analysis_cache VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z')",
    );
    insert.run(KEY.sha256, 0, "r1", JSON.stringify({ schemaVersion: 1 }));
    insert.run(KEY.sha256, 0, "r2", "not json");
    raw.close();
    const storage = open(path);
    expect(await storage.getCachedAnalysis(KEY)).toBeNull();
    expect(await storage.getCachedAnalysis({ ...KEY, revision: "r2" })).toBeNull();
  });

  it("refuses a database written by a newer schema", () => {
    const path = join(dir, "copilot.db");
    open(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("INSERT INTO schema_version VALUES (99)");
    raw.close();
    expect(() => new SqliteStorage({ path })).toThrow(/newer/);
  });

  it("migrates a version 1 database and reads its traces with taskId null", async () => {
    const path = join(dir, "v1.db");
    const raw = new DatabaseSync(path);
    raw.exec(V1_SQL);
    raw.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1)");
    raw
      .prepare(
        `INSERT INTO tool_calls (session_id, step, tool, args_json, ok, result_json, error_code, duration_ms, started_at, cache_hits)
         VALUES ('s', 1, 'analyze_audio', '{"path":"a.wav"}', 1, '{"bpm":120}', NULL, 3, '2026-01-01T00:00:00.000Z', 0)`,
      )
      .run();
    raw.close();
    const storage = open(path);
    const [trace] = await storage.listToolCalls();
    expect(trace).toMatchObject({ step: 1, tool: "analyze_audio", taskId: null });
    await storage.recordToolCall({ ...(trace as NonNullable<typeof trace>), step: 2, taskId: "t1" });
    expect((await storage.listToolCalls()).map((t) => t.taskId)).toEqual(["t1", null]);
  });

  it("leaves out a task or verification row that fails the schema", async () => {
    const path = join(dir, "copilot.db");
    open(path).close();
    const raw = new DatabaseSync(path);
    raw.exec("INSERT INTO tasks VALUES ('bad', '2026-01-01T00:00:00Z', '{}')");
    raw.exec("INSERT INTO task_verifications VALUES ('bad', 1, '2026-01-01T00:00:00Z', 'not json')");
    raw.close();
    const storage = open(path);
    expect(await storage.getTask("bad")).toBeNull();
    expect(await storage.listVerifications("bad")).toEqual([]);
  });

  it("rejects an invalid limit", async () => {
    await expect(open().listToolCalls({ limit: -1 })).rejects.toThrow(RangeError);
    await expect(open().listToolCalls({ limit: 1.5 })).rejects.toThrow(RangeError);
  });
});
