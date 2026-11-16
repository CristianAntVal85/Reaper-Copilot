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
});
