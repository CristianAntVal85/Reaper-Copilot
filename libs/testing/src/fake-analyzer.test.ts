import { asAssetPath, AudioFeaturesSchema, CopilotError } from "@reaper-copilot/core";
import { describe, expect, it } from "vitest";
import { FakeAnalyzer, SAMPLE_AUDIO_FEATURES } from "./fake-analyzer.ts";

const song = asAssetPath("/ws/song.wav");

describe("FakeAnalyzer", () => {
  it("ships a sample result that satisfies the contract", () => {
    expect(AudioFeaturesSchema.safeParse(SAMPLE_AUDIO_FEATURES).success).toBe(true);
  });

  it("returns the default result and records the call", async () => {
    const fake = new FakeAnalyzer();
    expect(await fake.analyze(song, { targetBpm: 190 })).toBe(SAMPLE_AUDIO_FEATURES);
    expect(fake.calls).toEqual([{ path: song, options: { targetBpm: 190 } }]);
  });

  it("returns a configured result", async () => {
    const result = { ...SAMPLE_AUDIO_FEATURES, tempo: { ...SAMPLE_AUDIO_FEATURES.tempo, bpm: 90 } };
    const fake = new FakeAnalyzer({ result });
    expect((await fake.analyze(song)).tempo.bpm).toBe(90);
    expect(fake.calls[0]?.options).toBeUndefined();
  });

  it("picks the result per path with resultFor", async () => {
    const other = asAssetPath("/ws/other.wav");
    const fake = new FakeAnalyzer({
      resultFor: (path) =>
        path === other
          ? { ...SAMPLE_AUDIO_FEATURES, tempo: { ...SAMPLE_AUDIO_FEATURES.tempo, bpm: 90 } }
          : SAMPLE_AUDIO_FEATURES,
    });
    expect((await fake.analyze(song)).tempo.bpm).toBe(120);
    expect((await fake.analyze(other)).tempo.bpm).toBe(90);
  });

  it("fails with the configured error and still records the call", async () => {
    const error = new CopilotError("analysis_failed", "boom");
    const fake = new FakeAnalyzer({ error });
    await expect(fake.analyze(song)).rejects.toBe(error);
    expect(fake.calls).toHaveLength(1);
  });
});
