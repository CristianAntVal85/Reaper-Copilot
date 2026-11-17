import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_DIR,
  DEFAULT_PRESETS_DIR,
  DEFAULT_REAPER_IPC_DIR, DEFAULT_WORKSPACE, databasePath, readConfig } from "./config.ts";

describe("readConfig", () => {
  it("defaults to mentor mode, the repository workspace and the adapter's Python", () => {
    expect(readConfig({})).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
      dataDir: DEFAULT_DATA_DIR,
      reaperIpcDir: DEFAULT_REAPER_IPC_DIR,
      reaperPathStyle: "identity",
      presetsDir: DEFAULT_PRESETS_DIR,
    });
    expect(DEFAULT_WORKSPACE.endsWith("/workspace")).toBe(true);
    expect(DEFAULT_DATA_DIR.endsWith("/.copilot")).toBe(true);
    expect(databasePath("/data")).toBe("/data/copilot.db");
  });

  it("reads MODE, COPILOT_WORKSPACE, COPILOT_PYTHON and COPILOT_DATA_DIR", () => {
    expect(
      readConfig({
        MODE: "agent",
        COPILOT_WORKSPACE: "/data/ws",
        COPILOT_PYTHON: "/usr/bin/python3",
        COPILOT_DATA_DIR: "/data/state",
      }),
    ).toEqual({
      mode: "agent",
      workspaceRoot: "/data/ws",
      pythonPath: "/usr/bin/python3",
      dataDir: "/data/state",
      reaperIpcDir: DEFAULT_REAPER_IPC_DIR,
      reaperPathStyle: "identity",
      presetsDir: DEFAULT_PRESETS_DIR,
    });
  });

  it("treats empty values as unset", () => {
    expect(readConfig({ MODE: "", COPILOT_WORKSPACE: " ", COPILOT_PYTHON: "", COPILOT_DATA_DIR: " " })).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
      dataDir: DEFAULT_DATA_DIR,
      reaperIpcDir: DEFAULT_REAPER_IPC_DIR,
      reaperPathStyle: "identity",
      presetsDir: DEFAULT_PRESETS_DIR,
    });
  });

  it("reads the Reaper variables", () => {
    const config = readConfig({
      COPILOT_REAPER_IPC: "/data/ipc",
      COPILOT_REAPER_PATH_STYLE: "unc",
      COPILOT_PRESETS: "/data/presets",
    });
    expect(config.reaperIpcDir).toBe("/data/ipc");
    expect(config.reaperPathStyle).toBe("unc");
    expect(config.presetsDir).toBe("/data/presets");
    expect(DEFAULT_REAPER_IPC_DIR.endsWith("/.copilot/reaper-ipc")).toBe(true);
    expect(DEFAULT_PRESETS_DIR.endsWith("/reaper/presets")).toBe(true);
  });

  it("defaults the path style to unc under WSL and rejects an invalid one", () => {
    expect(readConfig({ WSL_DISTRO_NAME: "Ubuntu" }).reaperPathStyle).toBe("unc");
    expect(readConfig({ WSL_DISTRO_NAME: "Ubuntu", COPILOT_REAPER_PATH_STYLE: "identity" }).reaperPathStyle).toBe(
      "identity",
    );
    expect(() => readConfig({ COPILOT_REAPER_PATH_STYLE: "windows" })).toThrow(/invalid COPILOT_REAPER_PATH_STYLE/);
  });

  it("rejects an unknown MODE instead of guessing", () => {
    expect(() => readConfig({ MODE: "root" })).toThrow(/invalid MODE/);
  });
});
