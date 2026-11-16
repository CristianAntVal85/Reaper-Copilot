import { ProjectStateSchema } from "@reaper-copilot/core";
import { describe, expect, it } from "vitest";
import { ReaperDaw } from "./reaper-daw.ts";

// Needs Reaper open with reaper/bridge/bridge.lua loaded (see CLAUDE.md).
const daw = new ReaperDaw({ pathStyle: process.env["WSL_DISTRO_NAME"] ? "unc" : "identity" });

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
});
