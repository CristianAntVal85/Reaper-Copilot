import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CopilotError,
  AppliedFxChainSchema,
  type AppliedFxChain,
  type AssetPath,
  type DawItem,
  type DawPort,
  type FxChain,
  type ItemId,
  type JobId,
  type JobStatus,
  type ProjectState,
  SliceSpecSchema,
  type SliceSpec,
  type StretchSpec,
  type TrackId,
  type TrackRef,
} from "@reaper-copilot/core";
import type { z } from "zod";
import { fromDawPath, toDawPath, type PathOptions, type PathStyle } from "./paths.ts";
import { readWavDuration } from "./wav.ts";
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeImportResultSchema,
  BridgeItemResultSchema,
  BridgeProjectStateSchema,
  BridgeRenderResultSchema,
  HeartbeatSchema,
  PingResultSchema,
  QuitResultSchema,
  ResponseSchema,
  SetTempoResultSchema,
  UndoResultSchema,
  translateBridgeError,
  type BridgeItem,
  type BridgeMethod,
  type Heartbeat,
} from "./protocol.ts";

export interface ReaperDawOptions {
  /** Directory shared with the bridge; defaults to `<repository>/.copilot/reaper-ipc`. */
  readonly ipcDir?: string;
  readonly pathStyle: PathStyle;
  /** WSL distribution for `unc`; defaults to `WSL_DISTRO_NAME`. */
  readonly distro?: string;
  /** Per-command time limit. Default 10 s. */
  readonly timeoutMs?: number;
  /** Time limit of a render. Default 300 s. */
  readonly renderTimeoutMs?: number;
  /** Heartbeat older than this means the bridge is gone. Default 3 s. */
  readonly heartbeatMaxAgeMs?: number;
  readonly log?: (message: string) => void;
}

const POLL_MS = 15;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const DEFAULT_IPC_DIR = path.join(REPO_ROOT, ".copilot", "reaper-ipc");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** `DawPort` over the file-based IPC with `reaper/bridge/bridge.lua`. */
export class ReaperDaw implements DawPort {
  private readonly inbox: string;
  private readonly outbox: string;
  private readonly heartbeatFile: string;
  private readonly pathOptions: PathOptions;
  private readonly timeoutMs: number;
  private readonly renderTimeoutMs: number;
  private readonly heartbeatMaxAgeMs: number;
  private readonly log: (message: string) => void;
  private dirsReady = false;
  private readonly jobs = new Map<string, JobStatus>();
  /** Id of the render in flight, if any: the bridge serves nothing else meanwhile. */
  private activeRender: string | null = null;

  constructor(options: ReaperDawOptions) {
    const ipcDir = options.ipcDir ?? DEFAULT_IPC_DIR;
    this.inbox = path.join(ipcDir, "inbox");
    this.outbox = path.join(ipcDir, "outbox");
    this.heartbeatFile = path.join(ipcDir, "heartbeat.json");
    const distro = options.distro ?? process.env["WSL_DISTRO_NAME"];
    if (options.pathStyle === "unc" && !distro) {
      throw new Error("pathStyle \"unc\" needs a WSL distribution name");
    }
    this.pathOptions = distro === undefined ? { style: options.pathStyle } : { style: options.pathStyle, distro };
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.renderTimeoutMs = options.renderTimeoutMs ?? 300_000;
    this.heartbeatMaxAgeMs = options.heartbeatMaxAgeMs ?? 3_000;
    this.log = options.log ?? (() => {});
  }

  /** Round-trip to the bridge; returns the Reaper version. */
  async ping(): Promise<{ reaperVersion: string }> {
    const result = await this.call("ping", {}, PingResultSchema);
    return { reaperVersion: result.reaper };
  }

  /** Asks the bridge to stop (used to reload it in development). */
  async quit(): Promise<void> {
    await this.call("quit", {}, QuitResultSchema);
  }

  async getProjectState(): Promise<ProjectState> {
    const raw = await this.call("get_project_state", {}, BridgeProjectStateSchema);
    return {
      tempo: raw.tempo,
      lengthSec: raw.lengthSec,
      tracks: raw.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => this.toDawItem(item)),
      })),
    };
  }

  private toDawItem(item: BridgeItem): DawItem {
    return { ...item, source: item.source === null ? null : fromDawPath(item.source, this.pathOptions) };
  }

  async setTempo(bpm: number): Promise<{ tempo: number }> {
    return this.call("set_tempo", { bpm }, SetTempoResultSchema);
  }

  async importAudio(file: AssetPath): Promise<{ track: TrackRef; item: DawItem }> {
    const dawPath = toDawPath(file, this.pathOptions);
    if (dawPath === null) {
      throw new CopilotError("daw_error", "the file path cannot be mapped for Reaper", {
        cause: new Error(`cannot translate ${file}`),
      });
    }
    const raw = await this.call("import_audio", { path: dawPath }, BridgeImportResultSchema);
    return { track: raw.track, item: this.toDawItem(raw.item) };
  }

  async sliceByBars(itemId: ItemId, spec: SliceSpec): Promise<DawItem> {
    const parsed = SliceSpecSchema.parse(spec);
    const raw = await this.call("slice", { itemId, ...parsed }, BridgeItemResultSchema);
    return this.toDawItem(raw);
  }

  async stretchToTempo(itemId: ItemId, spec: StretchSpec): Promise<DawItem> {
    const raw = await this.call(
      "stretch",
      { itemId, sourceBpm: spec.sourceBpm, targetBpm: spec.targetBpm },
      BridgeItemResultSchema,
    );
    return this.toDawItem(raw);
  }

  async applyFxChain(trackId: TrackId, chain: FxChain): Promise<AppliedFxChain> {
    return this.call("apply_fx_chain", { trackId, chain }, AppliedFxChainSchema);
  }

  /** Starts a render and returns its job id at once; `getJob` reports how it ends. */
  async render(itemId: ItemId, output: AssetPath): Promise<JobId> {
    if (this.activeRender !== null) throw this.busy();
    const dawPath = toDawPath(output, this.pathOptions);
    if (dawPath === null) {
      throw new CopilotError("daw_error", "the output path cannot be mapped for Reaper", {
        cause: new Error(`cannot translate ${output}`),
      });
    }
    if (!(await this.bridgeAlive())) throw this.unavailable();
    // Re-check: another render may have started while the heartbeat was read.
    if (this.activeRender !== null) throw this.busy();

    const jobId = randomUUID();
    this.activeRender = jobId;
    this.jobs.set(jobId, { jobId, status: "rendering", output: null, errorCode: null });
    void this.runRender(jobId, itemId, dawPath, output);
    return jobId;
  }

  async getJob(jobId: JobId): Promise<JobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) throw new CopilotError("job_not_found", "no render job with that id");
    return job;
  }

  private async runRender(jobId: string, itemId: ItemId, dawPath: string, output: AssetPath): Promise<void> {
    try {
      const raw = await this.call(
        "render",
        { itemId, path: dawPath },
        BridgeRenderResultSchema,
        this.renderTimeoutMs,
        true,
      );
      // The WAV header is the measure of what was written; the item's bounds are the fallback.
      const durationSec = (await readWavDuration(output)) ?? raw.lengthSec;
      this.jobs.set(jobId, { jobId, status: "done", output: { path: output, durationSec }, errorCode: null });
    } catch (error) {
      const errorCode = error instanceof CopilotError ? error.code : "daw_error";
      this.log(`render ${jobId} failed: ${errorCode} ${error instanceof Error ? error.message : String(error)}`);
      this.jobs.set(jobId, { jobId, status: "failed", output: null, errorCode });
    } finally {
      this.activeRender = null;
    }
  }

  private busy(): CopilotError {
    return new CopilotError("daw_busy", "a render is in progress: wait for it to finish (get_job_status)");
  }

  async undo(): Promise<{ undone: string }> {
    return this.call("undo", {}, UndoResultSchema);
  }

  // Transport ---------------------------------------------------------------

  private async readHeartbeat(): Promise<{ ageMs: number; state: Heartbeat["state"] | null } | null> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(this.heartbeatFile)).mtimeMs;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    let state: Heartbeat["state"] | null = null;
    try {
      const parsed = HeartbeatSchema.safeParse(JSON.parse(await readFile(this.heartbeatFile, "utf8")));
      if (parsed.success) state = parsed.data.state;
    } catch {
      // Being rewritten right now: the mtime is what counts.
    }
    return { ageMs: Date.now() - mtimeMs, state };
  }

  private async bridgeAlive(): Promise<boolean> {
    const beat = await this.readHeartbeat();
    if (beat === null) return false;
    return beat.ageMs <= this.heartbeatMaxAgeMs || beat.state === "rendering";
  }

  private unavailable(): CopilotError {
    return new CopilotError("daw_unavailable", "Reaper is not reachable: open Reaper and load the bridge script");
  }

  private async call<S extends z.ZodType>(
    method: BridgeMethod,
    params: Record<string, unknown>,
    schema: S,
    timeoutMs: number = this.timeoutMs,
    isRender = false,
  ): Promise<z.output<S>> {
    if (!isRender && this.activeRender !== null) throw this.busy();
    if (!(await this.bridgeAlive())) throw this.unavailable();

    if (!this.dirsReady) {
      await mkdir(this.inbox, { recursive: true });
      await mkdir(this.outbox, { recursive: true });
      this.dirsReady = true;
    }

    const id = randomUUID();
    const requestFile = path.join(this.inbox, `${id}.json`);
    const responseFile = path.join(this.outbox, `${id}.json`);
    const tmp = `${requestFile}.tmp`;
    await writeFile(tmp, JSON.stringify({ id, method, params, schemaVersion: BRIDGE_PROTOCOL_VERSION }));
    await rename(tmp, requestFile);

    const deadline = Date.now() + timeoutMs;
    let nextBeatCheck = Date.now() + 500;
    try {
      for (;;) {
        let text: string | null = null;
        try {
          text = await readFile(responseFile, "utf8");
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
        if (text !== null) {
          await unlink(responseFile).catch(() => {});
          return this.parseResponse(id, method, text, schema);
        }
        const now = Date.now();
        if (now >= deadline) {
          throw new CopilotError("daw_timeout", "Reaper did not answer in time", {
            cause: new Error(`no answer to ${method} within ${timeoutMs} ms`),
          });
        }
        if (now >= nextBeatCheck) {
          nextBeatCheck = now + 500;
          if (!(await this.bridgeAlive())) throw this.unavailable();
        }
        await sleep(POLL_MS);
      }
    } catch (error) {
      // Whatever the reason, an unanswered request must not run later.
      await unlink(requestFile).catch(() => {});
      throw error;
    }
  }

  private parseResponse<S extends z.ZodType>(id: string, method: BridgeMethod, text: string, schema: S): z.output<S> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new CopilotError("invalid_daw_output", "the Reaper bridge returned an unreadable response", {
        cause: error,
      });
    }
    const envelope = ResponseSchema.safeParse(json);
    if (!envelope.success || envelope.data.id !== id) {
      throw new CopilotError("invalid_daw_output", "the Reaper bridge returned an unexpected response", {
        cause: envelope.success ? new Error("response id mismatch") : envelope.error,
      });
    }
    if (!envelope.data.ok) {
      this.log(`bridge error: ${envelope.data.error.code} ${envelope.data.error.message ?? ""}`);
      throw translateBridgeError(envelope.data.error, method);
    }
    const result = schema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new CopilotError("invalid_daw_output", "the Reaper bridge returned data outside its contract", {
        cause: result.error,
      });
    }
    return result.data;
  }
}
