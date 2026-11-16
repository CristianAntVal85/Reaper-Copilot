import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE, readConfig } from "./config.ts";

describe("readConfig", () => {
  it("defaults to mentor mode, the repository workspace and the adapter's Python", () => {
    expect(readConfig({})).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
    });
    expect(DEFAULT_WORKSPACE.endsWith("/workspace")).toBe(true);
  });

  it("reads MODE, COPILOT_WORKSPACE and COPILOT_PYTHON", () => {
    expect(
      readConfig({ MODE: "agent", COPILOT_WORKSPACE: "/data/ws", COPILOT_PYTHON: "/usr/bin/python3" }),
    ).toEqual({ mode: "agent", workspaceRoot: "/data/ws", pythonPath: "/usr/bin/python3" });
  });

  it("treats empty values as unset", () => {
    expect(readConfig({ MODE: "", COPILOT_WORKSPACE: " ", COPILOT_PYTHON: "" })).toEqual({
      mode: "mentor",
      workspaceRoot: DEFAULT_WORKSPACE,
      pythonPath: undefined,
    });
  });

  it("rejects an unknown MODE instead of guessing", () => {
    expect(() => readConfig({ MODE: "root" })).toThrow(/invalid MODE/);
  });
});
