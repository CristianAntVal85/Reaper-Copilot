import { z } from "zod";
import type { AudioFeatures } from "./audio-features.ts";
import { FEATURE_METRICS, readMetric, type FeatureMetric } from "./feature-diff.ts";

/** Tempo confidence below this makes tempo-based criteria `unmeasured` (master document, 9.2). */
export const TEMPO_CONFIDENCE_THRESHOLD = 0.1;
/** Tolerance in seconds around the expected duration of the derived `duration` criterion. */
export const DURATION_TOLERANCE_SEC = 0.02;
/** Tolerance in BPM around the target of the derived `tempo` criterion. */
export const TEMPO_TOLERANCE_BPM = 1;
export const DEFAULT_BEATS_PER_BAR = 4;
export const MAX_OWN_CRITERIA = 16;
/** Verifications allowed per task. */
export const MAX_VERIFICATIONS_PER_TASK = 50;
/** Tasks a server session may start. */
export const MAX_TASKS_PER_SESSION = 100;
export const RESERVED_CRITERION_IDS = ["duration", "tempo"] as const;
export const CRITERION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

const finite = z.number().finite();
const metricSchema = z.enum(FEATURE_METRICS);
const basisSchema = z.enum(["absolute", "delta"]);

function checkInterval(
  c: { basis: "absolute" | "delta"; min?: number | null | undefined; max?: number | null | undefined },
  ctx: z.RefinementCtx,
): void {
  const min = c.min ?? null;
  const max = c.max ?? null;
  if (min === null && max === null) {
    ctx.addIssue({ code: "custom", message: "criterion needs at least one of min or max" });
    return;
  }
  if (min !== null && max !== null && min > max) {
    ctx.addIssue({ code: "custom", message: "criterion min must be less than or equal to max" });
  }
  if (c.basis === "delta") {
    const containsZero = (min === null || min <= 0) && (max === null || max >= 0);
    if (containsZero) {
      ctx.addIssue({
        code: "custom",
        message:
          "a delta criterion cannot include 0 in its interval (needs min > 0 or max < 0): a change must be required",
      });
    }
  }
}

/** Criterion as the client writes it in `start_task`. */
export const CriterionSchema = z
  .strictObject({
    id: z.string().regex(CRITERION_ID_PATTERN, "criterion id must match ^[a-z0-9][a-z0-9-]{0,39}$"),
    metric: metricSchema,
    basis: basisSchema,
    min: finite.optional(),
    max: finite.optional(),
  })
  .superRefine(checkInterval);

export type Criterion = z.infer<typeof CriterionSchema>;

/** Criterion as stored and evaluated: normalized limits, plus whether it was derived from the target. */
export const TaskCriterionSchema = z
  .strictObject({
    id: z.string().min(1),
    derived: z.boolean(),
    metric: metricSchema,
    basis: basisSchema,
    min: finite.nullable(),
    max: finite.nullable(),
  })
  .superRefine(checkInterval);

export type TaskCriterion = z.infer<typeof TaskCriterionSchema>;

export const TaskTargetSchema = z
  .strictObject({
    bpm: finite.min(60).max(320).optional(),
    bars: z.number().int().min(1).max(64).optional(),
    beatsPerBar: z.number().int().min(1).max(12).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.bars !== undefined && t.bpm === undefined) {
      ctx.addIssue({ code: "custom", message: "target.bars requires target.bpm" });
    }
  });

export type TaskTarget = z.infer<typeof TaskTargetSchema>;

/** Fills `beatsPerBar` (4 by default) when `bars` is present. */
export function resolveTarget(target: TaskTarget): TaskTarget {
  if (target.bars === undefined) return { ...target };
  return { ...target, beatsPerBar: target.beatsPerBar ?? DEFAULT_BEATS_PER_BAR };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded; // normalizes -0
}

/** Criteria the LLM cannot remove, derived from `target` (master document, 9.2). */
export function deriveCriteria(target: TaskTarget): TaskCriterion[] {
  const derived: TaskCriterion[] = [];
  if (target.bpm !== undefined && target.bars !== undefined) {
    const beatsPerBar = target.beatsPerBar ?? DEFAULT_BEATS_PER_BAR;
    const expected = (target.bars * beatsPerBar * 60) / target.bpm;
    derived.push({
      id: "duration",
      derived: true,
      metric: "file.durationSec",
      basis: "absolute",
      min: round3(expected - DURATION_TOLERANCE_SEC),
      max: round3(expected + DURATION_TOLERANCE_SEC),
    });
  }
  if (target.bpm !== undefined) {
    derived.push({
      id: "tempo",
      derived: true,
      metric: "tempo.bpm",
      basis: "absolute",
      min: target.bpm - TEMPO_TOLERANCE_BPM,
      max: target.bpm + TEMPO_TOLERANCE_BPM,
    });
  }
  return derived;
}

/** Builds the full criteria list to store: derived first, then the client's own. */
export function buildTaskCriteria(target: TaskTarget, own: readonly Criterion[]): TaskCriterion[] {
  return [
    ...deriveCriteria(resolveTarget(target)),
    ...own.map((c) => ({
      id: c.id,
      derived: false,
      metric: c.metric,
      basis: c.basis,
      min: c.min ?? null,
      max: c.max ?? null,
    })),
  ];
}

const requestSchema = z.string().min(1).max(2000);

export const StartTaskInputSchema = z
  .strictObject({
    request: requestSchema,
    source: z.string().min(1),
    target: TaskTargetSchema.default({}),
    criteria: z
      .array(CriterionSchema)
      .max(MAX_OWN_CRITERIA, `at most ${MAX_OWN_CRITERIA} own criteria are allowed`)
      .default([]),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.criteria.forEach((c, i) => {
      if ((RESERVED_CRITERION_IDS as readonly string[]).includes(c.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria", i, "id"],
          message: `criterion id "${c.id}" is reserved for criteria derived from target`,
        });
      }
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["criteria", i, "id"],
          message: `criterion ids must be unique ("${c.id}" is repeated)`,
        });
      }
      seen.add(c.id);
    });
    if (input.criteria.length + deriveCriteria(input.target).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["criteria"],
        message:
          "at least one criterion is required, counting those derived from target (bpm and bars)",
      });
    }
  });

export type StartTaskInput = z.infer<typeof StartTaskInputSchema>;

export const TaskSchema = z.strictObject({
  taskId: z.uuid(),
  createdAt: z.iso.datetime(),
  request: requestSchema,
  source: z.string().min(1),
  target: TaskTargetSchema.refine((t) => t.bars === undefined || t.beatsPerBar !== undefined, {
    message: "stored target must have beatsPerBar resolved when bars is present",
  }),
  criteria: z.array(TaskCriterionSchema).min(1),
});

export type Task = z.infer<typeof TaskSchema>;

export const CriterionResultSchema = z.strictObject({
  id: z.string().min(1),
  derived: z.boolean(),
  metric: metricSchema,
  basis: basisSchema,
  status: z.enum(["pass", "fail", "unmeasured"]),
  measured: finite,
  min: finite.nullable(),
  max: finite.nullable(),
  sourceValue: finite.nullable(),
  renderValue: finite.nullable(),
});

export type CriterionResult = z.infer<typeof CriterionResultSchema>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** Output of `verify_task`. */
export const VerifyTaskOutputSchema = z.strictObject({
  taskId: z.uuid(),
  attempt: z.number().int().min(1),
  render: z.strictObject({ path: z.string().min(1), sha256 }),
  pass: z.boolean(),
  results: z.array(CriterionResultSchema),
});

export type VerifyTaskOutput = z.infer<typeof VerifyTaskOutputSchema>;

/** A verification as stored. */
export const VerificationSchema = VerifyTaskOutputSchema.extend({
  verifiedAt: z.iso.datetime(),
});

export type Verification = z.infer<typeof VerificationSchema>;

/** A verification before the storage assigns its `attempt`. */
export type NewVerification = Omit<Verification, "attempt">;

export interface EvaluationResult {
  pass: boolean;
  results: CriterionResult[];
}

function withinLimits(value: number, c: TaskCriterion): boolean {
  return (c.min === null || value >= c.min) && (c.max === null || value <= c.max);
}

/**
 * Pure evaluation of criteria against the analyzed render (and the source, needed only by
 * `delta` criteria). The render must have been analyzed with `targetBpm = target.bpm` when set.
 */
export function evaluateCriteria(
  criteria: readonly TaskCriterion[],
  render: AudioFeatures,
  source: AudioFeatures | null,
): EvaluationResult {
  const results = criteria.map((c): CriterionResult => {
    const metric: FeatureMetric = c.metric;
    const renderValue = readMetric(render, metric);
    let measured = renderValue;
    let sourceValue: number | null = null;
    let reportedRender: number | null = null;
    if (c.basis === "delta") {
      if (source === null) {
        throw new Error(`criterion "${c.id}" is delta but no source analysis was given`);
      }
      sourceValue = readMetric(source, metric);
      reportedRender = renderValue;
      measured = round2(renderValue - sourceValue);
    }

    const lowConfidence =
      metric === "tempo.bpm" &&
      (render.tempo.confidence < TEMPO_CONFIDENCE_THRESHOLD ||
        (c.basis === "delta" &&
          source !== null &&
          source.tempo.confidence < TEMPO_CONFIDENCE_THRESHOLD));

    let status: CriterionResult["status"];
    if (lowConfidence) {
      status = "unmeasured";
    } else if (c.derived && c.id === "tempo" && render.tempo.target !== null) {
      status = render.tempo.target.matches ? "pass" : "fail";
    } else {
      status = withinLimits(measured, c) ? "pass" : "fail";
    }

    return {
      id: c.id,
      derived: c.derived,
      metric,
      basis: c.basis,
      status,
      measured,
      min: c.min,
      max: c.max,
      sourceValue,
      renderValue: reportedRender,
    };
  });

  const pass = results.every(
    (r) => r.status !== "fail" && !(r.derived && r.id === "duration" && r.status !== "pass"),
  );
  return { pass, results };
}
