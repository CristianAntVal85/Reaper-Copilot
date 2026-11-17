import { describe, expect, it } from "vitest";
import {
  AudioFeaturesSchema,
  CriterionResultSchema,
  StartTaskInputSchema,
  TaskSchema,
  VerificationSchema,
  VerifyTaskOutputSchema,
  buildTaskCriteria,
  deriveCriteria,
  evaluateCriteria,
  type AudioFeatures,
  type TaskCriterion,
} from "./index.ts";

function features(over: {
  durationSec?: number;
  bpm?: number;
  confidence?: number;
  matches?: boolean | null;
  crest?: number;
  lufs?: number;
}): AudioFeatures {
  return AudioFeaturesSchema.parse({
    schemaVersion: 2,
    file: { sha256: "a".repeat(64), durationSec: over.durationSec ?? 5.646, sampleRate: 44100, channels: 2 },
    tempo: {
      bpm: over.bpm ?? 170,
      confidence: over.confidence ?? 0.8,
      alternatives: [],
      target:
        over.matches === null || over.matches === undefined
          ? null
          : { bpm: 170, deviationBpm: 0, matches: over.matches },
    },
    key: { tonic: "A", mode: "minor", confidence: 0.6 },
    loudness: { integratedLufs: over.lufs ?? -8, peakDb: -0.4 },
    bands: { sub: -18, bass: -12, lowMid: -14, mid: -15, highMid: -17, high: -22 },
    dynamics: { crestFactorDb: over.crest ?? 7.9 },
  });
}

const base = { request: "loop", source: "samples/a.wav" };
const loud = { id: "louder", metric: "loudness.integratedLufs", basis: "absolute", min: -9, max: -6 };

function issues(input: unknown): string {
  const r = StartTaskInputSchema.safeParse(input);
  expect(r.success).toBe(false);
  return r.success ? "" : r.error.issues.map((i) => i.message).join(" | ");
}

describe("StartTaskInputSchema", () => {
  it("accepts the documented example and defaults criteria and target", () => {
    const parsed = StartTaskInputSchema.parse({
      ...base,
      target: { bpm: 170, bars: 4, beatsPerBar: 4 },
      criteria: [loud, { id: "more-distortion", metric: "dynamics.crestFactorDb", basis: "delta", max: -3 }],
    });
    expect(parsed.criteria).toHaveLength(2);
    expect(StartTaskInputSchema.parse({ ...base, criteria: [loud] }).target).toEqual({});
  });

  it("accepts a task with only target bpm and bars", () => {
    expect(StartTaskInputSchema.parse({ ...base, target: { bpm: 170, bars: 4 } }).criteria).toEqual([]);
  });

  it("rejects repeated ids", () => {
    expect(issues({ ...base, criteria: [loud, loud] })).toContain("unique");
  });

  it("rejects reserved ids", () => {
    expect(issues({ ...base, criteria: [{ ...loud, id: "duration" }] })).toContain("reserved");
    expect(issues({ ...base, criteria: [{ ...loud, id: "tempo" }] })).toContain("reserved");
  });

  it("rejects ids outside the pattern", () => {
    expect(issues({ ...base, criteria: [{ ...loud, id: "Bad Id" }] })).toContain("id must match");
  });

  it("rejects a delta interval that contains 0", () => {
    const d = { id: "d", metric: "dynamics.crestFactorDb", basis: "delta" };
    expect(issues({ ...base, criteria: [{ ...d, min: -1, max: 1 }] })).toContain("delta criterion");
    expect(issues({ ...base, criteria: [{ ...d, min: 0 }] })).toContain("delta criterion");
    expect(issues({ ...base, criteria: [{ ...d, max: 0 }] })).toContain("delta criterion");
    expect(StartTaskInputSchema.safeParse({ ...base, criteria: [{ ...d, min: 0.5 }] }).success).toBe(true);
    expect(StartTaskInputSchema.safeParse({ ...base, criteria: [{ ...d, max: -0.5 }] }).success).toBe(true);
  });

  it("rejects a criterion with neither min nor max", () => {
    expect(
      issues({ ...base, criteria: [{ id: "x", metric: "bands.mid", basis: "absolute" }] }),
    ).toContain("at least one of min or max");
  });

  it("rejects min greater than max", () => {
    expect(issues({ ...base, criteria: [{ ...loud, min: 1, max: 0 }] })).toContain("min must be less");
  });

  it("rejects bars without bpm", () => {
    expect(issues({ ...base, target: { bars: 4 }, criteria: [loud] })).toContain("bars requires");
  });

  it("rejects a task with no criteria at all, derived included", () => {
    expect(issues({ ...base })).toContain("at least one criterion");
    expect(issues({ ...base, target: {} })).toContain("at least one criterion");
  });

  it("accepts a task whose only criterion is derived from a bpm target", () => {
    expect(StartTaskInputSchema.safeParse({ ...base, target: { bpm: 170 } }).success).toBe(true);
  });

  it("rejects more than 16 own criteria", () => {
    const many = Array.from({ length: 17 }, (_, i) => ({ ...loud, id: `c${i}` }));
    expect(issues({ ...base, criteria: many })).toContain("at most 16");
    expect(StartTaskInputSchema.safeParse({ ...base, criteria: many.slice(0, 16) }).success).toBe(true);
  });

  it("rejects metrics outside the list, unknown fields and bad request length", () => {
    expect(StartTaskInputSchema.safeParse({ ...base, criteria: [{ ...loud, metric: "key.tonic" }] }).success).toBe(false);
    expect(StartTaskInputSchema.safeParse({ ...base, criteria: [{ ...loud, extra: 1 }] }).success).toBe(false);
    expect(StartTaskInputSchema.safeParse({ ...base, request: "", criteria: [loud] }).success).toBe(false);
    expect(StartTaskInputSchema.safeParse({ ...base, request: "x".repeat(2001), criteria: [loud] }).success).toBe(false);
    expect(StartTaskInputSchema.safeParse({ ...base, request: "x".repeat(2000), criteria: [loud] }).success).toBe(true);
  });

  it("validates target ranges", () => {
    for (const target of [{ bpm: 59 }, { bpm: 321 }, { bpm: 170, bars: 0 }, { bpm: 170, bars: 65 }, { bpm: 170, bars: 1.5 }, { bpm: 170, beatsPerBar: 13 }]) {
      expect(StartTaskInputSchema.safeParse({ ...base, target, criteria: [loud] }).success).toBe(false);
    }
  });
});

describe("deriveCriteria", () => {
  it("derives duration and tempo from bpm and bars", () => {
    const [duration, tempo] = deriveCriteria({ bpm: 170, bars: 4 });
    expect(duration).toMatchObject({ id: "duration", derived: true, metric: "file.durationSec", basis: "absolute", min: 5.627, max: 5.667 });
    expect(tempo).toMatchObject({ id: "tempo", derived: true, metric: "tempo.bpm", basis: "absolute", min: 169, max: 171 });
  });

  it("honours beatsPerBar and derives only tempo without bars", () => {
    expect(deriveCriteria({ bpm: 120, bars: 2, beatsPerBar: 3 })[0]).toMatchObject({ min: 2.98, max: 3.02 });
    expect(deriveCriteria({ bpm: 120 }).map((c) => c.id)).toEqual(["tempo"]);
    expect(deriveCriteria({})).toEqual([]);
  });

  it("buildTaskCriteria puts derived first and normalizes own limits", () => {
    const own = StartTaskInputSchema.parse({ ...base, criteria: [{ id: "d", metric: "bands.mid", basis: "delta", max: -2 }] }).criteria;
    const all = buildTaskCriteria({ bpm: 170, bars: 4 }, own);
    expect(all.map((c) => c.id)).toEqual(["duration", "tempo", "d"]);
    expect(all[2]).toEqual({ id: "d", derived: false, metric: "bands.mid", basis: "delta", min: null, max: -2 });
  });
});

describe("evaluateCriteria", () => {
  const derived = deriveCriteria({ bpm: 170, bars: 4 });
  const delta: TaskCriterion = { id: "more-distortion", derived: false, metric: "dynamics.crestFactorDb", basis: "delta", min: null, max: -3 };

  it("passes when everything is within limits", () => {
    const r = evaluateCriteria(derived, features({ matches: true }), null);
    expect(r.pass).toBe(true);
    expect(r.results.map((x) => x.status)).toEqual(["pass", "pass"]);
    expect(r.results[0]).toMatchObject({ measured: 5.646, sourceValue: null, renderValue: null });
    r.results.forEach((x) => CriterionResultSchema.parse(x));
  });

  it("fails and the global pass follows", () => {
    const r = evaluateCriteria(derived, features({ durationSec: 6, matches: true }), null);
    expect(r.results[0]?.status).toBe("fail");
    expect(r.pass).toBe(false);
  });

  it("uses tempo.target.matches for the derived tempo criterion", () => {
    const r = evaluateCriteria(derived, features({ bpm: 170, matches: false }), null);
    expect(r.results[1]?.status).toBe("fail");
    expect(r.pass).toBe(false);
  });

  it("marks tempo criteria unmeasured with low confidence without blocking pass", () => {
    const r = evaluateCriteria(derived, features({ confidence: 0.05, bpm: 90, matches: false }), null);
    expect(r.results[1]?.status).toBe("unmeasured");
    expect(r.results[0]?.status).toBe("pass");
    expect(r.pass).toBe(true);
  });

  it("marks an own tempo.bpm criterion unmeasured when the source confidence is low (delta)", () => {
    const c: TaskCriterion = { id: "faster", derived: false, metric: "tempo.bpm", basis: "delta", min: 5, max: null };
    const r = evaluateCriteria([c], features({ bpm: 170 }), features({ bpm: 150, confidence: 0.05 }));
    expect(r.results[0]?.status).toBe("unmeasured");
  });

  it("computes delta as render minus source with 2 decimals", () => {
    const r = evaluateCriteria([delta], features({ crest: 7.9 }), features({ crest: 9.7 }));
    expect(r.results[0]).toMatchObject({ status: "fail", measured: -1.8, sourceValue: 9.7, renderValue: 7.9, min: null, max: -3 });
    const ok = evaluateCriteria([delta], features({ crest: 5.123 }), features({ crest: 9.7 }));
    expect(ok.results[0]).toMatchObject({ status: "pass", measured: -4.58 });
    expect(ok.pass).toBe(true);
  });

  it("normalizes -0 in deltas", () => {
    const c: TaskCriterion = { ...delta, min: null, max: 1 };
    expect(evaluateCriteria([c], features({ crest: 7.001 }), features({ crest: 7.002 })).results[0]?.measured).toBe(0);
  });

  it("evaluates absolute criteria with inclusive limits", () => {
    const c: TaskCriterion = { id: "l", derived: false, metric: "loudness.integratedLufs", basis: "absolute", min: -9, max: -6 };
    expect(evaluateCriteria([c], features({ lufs: -9 }), null).results[0]?.status).toBe("pass");
    expect(evaluateCriteria([c], features({ lufs: -5.9 }), null).results[0]?.status).toBe("fail");
  });

  it("requires the derived duration to pass for the global pass", () => {
    const own: TaskCriterion = { id: "l", derived: false, metric: "loudness.integratedLufs", basis: "absolute", min: -9, max: -6 };
    const d = deriveCriteria({ bpm: 170, bars: 4 })[0] as TaskCriterion;
    const r = evaluateCriteria([d, own], features({ durationSec: 9 }), null);
    expect(r.results[1]?.status).toBe("pass");
    expect(r.pass).toBe(false);
  });

  it("throws when a delta criterion has no source", () => {
    expect(() => evaluateCriteria([delta], features({}), null)).toThrow(/delta/);
  });
});

describe("Task and Verification schemas", () => {
  const taskId = "123e4567-e89b-42d3-a456-426614174000";
  const sha = "b".repeat(64);

  it("round-trips a task and a verification", () => {
    const task = {
      taskId,
      createdAt: "2026-11-17T10:00:00.000Z",
      request: "loop",
      source: "samples/a.wav",
      target: { bpm: 170, bars: 4, beatsPerBar: 4 },
      criteria: deriveCriteria({ bpm: 170, bars: 4 }),
    };
    expect(TaskSchema.parse(task)).toEqual(task);
    expect(TaskSchema.safeParse({ ...task, target: { bpm: 170, bars: 4 } }).success).toBe(false);
    expect(TaskSchema.safeParse({ ...task, criteria: [] }).success).toBe(false);

    const { results, pass } = evaluateCriteria(task.criteria, features({ matches: true }), null);
    const out = { taskId, attempt: 1, render: { path: "renders/x.wav", sha256: sha }, pass, results };
    expect(VerifyTaskOutputSchema.parse(out)).toEqual(out);
    const v = { ...out, verifiedAt: "2026-11-17T10:01:00.000Z" };
    expect(VerificationSchema.parse(v)).toEqual(v);
    expect(VerificationSchema.safeParse({ ...v, attempt: 0 }).success).toBe(false);
    expect(VerifyTaskOutputSchema.safeParse({ ...out, extra: 1 }).success).toBe(false);
  });
});
