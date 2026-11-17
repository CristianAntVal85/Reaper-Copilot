import { CopilotError, TrackRefSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { ItemInfoSchema, createItemInfoMapper } from "./item-info.ts";
import { resolveAssetPath } from "./resolve-asset-path.ts";
import { defineTool } from "./tool-definition.ts";

export const importAudio = defineTool({
  name: "import_audio",
  description:
    "Import an audio file from the workspace into the Reaper project on a new track at position 0. " +
    "path is relative to the workspace (.wav, .flac, .mp3, .aiff, .ogg). The original file is not modified. " +
    "Returns the new track {id, name} and its item (id, trackId, positionSec, lengthSec, startOffsetSec, playRate, source); " +
    "keep those ids for the other tools. It can be undone with undo_last.",
  risk: "write",
  inputSchema: z.strictObject({ path: z.string().min(1) }),
  outputSchema: z.strictObject({ track: TrackRefSchema, item: ItemInfoSchema }),
  handler: async ({ path }, ctx) => {
    // Validate before touching the DAW (constitution, rule 13).
    const assetPath = await resolveAssetPath(ctx.workspaceRoot, path);
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    const { track, item } = await ctx.daw.importAudio(assetPath);
    const toInfo = await createItemInfoMapper(ctx.workspaceRoot);
    return { track, item: toInfo(item) };
  },
});
