import { CopilotError, evaluateCriteria, VerifyTaskOutputSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { analyzeWithCache } from "./analyze-with-cache.ts";
import { resolveAssetPath } from "./resolve-asset-path.ts";
import { defineTool } from "./tool-definition.ts";

export const verifyTask = defineTool({
  name: "verify_task",
  description:
    "Measure a render and check it against the success criteria of a task started with start_task. " +
    "Returns pass (true only if every criterion passes) and, per criterion, pass, fail or unmeasured with the measured values. " +
    "The criteria are the ones fixed in start_task; they cannot be passed or changed here. " +
    "path is the render, relative to the workspace (the one get_job_status reports, or a manual render inside the workspace). " +
    "If it fails, adjust the parameters, render again and call verify_task again with the new path: attempt increases each time. " +
    "To change the criteria, start a new task with start_task.",
  risk: "read",
  inputSchema: z.strictObject({
    taskId: z.string().min(1),
    path: z.string().min(1),
  }),
  outputSchema: VerifyTaskOutputSchema,
  handler: async (input, ctx) => {
    const renderPath = await resolveAssetPath(ctx.workspaceRoot, input.path);
    const task = await ctx.storage.getTask(input.taskId);
    if (task === null) throw new CopilotError("task_not_found", "no task with that taskId");
    ctx.trace?.forTask(task.taskId);

    const targetBpm = task.target.bpm;
    const render = await analyzeWithCache(
      ctx,
      renderPath,
      targetBpm === undefined ? {} : { targetBpm },
    );

    let source = null;
    if (task.criteria.some((c) => c.basis === "delta")) {
      const sourcePath = await resolveAssetPath(ctx.workspaceRoot, task.source);
      source = (await analyzeWithCache(ctx, sourcePath)).features;
    }

    const { pass, results } = evaluateCriteria(task.criteria, render.features, source);
    const attempt = (await ctx.storage.listVerifications(task.taskId)).length + 1;
    const output = {
      taskId: task.taskId,
      attempt,
      render: { path: input.path, sha256: render.features.file.sha256 },
      pass,
      results,
    };
    await ctx.storage.recordVerification({ ...output, verifiedAt: new Date().toISOString() });
    return output;
  },
});
