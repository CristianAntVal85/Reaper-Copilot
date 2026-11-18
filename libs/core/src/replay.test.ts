import { describe, expect, it } from "vitest";
import {
  AudioFeaturesSchema,
  ReplayAssetsSchema,
  ReplayIndexSchema,
  ReplayRunSchema,
  type ReplayAssets,
  type ReplayRun,
} from "./index.ts";

const features = AudioFeaturesSchema.parse({
  schemaVersion: 2,
  file: { sha256: "a".repeat(64), durationSec: 5.647, sampleRate: 44100, channels: 2 },
  tempo: { bpm: 170, confidence: 0.9, alternatives: [85, 340], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.8 },
  loudness: { integratedLufs: -14, peakDb: -1 },
  bands: { sub: -30, bass: -20, lowMid: -22, mid: -24, highMid: -28, high: -35 },
  dynamics: { crestFactorDb: 12 },
});

function assets(): ReplayAssets {
  return {
    durationSec: 5.647,
    waveform: {
      min: Array.from({ length: 800 }, () => -0.5),
      max: Array.from({ length: 800 }, () => 0.5),
    },
    spectrum: {
      freqHz: Array.from({ length: 96 }, (_, i) => 20 * 1000 ** (i / 95)),
      db: Array.from({ length: 96 }, () => -40),
    },
  };
}

function run(): ReplayRun {
  return {
    schemaVersion: 1,
    taskId: "11111111-1111-4111-8111-111111111111",
    title: "Loop of 4 bars at 170 BPM",
    request: "Make a loop",
    createdAt: "2026-01-01T00:00:00.000Z",
    target: { bpm: 170, bars: 4, beatsPerBar: 4 },
    criteria: [
      { id: "tempo", derived: true, metric: "tempo.bpm", basis: "absolute", min: 169, max: 171 },
    ],
    source: { file: "source.mp3", features, assets: assets() },
    verifications: [
      {
        attempt: 1,
        verifiedAt: "2026-01-01T00:01:00.000Z",
        pass: true,
        results: [
          {
            id: "tempo",
            derived: true,
            metric: "tempo.bpm",
            basis: "absolute",
            status: "pass",
            measured: 170,
            min: 169,
            max: 171,
            sourceValue: null,
            renderValue: null,
          },
        ],
        render: { file: "render-1.mp3", features, assets: assets() },
      },
    ],
    steps: [
      {
        step: 1,
        sessionId: "s1",
        tool: "start_task",
        startedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 8,
        ok: true,
        errorCode: null,
        args: { request: "Make a loop" },
        result: { taskId: "x" },
      },
      {
        step: 2,
        sessionId: "s1",
        tool: "verify_task",
        startedAt: "2026-01-01T00:00:02.000Z",
        durationMs: 3,
        ok: false,
        errorCode: "invalid_input",
        args: {},
        result: null,
      },
    ],
  };
}

describe("ReplayAssetsSchema", () => {
  it("accepts valid assets", () => {
    expect(ReplayAssetsSchema.safeParse(assets()).success).toBe(true);
  });

  it("rejects a waveform that is not 800 points", () => {
    const bad = assets();
    bad.waveform.min = bad.waveform.min.slice(1);
    expect(ReplayAssetsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects waveform values outside [-1, 1]", () => {
    const bad = assets();
    bad.waveform.max[3] = 1.01;
    expect(ReplayAssetsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a spectrum that is not 96 points", () => {
    const bad = assets();
    bad.spectrum.db.pop();
    expect(ReplayAssetsSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects non-increasing or out-of-range frequencies", () => {
    const flat = assets();
    flat.spectrum.freqHz[10] = flat.spectrum.freqHz[9] as number;
    expect(ReplayAssetsSchema.safeParse(flat).success).toBe(false);
    const low = assets();
    low.spectrum.freqHz[0] = 10;
    expect(ReplayAssetsSchema.safeParse(low).success).toBe(false);
    const high = assets();
    high.spectrum.freqHz[95] = 20001;
    expect(ReplayAssetsSchema.safeParse(high).success).toBe(false);
  });

  it("rejects db below -120 or non-finite, and a non-positive duration", () => {
    const low = assets();
    low.spectrum.db[0] = -120.1;
    expect(ReplayAssetsSchema.safeParse(low).success).toBe(false);
    const inf = assets();
    inf.spectrum.db[0] = Number.NEGATIVE_INFINITY;
    expect(ReplayAssetsSchema.safeParse(inf).success).toBe(false);
    expect(ReplayAssetsSchema.safeParse({ ...assets(), durationSec: 0 }).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ReplayAssetsSchema.safeParse({ ...assets(), extra: 1 }).success).toBe(false);
  });
});

describe("ReplayRunSchema", () => {
  it("accepts a complete run", () => {
    expect(ReplayRunSchema.safeParse(run()).success).toBe(true);
  });

  it.each(["../render.mp3", "a/b.mp3", "/abs.mp3", "..", "Render.mp3", "render.wav", "a b.mp3"])(
    "rejects file %s",
    (file) => {
      const bad = run();
      bad.source.file = file;
      expect(ReplayRunSchema.safeParse(bad).success).toBe(false);
      const bad2 = run();
      (bad2.verifications[0] as { render: { file: string } }).render.file = file;
      expect(ReplayRunSchema.safeParse(bad2).success).toBe(false);
    },
  );

  it("bounds the title to 1..120 characters", () => {
    expect(ReplayRunSchema.safeParse({ ...run(), title: "" }).success).toBe(false);
    expect(ReplayRunSchema.safeParse({ ...run(), title: "x".repeat(121) }).success).toBe(false);
    expect(ReplayRunSchema.safeParse({ ...run(), title: "x".repeat(120) }).success).toBe(true);
  });

  it("requires schemaVersion 1 and at least one verification", () => {
    expect(ReplayRunSchema.safeParse({ ...run(), schemaVersion: 2 }).success).toBe(false);
    expect(ReplayRunSchema.safeParse({ ...run(), verifications: [] }).success).toBe(false);
  });

  it("rejects steps that carry taskId or cacheHits, and inconsistent failures", () => {
    const withTask = run();
    Object.assign(withTask.steps[0] as object, { taskId: null });
    expect(ReplayRunSchema.safeParse(withTask).success).toBe(false);
    const withHits = run();
    Object.assign(withHits.steps[0] as object, { cacheHits: 0 });
    expect(ReplayRunSchema.safeParse(withHits).success).toBe(false);
    const inconsistent = run();
    (inconsistent.steps[1] as { errorCode: string | null }).errorCode = null;
    expect(ReplayRunSchema.safeParse(inconsistent).success).toBe(false);
  });
});

describe("ReplayIndexSchema", () => {
  const entry = {
    taskId: "11111111-1111-4111-8111-111111111111",
    title: "Loop",
    createdAt: "2026-01-01T00:00:00.000Z",
    pass: true,
    attempts: 2,
  };

  it("accepts an empty and a populated index", () => {
    expect(ReplayIndexSchema.safeParse({ schemaVersion: 1, runs: [] }).success).toBe(true);
    expect(ReplayIndexSchema.safeParse({ schemaVersion: 1, runs: [entry] }).success).toBe(true);
  });

  it("rejects a bad entry, a wrong version and unknown keys", () => {
    expect(
      ReplayIndexSchema.safeParse({ schemaVersion: 1, runs: [{ ...entry, attempts: 0 }] }).success,
    ).toBe(false);
    expect(ReplayIndexSchema.safeParse({ schemaVersion: 2, runs: [] }).success).toBe(false);
    expect(ReplayIndexSchema.safeParse({ schemaVersion: 1, runs: [], x: 1 }).success).toBe(false);
  });
});
