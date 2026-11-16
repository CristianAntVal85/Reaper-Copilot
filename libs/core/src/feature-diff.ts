import { z } from "zod";
import { AudioFeaturesSchema, type AudioFeatures } from "./audio-features.ts";

/** Closed list of compared metrics (master document, section 9.2). */
export const FEATURE_METRICS = [
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
] as const;

export type FeatureMetric = (typeof FEATURE_METRICS)[number];

const METRIC_READERS: Record<FeatureMetric, (f: AudioFeatures) => number> = {
  "file.durationSec": (f) => f.file.durationSec,
  "tempo.bpm": (f) => f.tempo.bpm,
  "loudness.integratedLufs": (f) => f.loudness.integratedLufs,
  "loudness.peakDb": (f) => f.loudness.peakDb,
  "bands.sub": (f) => f.bands.sub,
  "bands.bass": (f) => f.bands.bass,
  "bands.lowMid": (f) => f.bands.lowMid,
  "bands.mid": (f) => f.bands.mid,
  "bands.highMid": (f) => f.bands.highMid,
  "bands.high": (f) => f.bands.high,
  "dynamics.crestFactorDb": (f) => f.dynamics.crestFactorDb,
};

export function readMetric(features: AudioFeatures, metric: FeatureMetric): number {
  return METRIC_READERS[metric](features);
}

const finite = z.number().finite();
const metricDiff = z.strictObject({ a: finite, b: finite, delta: finite });

const metricsShape = Object.fromEntries(FEATURE_METRICS.map((m) => [m, metricDiff])) as Record<
  FeatureMetric,
  typeof metricDiff
>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const fileRef = z.strictObject({ path: z.string().min(1), sha256 });

const tempoSide = z.strictObject({
  confidence: AudioFeaturesSchema.shape.tempo.shape.confidence,
  target: AudioFeaturesSchema.shape.tempo.shape.target,
});

const keyShape = AudioFeaturesSchema.shape.key;

export const FeatureDiffSchema = z.strictObject({
  a: fileRef,
  b: fileRef,
  metrics: z.strictObject(metricsShape),
  tempo: z.strictObject({ a: tempoSide, b: tempoSide }),
  key: z.strictObject({ a: keyShape, b: keyShape, same: z.boolean() }),
});

export type FeatureDiff = z.infer<typeof FeatureDiffSchema>;

export interface FeatureDiffLabels {
  /** Path as given by the client (relative to the workspace), never the absolute one. */
  a: string;
  b: string;
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalizes -0
}

/** Differences between two analyses; `delta = b - a` rounded to 2 decimals. */
export function compareFeatures(
  a: AudioFeatures,
  b: AudioFeatures,
  labels: FeatureDiffLabels,
): FeatureDiff {
  const metrics = Object.fromEntries(
    FEATURE_METRICS.map((metric) => {
      const va = readMetric(a, metric);
      const vb = readMetric(b, metric);
      return [metric, { a: va, b: vb, delta: round2(vb - va) }];
    }),
  ) as FeatureDiff["metrics"];

  return {
    a: { path: labels.a, sha256: a.file.sha256 },
    b: { path: labels.b, sha256: b.file.sha256 },
    metrics,
    tempo: {
      a: { confidence: a.tempo.confidence, target: a.tempo.target },
      b: { confidence: b.tempo.confidence, target: b.tempo.target },
    },
    key: {
      a: a.key,
      b: b.key,
      same: a.key.tonic === b.key.tonic && a.key.mode === b.key.mode,
    },
  };
}
