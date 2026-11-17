import type { AssetPath } from "./asset-path.ts";
import type {
  AppliedFxChain,
  DawItem,
  FxChain,
  ItemId,
  JobId,
  JobStatus,
  ProjectState,
  SliceSpec,
  StretchSpec,
  TrackId,
  TrackRef,
} from "./daw.ts";
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

export interface DawPort {
  getProjectState(): Promise<ProjectState>;
  setTempo(bpm: number): Promise<{ tempo: number }>;
  importAudio(path: AssetPath): Promise<{ track: TrackRef; item: DawItem }>;
  sliceByBars(item: ItemId, spec: SliceSpec): Promise<DawItem>;
  stretchToTempo(item: ItemId, spec: StretchSpec): Promise<DawItem>;
  applyFxChain(track: TrackId, chain: FxChain): Promise<AppliedFxChain>;
  render(item: ItemId, output: AssetPath): Promise<JobId>;
  getJob(job: JobId): Promise<JobStatus>;
  undo(): Promise<{ undone: string }>;
}
