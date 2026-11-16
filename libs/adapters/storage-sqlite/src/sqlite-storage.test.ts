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
    expect(raw.prepare("SELECT version FROM schema_version").all()).toEqual([{ version: 1 }]);
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

  it("rejects an invalid limit", async () => {
    await expect(open().listToolCalls({ limit: -1 })).rejects.toThrow(RangeError);
    await expect(open().listToolCalls({ limit: 1.5 })).rejects.toThrow(RangeError);
  });
});
