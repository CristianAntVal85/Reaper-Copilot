import {
  CopilotError,
  evaluateCriteria,
  MAX_VERIFICATIONS_PER_TASK,
  VerifyTaskOutputSchema,
} from "@reaper-copilot/core";
import { z } from "zod";
import { analyzeWithCache } from "./analyze-with-cache.ts";
import { relativeToWorkspace } from "./render-paths.ts";
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
    taskId: z.uuid(),
    path: z.string().min(1),
  }),
  outputSchema: VerifyTaskOutputSchema,
  handler: async (input, ctx) => {
    const renderPath = await resolveAssetPath(ctx.workspaceRoot, input.path);
    const task = await ctx.storage.getTask(input.taskId);
    if (task === null) throw new CopilotError("task_not_found", "no task with that taskId");
    ctx.trace?.forTask(task.taskId);
    if ((await ctx.storage.listVerifications(task.taskId)).length >= MAX_VERIFICATIONS_PER_TASK) {
      throw new CopilotError(
        "out_of_range",
        `this task already has the maximum of ${MAX_VERIFICATIONS_PER_TASK} verifications; start a new task`,
      );
    }
    const renderRelative = await relativeToWorkspace(ctx.workspaceRoot, renderPath);
    if (renderRelative === null) throw new CopilotError("path_outside_workspace", "invalid path");

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
    const stored = await ctx.storage.recordVerification({
      taskId: task.taskId,
      render: { path: renderRelative, sha256: render.features.file.sha256 },
      pass,
      results,
      verifiedAt: new Date().toISOString(),
    });
    return {
      taskId: stored.taskId,
      attempt: stored.attempt,
      render: stored.render,
      pass: stored.pass,
      results: stored.results,
    };
  },
});
