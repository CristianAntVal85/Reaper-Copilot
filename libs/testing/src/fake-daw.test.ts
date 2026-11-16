import { asAssetPath } from "@reaper-copilot/core";
import { describe, expect, it } from "vitest";
import { FakeDaw } from "./index.ts";

const click = asAssetPath("/ws/clicks150.wav");
const SLICE = { sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 };

async function imported() {
  const daw = new FakeDaw();
  daw.sourceLengths.set(click, 40);
  const { track, item } = await daw.importAudio(click);
  return { daw, track, item };
}

describe("FakeDaw", () => {
  it("slices 4 bars at 150 BPM from bar 5 with a 0.5 s offset, idempotently", async () => {
    const { daw, item } = await imported();
    for (let i = 0; i < 2; i++) {
      const sliced = await daw.sliceByBars(item.id, SLICE);
      expect(sliced.startOffsetSec).toBeCloseTo(6.9, 9);
      expect(sliced.lengthSec).toBeCloseTo(6.4, 9);
      expect(sliced.positionSec).toBe(0);
    }
  });

  it("stretches to 170 BPM to 5.647 s, idempotently", async () => {
    const { daw, item } = await imported();
    await daw.sliceByBars(item.id, SLICE);
    for (let i = 0; i < 2; i++) {
      const stretched = await daw.stretchToTempo(item.id, { sourceBpm: 150, targetBpm: 170 });
      expect(stretched.lengthSec).toBeCloseTo(5.647059, 5);
      expect(stretched.playRate).toBeCloseTo(170 / 150, 9);
    }
    await daw.sliceByBars(item.id, SLICE);
    expect((await daw.getProjectState()).tracks[0]!.items[0]!.lengthSec).toBeCloseTo(5.647059, 5);
  });

  it("rejects out-of-range slices and rates, and unknown ids", async () => {
    const { daw, item } = await imported();
    await expect(daw.sliceByBars(item.id, { ...SLICE, startBar: 40 })).rejects.toMatchObject({ code: "out_of_range" });
    await expect(daw.stretchToTempo(item.id, { sourceBpm: 60, targetBpm: 200 })).rejects.toMatchObject({ code: "out_of_range" });
    await expect(daw.sliceByBars("{00000000-0000-0000-0000-0000000000FF}", SLICE)).rejects.toMatchObject({ code: "item_not_found" });
  });

  it("renders as an async job and blocks other commands meanwhile", async () => {
    const { daw, item } = await imported();
    const jobId = await daw.render(item.id, asAssetPath("/ws/renders/a.wav"));
    expect((await daw.getJob(jobId)).status).toBe("rendering");
    await expect(daw.setTempo(170)).rejects.toMatchObject({ code: "daw_busy" });
    daw.completeJob(jobId);
    const done = await daw.getJob(jobId);
    expect(done).toMatchObject({ status: "done", output: { path: "/ws/renders/a.wav", durationSec: 40 } });
    await expect(daw.getJob("nope")).rejects.toMatchObject({ code: "job_not_found" });
    await daw.setTempo(170);
  });

  it("undoes only Copilot blocks, last first, and reports nothing_to_undo", async () => {
    const { daw, track } = await imported();
    await daw.setTempo(170);
    await daw.applyFxChain(track.id, [{ plugin: "ReaEQ (Cockos)", params: [] }]);
    await expect(daw.undo()).resolves.toEqual({ undone: "Copilot: apply_fx_chain" });
    await daw.undo();
    expect((await daw.getProjectState()).tempo).toBe(120);
    await daw.undo();
    expect((await daw.getProjectState()).tracks).toHaveLength(0);
    await expect(daw.undo()).rejects.toMatchObject({ code: "nothing_to_undo" });
  });

  it("logs calls and fails on demand", async () => {
    const { daw } = await imported();
    daw.failures.setTempo = new Error("boom");
    await expect(daw.setTempo(100)).rejects.toThrow("boom");
    expect(daw.calls.map((c) => c.method)).toEqual(["importAudio", "setTempo"]);
    await expect(daw.applyFxChain("{00000000-0000-0000-0000-0000000000FF}", [])).rejects.toMatchObject({ code: "track_not_found" });
  });
});
