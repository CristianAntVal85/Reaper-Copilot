import { CopilotError, JobStatusSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { relativeToWorkspace } from "./render-paths.ts";
import { defineTool } from "./tool-definition.ts";

export const getJobStatus = defineTool({
  name: "get_job_status",
  description:
    "Check a render started by render_selection. Returns {jobId, status, output, errorCode}: status is rendering, done " +
    "or failed. When done, output is {path, durationSec} with path relative to the workspace (usable by analyze_audio); " +
    "when failed, errorCode says why. Jobs live in the server's memory: an unknown jobId gives job_not_found. " +
    "It does not ask Reaper, so it can be called while a render runs.",
  risk: "read",
  inputSchema: z.strictObject({ jobId: z.string().min(1) }),
  outputSchema: JobStatusSchema,
  handler: async ({ jobId }, ctx) => {
    if (!ctx.daw) throw new CopilotError("daw_unavailable", "no Reaper connection is configured");
    const job = await ctx.daw.getJob(jobId);
    if (job.status !== "done") return job;
    const relative = await relativeToWorkspace(ctx.workspaceRoot, job.output.path);
    if (relative === null) {
      throw new CopilotError("invalid_daw_output", "the render output is outside the workspace");
    }
    return { ...job, output: { ...job.output, path: relative } };
  },
});
