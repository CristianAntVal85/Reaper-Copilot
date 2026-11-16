import { z } from "zod";
import { defineTool } from "./tool-definition.ts";

const KnobOutputSchema = z.strictObject({
  description: z.string(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  default: z.number(),
});

export const listPresets = defineTool({
  name: "list_presets",
  description:
    "List the FX presets that apply_fx_chain can add to a track. Each preset has an id, a description and its knobs: " +
    "adjustable values with a description, unit, min, max and default. Read it before apply_fx_chain to choose a preset and valid knob values.",
  risk: "read",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({
    presets: z.array(z.strictObject({ id: z.string(), description: z.string(), knobs: z.record(z.string(), KnobOutputSchema) })),
  }),
  handler: async (_input, ctx) => ({
    presets: (ctx.presets ?? []).map(({ id, description, knobs }) => ({ id, description, knobs })),
  }),
});
