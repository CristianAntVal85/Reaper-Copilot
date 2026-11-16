import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_DIR, DEFAULT_WORKSPACE, databasePath, readConfig } from "./config.ts";

describe("readConfig", () => {
  it("defaults to mentor mode, the repository workspace and the adapter's Python", () => {
    expect(readConfig({})).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
      dataDir: DEFAULT_DATA_DIR,
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
    });
  });

  it("treats empty values as unset", () => {
    expect(readConfig({ MODE: "", COPILOT_WORKSPACE: " ", COPILOT_PYTHON: "", COPILOT_DATA_DIR: " " })).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
      dataDir: DEFAULT_DATA_DIR,
    });
  });

  it("rejects an unknown MODE instead of guessing", () => {
    expect(() => readConfig({ MODE: "root" })).toThrow(/invalid MODE/);
  });
});
