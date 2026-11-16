import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asAssetPath, CopilotError, ProjectStateSchema } from "@reaper-copilot/core";
import { afterAll, describe, expect, it } from "vitest";
import { ReaperDaw } from "./reaper-daw.ts";

// Needs Reaper open with reaper/bridge/bridge.lua loaded (see CLAUDE.md).
const daw = new ReaperDaw({ pathStyle: process.env["WSL_DISTRO_NAME"] ? "unc" : "identity" });

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../workspace");

/** Mono 16-bit PCM WAV with a quiet tone. */
function wav(seconds: number, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), i * 2);
  }
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

/** Click track: 0.5 s of silence, then 4/4 clicks at `bpm`, the first beat of each bar accented. */
function clickTrack(bpm: number, bars: number, leadSec: number, sampleRate = 22050): Buffer {
  const beatSec = 60 / bpm;
  const total = Math.round((leadSec + bars * 4 * beatSec) * sampleRate);
  const data = Buffer.alloc(total * 2);
  for (let beat = 0; beat < bars * 4; beat++) {
    const start = Math.round((leadSec + beat * beatSec) * sampleRate);
    const amp = beat % 4 === 0 ? 24000 : 12000;
    const freq = beat % 4 === 0 ? 1500 : 1000;
    for (let i = 0; i < 0.02 * sampleRate && start + i < total; i++) {
      const v = amp * Math.exp(-i / (0.004 * sampleRate)) * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      data.writeInt16LE(Math.round(v), (start + i) * 2);
    }
  }
  const header = Buffer.from(wav(0, sampleRate).subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let tmp: string | undefined;
afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("Reaper bridge (real)", () => {
  it("answers ping", async () => {
    const { reaperVersion } = await daw.ping();
    expect(reaperVersion).toMatch(/\d/);
  });

  it("reads the project state", async () => {
    const state = await daw.getProjectState();
    expect(ProjectStateSchema.safeParse(state).success).toBe(true);
    expect(state.tempo).toBeGreaterThan(0);
  });

  it("imports, changes the tempo without stretching, and undoes everything", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp = await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "tone.wav");
    await writeFile(file, wav(4));

    const before = await daw.getProjectState();
    const { track, item } = await daw.importAudio(asAssetPath(file));
    expect(item.lengthSec).toBeCloseTo(4, 2);
    expect(item.source).toBe(file);
    expect(item.trackId).toBe(track.id);

    const tempo = await daw.setTempo(170);
    expect(tempo.tempo).toBeCloseTo(170, 6);
    const after = await daw.getProjectState();
    const imported = after.tracks.flatMap((t) => t.items).find((i) => i.id === item.id);
    expect(imported?.lengthSec).toBeCloseTo(4, 3);
    expect(imported?.playRate).toBe(1);

    expect((await daw.undo()).undone).toBe("Copilot: set_tempo");
    expect((await daw.undo()).undone).toBe("Copilot: import_audio");
    const restored = await daw.getProjectState();
    expect(restored.tempo).toBeCloseTo(before.tempo, 6);
    expect(restored.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));

    const third = await daw.undo().catch((e: unknown) => e);
    expect(third).toBeInstanceOf(CopilotError);
    expect(third).toMatchObject({ code: "nothing_to_undo" });
  });

  it("slices bars 5-8 and stretches to 170 (absolute, idempotent), then undoes", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "click.wav");
    await writeFile(file, clickTrack(150, 16, 0.5));

    const before = await daw.getProjectState();
    const { item } = await daw.importAudio(asAssetPath(file));
    const spec = { sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 };

    const sliced = await daw.sliceByBars(item.id, spec);
    expect(sliced.startOffsetSec).toBeCloseTo(0.5 + 4 * 1.6, 6);
    expect(sliced.lengthSec).toBeCloseTo(6.4, 6);
    expect(sliced.positionSec).toBe(0);
    expect(await daw.sliceByBars(item.id, spec)).toEqual(sliced);

    const stretch = { sourceBpm: 150, targetBpm: 170 };
    const stretched = await daw.stretchToTempo(item.id, stretch);
    expect(Math.abs(stretched.lengthSec - 5.647059)).toBeLessThan(0.001);
    expect(stretched.playRate).toBeCloseTo(170 / 150, 9);
    expect(await daw.stretchToTempo(item.id, stretch)).toEqual(stretched);
    expect(await daw.sliceByBars(item.id, spec)).toMatchObject({ lengthSec: expect.closeTo(6.4 / (170 / 150), 6) });
    expect(await daw.stretchToTempo(item.id, stretch)).toEqual(stretched);

    const outOfSource = await daw.sliceByBars(item.id, { ...spec, startBar: 15 }).catch((e: unknown) => e);
    expect(outOfSource).toMatchObject({ code: "out_of_range" });
    const badRate = await daw.stretchToTempo(item.id, { sourceBpm: 100, targetBpm: 320 }).catch((e: unknown) => e);
    expect(badRate).toMatchObject({ code: "out_of_range" });
    const unknown = await daw
      .sliceByBars("{00000000-0000-0000-0000-000000000000}", spec)
      .catch((e: unknown) => e);
    expect(unknown).toMatchObject({ code: "item_not_found" });

    // Every slice and stretch above is one undo step; undo until the import is gone.
    let undone = (await daw.undo()).undone;
    while (undone !== "Copilot: import_audio") undone = (await daw.undo()).undone;
    const restored = await daw.getProjectState();
    expect(restored.tracks.map((t) => t.id)).toEqual(before.tracks.map((t) => t.id));
  });
});
