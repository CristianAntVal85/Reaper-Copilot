import { CopilotError, ItemIdSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { ItemInfoSchema, createItemInfoMapper } from "./item-info.ts";
import { defineTool } from "./tool-definition.ts";

export const sliceLoop = defineTool({
  name: "slice_loop",
  description:
    "Cut a loop out of an imported item by whole bars, without touching the original file. " +
    "sourceBpm (60-320) is the tempo of the audio; startBar (integer >= 1) is the first bar to keep, counted from offsetSec; " +
    "bars (1-64) is how many to keep; beatsPerBar (1-16, default 4); offsetSec (>= 0, default 0) is where bar 1 starts in the file, " +
    "e.g. after leading silence. Absolute: repeating the call gives the same result. The slice moves to position 0. " +
    "Fails with out_of_range if it goes past the end of the audio. Returns the item (id, trackId, positionSec, lengthSec, " +
    "startOffsetSec, playRate, source). It can be undone with undo_last.",
  risk: "write",
  inputSchema: z.strictObject({
    itemId: ItemIdSchema,
    sourceBpm: z.number().finite().min(60).max(320),
    startBar: z.number().int().min(1),
    bars: z.number().int().min(1).max(64),
    beatsPerBar: z.number().int().min(1).max(16).default(4),
    offsetSec: z.number().finite().min(0).default(0),
  }),
  outputSchema: ItemInfoSchema,
  handler: async ({ itemId, ...spec }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    const item = await ctx.daw.sliceByBars(itemId, spec);
    const toInfo = await createItemInfoMapper(ctx.workspaceRoot);
    return toInfo(item);
  },
});
