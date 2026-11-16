import type { AssetPath } from "./asset-path.ts";
import type { AudioFeatures } from "./audio-features.ts";
import type { AnalysisCacheKey, ToolCallTrace } from "./storage.ts";

export interface AnalyzeOptions {
  targetBpm?: number;
}

export interface AnalyzerPort {
  analyze(path: AssetPath, options?: AnalyzeOptions): Promise<AudioFeatures>;
}

export interface StoragePort {
  getCachedAnalysis(key: AnalysisCacheKey): Promise<AudioFeatures | null>;
  putCachedAnalysis(key: AnalysisCacheKey, features: AudioFeatures): Promise<void>;
  recordToolCall(trace: ToolCallTrace): Promise<void>;
  /** Most recent first. */
  listToolCalls(options?: { limit?: number }): Promise<ToolCallTrace[]>;
}
