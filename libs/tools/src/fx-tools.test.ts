import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Preset } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeDaw, FakeStorage } from "@reaper-copilot/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { applyFxChain } from "./apply-fx-chain.ts";
import { listPresets } from "./list-presets.ts";
import { loadPresets } from "./presets.ts";
import type { ToolContext } from "./tool-definition.ts";

const PRESET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../reaper/presets");

let presets: Preset[];
beforeAll(async () => {
  presets = await loadPresets(PRESET_DIR);
});

function context(daw?: FakeDaw, withPresets = true): ToolContext {
  return {
    workspaceRoot: "/tmp",
    analyzer: new FakeAnalyzer(),
    storage: new FakeStorage(),
    log: () => {},
    ...(daw ? { daw } : {}),
    ...(withPresets ? { presets } : {}),
  };
}

async function trackOf(daw: FakeDaw): Promise<string> {
  await daw.importAudio("/tmp/a.wav" as never);
  return (await daw.getProjectState()).tracks[0]!.id;
}

describe("list_presets", () => {
  it("lists ids, descriptions and knobs, and is a read tool", async () => {
    expect(listPresets.risk).toBe("read");
    const out = listPresets.outputSchema.parse(await listPresets.handler({}, context()));
    expect(out.presets.map((p) => p.id)).toContain("distortion_hard");
    expect(out.presets.find((p) => p.id === "distortion_hard")?.knobs["drive"]).toMatchObject({ min: 0, max: 90, default: 60 });
  });

  it("is empty without presets", async () => {
    expect(await listPresets.handler({}, context(undefined, false))).toEqual({ presets: [] });
  });
});

describe("apply_fx_chain", () => {
  it("rejects an out-of-range or unknown knob without calling the DAW", async () => {
    const daw = new FakeDaw();
    const trackId = await trackOf(daw);
    const before = daw.calls.length;
    await expect(
      applyFxChain.handler({ trackId, preset: "distortion_hard", knobs: { drive: 95 } }, context(daw)),
    ).rejects.toMatchObject({ code: "out_of_range" });
    await expect(
      applyFxChain.handler({ trackId, preset: "distortion_hard", knobs: { nope: 1 } }, context(daw)),
    ).rejects.toMatchObject({ code: "out_of_range" });
    expect(daw.calls.length).toBe(before);
  });

  it("reports an unknown preset and a missing DAW", async () => {
    const daw = new FakeDaw();
    const trackId = await trackOf(daw);
    await expect(applyFxChain.handler({ trackId, preset: "nope" }, context(daw))).rejects.toMatchObject({
      code: "preset_not_found",
    });
    await expect(applyFxChain.handler({ trackId, preset: "nope" }, context())).rejects.toMatchObject({
      code: "daw_unavailable",
    });
  });

  it("resolves knobs and defaults into a concrete chain", async () => {
    const daw = new FakeDaw();
    const trackId = await trackOf(daw);
    const out = applyFxChain.outputSchema.parse(
      await applyFxChain.handler({ trackId, preset: "distortion_hard", knobs: { drive: 80 } }, context(daw)),
    );
    expect(out.preset).toBe("distortion_hard");
    const call = daw.calls.at(-1);
    expect(call?.method).toBe("applyFxChain");
    expect(call?.args[1]).toEqual([
      { plugin: "JS: Waveshaping Distortion", params: [{ name: "Distortion (%)", value: 80 }] },
      {
        plugin: "ReaLimit (Cockos)",
        params: [
          { name: "Threshold", value: -6 },
          { name: "Ceiling", value: -0.3 },
        ],
      },
    ]);
    expect(applyFxChain.risk).toBe("write");
  });
});
