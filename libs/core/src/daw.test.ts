import { describe, expect, it } from "vitest";
import {
  ALLOWED_FX_CONFIG,
  AppliedFxChainSchema,
  DawItemSchema,
  FxChainSchema,
  JobStatusSchema,
  PresetSchema,
  ProjectStateSchema,
  SliceSpecSchema,
  StretchSpecSchema,
} from "./index.ts";

const GUID = "{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}";

const preset = {
  id: "distortion_hard",
  description: "Hard distortion.",
  fx: [
    {
      plugin: "JS: Waveshaping Distortion",
      params: { "Distortion (%)": { knob: "drive" } },
    },
    { plugin: "ReaLimit (Cockos)", params: { Ceiling: { value: -0.3 } } },
  ],
  knobs: { drive: { description: "Amount", unit: "%", min: 0, max: 90, default: 60 } },
};

const item = {
  id: GUID,
  trackId: GUID,
  positionSec: 0,
  lengthSec: 5.6,
  startOffsetSec: 6.9,
  playRate: 1.13,
  source: "/ws/a.wav",
};

describe("Reaper GUIDs", () => {
  it("accepts a GUID and rejects malformed or lowercase ones", () => {
    expect(DawItemSchema.safeParse(item).success).toBe(true);
    for (const bad of ["abc", GUID.toLowerCase(), GUID.slice(1, -1), "{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F}"]) {
      expect(DawItemSchema.safeParse({ ...item, id: bad }).success).toBe(false);
    }
    expect(
      ProjectStateSchema.safeParse({
        tempo: 120,
        lengthSec: 0,
        tracks: [{ id: "x", name: "t", fx: [], items: [] }],
      }).success,
    ).toBe(false);
  });
});

describe("slice and stretch specs", () => {
  it("applies defaults and enforces ranges", () => {
    expect(SliceSpecSchema.parse({ sourceBpm: 150, startBar: 5, bars: 4 })).toMatchObject({
      beatsPerBar: 4,
      offsetSec: 0,
    });
    expect(SliceSpecSchema.safeParse({ sourceBpm: 150, startBar: 0, bars: 4 }).success).toBe(false);
    expect(SliceSpecSchema.safeParse({ sourceBpm: 150, startBar: 1, bars: 65 }).success).toBe(false);
    expect(StretchSpecSchema.safeParse({ sourceBpm: 59, targetBpm: 170 }).success).toBe(false);
  });
});

describe("FxChain and AppliedFxChain", () => {
  it("validate their shape", () => {
    expect(FxChainSchema.safeParse([{ plugin: "ReaEQ (Cockos)", params: [{ name: "a", value: 1 }] }]).success).toBe(true);
    expect(FxChainSchema.safeParse([{ plugin: "", params: [] }]).success).toBe(false);
    expect(AppliedFxChainSchema.safeParse({ trackId: GUID, fx: [{ plugin: "p", params: [{ name: "a", text: "1.0" }], config: [] }] }).success).toBe(true);
    expect(AppliedFxChainSchema.safeParse({ trackId: GUID, fx: [{ plugin: "p", params: [] }] }).success).toBe(false);
  });

  it("defaults config to an empty list and accepts name/value settings", () => {
    expect(FxChainSchema.parse([{ plugin: "ReaEQ (Cockos)", params: [] }])[0]?.config).toEqual([]);
    expect(FxChainSchema.safeParse([{ plugin: "p", params: [], config: [{ name: "BANDENABLED4", value: "1" }] }]).success).toBe(true);
    expect(FxChainSchema.safeParse([{ plugin: "p", params: [], config: [{ name: "", value: "1" }] }]).success).toBe(false);
  });

  it("lists the allowed FX config settings per plugin", () => {
    const eq = ALLOWED_FX_CONFIG["ReaEQ (Cockos)"];
    expect(eq?.key.test("BANDENABLED4")).toBe(true);
    expect(eq?.key.test("FOO")).toBe(false);
    expect(eq?.value.test("1")).toBe(true);
    expect(eq?.value.test("2")).toBe(false);
    expect(ALLOWED_FX_CONFIG["ReaLimit (Cockos)"]).toBeUndefined();
  });
});

describe("JobStatus", () => {
  it("is coherent with its status", () => {
    const ok = (v: unknown) => JobStatusSchema.safeParse(v).success;
    expect(ok({ jobId: "j", status: "rendering", output: null, errorCode: null })).toBe(true);
    expect(ok({ jobId: "j", status: "done", output: { path: "renders/a.wav", durationSec: 5.6 }, errorCode: null })).toBe(true);
    expect(ok({ jobId: "j", status: "failed", output: null, errorCode: "render_failed" })).toBe(true);
    expect(ok({ jobId: "j", status: "done", output: null, errorCode: null })).toBe(false);
    expect(ok({ jobId: "j", status: "rendering", output: { path: "a", durationSec: 1 }, errorCode: null })).toBe(false);
    expect(ok({ jobId: "j", status: "failed", output: null, errorCode: null })).toBe(false);
    expect(ok({ jobId: "j", status: "done", output: { path: "a", durationSec: 1 }, errorCode: "x" })).toBe(false);
  });
});

describe("PresetSchema", () => {
  it("accepts a valid preset", () => {
    expect(PresetSchema.safeParse(preset).success).toBe(true);
  });

  it("rejects a knob used but not defined", () => {
    expect(PresetSchema.safeParse({ ...preset, knobs: {} }).success).toBe(false);
  });

  it("rejects a knob defined but not used", () => {
    const extra = { ...preset.knobs, extra: { description: "x", unit: "", min: 0, max: 1, default: 0 } };
    expect(PresetSchema.safeParse({ ...preset, knobs: extra }).success).toBe(false);
  });

  it("rejects a default outside its range and an inverted range", () => {
    const knob = (k: object) => ({ ...preset, knobs: { drive: { ...preset.knobs.drive, ...k } } });
    expect(PresetSchema.safeParse(knob({ default: 95 })).success).toBe(false);
    expect(PresetSchema.safeParse(knob({ min: 90, max: 0, default: 50 })).success).toBe(false);
  });

  it("rejects a parameter that is both knob and value", () => {
    const bad = { ...preset, fx: [{ plugin: "p", params: { x: { knob: "drive", value: 1 } } }] };
    expect(PresetSchema.safeParse(bad).success).toBe(false);
  });
});
