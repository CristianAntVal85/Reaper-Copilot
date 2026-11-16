import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeDaw, FakeStorage } from "@reaper-copilot/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importAudio } from "./import-audio.ts";
import { setTempo } from "./set-tempo.ts";
import type { ToolContext } from "./tool-definition.ts";
import { undoLast } from "./undo-last.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-mut-")));
  await mkdir(path.join(ws, "demo"));
  await writeFile(path.join(ws, "demo", "loop.wav"), "x");
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

describe("import_audio", () => {
  it("imports a workspace file and returns a relative source", async () => {
    const daw = new FakeDaw();
    const out = importAudio.outputSchema.parse(
      await importAudio.handler({ path: "demo/loop.wav" }, context(daw)),
    );
    expect(out.item.source).toBe("demo/loop.wav");
    expect(JSON.stringify(out)).not.toContain(ws);
    expect(daw.calls.map((c) => c.method)).toEqual(["importAudio"]);
  });

  it("rejects a path outside the workspace without calling the DAW", async () => {
    const daw = new FakeDaw();
    await expect(importAudio.handler({ path: "../x.wav" }, context(daw))).rejects.toMatchObject({
      code: "path_outside_workspace",
    });
    expect(daw.calls).toEqual([]);
  });

  it("is a write tool and needs a DAW", async () => {
    expect(importAudio.risk).toBe("write");
    await expect(importAudio.handler({ path: "demo/loop.wav" }, context())).rejects.toMatchObject({
      code: "daw_unavailable",
    });
  });
});

describe("set_tempo", () => {
  it("sets the tempo and limits it to 40-320", async () => {
    const daw = new FakeDaw();
    expect(await setTempo.handler({ bpm: 170 }, context(daw))).toEqual({ tempo: 170 });
    expect(setTempo.inputSchema.safeParse({ bpm: 39 }).success).toBe(false);
    expect(setTempo.inputSchema.safeParse({ bpm: 321 }).success).toBe(false);
    expect(setTempo.risk).toBe("write");
  });
});

describe("undo_last", () => {
  it("undoes the copilot's steps and then reports nothing_to_undo", async () => {
    const daw = new FakeDaw();
    await setTempo.handler({ bpm: 170 }, context(daw));
    expect(await undoLast.handler({}, context(daw))).toEqual({ undone: "Copilot: set_tempo" });
    const error = await undoLast.handler({}, context(daw)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CopilotError);
    expect(error).toMatchObject({ code: "nothing_to_undo" });
    expect(undoLast.risk).toBe("write");
  });
});
