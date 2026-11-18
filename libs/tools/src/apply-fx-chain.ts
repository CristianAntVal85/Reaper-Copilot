import { CopilotError, type FxChain, TrackIdSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { defineTool } from "./tool-definition.ts";

export const applyFxChain = defineTool({
  name: "apply_fx_chain",
  description:
    "Add a preset's FX chain at the end of a track's FX list (existing FX are kept). trackId comes from get_project_state; " +
    "preset is an id from list_presets; knobs (optional) maps knob names to numbers within each knob's min and max; " +
    "omitted knobs use their default. An unknown knob or a value out of range fails with out_of_range and changes nothing. " +
    "Returns {trackId, preset, fx: [{plugin, params: [{name, text}], config: [{name, value}]}]} where text is the value the plugin displays and config lists the plugin settings read back after setting them. " +
    "To readjust, call undo_last and apply again.",
  risk: "write",
  inputSchema: z.strictObject({
    trackId: TrackIdSchema,
    preset: z.string().min(1),
    knobs: z.record(z.string(), z.number().finite()).optional(),
  }),
  outputSchema: z.strictObject({
    trackId: z.string(),
    preset: z.string(),
    fx: z.array(
      z.strictObject({
        plugin: z.string(),
        params: z.array(z.strictObject({ name: z.string(), text: z.string() })),
        config: z.array(z.strictObject({ name: z.string(), value: z.string() })),
      }),
    ),
  }),
  handler: async ({ trackId, preset: presetId, knobs = {} }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    const preset = (ctx.presets ?? []).find((p) => p.id === presetId);
    if (!preset) throw new CopilotError("preset_not_found", "no preset with that id");

    for (const [name, value] of Object.entries(knobs)) {
      const knob = Object.hasOwn(preset.knobs, name) ? preset.knobs[name] : undefined;
      if (!knob) throw new CopilotError("out_of_range", `the preset has no knob "${name}"`);
      if (value < knob.min || value > knob.max) {
        throw new CopilotError("out_of_range", `knob "${name}" must lie within [${knob.min}, ${knob.max}]`);
      }
    }

    const chain: FxChain = preset.fx.map((fx) => ({
      plugin: fx.plugin,
      params: Object.entries(fx.params).map(([name, param]) => {
        if ("value" in param) return { name, value: param.value };
        const knob = preset.knobs[param.knob];
        if (!knob) throw new CopilotError("preset_not_found", "the preset is inconsistent");
        return { name, value: Object.hasOwn(knobs, param.knob) ? (knobs[param.knob] as number) : knob.default };
      }),
      config: Object.entries(fx.config ?? {}).map(([name, value]) => ({ name, value })),
    }));

    const applied = await ctx.daw.applyFxChain(trackId, chain);
    return { trackId: applied.trackId, preset: preset.id, fx: applied.fx };
  },
});
