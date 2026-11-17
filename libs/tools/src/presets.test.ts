import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadPresets } from "./presets.ts";

const PRESET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../reaper/presets");

const valid = {
  id: "demo",
  description: "d",
  fx: [{ plugin: "ReaLimit (Cockos)", params: { Threshold: { knob: "t" } } }],
  knobs: { t: { description: "t", unit: "dB", min: -12, max: 0, default: -6 } },
};

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function dirWith(files: Record<string, unknown>): Promise<string> {
  dir = await mkdtemp(path.join(tmpdir(), "rca-presets-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

describe("loadPresets", () => {
  it("loads the shipped presets", async () => {
    const presets = await loadPresets(PRESET_DIR);
    expect(presets.map((p) => p.id)).toEqual(["distortion_hard", "eq_lowcut", "limiter_loud"]);
  });

  it("loads a valid file", async () => {
    expect((await loadPresets(await dirWith({ "demo.json": valid }))).map((p) => p.id)).toEqual(["demo"]);
  });

  it("fails on a knob that is used but not defined", async () => {
    await expect(loadPresets(await dirWith({ "demo.json": { ...valid, knobs: {} } }))).rejects.toThrow(/demo\.json/);
  });

  it("fails on a plugin outside the allowed list", async () => {
    const bad = { ...valid, fx: [{ plugin: "C:\\evil\\x.dll", params: { Threshold: { knob: "t" } } }] };
    await expect(loadPresets(await dirWith({ "demo.json": bad }))).rejects.toThrow(/demo\.json/);
  });

  it("fails when the id differs from the file name", async () => {
    await expect(loadPresets(await dirWith({ "other.json": valid }))).rejects.toThrow(/other\.json/);
  });

  it("fails on malformed JSON and on a missing directory", async () => {
    await expect(loadPresets(await dirWith({ "demo.json": "{" }))).rejects.toThrow(/demo\.json/);
    await expect(loadPresets(path.join(tmpdir(), "rca-no-such-dir"))).rejects.toThrow();
  });
});
