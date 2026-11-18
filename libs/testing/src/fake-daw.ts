import {
  CopilotError,
  type AppliedFxChain,
  type AssetPath,
  type DawItem,
  type DawPort,
  type FxChain,
  type ItemId,
  type JobId,
  type JobStatus,
  type ProjectState,
  type SliceSpec,
  type StretchSpec,
  type TrackId,
  type TrackRef,
} from "@reaper-copilot/core";

export type FakeDawMethod =
  | "getProjectState"
  | "setTempo"
  | "importAudio"
  | "sliceByBars"
  | "stretchToTempo"
  | "applyFxChain"
  | "render"
  | "getJob"
  | "undo";

export interface DawCall {
  readonly method: FakeDawMethod;
  readonly args: readonly unknown[];
}

interface FakeTrack {
  id: string;
  name: string;
  fx: string[];
  items: DawItem[];
}

interface FakeState {
  tempo: number;
  tracks: FakeTrack[];
}

interface FakeJob {
  status: JobStatus;
  durationSec: number;
  output: string;
}

const MIN_RATE = 0.5;
const MAX_RATE = 2;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function guid(n: number): string {
  return `{${"0".repeat(8)}-0000-0000-0000-${n.toString(16).toUpperCase().padStart(12, "0")}}`;
}

/**
 * In-memory `DawPort` with the same semantics as the Reaper bridge: absolute slice and stretch
 * (idempotent), undo blocks labelled `Copilot: `, one render at a time. Render jobs stay in
 * `rendering` until the test calls `completeJob` or `failJob`.
 */
export class FakeDaw implements DawPort {
  readonly calls: DawCall[] = [];
  /** A method listed here rejects with its error (every time, until removed). */
  readonly failures: Partial<Record<FakeDawMethod, Error>> = {};
  /** Source length in seconds per imported path; `defaultSourceLengthSec` otherwise. */
  readonly sourceLengths = new Map<string, number>();
  defaultSourceLengthSec = 60;

  private state: FakeState = { tempo: 120, tracks: [] };
  private readonly undoStack: { label: string; before: FakeState }[] = [];
  private readonly sourceLengthByItem = new Map<string, number>();
  private readonly jobs = new Map<string, FakeJob>();
  private counter = 0;
  private activeJob: string | null = null;

  async getProjectState(): Promise<ProjectState> {
    this.enter("getProjectState", []);
    return this.snapshotState();
  }

  async setTempo(bpm: number): Promise<{ tempo: number }> {
    this.enter("setTempo", [bpm]);
    this.begin("set_tempo");
    this.state.tempo = bpm;
    return { tempo: bpm };
  }

  async importAudio(path: AssetPath): Promise<{ track: TrackRef; item: DawItem }> {
    this.enter("importAudio", [path]);
    this.begin("import_audio");
    const trackId = this.nextId();
    const itemId = this.nextId();
    const length = this.sourceLengths.get(path) ?? this.defaultSourceLengthSec;
    const name = path.split("/").pop() ?? path;
    const item: DawItem = {
      id: itemId,
      trackId,
      positionSec: 0,
      lengthSec: length,
      startOffsetSec: 0,
      playRate: 1,
      source: path,
    };
    this.state.tracks.push({ id: trackId, name, fx: [], items: [item] });
    this.sourceLengthByItem.set(itemId, length);
    return { track: { id: trackId, name }, item: { ...item } };
  }

  async sliceByBars(itemId: ItemId, spec: SliceSpec): Promise<DawItem> {
    this.enter("sliceByBars", [itemId, spec]);
    const item = this.findItem(itemId);
    const beatsPerBar = spec.beatsPerBar ?? 4;
    const offsetSec = spec.offsetSec ?? 0;
    const barSec = (beatsPerBar * 60) / spec.sourceBpm;
    const startOffsetSec = offsetSec + (spec.startBar - 1) * barSec;
    const sourceLength = this.sourceLengthByItem.get(itemId) ?? this.defaultSourceLengthSec;
    if (startOffsetSec + spec.bars * barSec > sourceLength + 1e-9) {
      throw new CopilotError("out_of_range", "the slice goes past the end of the source");
    }
    this.begin("slice_loop");
    item.startOffsetSec = startOffsetSec;
    item.positionSec = 0;
    item.lengthSec = (spec.bars * barSec) / item.playRate;
    return { ...item };
  }

  async stretchToTempo(itemId: ItemId, spec: StretchSpec): Promise<DawItem> {
    this.enter("stretchToTempo", [itemId, spec]);
    const item = this.findItem(itemId);
    const rate = spec.targetBpm / spec.sourceBpm;
    if (rate < MIN_RATE || rate > MAX_RATE) {
      throw new CopilotError("out_of_range", "the playback rate must lie within [0.5, 2]");
    }
    this.begin("time_stretch");
    const lengthAtUnitRate = item.lengthSec * item.playRate;
    item.playRate = rate;
    item.lengthSec = lengthAtUnitRate / rate;
    return { ...item };
  }

  async applyFxChain(trackId: TrackId, chain: FxChain): Promise<AppliedFxChain> {
    this.enter("applyFxChain", [trackId, chain]);
    const track = this.state.tracks.find((t) => t.id === trackId);
    if (!track) throw new CopilotError("track_not_found", "no track with that id");
    this.begin("apply_fx_chain");
    for (const fx of chain) track.fx.push(fx.plugin);
    return {
      trackId,
      fx: chain.map((fx) => ({
        plugin: fx.plugin,
        params: fx.params.map((p) => ({ name: p.name, text: p.value.toFixed(2) })),
        config: (fx.config ?? []).map((c) => ({ name: c.name, value: c.value })),
      })),
    };
  }

  async render(itemId: ItemId, output: AssetPath): Promise<JobId> {
    this.enter("render", [itemId, output]);
    const item = this.findItem(itemId);
    const jobId = `job-${++this.counter}`;
    this.jobs.set(jobId, {
      status: { jobId, status: "rendering", output: null, errorCode: null },
      durationSec: item.lengthSec,
      output,
    });
    this.activeJob = jobId;
    return jobId;
  }

  async getJob(jobId: JobId): Promise<JobStatus> {
    this.enter("getJob", [jobId], false);
    const job = this.jobs.get(jobId);
    if (!job) throw new CopilotError("job_not_found", "no job with that id");
    return job.status;
  }

  async undo(): Promise<{ undone: string }> {
    this.enter("undo", []);
    const entry = this.undoStack.pop();
    if (!entry) throw new CopilotError("nothing_to_undo", "there is nothing to undo");
    this.state = entry.before;
    return { undone: entry.label };
  }

  /** Test control: finishes a render job as `done`; the duration defaults to the item's length. */
  completeJob(jobId: JobId, durationSec?: number): void {
    const job = this.requireJob(jobId);
    job.status = {
      jobId,
      status: "done",
      output: { path: job.output, durationSec: durationSec ?? job.durationSec },
      errorCode: null,
    };
    if (this.activeJob === jobId) this.activeJob = null;
  }

  /** Test control: finishes a render job as `failed`. */
  failJob(jobId: JobId, errorCode = "render_failed"): void {
    const job = this.requireJob(jobId);
    job.status = { jobId, status: "failed", output: null, errorCode };
    if (this.activeJob === jobId) this.activeJob = null;
  }

  private requireJob(jobId: string): FakeJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`FakeDaw: unknown job ${jobId}`);
    return job;
  }

  private enter(method: FakeDawMethod, args: unknown[], blockedByRender = true): void {
    this.calls.push({ method, args });
    const failure = this.failures[method];
    if (failure) throw failure;
    if (blockedByRender && this.activeJob !== null) {
      throw new CopilotError("daw_busy", "a render is in progress");
    }
  }

  private begin(action: string): void {
    this.undoStack.push({ label: `Copilot: ${action}`, before: clone(this.state) });
  }

  private nextId(): string {
    return guid(++this.counter);
  }

  private findItem(itemId: string): DawItem {
    for (const track of this.state.tracks) {
      const item = track.items.find((i) => i.id === itemId);
      if (item) return item;
    }
    throw new CopilotError("item_not_found", "no item with that id");
  }

  private snapshotState(): ProjectState {
    const copy = clone(this.state);
    const lengthSec = Math.max(
      0,
      ...copy.tracks.flatMap((t) => t.items.map((i) => i.positionSec + i.lengthSec)),
    );
    return { tempo: copy.tempo, lengthSec, tracks: copy.tracks };
  }
}
