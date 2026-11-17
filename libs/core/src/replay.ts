import { z } from "zod";
import { AudioFeaturesSchema } from "./audio-features.ts";
import { ToolCallTraceSchema } from "./storage.ts";
import { CriterionResultSchema, TaskCriterionSchema, TaskTargetSchema } from "./task.ts";

export const REPLAY_SCHEMA_VERSION = 1;
export const WAVEFORM_POINTS = 800;
export const SPECTRUM_POINTS = 96;
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 20000;
export const SPECTRUM_FLOOR_DB = -120;
export const REPLAY_TITLE_MAX = 120;
export const REPLAY_FILE_PATTERN = /^[a-z0-9-]+\.mp3$/;

const waveformChannel = z.array(z.number().min(-1).max(1)).length(WAVEFORM_POINTS);

/** Precomputed data for the Replay charts; the web computes nothing. */
export const ReplayAssetsSchema = z.strictObject({
  durationSec: z.number().finite().positive(),
  waveform: z.strictObject({ min: waveformChannel, max: waveformChannel }),
  spectrum: z
    .strictObject({
      freqHz: z
        .array(z.number().finite().min(SPECTRUM_MIN_HZ).max(SPECTRUM_MAX_HZ))
        .length(SPECTRUM_POINTS),
      db: z.array(z.number().finite().min(SPECTRUM_FLOOR_DB)).length(SPECTRUM_POINTS),
    })
    .refine((s) => s.freqHz.every((f, i) => i === 0 || f > (s.freqHz[i - 1] as number)), {
      message: "spectrum.freqHz must be strictly increasing",
      path: ["freqHz"],
    }),
});

export type ReplayAssets = z.infer<typeof ReplayAssetsSchema>;

const replayFile = z.string().regex(REPLAY_FILE_PATTERN, "file must be a plain name like render-1.mp3");

const replayAudio = z.strictObject({
  file: replayFile,
  features: AudioFeaturesSchema,
  assets: ReplayAssetsSchema,
});

const { sessionId, step, tool, args, ok, result, errorCode, durationMs, startedAt } =
  ToolCallTraceSchema.shape;

/** A tool call trace as published: no `taskId` (the run is the task) and no `cacheHits`. */
export const ReplayStepSchema = z
  .strictObject({ step, sessionId, tool, startedAt, durationMs, ok, errorCode, args, result })
  .refine((t) => (t.ok ? t.errorCode === null : t.errorCode !== null && t.result === null), {
    message: "ok steps carry no errorCode; failed steps carry an errorCode and a null result",
  });

export type ReplayStep = z.infer<typeof ReplayStepSchema>;

export const ReplayVerificationSchema = z.strictObject({
  attempt: z.number().int().min(1),
  verifiedAt: z.iso.datetime(),
  pass: z.boolean(),
  results: z.array(CriterionResultSchema),
  render: replayAudio,
});

export type ReplayVerification = z.infer<typeof ReplayVerificationSchema>;

/** `runs/<taskId>/run.json`, written by the exporter and validated by the web. */
export const ReplayRunSchema = z.strictObject({
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  taskId: z.uuid(),
  title: z.string().min(1).max(REPLAY_TITLE_MAX),
  request: z.string().min(1),
  createdAt: z.iso.datetime(),
  target: TaskTargetSchema,
  criteria: z.array(TaskCriterionSchema).min(1),
  source: replayAudio,
  verifications: z.array(ReplayVerificationSchema).min(1),
  steps: z.array(ReplayStepSchema),
});

export type ReplayRun = z.infer<typeof ReplayRunSchema>;

export const ReplayIndexEntrySchema = z.strictObject({
  taskId: z.uuid(),
  title: z.string().min(1).max(REPLAY_TITLE_MAX),
  createdAt: z.iso.datetime(),
  pass: z.boolean(),
  attempts: z.number().int().min(1),
});

export type ReplayIndexEntry = z.infer<typeof ReplayIndexEntrySchema>;

/** `runs/index.json`, most recent run first. */
export const ReplayIndexSchema = z.strictObject({
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  runs: z.array(ReplayIndexEntrySchema),
});

export type ReplayIndex = z.infer<typeof ReplayIndexSchema>;
