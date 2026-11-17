import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asAssetPath, CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeDaw, FakeStorage } from "@reaper-copilot/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProjectState } from "./get-project-state.ts";
import type { ToolContext } from "./tool-definition.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-state-")));
});
afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

function context(daw?: FakeDaw): ToolContext {
  return {
    workspaceRoot: ws,
    analyzer: new FakeAnalyzer(),
    storage: new FakeStorage(),
    log: () => {},
    ...(daw ? { daw } : {}),
  };
}

describe("get_project_state", () => {
  it("returns sources relative to the workspace, or null outside it, never absolute", async () => {
    const daw = new FakeDaw();
    await daw.importAudio(asAssetPath(path.join(ws, "demo", "loop.wav")));
    await daw.importAudio(asAssetPath("/elsewhere/other.wav"));
    const result = getProjectState.outputSchema.parse(
      await getProjectState.handler({}, context(daw)),
    );
    expect(result.tracks[0]?.items[0]?.source).toBe("demo/loop.wav");
    expect(result.tracks[1]?.items[0]?.source).toBeNull();
    expect(JSON.stringify(result)).not.toContain(ws);
    expect(JSON.stringify(result)).not.toContain("/elsewhere");
  });

  it("reports daw_unavailable when no DAW is configured", async () => {
    await expect(getProjectState.handler({}, context())).rejects.toMatchObject({
      code: "daw_unavailable",
    });
    await expect(getProjectState.handler({}, context())).rejects.toBeInstanceOf(CopilotError);
  });

  it("is a read tool", () => {
    expect(getProjectState.risk).toBe("read");
  });
});
