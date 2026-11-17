import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeDaw, FakeStorage } from "@reaper-copilot/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobStatus } from "./get-job-status.ts";
import { importAudio } from "./import-audio.ts";
import { renderSelection } from "./render-selection.ts";
import { setTempo } from "./set-tempo.ts";
import { sliceLoop } from "./slice-loop.ts";
import { timeStretch } from "./time-stretch.ts";
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

describe("slice_loop and time_stretch", () => {
  async function imported(daw: FakeDaw): Promise<string> {
    const out = await importAudio.handler({ path: "demo/loop.wav" }, context(daw));
    return out.item.id;
  }

  it("slices with defaults, relative source, and is idempotent", async () => {
    const daw = new FakeDaw();
    daw.defaultSourceLengthSec = 30;
    const itemId = await imported(daw);
    const input = sliceLoop.inputSchema.parse({ itemId, sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 });
    expect(input.beatsPerBar).toBe(4);
    const first = sliceLoop.outputSchema.parse(await sliceLoop.handler(input, context(daw)));
    const second = await sliceLoop.handler(input, context(daw));
    expect(second).toEqual(first);
    expect(first.startOffsetSec).toBeCloseTo(0.5 + 4 * 1.6, 9);
    expect(first.lengthSec).toBeCloseTo(6.4, 9);
    expect(first.source).toBe("demo/loop.wav");
    expect(sliceLoop.risk).toBe("write");
  });

  it("limits the slice input and reports out_of_range past the source", async () => {
    const shape = { itemId: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}", sourceBpm: 150, startBar: 1, bars: 4 };
    expect(sliceLoop.inputSchema.safeParse(shape).success).toBe(true);
    for (const bad of [{ startBar: 0 }, { bars: 65 }, { sourceBpm: 59 }, { beatsPerBar: 17 }, { offsetSec: -1 }, { itemId: "x" }]) {
      expect(sliceLoop.inputSchema.safeParse({ ...shape, ...bad }).success).toBe(false);
    }
    const daw = new FakeDaw();
    daw.defaultSourceLengthSec = 10;
    const itemId = await imported(daw);
    await expect(
      sliceLoop.handler(sliceLoop.inputSchema.parse({ ...shape, itemId, startBar: 5 }), context(daw)),
    ).rejects.toMatchObject({ code: "out_of_range" });
  });

  it("stretches idempotently and rejects a rate outside [0.5, 2]", async () => {
    const daw = new FakeDaw();
    daw.defaultSourceLengthSec = 30;
    const itemId = await imported(daw);
    await sliceLoop.handler(sliceLoop.inputSchema.parse({ itemId, sourceBpm: 150, startBar: 5, bars: 4, offsetSec: 0.5 }), context(daw));
    const input = { itemId, sourceBpm: 150, targetBpm: 170 };
    const first = timeStretch.outputSchema.parse(await timeStretch.handler(input, context(daw)));
    expect(first.lengthSec).toBeCloseTo(5.647059, 5);
    expect(await timeStretch.handler(input, context(daw))).toEqual(first);
    await expect(timeStretch.handler({ ...input, targetBpm: 320 }, context(daw))).rejects.toMatchObject({
      code: "out_of_range",
    });
    expect(timeStretch.risk).toBe("write");
  });

  it("need a DAW", async () => {
    const id = "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}";
    await expect(timeStretch.handler({ itemId: id, sourceBpm: 150, targetBpm: 170 }, context())).rejects.toMatchObject({
      code: "daw_unavailable",
    });
  });
});

describe("render_selection and get_job_status", () => {
  it("renders to a generated name in workspace/renders and reports a relative path", async () => {
    const daw = new FakeDaw();
    daw.defaultSourceLengthSec = 30;
    const { item } = await importAudio.handler({ path: "demo/loop.wav" }, context(daw));
    const { jobId } = await renderSelection.handler({ itemId: item.id }, context(daw));

    const rendering = await getJobStatus.handler({ jobId }, context(daw));
    expect(rendering).toMatchObject({ status: "rendering", output: null });
    const call = daw.calls.find((c) => c.method === "render");
    const output = String(call?.args[1]);
    expect(path.dirname(output)).toBe(path.join(ws, "renders"));
    expect(path.basename(output)).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}\.wav$/);

    await expect(setTempo.handler({ bpm: 160 }, context(daw))).rejects.toMatchObject({ code: "daw_busy" });
    daw.completeJob(jobId);
    const done = getJobStatus.outputSchema.parse(await getJobStatus.handler({ jobId }, context(daw)));
    expect(done).toMatchObject({ status: "done", output: { path: `renders/${path.basename(output)}`, durationSec: 30 } });
    expect(JSON.stringify(done)).not.toContain(ws);
  });

  it("reports failures and unknown jobs, and both need a DAW", async () => {
    const daw = new FakeDaw();
    const { item } = await importAudio.handler({ path: "demo/loop.wav" }, context(daw));
    const { jobId } = await renderSelection.handler({ itemId: item.id }, context(daw));
    daw.failJob(jobId, "render_failed");
    expect(await getJobStatus.handler({ jobId }, context(daw))).toMatchObject({ status: "failed", errorCode: "render_failed" });
    await expect(getJobStatus.handler({ jobId: "nope" }, context(daw))).rejects.toMatchObject({ code: "job_not_found" });
    await expect(renderSelection.handler({ itemId: item.id }, context())).rejects.toMatchObject({ code: "daw_unavailable" });
    await expect(getJobStatus.handler({ jobId }, context())).rejects.toMatchObject({ code: "daw_unavailable" });
    expect(renderSelection.risk).toBe("write");
    expect(getJobStatus.risk).toBe("read");
  });

  it("refuses a renders directory that points outside the workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "rca-out-"));
    const ws2 = await realpath(await mkdtemp(path.join(tmpdir(), "rca-ws2-")));
    try {
      await symlink(outside, path.join(ws2, "renders"));
      const daw = new FakeDaw();
      const ctx = { ...context(daw), workspaceRoot: ws2 };
      await expect(renderSelection.handler({ itemId: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" }, ctx)).rejects.toMatchObject({
        code: "path_outside_workspace",
      });
      expect(daw.calls).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
      await rm(ws2, { recursive: true, force: true });
    }
  });
});
