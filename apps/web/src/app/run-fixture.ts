import { AudioFeaturesSchema, type ReplayAssets, type ReplayRun } from "@reaper-copilot/core";

/** Valid two-attempt run (fail, then pass) shared by the page tests. No test-runner imports. */
export const SAMPLE_TASK_ID = "11111111-1111-4111-8111-111111111111";

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

export function sampleRun(overrides: Partial<ReplayRun> = {}): ReplayRun {
  return {
    schemaVersion: 1,
    taskId: SAMPLE_TASK_ID,
    title: "Loop of 4 bars at 170 BPM",
    request: "Make a loop at 170 BPM",
    createdAt: "2026-11-02T10:15:00.000Z",
    target: { bpm: 170, bars: 4, beatsPerBar: 4 },
    criteria: [
      { id: "tempo", derived: true, metric: "tempo.bpm", basis: "absolute", min: 169, max: 171 },
      { id: "brighter", derived: false, metric: "bands.high", basis: "delta", min: 3, max: null },
    ],
    source: { file: "source.mp3", features, assets: assets() },
    verifications: [
      {
        attempt: 1,
        verifiedAt: "2026-11-02T10:16:00.000Z",
        pass: false,
        results: [
          {
            id: "tempo",
            derived: true,
            metric: "tempo.bpm",
            basis: "absolute",
            status: "fail",
            measured: 150.25,
            min: 169,
            max: 171,
            sourceValue: null,
            renderValue: null,
          },
          {
            id: "brighter",
            derived: false,
            metric: "bands.high",
            basis: "delta",
            status: "pass",
            measured: 4.5,
            min: 3,
            max: null,
            sourceValue: -35,
            renderValue: -30.5,
          },
        ],
        render: { file: "render-1.mp3", features, assets: assets() },
      },
      {
        attempt: 2,
        verifiedAt: "2026-11-02T10:18:00.000Z",
        pass: true,
        results: [
          {
            id: "tempo",
            derived: true,
            metric: "tempo.bpm",
            basis: "absolute",
            status: "pass",
            measured: 170.1,
            min: 169,
            max: 171,
            sourceValue: null,
            renderValue: null,
          },
          {
            id: "brighter",
            derived: false,
            metric: "bands.high",
            basis: "delta",
            status: "pass",
            measured: 6.25,
            min: 3,
            max: null,
            sourceValue: -35,
            renderValue: -28.75,
          },
        ],
        render: { file: "render-2.mp3", features, assets: assets() },
      },
    ],
    steps: [
      {
        step: 1,
        sessionId: "s1",
        tool: "start_task",
        startedAt: "2026-11-02T10:15:01.000Z",
        durationMs: 8,
        ok: true,
        errorCode: null,
        args: { request: "Make a loop at 170 BPM" },
        result: { taskId: SAMPLE_TASK_ID },
      },
      {
        step: 2,
        sessionId: "s1",
        tool: "verify_task",
        startedAt: "2026-11-02T10:16:00.000Z",
        durationMs: 3,
        ok: false,
        errorCode: "invalid_input",
        args: { note: "<script>alert(1)</script>" },
        result: null,
      },
    ],
    ...overrides,
  };
}
