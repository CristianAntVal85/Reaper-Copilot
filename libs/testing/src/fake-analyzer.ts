import type {
  AnalyzeOptions,
  AnalyzerPort,
  AssetPath,
  AudioFeatures,
} from "@reaper-copilot/core";

/** A valid `AudioFeatures` value, used when a test does not care about the content. */
export const SAMPLE_AUDIO_FEATURES: AudioFeatures = {
  schemaVersion: 2,
  file: { sha256: "a".repeat(64), durationSec: 12.5, sampleRate: 44100, channels: 2 },
  tempo: { bpm: 120, confidence: 0.9, alternatives: [60, 240], target: null },
  key: { tonic: "A", mode: "minor", confidence: 0.8 },
  loudness: { integratedLufs: -14, peakDb: -1 },
  bands: { sub: -30, bass: -20, lowMid: -22, mid: -24, highMid: -28, high: -35 },
  dynamics: { crestFactorDb: 12 },
};

export interface AnalyzerCall {
  readonly path: AssetPath;
  readonly options: AnalyzeOptions | undefined;
}

/** In-memory `AnalyzerPort`: configurable result, configurable failure, call log. */
export class FakeAnalyzer implements AnalyzerPort {
  result: AudioFeatures;
  /** When set, `analyze` rejects with this error instead of returning `result`. */
  error: Error | undefined;
  readonly calls: AnalyzerCall[] = [];

  constructor(init: { result?: AudioFeatures; error?: Error } = {}) {
    this.result = init.result ?? SAMPLE_AUDIO_FEATURES;
    this.error = init.error;
  }

  async analyze(path: AssetPath, options?: AnalyzeOptions): Promise<AudioFeatures> {
    this.calls.push({ path, options });
    if (this.error) throw this.error;
    return this.result;
  }
}
