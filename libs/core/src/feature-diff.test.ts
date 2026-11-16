import { describe, expect, it } from "vitest";
import {
  AudioFeaturesSchema,
  FEATURE_METRICS,
  FeatureDiffSchema,
  compareFeatures,
  readMetric,
  type AudioFeatures,
} from "./index.ts";

const base: AudioFeatures = AudioFeaturesSchema.parse({
  schemaVersion: 2,
  file: { sha256: "a".repeat(64), durationSec: 12.4, sampleRate: 44100, channels: 2 },
  tempo: { bpm: 128.0, confidence: 0.82, alternatives: [64.0, 256.0], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.61 },
  loudness: { integratedLufs: -9.3, peakDb: -0.4 },
  bands: { sub: -18.2, bass: -12.1, lowMid: -14.0, mid: -15.3, highMid: -17.8, high: -22.5 },
  dynamics: { crestFactorDb: 7.9 },
});

const other: AudioFeatures = AudioFeaturesSchema.parse({
  schemaVersion: 2,
  file: { sha256: "b".repeat(64), durationSec: 15.123, sampleRate: 48000, channels: 2 },
  tempo: {
    bpm: 130.37,
    confidence: 0.5,
    alternatives: [],
    target: { bpm: 130, deviationBpm: 0.37, matches: true },
  },
  key: { tonic: "B", mode: "minor", confidence: 0.73 },
  loudness: { integratedLufs: -10.333, peakDb: -1.1 },
  bands: { sub: -20, bass: -11.557, lowMid: -14.004, mid: -15, highMid: -18.1, high: -21.5 },
  dynamics: { crestFactorDb: 9.015 },
});

const labels = { a: "demo/a.mp3", b: "demo/b.mp3" };

describe("FEATURE_METRICS", () => {
  it("lists the 11 metrics of the master document", () => {
    expect([...FEATURE_METRICS]).toEqual([
      "file.durationSec",
      "tempo.bpm",
      "loudness.integratedLufs",
      "loudness.peakDb",
      "bands.sub",
      "bands.bass",
      "bands.lowMid",
      "bands.mid",
      "bands.highMid",
      "bands.high",
      "dynamics.crestFactorDb",
    ]);
  });

  it("reads each metric from the features", () => {
    expect(readMetric(other, "file.durationSec")).toBe(15.123);
    expect(readMetric(other, "tempo.bpm")).toBe(130.37);
    expect(readMetric(other, "bands.lowMid")).toBe(-14.004);
    expect(readMetric(other, "dynamics.crestFactorDb")).toBe(9.015);
  });
});

describe("compareFeatures", () => {
  const diff = compareFeatures(base, other, labels);

  it("passes FeatureDiffSchema", () => {
    expect(FeatureDiffSchema.safeParse(diff).success).toBe(true);
  });

  it("has exactly the 11 metric keys", () => {
    expect(Object.keys(diff.metrics).sort()).toEqual([...FEATURE_METRICS].sort());
  });

  it("computes delta = b - a rounded to 2 decimals for every metric", () => {
    for (const metric of FEATURE_METRICS) {
      const a = readMetric(base, metric);
      const b = readMetric(other, metric);
      expect(diff.metrics[metric].a).toBe(a);
      expect(diff.metrics[metric].b).toBe(b);
      expect(diff.metrics[metric].delta).toBe(Math.round((b - a) * 100) / 100 || 0);
    }
    expect(diff.metrics["file.durationSec"].delta).toBe(2.72);
    expect(diff.metrics["tempo.bpm"].delta).toBe(2.37);
    expect(diff.metrics["loudness.integratedLufs"].delta).toBe(-1.03);
    expect(diff.metrics["bands.bass"].delta).toBe(0.54);
    expect(diff.metrics["bands.lowMid"].delta).toBe(0);
    expect(Object.is(diff.metrics["bands.lowMid"].delta, 0)).toBe(true);
  });

  it("labels each side with the client path and the file hash", () => {
    expect(diff.a).toEqual({ path: "demo/a.mp3", sha256: "a".repeat(64) });
    expect(diff.b).toEqual({ path: "demo/b.mp3", sha256: "b".repeat(64) });
  });

  it("reports tempo confidence and target for each side", () => {
    expect(diff.tempo.a).toEqual({ confidence: 0.82, target: null });
    expect(diff.tempo.b.target).toEqual({ bpm: 130, deviationBpm: 0.37, matches: true });
  });

  it("flags different keys", () => {
    expect(diff.key.same).toBe(false);
    expect(diff.key.a.tonic).toBe("A");
    expect(diff.key.b.tonic).toBe("B");
  });

  it("flags same key regardless of confidence", () => {
    const sameKey = { ...other, key: { ...base.key, confidence: 0.1 } };
    expect(compareFeatures(base, sameKey, labels).key.same).toBe(true);
  });

  it("treats the same tonic in another mode as a different key", () => {
    const relative = { ...other, key: { ...base.key, mode: "major" as const } };
    expect(compareFeatures(base, relative, labels).key.same).toBe(false);
  });

  it("gives all deltas 0 (never -0) when comparing an analysis with itself", () => {
    const self = compareFeatures(base, base, labels);
    for (const metric of FEATURE_METRICS) {
      expect(Object.is(self.metrics[metric].delta, 0)).toBe(true);
    }
    expect(self.key.same).toBe(true);
    expect(FeatureDiffSchema.safeParse(self).success).toBe(true);
  });

  it("normalizes a tiny negative difference to 0", () => {
    const tiny = { ...other, loudness: { ...other.loudness, peakDb: base.loudness.peakDb - 0.001 } };
    const d = compareFeatures(base, tiny, labels);
    expect(Object.is(d.metrics["loudness.peakDb"].delta, 0)).toBe(true);
  });
});

describe("FeatureDiffSchema", () => {
  const valid = compareFeatures(base, other, labels);

  it("rejects a diff missing a metric", () => {
    const broken = (JSON.parse(JSON.stringify(valid)) as typeof valid) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    delete broken.metrics["bands.high"];
    expect(FeatureDiffSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an extra metric and a non-finite delta", () => {
    const extra = (JSON.parse(JSON.stringify(valid)) as typeof valid) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    extra.metrics["bands.air"] = { a: 1, b: 1, delta: 0 };
    expect(FeatureDiffSchema.safeParse(extra).success).toBe(false);

    const nan = (JSON.parse(JSON.stringify(valid)) as typeof valid);
    nan.metrics["tempo.bpm"].delta = NaN;
    expect(FeatureDiffSchema.safeParse(nan).success).toBe(false);
  });
});
