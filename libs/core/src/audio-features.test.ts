import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ANALYSIS_REVISION, AudioFeaturesSchema } from "./index.ts";

const valid = {
  schemaVersion: 2,
  file: { sha256: "a".repeat(64), durationSec: 12.4, sampleRate: 44100, channels: 2 },
  tempo: { bpm: 128.0, confidence: 0.82, alternatives: [64.0, 256.0], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.61 },
  loudness: { integratedLufs: -9.3, peakDb: -0.4 },
  bands: { sub: -18.2, bass: -12.1, lowMid: -14.0, mid: -15.3, highMid: -17.8, high: -22.5 },
  dynamics: { crestFactorDb: 7.9 },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Draft = Record<string, any>;

function variant(mutate: (draft: Draft) => void): unknown {
  const draft = JSON.parse(JSON.stringify(valid)) as Draft;
  mutate(draft);
  return draft;
}

describe("AudioFeaturesSchema", () => {
  it("accepts the example from the master document", () => {
    expect(AudioFeaturesSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a tempo target", () => {
    const withTarget = variant((d) => {
      d.tempo.target = { bpm: 190, deviationBpm: -30.05, matches: false };
    });
    expect(AudioFeaturesSchema.safeParse(withTarget).success).toBe(true);
  });

  it("exposes the analysis revision", () => {
    expect(ANALYSIS_REVISION).toBe("2");
  });

  it("derives its type with z.infer", () => {
    const parsed: z.infer<typeof AudioFeaturesSchema> = AudioFeaturesSchema.parse(valid);
    expect(parsed.key.tonic).toBe("A");
  });

  it.each<[string, (d: Draft) => void]>([
    ["missing field", (d) => delete d.tempo.confidence],
    ["missing section", (d) => delete d.bands],
    ["bpm as text", (d) => (d.tempo.bpm = "128")],
    ["schemaVersion 1", (d) => (d.schemaVersion = 1)],
    ["tempo without target", (d) => delete d.tempo.target],
    ["target without matches", (d) => (d.tempo.target = { bpm: 190, deviationBpm: -30 })],
    [
      "target with NaN deviation",
      (d) => (d.tempo.target = { bpm: 190, deviationBpm: NaN, matches: false }),
    ],
    [
      "target with infinite deviation",
      (d) => (d.tempo.target = { bpm: 190, deviationBpm: Infinity, matches: false }),
    ],
    [
      "target with extra field",
      (d) => (d.tempo.target = { bpm: 190, deviationBpm: -30, matches: false, extra: 1 }),
    ],
    ["invalid tonic", (d) => (d.key.tonic = "H")],
    ["invalid mode", (d) => (d.key.mode = "dorian")],
    ["NaN", (d) => (d.loudness.integratedLufs = NaN)],
    ["Infinity", (d) => (d.bands.sub = Infinity)],
    ["-Infinity", (d) => (d.loudness.peakDb = -Infinity)],
    ["confidence above 1", (d) => (d.key.confidence = 1.5)],
    ["short sha256", (d) => (d.file.sha256 = "abc")],
    ["unknown field", (d) => (d.extra = 1)],
  ])("rejects %s", (_name, mutate) => {
    expect(AudioFeaturesSchema.safeParse(variant(mutate)).success).toBe(false);
  });
});
