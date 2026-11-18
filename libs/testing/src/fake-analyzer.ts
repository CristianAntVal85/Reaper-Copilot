import type {
  AnalyzeOptions,
  AnalyzerPort,
  AssetPath,
  AudioFeatures,
  ReplayAssets,
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

/** Valid `ReplayAssets`: a flat waveform and a falling spectrum on 96 log-spaced bands. */
export const SAMPLE_REPLAY_ASSETS: ReplayAssets = {
  durationSec: 12.5,
  waveform: {
    min: Array.from({ length: 800 }, () => -0.5),
    max: Array.from({ length: 800 }, () => 0.5),
  },
  spectrum: {
    freqHz: Array.from({ length: 96 }, (_, i) => Math.round(20 * 1000 ** (i / 95) * 100) / 100),
    db: Array.from({ length: 96 }, (_, i) => -20 - i * 0.5),
  },
};

export interface ReplayAssetsCall {
  readonly input: AssetPath;
  readonly output: string;
}

export interface AnalyzerCall {
  readonly path: AssetPath;
  readonly options: AnalyzeOptions | undefined;
}

/** In-memory `AnalyzerPort`: configurable result, configurable failure, call log. */
export class FakeAnalyzer implements AnalyzerPort {
  result: AudioFeatures;
  /** When set, `analyze` rejects with this error instead of returning `result`. */
  error: Error | undefined;
  /** When set, picks the result per analyzed path instead of `result`. */
  resultFor: ((path: AssetPath) => AudioFeatures) | undefined;
  readonly calls: AnalyzerCall[] = [];
  readonly replayAssetsCalls: ReplayAssetsCall[] = [];
  /** Result of `replayAssets`; when `error` is set, that is thrown instead. */
  replayAssetsResult: ReplayAssets = SAMPLE_REPLAY_ASSETS;

  constructor(init: {
      result?: AudioFeatures;
      error?: Error;
      resultFor?: (path: AssetPath) => AudioFeatures;
    } = {},) {
    this.result = init.result ?? SAMPLE_AUDIO_FEATURES;
    this.error = init.error;
    this.resultFor = init.resultFor;
  }

  async analyze(path: AssetPath, options?: AnalyzeOptions): Promise<AudioFeatures> {
    this.calls.push({ path, options });
    if (this.error) throw this.error;
    return this.resultFor ? this.resultFor(path) : this.result;
  }

  async replayAssets(input: AssetPath, output: string): Promise<ReplayAssets> {
    this.replayAssetsCalls.push({ input, output });
    if (this.error) throw this.error;
    return this.replayAssetsResult;
  }
}
