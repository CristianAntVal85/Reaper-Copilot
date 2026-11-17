import { CopilotError } from "@reaper-copilot/core";
import { z } from "zod";
import { defineTool } from "./tool-definition.ts";

export const undoLast = defineTool({
  name: "undo_last",
  description:
    "Undo the last change the copilot made in the Reaper project. Only the copilot's own changes are undone: " +
    "if the last change is the user's, it fails with nothing_to_undo. Returns {undone} with the label of the step undone.",
  risk: "write",
  inputSchema: z.strictObject({}),
  outputSchema: z.strictObject({ undone: z.string() }),
  handler: async (_input, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    return ctx.daw.undo();
  },
});
