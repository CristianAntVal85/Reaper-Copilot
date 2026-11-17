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
import type { Task, Verification } from "./task.ts";
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
  /** Rejects a task that fails `TaskSchema` or whose `taskId` already exists. */
  createTask(task: Task): Promise<void>;
  getTask(taskId: string): Promise<Task | null>;
  /** Rejects a verification that fails `VerificationSchema` or repeats a `(taskId, attempt)`. */
  recordVerification(verification: Verification): Promise<void>;
  /** Ascending `attempt`. */
  listVerifications(taskId: string): Promise<Verification[]>;
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
