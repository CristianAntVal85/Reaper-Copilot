import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asAssetPath, CopilotError, type JobStatus } from "@reaper-copilot/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeBridge, type FakeBridgeHandler } from "./fake-bridge.ts";
import { ReaperDaw } from "./reaper-daw.ts";

const TRACK = "{11111111-2222-3333-4444-555555555555}";
const ITEM = "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}";
const secret = "\\\\wsl.localhost\\Ubuntu-24.04\\home\\secret\\a.wav";

const stateResult = {
  tempo: 150,
  lengthSec: 4,
  tracks: [
    {
      id: TRACK,
      name: "Loop",
      fx: ["ReaEQ (Cockos)"],
      items: [
        { id: ITEM, trackId: TRACK, positionSec: 0, lengthSec: 4, startOffsetSec: 0.5, playRate: 1, source: secret },
        { id: ITEM, trackId: TRACK, positionSec: 4, lengthSec: 1, startOffsetSec: 0, playRate: 1, source: "C:\\x\\b.wav" },
      ],
    },
  ],
};

let dir: string;
let bridge: FakeBridge;
let handler: FakeBridgeHandler;

function daw(options: { timeoutMs?: number } = {}): ReaperDaw {
  return new ReaperDaw({ ipcDir: dir, pathStyle: "unc", distro: "Ubuntu-24.04", ...options });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rca-ipc-"));
  handler = (method) =>
    method === "get_project_state" ? { ok: true, result: stateResult } : { ok: true, result: {} };
  bridge = new FakeBridge(dir, (m, p) => handler(m, p));
});

afterEach(async () => {
  bridge.stop();
  await rm(dir, { recursive: true, force: true });
});

function silentWav(seconds: number, sampleRate: number): Buffer {
  const data = Buffer.alloc(seconds * sampleRate * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function waitForJob(d: ReaperDaw, jobId: string): Promise<JobStatus> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const job = await d.getJob(jobId);
    if (job.status !== "rendering" || Date.now() > deadline) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CopilotError) return error.code;
    throw error;
  }
  return "no error";
}

describe("ReaperDaw", () => {
  it("returns the project state with sources translated to Linux", async () => {
    await bridge.start();
    const state = await daw().getProjectState();
    expect(state.tracks[0]?.items[0]?.source).toBe("/home/secret/a.wav");
    expect(state.tracks[0]?.items[1]?.source).toBeNull();
    expect(state.tempo).toBe(150);
    expect(await readdir(path.join(dir, "outbox"))).toEqual([]);
  });

  it("pings", async () => {
    handler = () => ({
      ok: true,
      result: { pong: true, protocol: 1, instance: "x", reaper: "7.86/win64" },
    });
    await bridge.start();
    expect(await daw().ping()).toEqual({ reaperVersion: "7.86/win64" });
  });

  it("rejects a response outside the schema", async () => {
    handler = () => ({ ok: true, result: { tempo: "fast" } });
    await bridge.start();
    expect(await code(daw().getProjectState())).toBe("invalid_daw_output");
  });

  it("translates bridge error codes with fixed messages (no Reaper text, no paths)", async () => {
    handler = () => ({ ok: false, error: { code: "item_not_found", message: `missing ${secret}` } });
    await bridge.start();
    const error = await daw()
      .getProjectState()
      .catch((e: unknown) => e as CopilotError);
    expect(error).toBeInstanceOf(CopilotError);
    expect((error as CopilotError).code).toBe("item_not_found");
    expect((error as CopilotError).message).not.toContain("secret");
  });

  it("maps an unknown bridge code to daw_error", async () => {
    handler = () => ({ ok: false, error: { code: "weird" } });
    await bridge.start();
    expect(await code(daw().getProjectState())).toBe("daw_error");
  });

  it("answers daw_unavailable fast without a heartbeat", async () => {
    await bridge.start({ heartbeat: false });
    const started = Date.now();
    expect(await code(daw().getProjectState())).toBe("daw_unavailable");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("answers daw_unavailable for a stale heartbeat", async () => {
    await bridge.start({ heartbeat: false });
    const file = path.join(dir, "heartbeat.json");
    await writeFile(file, JSON.stringify({ state: "idle", instance: "old" }));
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    const started = Date.now();
    expect(await code(daw().getProjectState())).toBe("daw_unavailable");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not give up on a stale heartbeat while the bridge is rendering", async () => {
    handler = () => "silence";
    await bridge.start({ heartbeat: false });
    const file = path.join(dir, "heartbeat.json");
    await writeFile(file, JSON.stringify({ state: "rendering", instance: "x" }));
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    expect(await code(daw({ timeoutMs: 150 }).getProjectState())).toBe("daw_timeout");
  });

  it("times out with daw_timeout and removes the request", async () => {
    handler = () => "silence";
    await bridge.start();
    // Keep the bridge's own loop from consuming the request.
    bridge.stop();
    await bridge.beat();
    const result = await code(daw({ timeoutMs: 200 }).getProjectState());
    expect(result).toBe("daw_timeout");
    expect(await readdir(path.join(dir, "inbox"))).toEqual([]);
  });

  it("reports the bridge going away mid-call", async () => {
    handler = () => "silence";
    await bridge.start();
    bridge.stop();
    await bridge.beat();
    const adapter = new ReaperDaw({
      ipcDir: dir,
      pathStyle: "unc",
      distro: "Ubuntu-24.04",
      timeoutMs: 5000,
      heartbeatMaxAgeMs: 300,
    });
    const started = Date.now();
    expect(await code(adapter.getProjectState())).toBe("daw_unavailable");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("refuses unc without a distribution", () => {
    const saved = process.env["WSL_DISTRO_NAME"];
    delete process.env["WSL_DISTRO_NAME"];
    try {
      expect(() => new ReaperDaw({ ipcDir: dir, pathStyle: "unc" })).toThrow();
    } finally {
      if (saved !== undefined) process.env["WSL_DISTRO_NAME"] = saved;
    }
  });

  it("renders as an async job: busy meanwhile, then done with the WAV header's duration", async () => {
    const out = path.join(dir, "out.wav");
    const seen: { method: string; params: unknown }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    handler = async (method, params) => {
      seen.push({ method, params });
      if (method !== "render") return { ok: true, result: {} };
      bridge.state = "rendering";
      await gate;
      await writeFile(out, silentWav(2, 8000));
      bridge.state = "idle";
      return { ok: true, result: { lengthSec: 9 } };
    };
    await bridge.start();
    const d = daw();
    const jobId = await d.render(ITEM, asAssetPath(out));
    expect(await d.getJob(jobId)).toEqual({ jobId, status: "rendering", output: null, errorCode: null });
    expect(await code(d.setTempo(170))).toBe("daw_busy");
    expect(await code(d.getProjectState())).toBe("daw_busy");
    expect(await code(d.render(ITEM, asAssetPath(path.join(dir, "other.wav"))))).toBe("daw_busy");
    release();
    const done = await waitForJob(d, jobId);
    expect(done).toEqual({ jobId, status: "done", output: { path: out, durationSec: 2 }, errorCode: null });
    expect(seen.map((s) => s.method)).toEqual(["render"]);
    expect(seen[0]?.params).toEqual({
      itemId: ITEM,
      path: `\\\\wsl.localhost\\Ubuntu-24.04${out.replaceAll("/", "\\")}`,
    });
    // Free again afterwards.
    handler = () => ({ ok: true, result: { tempo: 170 } });
    expect(await d.setTempo(170)).toEqual({ tempo: 170 });
    expect(await code(d.getJob("nope"))).toBe("job_not_found");
  });

  it("falls back to the item's length when the WAV cannot be read", async () => {
    handler = () => ({ ok: true, result: { lengthSec: 5.5 } });
    await bridge.start();
    const d = daw();
    const jobId = await d.render(ITEM, asAssetPath(path.join(dir, "missing.wav")));
    expect(await waitForJob(d, jobId)).toMatchObject({ status: "done", output: { durationSec: 5.5 } });
  });

  it("fails the job with the translated code (output_exists, media_offline) and frees the bridge", async () => {
    handler = () => ({ ok: false, error: { code: "output_exists", message: "x" } });
    await bridge.start();
    const d = daw();
    const first = await d.render(ITEM, asAssetPath(path.join(dir, "a.wav")));
    expect(await waitForJob(d, first)).toMatchObject({ status: "failed", errorCode: "render_failed", output: null });
    handler = () => ({ ok: false, error: { code: "media_offline", message: "x" } });
    const second = await d.render(ITEM, asAssetPath(path.join(dir, "b.wav")));
    expect(await waitForJob(d, second)).toMatchObject({ status: "failed", errorCode: "render_failed" });
    // Outside a render, media_offline is a plain bridge error.
    expect(await code(d.sliceByBars(ITEM, { sourceBpm: 150, startBar: 1, bars: 1 }))).toBe("daw_error");
  });

  it("times out a render with renderTimeoutMs and fails the job", async () => {
    handler = () => "silence";
    await bridge.start();
    const d = new ReaperDaw({ ipcDir: dir, pathStyle: "unc", distro: "Ubuntu-24.04", renderTimeoutMs: 200 });
    const jobId = await d.render(ITEM, asAssetPath(path.join(dir, "slow.wav")));
    expect(await waitForJob(d, jobId)).toMatchObject({ status: "failed", errorCode: "daw_timeout" });
  });

  it("does not give up on a render while the heartbeat is stale but says rendering", async () => {
    handler = async () => {
      const file = path.join(dir, "heartbeat.json");
      await writeFile(file, JSON.stringify({ state: "rendering", instance: "x" }));
      const old = new Date(Date.now() - 60_000);
      await utimes(file, old, old);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      return { ok: true, result: { lengthSec: 3 } };
    };
    await bridge.start({ heartbeat: false });
    await bridge.beat();
    const d = daw();
    const jobId = await d.render(ITEM, asAssetPath(path.join(dir, "long.wav")));
    expect(await waitForJob(d, jobId)).toMatchObject({ status: "done", output: { durationSec: 3 } });
  });

  it("refuses to start a render without a bridge", async () => {
    await bridge.start({ heartbeat: false });
    expect(await code(daw().render(ITEM, asAssetPath(path.join(dir, "x.wav"))))).toBe("daw_unavailable");
  });

  it("imports audio with the path translated to UNC and the source back to Linux", async () => {
    let seen: unknown;
    handler = (_m, params) => {
      seen = params;
      return {
        ok: true,
        result: {
          track: { id: TRACK, name: "a.wav" },
          item: { id: ITEM, trackId: TRACK, positionSec: 0, lengthSec: 4, startOffsetSec: 0, playRate: 1, source: secret },
        },
      };
    };
    await bridge.start();
    const out = await daw().importAudio(asAssetPath("/home/secret/a.wav"));
    expect(seen).toEqual({ path: secret });
    expect(out.track.name).toBe("a.wav");
    expect(out.item.source).toBe("/home/secret/a.wav");
  });

  it("applies an FX chain and validates the answer", async () => {
    const seen: { method: string; params: unknown }[] = [];
    const chain = [{ plugin: "ReaLimit (Cockos)", params: [{ name: "Threshold", value: -6 }] }];
    handler = (method, params) => {
      seen.push({ method, params });
      return {
        ok: true,
        result: { trackId: TRACK, fx: [{ plugin: "ReaLimit (Cockos)", params: [{ name: "Threshold", text: "-6.00" }] }] },
      };
    };
    await bridge.start();
    const applied = await daw().applyFxChain(TRACK, chain);
    expect(applied.fx[0]?.params[0]?.text).toBe("-6.00");
    expect(seen).toEqual([{ method: "apply_fx_chain", params: { trackId: TRACK, chain } }]);
    handler = () => ({ ok: true, result: { trackId: TRACK } });
    expect(await code(daw().applyFxChain(TRACK, chain))).toBe("invalid_daw_output");
    handler = () => ({ ok: false, error: { code: "out_of_range", message: "x" } });
    expect(await code(daw().applyFxChain(TRACK, chain))).toBe("out_of_range");
    handler = () => ({ ok: false, error: { code: "fx_not_found", message: "x" } });
    expect(await code(daw().applyFxChain(TRACK, chain))).toBe("daw_error");
  });

  it("sets the tempo", async () => {
    handler = () => ({ ok: true, result: { tempo: 170 } });
    await bridge.start();
    expect(await daw().setTempo(170)).toEqual({ tempo: 170 });
  });

  it("slices and stretches with the full parameters and translates errors", async () => {
    const seen: { method: string; params: unknown }[] = [];
    const item = { id: ITEM, trackId: TRACK, positionSec: 0, lengthSec: 6.4, startOffsetSec: 6.9, playRate: 1, source: null };
    handler = (method, params) => {
      seen.push({ method, params });
      return { ok: true, result: item };
    };
    await bridge.start();
    const d = daw();
    expect((await d.sliceByBars(ITEM, { sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 })).lengthSec).toBe(6.4);
    await d.stretchToTempo(ITEM, { sourceBpm: 150, targetBpm: 170 });
    expect(seen).toEqual([
      { method: "slice", params: { itemId: ITEM, sourceBpm: 150, startBar: 5, bars: 4, beatsPerBar: 4, offsetSec: 0.5 } },
      { method: "stretch", params: { itemId: ITEM, sourceBpm: 150, targetBpm: 170 } },
    ]);
    handler = () => ({ ok: false, error: { code: "out_of_range", message: "x" } });
    expect(await code(d.stretchToTempo(ITEM, { sourceBpm: 150, targetBpm: 320 }))).toBe("out_of_range");
    handler = () => ({ ok: false, error: { code: "item_not_found", message: "x" } });
    expect(await code(d.sliceByBars(ITEM, { sourceBpm: 150, startBar: 1, bars: 1 }))).toBe("item_not_found");
  });

  it("undoes and translates nothing_to_undo", async () => {
    handler = () => ({ ok: true, result: { undone: "Copilot: set_tempo" } });
    await bridge.start();
    expect(await daw().undo()).toEqual({ undone: "Copilot: set_tempo" });
    handler = () => ({ ok: false, error: { code: "nothing_to_undo", message: "x" } });
    expect(await code(daw().undo())).toBe("nothing_to_undo");
  });
});
