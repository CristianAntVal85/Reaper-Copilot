import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asAssetPath, CopilotError, ProjectStateSchema, type JobStatus } from "@reaper-copilot/core";
import { afterAll, describe, expect, it } from "vitest";
import { type PathOptions, toDawPath } from "./paths.ts";
import { ReaperDaw } from "./reaper-daw.ts";
import { readWavDuration } from "./wav.ts";

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

/** Mono 16-bit PCM WAV at 48 kHz: a 40 Hz and a 1 kHz sine, each at -12 dBFS. */
function twoTones(seconds: number): Buffer {
  const sampleRate = 48000;
  const amp = 10 ** (-12 / 20);
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const v = amp * (Math.sin((2 * Math.PI * 40 * i) / sampleRate) + Math.sin((2 * Math.PI * 1000 * i) / sampleRate));
    data.writeInt16LE(Math.round(32767 * v), i * 2);
  }
  const header = Buffer.from(wav(0, sampleRate).subarray(0, 44));
  header.writeUInt32LE(36 + data.length, 4);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Level in dB of one frequency in the first channel of a PCM or float WAV, between `fromSec` and `toSec`
 * (Goertzel). The adapter may depend only on core, so the analysis-py adapter is not available here; a single
 * known frequency does not need more than this.
 */
function toneLevelDb(file: Buffer, freq: number, fromSec: number, toSec: number): number {
  let channels = 1;
  let rate = 48000;
  let bits = 16;
  let float = false;
  let dataAt = 0;
  let dataSize = 0;
  for (let at = 12; at + 8 <= file.length; ) {
    const id = file.toString("latin1", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    if (id === "fmt ") {
      const tag = file.readUInt16LE(at + 8);
      channels = file.readUInt16LE(at + 10);
      rate = file.readUInt32LE(at + 12);
      bits = file.readUInt16LE(at + 22);
      float = tag === 3 || (tag === 0xfffe && file.readUInt16LE(at + 32) === 3);
    } else if (id === "data") {
      dataAt = at + 8;
      dataSize = Math.min(size, file.length - dataAt);
      break;
    }
    at += 8 + size + (size % 2);
  }
  const bytes = bits / 8;
  const frames = Math.floor(dataSize / (bytes * channels));
  const sampleAt = (n: number): number => {
    const o = dataAt + n * channels * bytes;
    if (float) return file.readFloatLE(o);
    if (bits === 16) return file.readInt16LE(o) / 32768;
    if (bits === 24) return file.readIntLE(o, 3) / 8388608;
    return file.readInt32LE(o) / 2147483648;
  };
  const first = Math.round(fromSec * rate);
  const last = Math.min(frames, Math.round(toSec * rate));
  let re = 0;
  let im = 0;
  for (let n = first; n < last; n++) {
    const phase = (2 * Math.PI * freq * n) / rate;
    const x = sampleAt(n);
    re += x * Math.cos(phase);
    im -= x * Math.sin(phase);
  }
  const amplitude = (2 * Math.hypot(re, im)) / (last - first);
  return 20 * Math.log10(amplitude);
}

let tmp: string | undefined;

const DISTRO = process.env["WSL_DISTRO_NAME"];
const PATH_OPTIONS: PathOptions = DISTRO ? { style: "unc", distro: DISTRO } : { style: "identity" };
const REAPER_EXE = process.env["COPILOT_REAPER_EXE"]?.trim() || "/mnt/c/Program Files/REAPER (x64)/reaper.exe";

/**
 * Runs a throwaway ReaScript in the open Reaper (`-nonewinst`, as reaper:bridge does) to set or read what the
 * bridge's closed method list does not expose: item selection and the RENDER_* project settings.
 * Returns the `key=value` lines the script wrote.
 */
async function probe(dir: string, name: string, itemId: string, set: boolean): Promise<Record<string, string>> {
  const lua = (p: string): string => JSON.stringify(toDawPath(p, PATH_OPTIONS) ?? p);
  const outFile = path.join(dir, `${name}.out`);
  const script = path.join(dir, `${name}.lua`);
  await writeFile(
    script,
    `local out, id, set = ${lua(outFile + ".tmp")}, ${JSON.stringify(itemId)}, ${set}
local ok, err = pcall(function()
local function guid(i) return reaper.BR_GetMediaItemGUID and reaper.BR_GetMediaItemGUID(i) or select(2, reaper.GetSetMediaItemInfo_String(i, "GUID", "", false)) end
local target
for i = 0, reaper.CountMediaItems(0) - 1 do
  local it = reaper.GetMediaItem(0, i)
  if guid(it) == id then target = it end
end
if set then
  for i = 0, reaper.CountMediaItems(0) - 1 do reaper.SetMediaItemSelected(reaper.GetMediaItem(0, i), false) end
  if target then reaper.SetMediaItemSelected(target, true) end
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE", "probe-dir", true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "probe-pattern", true)
  reaper.GetSetProjectInfo(0, "RENDER_SETTINGS", 1, true)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 1, true)
  reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG", 1, true)
end
local lines = { "selected=" .. tostring(target ~= nil and reaper.IsMediaItemSelected(target)) }
for _, k in ipairs({ "RENDER_FILE", "RENDER_PATTERN", "RENDER_FORMAT" }) do
  local _, v = reaper.GetSetProjectInfo_String(0, k, "", false)
  lines[#lines + 1] = k .. "=" .. v
end
for _, k in ipairs({ "RENDER_SETTINGS", "RENDER_BOUNDSFLAG", "RENDER_TAILFLAG" }) do
  lines[#lines + 1] = k .. "=" .. string.format("%.0f", reaper.GetSetProjectInfo(0, k, 0, false))
end
local f = io.open(out, "wb")
f:write(table.concat(lines, "\\n"))
f:close()
end)
if not ok then
  local f = io.open(out, "wb")
  f:write("error=" .. tostring(err))
  f:close()
end
os.rename(out, ${lua(outFile)})
`,
  );
  const child = spawn(REAPER_EXE, ["-nonewinst", toDawPath(script, PATH_OPTIONS) ?? script], { stdio: "ignore", detached: true });
  child.unref();
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const text = await readFile(outFile, "utf8");
      return Object.fromEntries(text.split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    } catch {
      if (Date.now() > deadline) throw new Error("the probe script did not answer");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function waitForJob(jobId: string): Promise<JobStatus> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const job = await daw.getJob(jobId);
    if (job.status !== "rendering" || Date.now() > deadline) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Undoes the copilot's steps until the project has the original tracks again (cleanup of a test, even a failed one). */
async function restore(originalTrackIds: string[]): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const ids = (await daw.getProjectState().catch(() => null))?.tracks.map((t) => t.id);
    if (ids !== undefined && ids.length === originalTrackIds.length && ids.every((id, n) => id === originalTrackIds[n])) return;
    if (ids === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // still rendering
      continue;
    }
    await daw.undo().catch(() => {});
  }
}
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

  it("applies the three presets with displayed values, then undoes", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "fx.wav");
    await writeFile(file, wav(1));

    const before = await daw.getProjectState();
    const { track } = await daw.importAudio(asAssetPath(file));

    const distortion = await daw.applyFxChain(track.id, [
      { plugin: "JS: Waveshaping Distortion", params: [{ name: "Distortion (%)", value: 80 }] },
      {
        plugin: "ReaLimit (Cockos)",
        params: [
          { name: "Threshold", value: -6 },
          { name: "Ceiling", value: -0.3 },
        ],
      },
    ]);
    const text = (fx: number, name: string): number =>
      Number.parseFloat(distortion.fx[fx]?.params.find((p) => p.name === name)?.text ?? "NaN");
    expect(Math.abs(text(0, "Distortion (%)") - 80)).toBeLessThan(0.01);
    expect(Math.abs(text(1, "Threshold") + 6)).toBeLessThan(0.01);
    expect(Math.abs(text(1, "Ceiling") + 0.3)).toBeLessThan(0.01);

    await daw.applyFxChain(track.id, [{ plugin: "ReaLimit (Cockos)", params: [{ name: "Threshold", value: -9 }, { name: "Ceiling", value: -1 }] }]);
    await daw.applyFxChain(track.id, [
      { plugin: "ReaEQ (Cockos)", params: [{ name: "Freq-High Pass 5", value: 80 }], config: [{ name: "BANDENABLED4", value: "1" }] },
    ]);

    const tooHigh = await daw
      .applyFxChain(track.id, [{ plugin: "ReaLimit (Cockos)", params: [{ name: "Threshold", value: 50 }] }])
      .catch((e: unknown) => e);
    expect(tooHigh).toMatchObject({ code: "out_of_range" });
    const noPlugin = await daw
      .applyFxChain(track.id, [{ plugin: "No Such Plugin (Nobody)", params: [] }])
      .catch((e: unknown) => e);
    expect(noPlugin).toMatchObject({ code: "daw_error" });
    const noParam = await daw
      .applyFxChain(track.id, [{ plugin: "ReaLimit (Cockos)", params: [{ name: "Nope", value: 1 }] }])
      .catch((e: unknown) => e);
    expect(noParam).toMatchObject({ code: "daw_error" });
    const noTrack = await daw
      .applyFxChain("{00000000-0000-0000-0000-000000000000}", [{ plugin: "ReaLimit (Cockos)", params: [] }])
      .catch((e: unknown) => e);
    expect(noTrack).toMatchObject({ code: "track_not_found" });

    const withFx = await daw.getProjectState();
    expect(withFx.tracks.at(-1)?.fx).toHaveLength(4);

    let undone = (await daw.undo()).undone;
    while (undone !== "Copilot: import_audio") undone = (await daw.undo()).undone;
    expect(await daw.getProjectState()).toEqual(before);
  });

  it("renders the sliced and stretched loop with distortion_hard and refuses an existing output", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "click-render.wav");
    await writeFile(file, clickTrack(150, 16, 0.5));
    const output = path.join(tmp, "render-out.wav");

    const before = await daw.getProjectState();
    try {
      const { track, item } = await daw.importAudio(asAssetPath(file));
      await daw.sliceByBars(item.id, { sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 });
      await daw.stretchToTempo(item.id, { sourceBpm: 150, targetBpm: 170 });
      await daw.applyFxChain(track.id, [
        { plugin: "JS: Waveshaping Distortion", params: [{ name: "Distortion (%)", value: 60 }] },
        {
          plugin: "ReaLimit (Cockos)",
          params: [
            { name: "Threshold", value: -6 },
            { name: "Ceiling", value: -0.3 },
          ],
        },
      ]);

      const jobId = await daw.render(item.id, asAssetPath(output));
      const busy = await daw.getProjectState().catch((e: unknown) => e);
      expect(busy).toMatchObject({ code: "daw_busy" });
      const job = await waitForJob(jobId);
      expect(job.status).toBe("done");
      const header = await readWavDuration(output);
      expect(Math.abs((header ?? 0) - 5.647)).toBeLessThan(0.02);
      if (job.status === "done") expect(Math.abs(job.output.durationSec - 5.647)).toBeLessThan(0.02);

      // Same name again: refused before Reaper opens its overwrite dialog.
      const again = await waitForJob(await daw.render(item.id, asAssetPath(output)));
      expect(again).toMatchObject({ status: "failed", errorCode: "render_failed" });
      expect((await daw.getProjectState()).tracks.length).toBeGreaterThan(before.tracks.length);
    } finally {
      await restore(before.tracks.map((t) => t.id));
      await rm(output, { force: true });
    }
  });
  it("refuses plugins outside the closed list and paths outside the workspace", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "guard.wav");
    await writeFile(file, wav(1));
    const before = await daw.getProjectState();
    try {
      const { track, item } = await daw.importAudio(asAssetPath(file));
      for (const plugin of ["ReaGate (Cockos)", "C:\\Windows\\evil.dll", "/usr/lib/x.vst3", "reaeq (cockos)", "ReaEQ (Cockos).vst3"]) {
        const refused = await daw.applyFxChain(track.id, [{ plugin, params: [] }]).catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(CopilotError);
        expect(refused).toMatchObject({ code: "daw_error" });
      }
      expect((await daw.getProjectState()).tracks.at(-1)?.fx).toEqual([]);

      const outside = [
        "/tmp/outside.wav",
        path.join(WORKSPACE, "..", "outside.wav"),
        `${tmp}/sub/../../../outside.wav`,
        `${WORKSPACE}-evil/outside.wav`,
      ];
      for (const bad of outside) {
        const imported = await daw.importAudio(asAssetPath(bad)).catch((e: unknown) => e);
        expect(imported).toMatchObject({ code: "path_outside_workspace" });
      }
      const dotted = await daw.importAudio(asAssetPath(`${tmp}/sub/../guard.wav`)).catch((e: unknown) => e);
      expect(dotted).toMatchObject({ code: "path_outside_workspace" });
      const job = await waitForJob(await daw.render(item.id, asAssetPath("/tmp/rca-outside-render.wav")));
      expect(job).toMatchObject({ status: "failed", errorCode: "path_outside_workspace" });
      expect((await daw.getProjectState()).tracks.length).toBe(before.tracks.length + 1);
    } finally {
      await restore(before.tracks.map((t) => t.id));
    }
  });

  it("eq_lowcut enables the ReaEQ high-pass band: the 40 Hz tone drops, the 1 kHz tone stays", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "lowcut.wav");
    await writeFile(file, twoTones(4));
    const plain = path.join(tmp, "lowcut-plain.wav");
    const cut = path.join(tmp, "lowcut-cut.wav");
    const before = await daw.getProjectState();
    try {
      const { track, item } = await daw.importAudio(asAssetPath(file));
      expect((await waitForJob(await daw.render(item.id, asAssetPath(plain)))).status).toBe("done");

      // Literal copy of reaper/presets/eq_lowcut.json at its default cutoff: an adapter may depend only on core,
      // and the preset resolver lives in tools.
      const applied = await daw.applyFxChain(track.id, [
        { plugin: "ReaEQ (Cockos)", params: [{ name: "Freq-High Pass 5", value: 80 }], config: [{ name: "BANDENABLED4", value: "1" }] },
      ]);
      expect(applied.fx[0]?.config).toEqual([{ name: "BANDENABLED4", value: "1" }]);
      expect((await waitForJob(await daw.render(item.id, asAssetPath(cut)))).status).toBe("done");

      const a = await readFile(plain);
      const b = await readFile(cut);
      const sub = [toneLevelDb(a, 40, 1, 3), toneLevelDb(b, 40, 1, 3)] as const;
      const mid = [toneLevelDb(a, 1000, 1, 3), toneLevelDb(b, 1000, 1, 3)] as const;
      console.log(`sub before/after: ${sub[0].toFixed(2)} / ${sub[1].toFixed(2)} dB; mid: ${mid[0].toFixed(2)} / ${mid[1].toFixed(2)} dB`);
      expect(sub[0] - sub[1]).toBeGreaterThanOrEqual(6);
      expect(Math.abs(mid[1] - mid[0])).toBeLessThanOrEqual(1);
    } finally {
      await restore(before.tracks.map((t) => t.id));
      await rm(plain, { force: true });
      await rm(cut, { force: true });
    }
  });

  it("refuses a FX config key outside the closed list and leaves no FX behind", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "config-guard.wav");
    await writeFile(file, wav(1));
    const before = await daw.getProjectState();
    try {
      const { track } = await daw.importAudio(asAssetPath(file));
      const bad = [
        { name: "BANDENABLED10", value: "1" },
        { name: "FILE", value: "1" },
        { name: "BANDENABLED4", value: "2" },
      ];
      for (const config of bad) {
        const refused = await daw
          .applyFxChain(track.id, [{ plugin: "ReaEQ (Cockos)", params: [], config: [config] }])
          .catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(CopilotError);
        expect(refused).toMatchObject({ code: "daw_error" });
      }
      const wrongPlugin = await daw
        .applyFxChain(track.id, [{ plugin: "ReaLimit (Cockos)", params: [], config: [{ name: "BANDENABLED4", value: "1" }] }])
        .catch((e: unknown) => e);
      expect(wrongPlugin).toMatchObject({ code: "daw_error" });
      expect((await daw.getProjectState()).tracks.at(-1)?.fx).toEqual([]);
    } finally {
      await restore(before.tracks.map((t) => t.id));
    }
  });

  it("leaves item selection and render settings as they were after a render, and after a failed one", async () => {
    await mkdir(WORKSPACE, { recursive: true });
    tmp ??= await mkdtemp(path.join(WORKSPACE, "test-reaper-"));
    const file = path.join(tmp, "restore.wav");
    await writeFile(file, wav(1));
    const output = path.join(tmp, "restore-out.wav");
    const before = await daw.getProjectState();
    try {
      const { item } = await daw.importAudio(asAssetPath(file));
      const known = await probe(tmp, "set", item.id, true);
      expect(known).toMatchObject({ selected: "true", RENDER_PATTERN: "probe-pattern", RENDER_FILE: "probe-dir", RENDER_BOUNDSFLAG: "1" });

      const job = await waitForJob(await daw.render(item.id, asAssetPath(output)));
      expect(job.status).toBe("done");
      expect(await probe(tmp, "after-ok", item.id, false)).toEqual(known);

      // A failing render (the output already exists) must leave things as they were, too.
      const failed = await waitForJob(await daw.render(item.id, asAssetPath(output)));
      expect(failed.status).toBe("failed");
      expect(await probe(tmp, "after-failed", item.id, false)).toEqual(known);
    } finally {
      await restore(before.tracks.map((t) => t.id));
      await rm(output, { force: true });
    }
  });
});
