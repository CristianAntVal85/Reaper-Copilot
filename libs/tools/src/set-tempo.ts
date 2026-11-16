import { CopilotError } from "@reaper-copilot/core";
import { z } from "zod";
import { defineTool } from "./tool-definition.ts";

export const setTempo = defineTool({
  name: "set_tempo",
  description:
    "Set the Reaper project tempo in BPM (40-320). Items keep their length in seconds, so audio is not stretched. " +
    "Returns {tempo}. It can be undone with undo_last.",
  risk: "write",
  inputSchema: z.strictObject({ bpm: z.number().finite().min(40).max(320) }),
  outputSchema: z.strictObject({ tempo: z.number() }),
  handler: async ({ bpm }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    return ctx.daw.setTempo(bpm);
  },
});
