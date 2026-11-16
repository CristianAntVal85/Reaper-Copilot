import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asAssetPath, CopilotError } from "@reaper-copilot/core";
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

  it("fails clearly on commands that are not bridged yet", async () => {
    expect(await code(daw().applyFxChain())).toBe("daw_error");
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
