import type { AssetPath } from "./asset-path.ts";
import type { AudioFeatures } from "./audio-features.ts";

export interface AnalyzeOptions {
  targetBpm?: number;
}

export interface AnalyzerPort {
  analyze(path: AssetPath, options?: AnalyzeOptions): Promise<AudioFeatures>;
}
