import { randomBytes } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { asAssetPath, CopilotError, ItemIdSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { isInside } from "./render-paths.ts";
import { defineTool } from "./tool-definition.ts";

function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

export const renderSelection = defineTool({
  name: "render_selection",
  description:
    "Render an item of the Reaper project to a WAV file in workspace/renders/ (the server picks the name). " +
    "itemId comes from import_audio, slice_loop or get_project_state. Returns {jobId} at once; poll get_job_status " +
    "until it is done (it then gives the file path relative to the workspace, ready for analyze_audio). " +
    "While it renders, every other Reaper tool fails with daw_busy. The render is the master mix over the item's " +
    "time span, so other tracks that sound in that span are included.",
  risk: "write",
  inputSchema: z.strictObject({ itemId: ItemIdSchema }),
  outputSchema: z.strictObject({ jobId: z.string().min(1) }),
  handler: async ({ itemId }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");

    let realRoot: string;
    try {
      realRoot = await realpath(ctx.workspaceRoot);
    } catch (error) {
      throw new CopilotError("file_not_found", "workspace directory does not exist", { cause: error });
    }
    const rendersDir = path.join(realRoot, "renders");
    await mkdir(rendersDir, { recursive: true });
    // `renders` could be a symlink pointing out of the workspace.
    const realRenders = await realpath(rendersDir);
    if (!isInside(realRoot, realRenders)) {
      throw new CopilotError("path_outside_workspace", "the renders directory is outside the workspace");
    }
    const name = `${stamp(new Date())}-${randomBytes(4).toString("hex")}.wav`;
    const output = path.join(realRenders, name);
    if (!isInside(realRoot, output)) {
      throw new CopilotError("path_outside_workspace", "the render path is outside the workspace");
    }
    const jobId = await ctx.daw.render(itemId, asAssetPath(output));
    return { jobId };
  },
});
