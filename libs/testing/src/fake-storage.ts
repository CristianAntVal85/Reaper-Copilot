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

export type StorageCall =
  | { readonly method: "getCachedAnalysis"; readonly key: AnalysisCacheKey }
  | {
      readonly method: "putCachedAnalysis";
      readonly key: AnalysisCacheKey;
      readonly features: AudioFeatures;
    }
  | { readonly method: "recordToolCall"; readonly trace: ToolCallTrace }
  | { readonly method: "listToolCalls"; readonly options: { limit?: number } | undefined }
  | { readonly method: "createTask"; readonly task: Task }
  | { readonly method: "getTask"; readonly taskId: string }
  | { readonly method: "recordVerification"; readonly verification: Verification }
  | { readonly method: "listVerifications"; readonly taskId: string };

/** Per-method failures. A set error makes that method reject (after the call is logged). */
export interface StorageErrors {
  get?: Error | undefined;
  put?: Error | undefined;
  record?: Error | undefined;
  list?: Error | undefined;
  createTask?: Error | undefined;
  getTask?: Error | undefined;
  recordVerification?: Error | undefined;
  listVerifications?: Error | undefined;
}

/**
 * In-memory `StoragePort` with a call log and configurable failures. Like the SQLite adapter, it
 * validates what it stores and returns copies, so a test cannot mutate the "database" by accident.
 */
export class FakeStorage implements StoragePort {
  /** Mutable: set `errors.get = new Error(...)` mid-test to make reads fail, clear it to recover. */
  errors: StorageErrors;
  readonly calls: StorageCall[] = [];
  readonly #cache = new Map<string, AudioFeatures>();
  readonly #traces: ToolCallTrace[] = [];
  readonly #tasks = new Map<string, Task>();
  readonly #verifications: Verification[] = [];

  constructor(init: { errors?: StorageErrors } = {}) {
    this.errors = init.errors ?? {};
  }

  /** Recorded traces, oldest first (the order `recordToolCall` was called). */
  get traces(): readonly ToolCallTrace[] {
    return this.#traces;
  }

  /** Stored tasks, in creation order. */
  get tasks(): readonly Task[] {
    return [...this.#tasks.values()];
  }

  /** Stored verifications, in the order they were recorded. */
  get verifications(): readonly Verification[] {
    return this.#verifications;
  }

  async getCachedAnalysis(key: AnalysisCacheKey): Promise<AudioFeatures | null> {
    this.calls.push({ method: "getCachedAnalysis", key });
    if (this.errors.get) throw this.errors.get;
    const hit = this.#cache.get(cacheId(key));
    return hit ? copy(hit) : null;
  }

  async putCachedAnalysis(key: AnalysisCacheKey, features: AudioFeatures): Promise<void> {
    this.calls.push({ method: "putCachedAnalysis", key, features });
    if (this.errors.put) throw this.errors.put;
    this.#cache.set(cacheId(key), AudioFeaturesSchema.parse(copy(features)));
  }

  async recordToolCall(trace: ToolCallTrace): Promise<void> {
    this.calls.push({ method: "recordToolCall", trace });
    if (this.errors.record) throw this.errors.record;
    this.#traces.push(ToolCallTraceSchema.parse(copy(trace)));
  }

  async listToolCalls(options?: { limit?: number }): Promise<ToolCallTrace[]> {
    this.calls.push({ method: "listToolCalls", options });
    if (this.errors.list) throw this.errors.list;
    const limit = options?.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
      throw new RangeError("limit must be a non-negative integer");
    }
    const newestFirst = [...this.#traces].reverse();
    return copy(limit === undefined ? newestFirst : newestFirst.slice(0, limit));
  }

  async createTask(task: Task): Promise<void> {
    this.calls.push({ method: "createTask", task });
    if (this.errors.createTask) throw this.errors.createTask;
    const valid = TaskSchema.parse(copy(task));
    if (this.#tasks.has(valid.taskId)) throw new Error(`task ${valid.taskId} already exists`);
    this.#tasks.set(valid.taskId, valid);
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.calls.push({ method: "getTask", taskId });
    if (this.errors.getTask) throw this.errors.getTask;
    const task = this.#tasks.get(taskId);
    return task ? copy(task) : null;
  }

  async recordVerification(verification: Verification): Promise<void> {
    this.calls.push({ method: "recordVerification", verification });
    if (this.errors.recordVerification) throw this.errors.recordVerification;
    const valid = VerificationSchema.parse(copy(verification));
    if (this.#verifications.some((v) => v.taskId === valid.taskId && v.attempt === valid.attempt)) {
      throw new Error(`verification ${valid.taskId}#${valid.attempt} already exists`);
    }
    this.#verifications.push(valid);
  }

  async listVerifications(taskId: string): Promise<Verification[]> {
    this.calls.push({ method: "listVerifications", taskId });
    if (this.errors.listVerifications) throw this.errors.listVerifications;
    return copy(
      this.#verifications.filter((v) => v.taskId === taskId).sort((a, b) => a.attempt - b.attempt),
    );
  }
}

function cacheId(key: AnalysisCacheKey): string {
  return JSON.stringify([key.sha256, key.targetBpm, key.revision]);
}

/** Deep copy of JSON-shaped data (the packages here build without Node's `structuredClone` types). */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
