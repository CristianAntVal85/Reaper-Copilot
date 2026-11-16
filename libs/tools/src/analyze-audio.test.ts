import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AudioFeaturesSchema, CopilotError } from "@reaper-copilot/core";
import { FakeAnalyzer, FakeStorage } from "@reaper-copilot/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeAudio, AnalyzeAudioInputSchema } from "./analyze-audio.ts";
import { ALL_TOOLS } from "./tools.ts";

let ws: string;

beforeAll(async () => {
  ws = await realpath(await mkdtemp(path.join(tmpdir(), "rca-analyze-")));
  await writeFile(path.join(ws, "song.wav"), "x");
});

afterAll(async () => {
  await rm(ws, { recursive: true, force: true });
});

const run = (analyzer: FakeAnalyzer, input: { path: string; targetBpm?: number }) =>
  analyzeAudio.handler(input, {
    workspaceRoot: ws,
    analyzer,
    storage: new FakeStorage(),
    log: () => {},
  });

describe("analyze_audio", () => {
  it("is a read tool and part of ALL_TOOLS", () => {
    expect(analyzeAudio.risk).toBe("read");
    expect(ALL_TOOLS).toContain(analyzeAudio);
  });

  it("returns a result that satisfies the output schema", async () => {
    const result = await run(new FakeAnalyzer(), { path: "song.wav" });
    expect(analyzeAudio.outputSchema.safeParse(result).success).toBe(true);
    expect(AudioFeaturesSchema.safeParse(result).success).toBe(true);
  });

  it("validates the path before analyzing", async () => {
    const analyzer = new FakeAnalyzer();
    await expect(run(analyzer, { path: "../etc/passwd" })).rejects.toMatchObject({
      code: "path_outside_workspace",
    });
    await expect(run(analyzer, { path: "missing.wav" })).rejects.toMatchObject({
      code: "file_not_found",
    });
    expect(analyzer.calls).toEqual([]);
  });

  it("passes the resolved path and targetBpm to the analyzer", async () => {
    const analyzer = new FakeAnalyzer();
    await run(analyzer, { path: "song.wav", targetBpm: 190 });
    expect(analyzer.calls).toEqual([
      { path: path.join(ws, "song.wav"), options: { targetBpm: 190 } },
    ]);
  });

  it("omits targetBpm when not given", async () => {
    const analyzer = new FakeAnalyzer();
    await run(analyzer, { path: "song.wav" });
    expect(analyzer.calls[0]?.options).toEqual({});
  });

  it("propagates a CopilotError from the analyzer unchanged", async () => {
    const error = new CopilotError("analysis_timeout", "too slow");
    await expect(run(new FakeAnalyzer({ error }), { path: "song.wav" })).rejects.toBe(error);
  });

  it("wraps an unexpected analyzer error as CopilotError", async () => {
    const cause = new Error("boom");
    const failure = run(new FakeAnalyzer({ error: cause }), { path: "song.wav" });
    await expect(failure).rejects.toBeInstanceOf(CopilotError);
    await expect(failure).rejects.toMatchObject({ code: "analysis_failed", cause });
  });

  it("limits targetBpm to 60-320", () => {
    const parse = (targetBpm: number) =>
      AnalyzeAudioInputSchema.safeParse({ path: "a.wav", targetBpm }).success;
    expect([59.9, 60, 190, 320, 320.1, Number.NaN].map(parse)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(AnalyzeAudioInputSchema.safeParse({ path: "a.wav" }).success).toBe(true);
    expect(AnalyzeAudioInputSchema.safeParse({ path: "" }).success).toBe(false);
  });
});
