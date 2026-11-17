import { CopilotError, ItemIdSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { ItemInfoSchema, createItemInfoMapper } from "./item-info.ts";
import { defineTool } from "./tool-definition.ts";

export const timeStretch = defineTool({
  name: "time_stretch",
  description:
    "Change an item's tempo without changing its pitch. sourceBpm (60-320) is the tempo of the audio, targetBpm (60-320) " +
    "the tempo wanted; the rate targetBpm/sourceBpm must lie within [0.5, 2] or it fails with out_of_range. " +
    "Absolute: repeating the call gives the same result. Returns the item (id, trackId, positionSec, lengthSec, " +
    "startOffsetSec, playRate, source). It can be undone with undo_last.",
  risk: "write",
  inputSchema: z.strictObject({
    itemId: ItemIdSchema,
    sourceBpm: z.number().finite().min(60).max(320),
    targetBpm: z.number().finite().min(60).max(320),
  }),
  outputSchema: ItemInfoSchema,
  handler: async ({ itemId, ...spec }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    const item = await ctx.daw.stretchToTempo(itemId, spec);
    const toInfo = await createItemInfoMapper(ctx.workspaceRoot);
    return toInfo(item);
  },
});
