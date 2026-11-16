import { z } from "zod";

const finite = z.number().finite();

/** Reaper GUID, as returned by `GetTrackGUID` / `GetSetMediaItemInfo_String`. */
export const REAPER_GUID_PATTERN = /^\{[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/;

export const ReaperIdSchema = z.string().regex(REAPER_GUID_PATTERN);
export const TrackIdSchema = ReaperIdSchema;
export const ItemIdSchema = ReaperIdSchema;
export const JobIdSchema = z.string().min(1);

export type TrackId = z.infer<typeof TrackIdSchema>;
export type ItemId = z.infer<typeof ItemIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;

export const TrackRefSchema = z.strictObject({ id: TrackIdSchema, name: z.string() });
export type TrackRef = z.infer<typeof TrackRefSchema>;

/** Item as the port reports it: `source` is an absolute Linux path, or null if unknown. */
export const DawItemSchema = z.strictObject({
  id: ItemIdSchema,
  trackId: TrackIdSchema,
  positionSec: finite.min(0),
  lengthSec: finite.positive(),
  startOffsetSec: finite.min(0),
  playRate: finite.positive(),
  source: z.string().nullable(),
});
export type DawItem = z.infer<typeof DawItemSchema>;

export const ProjectStateSchema = z.strictObject({
  tempo: finite.positive(),
  lengthSec: finite.min(0),
  tracks: z.array(
    z.strictObject({
      id: TrackIdSchema,
      name: z.string(),
      fx: z.array(z.string()),
      items: z.array(DawItemSchema),
    }),
  ),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const SliceSpecSchema = z.strictObject({
  sourceBpm: finite.min(60).max(320),
  startBar: z.number().int().min(1),
  bars: z.number().int().min(1).max(64),
  beatsPerBar: z.number().int().min(1).max(16).default(4),
  offsetSec: finite.min(0).default(0),
});
export type SliceSpec = z.input<typeof SliceSpecSchema>;
export type ParsedSliceSpec = z.output<typeof SliceSpecSchema>;

export const StretchSpecSchema = z.strictObject({
  sourceBpm: finite.min(60).max(320),
  targetBpm: finite.min(60).max(320),
});
export type StretchSpec = z.infer<typeof StretchSpecSchema>;

export const FxChainSchema = z.array(
  z.strictObject({
    plugin: z.string().min(1),
    params: z.array(z.strictObject({ name: z.string().min(1), value: finite })),
  }),
);
export type FxChain = z.infer<typeof FxChainSchema>;

export const AppliedFxChainSchema = z.strictObject({
  trackId: TrackIdSchema,
  fx: z.array(
    z.strictObject({
      plugin: z.string(),
      params: z.array(z.strictObject({ name: z.string(), text: z.string() })),
    }),
  ),
});
export type AppliedFxChain = z.infer<typeof AppliedFxChainSchema>;

const JobOutputSchema = z.strictObject({ path: z.string().min(1), durationSec: finite.positive() });

export const JobStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    jobId: JobIdSchema,
    status: z.literal("rendering"),
    output: z.null(),
    errorCode: z.null(),
  }),
  z.strictObject({
    jobId: JobIdSchema,
    status: z.literal("done"),
    output: JobOutputSchema,
    errorCode: z.null(),
  }),
  z.strictObject({
    jobId: JobIdSchema,
    status: z.literal("failed"),
    output: z.null(),
    errorCode: z.string().min(1),
  }),
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

const knobName = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const KnobSchema = z
  .strictObject({
    description: z.string().min(1),
    unit: z.string(),
    min: finite,
    max: finite,
    default: finite,
  })
  .refine((k) => k.min < k.max, { message: "min must be below max" })
  .refine((k) => k.default >= k.min && k.default <= k.max, {
    message: "default must lie within [min, max]",
  });
export type Knob = z.infer<typeof KnobSchema>;

const PresetParamSchema = z.union([
  z.strictObject({ knob: knobName }),
  z.strictObject({ value: finite }),
]);

export const PresetSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    fx: z
      .array(
        z.strictObject({
          plugin: z.string().min(1),
          params: z.record(z.string().min(1), PresetParamSchema),
        }),
      )
      .min(1),
    knobs: z.record(knobName, KnobSchema),
  })
  .superRefine((preset, ctx) => {
    const used = new Set<string>();
    for (const fx of preset.fx) {
      for (const param of Object.values(fx.params)) {
        if ("knob" in param) used.add(param.knob);
      }
    }
    for (const name of used) {
      if (!(name in preset.knobs)) {
        ctx.addIssue({ code: "custom", message: `knob "${name}" is used but not defined`, path: ["knobs"] });
      }
    }
    for (const name of Object.keys(preset.knobs)) {
      if (!used.has(name)) {
        ctx.addIssue({ code: "custom", message: `knob "${name}" is defined but never used`, path: ["knobs", name] });
      }
    }
  });
export type Preset = z.infer<typeof PresetSchema>;
