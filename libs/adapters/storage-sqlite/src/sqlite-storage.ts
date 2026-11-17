import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  AudioFeaturesSchema,
  TaskSchema,
  ToolCallTraceSchema,
  VerificationSchema,
  type AnalysisCacheKey,
  type AudioFeatures,
  type StoragePort,
  type Task,
  type ToolCallTrace,
  type Verification,
} from "@reaper-copilot/core";

/**
 * SQLite treats NULL as distinct from NULL inside primary keys, so a null `targetBpm` is stored
 * as this sentinel. Real targets are strictly positive (`AnalysisCacheKeySchema`).
 */
const NO_TARGET_BPM = 0;

/** Append-only. Each entry runs once, in order, inside a transaction. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE analysis_cache (
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
   );`,
  `CREATE TABLE tasks (
     task_id TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     task_json TEXT NOT NULL
   );
   CREATE TABLE task_verifications (
     task_id TEXT NOT NULL,
     attempt INTEGER NOT NULL,
     verified_at TEXT NOT NULL,
     verification_json TEXT NOT NULL,
     UNIQUE (task_id, attempt)
   );
   ALTER TABLE tool_calls ADD COLUMN task_id TEXT;`,
];

export interface SqliteStorageOptions {
  /** Database file. Missing parent directories are created. `:memory:` is accepted. */
  path: string;
}

interface ToolCallRow {
  session_id: string;
  step: number;
  tool: string;
  args_json: string;
  ok: number;
  result_json: string;
  error_code: string | null;
  duration_ms: number;
  started_at: string;
  cache_hits: number;
  task_id: string | null;
}

/**
 * `StoragePort` on `node:sqlite`. Statements are prepared once; nothing is interpolated into SQL.
 * Reads are validated with the core schemas: an invalid cache row is a miss, an invalid trace row
 * is left out of `listToolCalls`.
 */
export class SqliteStorage implements StoragePort {
  readonly #db: DatabaseSync;
  readonly #getCache: StatementSync;
  readonly #putCache: StatementSync;
  readonly #insertCall: StatementSync;
  readonly #listCalls: StatementSync;
  readonly #listCallsByTask: StatementSync;
  readonly #insertTask: StatementSync;
  readonly #getTask: StatementSync;
  readonly #insertVerification: StatementSync;
  readonly #listVerifications: StatementSync;

  constructor(options: SqliteStorageOptions) {
    if (options.path !== ":memory:") mkdirSync(dirname(options.path), { recursive: true });
    this.#db = new DatabaseSync(options.path);
    try {
      this.#db.exec("PRAGMA busy_timeout = 5000");
      this.#db.exec("PRAGMA journal_mode = WAL");
      migrate(this.#db);
      this.#getCache = this.#db.prepare(
        "SELECT features_json FROM analysis_cache WHERE sha256 = ? AND target_bpm = ? AND revision = ?",
      );
      this.#putCache = this.#db.prepare(
        `INSERT OR REPLACE INTO analysis_cache (sha256, target_bpm, revision, features_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      this.#insertCall = this.#db.prepare(
        `INSERT INTO tool_calls
           (session_id, step, tool, args_json, ok, result_json, error_code, duration_ms, started_at, cache_hits, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      this.#listCalls = this.#db.prepare("SELECT * FROM tool_calls ORDER BY id DESC LIMIT ?");
      this.#listCallsByTask = this.#db.prepare(
        "SELECT * FROM tool_calls WHERE task_id = ? ORDER BY id DESC LIMIT ?",
      );
      this.#insertTask = this.#db.prepare(
        "INSERT INTO tasks (task_id, created_at, task_json) VALUES (?, ?, ?)",
      );
      this.#getTask = this.#db.prepare("SELECT task_json FROM tasks WHERE task_id = ?");
      this.#insertVerification = this.#db.prepare(
        `INSERT INTO task_verifications (task_id, attempt, verified_at, verification_json)
         SELECT ?1, next.attempt, ?2, json_set(?3, '$.attempt', next.attempt)
         FROM (SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM task_verifications WHERE task_id = ?1) AS next
         RETURNING attempt`,
      );
      this.#listVerifications = this.#db.prepare(
        "SELECT verification_json FROM task_verifications WHERE task_id = ? ORDER BY attempt ASC",
      );
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  async getCachedAnalysis(key: AnalysisCacheKey): Promise<AudioFeatures | null> {
    const row = this.#getCache.get(key.sha256, key.targetBpm ?? NO_TARGET_BPM, key.revision);
    if (row === undefined) return null;
    try {
      const parsed = AudioFeaturesSchema.safeParse(JSON.parse(String(row["features_json"])));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async putCachedAnalysis(key: AnalysisCacheKey, features: AudioFeatures): Promise<void> {
    const valid = AudioFeaturesSchema.parse(features);
    this.#putCache.run(
      key.sha256,
      key.targetBpm ?? NO_TARGET_BPM,
      key.revision,
      JSON.stringify(valid),
      new Date().toISOString(),
    );
  }

  async recordToolCall(trace: ToolCallTrace): Promise<void> {
    const t = ToolCallTraceSchema.parse(trace);
    this.#insertCall.run(
      t.sessionId,
      t.step,
      t.tool,
      JSON.stringify(t.args),
      t.ok ? 1 : 0,
      JSON.stringify(t.result),
      t.errorCode,
      t.durationMs,
      t.startedAt,
      t.cacheHits,
      t.taskId,
    );
  }

  async createTask(task: Task): Promise<void> {
    const t = TaskSchema.parse(task);
    this.#insertTask.run(t.taskId, t.createdAt, JSON.stringify(t));
  }

  async getTask(taskId: string): Promise<Task | null> {
    const row = this.#getTask.get(taskId);
    if (row === undefined) return null;
    try {
      const parsed = TaskSchema.safeParse(JSON.parse(String(row["task_json"])));
      if (parsed.success) return parsed.data;
    } catch {
      // falls through to the error below
    }
    // The task exists but cannot be read: that is a defect, not a missing task.
    throw new Error(`stored task ${taskId} is invalid`);
  }

  async recordVerification(verification: Omit<Verification, "attempt">): Promise<Verification> {
    // Validated with a placeholder attempt; the INSERT assigns the real one from the raw rows.
    const v = VerificationSchema.parse({ ...verification, attempt: 1 });
    const row = this.#insertVerification.get(v.taskId, v.verifiedAt, JSON.stringify(v));
    if (row === undefined) throw new Error("verification was not stored");
    return VerificationSchema.parse({ ...v, attempt: Number(row["attempt"]) });
  }

  async listVerifications(taskId: string): Promise<Verification[]> {
    const out: Verification[] = [];
    for (const row of this.#listVerifications.all(taskId)) {
      try {
        const parsed = VerificationSchema.safeParse(JSON.parse(String(row["verification_json"])));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // invalid row: left out
      }
    }
    return out;
  }

  async listToolCalls(options: { limit?: number; taskId?: string } = {}): Promise<ToolCallTrace[]> {
    const limit = options.limit ?? -1; // SQLite: a negative LIMIT means no limit.
    if (options.limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new RangeError("limit must be a non-negative integer");
    }
    const traces: ToolCallTrace[] = [];
    const rows =
      options.taskId === undefined
        ? this.#listCalls.all(limit)
        : this.#listCallsByTask.all(options.taskId, limit);
    for (const row of rows as unknown as ToolCallRow[]) {
      const trace = rowToTrace(row);
      if (trace) traces.push(trace);
    }
    return traces;
  }

  close(): void {
    this.#db.close();
  }
}

function rowToTrace(row: ToolCallRow): ToolCallTrace | null {
  try {
    const parsed = ToolCallTraceSchema.safeParse({
      sessionId: row.session_id,
      step: row.step,
      tool: row.tool,
      args: JSON.parse(row.args_json),
      ok: row.ok === 1,
      result: JSON.parse(row.result_json),
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      startedAt: row.started_at,
      cacheHits: row.cache_hits,
      taskId: row.task_id,
    });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function migrate(db: DatabaseSync): void {
  // BEGIN IMMEDIATE serialises concurrent first opens of the same file.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const row = db.prepare("SELECT MAX(version) AS version FROM schema_version").get();
    const current = Number(row?.["version"] ?? 0);
    if (current > MIGRATIONS.length) {
      throw new Error(
        `Database schema version ${current} is newer than this build supports (${MIGRATIONS.length})`,
      );
    }
    for (let version = current + 1; version <= MIGRATIONS.length; version++) {
      db.exec(MIGRATIONS[version - 1] as string);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(version);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
