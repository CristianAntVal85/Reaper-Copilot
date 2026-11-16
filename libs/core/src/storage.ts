import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const AnalysisCacheKeySchema = z.strictObject({
  sha256,
  targetBpm: z.number().finite().positive().nullable(),
  revision: z.string().min(1),
});

export type AnalysisCacheKey = z.infer<typeof AnalysisCacheKeySchema>;

/**
 * One row per tool call, failed ones included. A successful call has no `errorCode`; a failed
 * one has an `errorCode` and a null `result`. Never holds absolute paths or error causes.
 */
export const ToolCallTraceSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    step: z.number().int().min(1),
    tool: z.string().min(1),
    args: z.json(),
    ok: z.boolean(),
    result: z.json(),
    errorCode: z.string().min(1).nullable(),
    durationMs: z.number().finite().min(0),
    startedAt: z.iso.datetime(),
    cacheHits: z.number().int().min(0),
  })
  .refine((t) => (t.ok ? t.errorCode === null : t.errorCode !== null && t.result === null), {
    message: "ok traces carry no errorCode; failed traces carry an errorCode and a null result",
  });

export type ToolCallTrace = z.infer<typeof ToolCallTraceSchema>;
