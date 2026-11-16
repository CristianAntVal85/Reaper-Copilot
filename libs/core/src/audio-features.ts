import { z } from "zod";

export const AUDIO_FEATURES_SCHEMA_VERSION = 2;

/**
 * Revision of the analysis method in `python/analysis`. Bump it by hand whenever the method
 * changes without a contract change, so cached analyses from the old method are not reused.
 */
export const ANALYSIS_REVISION = "1";

export const TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const finite = z.number().finite();
const confidence = finite.min(0).max(1);

export const AudioFeaturesSchema = z.strictObject({
  schemaVersion: z.literal(AUDIO_FEATURES_SCHEMA_VERSION),
  file: z.strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    durationSec: finite.positive(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
  }),
  tempo: z.strictObject({
    bpm: finite.positive(),
    confidence,
    alternatives: z.array(finite.positive()),
    target: z
      .strictObject({
        bpm: finite.positive(),
        deviationBpm: finite,
        matches: z.boolean(),
      })
      .nullable(),
  }),
  key: z.strictObject({
    tonic: z.enum(TONICS),
    mode: z.enum(["major", "minor"]),
    confidence,
  }),
  loudness: z.strictObject({
    integratedLufs: finite,
    peakDb: finite,
  }),
  bands: z.strictObject({
    sub: finite,
    bass: finite,
    lowMid: finite,
    mid: finite,
    highMid: finite,
    high: finite,
  }),
  dynamics: z.strictObject({
    crestFactorDb: finite,
  }),
});

export type AudioFeatures = z.infer<typeof AudioFeaturesSchema>;
