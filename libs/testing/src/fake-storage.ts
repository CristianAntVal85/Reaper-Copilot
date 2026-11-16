import {
  AudioFeaturesSchema,
  ToolCallTraceSchema,
  type AnalysisCacheKey,
  type AudioFeatures,
  type StoragePort,
  type ToolCallTrace,
} from "@reaper-copilot/core";

export type StorageCall =
  | { readonly method: "getCachedAnalysis"; readonly key: AnalysisCacheKey }
  | {
      readonly method: "putCachedAnalysis";
      readonly key: AnalysisCacheKey;
      readonly features: AudioFeatures;
    }
  | { readonly method: "recordToolCall"; readonly trace: ToolCallTrace }
  | { readonly method: "listToolCalls"; readonly options: { limit?: number } | undefined };

/** Per-method failures. A set error makes that method reject (after the call is logged). */
export interface StorageErrors {
  get?: Error | undefined;
  put?: Error | undefined;
  record?: Error | undefined;
  list?: Error | undefined;
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

  constructor(init: { errors?: StorageErrors } = {}) {
    this.errors = init.errors ?? {};
  }

  /** Recorded traces, oldest first (the order `recordToolCall` was called). */
  get traces(): readonly ToolCallTrace[] {
    return this.#traces;
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
}

function cacheId(key: AnalysisCacheKey): string {
  return JSON.stringify([key.sha256, key.targetBpm, key.revision]);
}

/** Deep copy of JSON-shaped data (the packages here build without Node's `structuredClone` types). */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
