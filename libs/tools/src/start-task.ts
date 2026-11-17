import { randomUUID } from "node:crypto";
import {
  buildTaskCriteria,
  resolveTarget,
  StartTaskInputSchema,
  TaskCriterionSchema,
  type Task,
} from "@reaper-copilot/core";
import { z } from "zod";
import { resolveAssetPath } from "./resolve-asset-path.ts";
import { defineTool } from "./tool-definition.ts";

export const startTask = defineTool({
  name: "start_task",
  description:
    "Register the user's request and the success criteria of a piece of work, so the result can be verified with measurements afterwards. " +
    "Call it BEFORE working, with the user's request verbatim in request, and source = the audio file (relative to the workspace) the work starts from. " +
    "Each own criterion has an id, a metric (file.durationSec, tempo.bpm, loudness.integratedLufs, loudness.peakDb, bands.sub, bands.bass, bands.lowMid, bands.mid, bands.highMid, bands.high, dynamics.crestFactorDb), " +
    "a basis and min and/or max. Basis absolute checks the metric of the render; basis delta checks render minus source, and its interval must exclude 0 (min > 0 or max < 0) because a change is required. " +
    "Criteria are derived from target: with bpm and bars, duration within ±0.020 s of the expected length; with bpm, tempo within ±1 BPM. " +
    "The ids duration and tempo are reserved for those derived criteria. " +
    "Criteria cannot be changed afterwards: if they were wrong, start a new task. " +
    "Returns the taskId and every criterion that will be evaluated. Next step: after rendering, call verify_task with the taskId and the path of the render.",
  risk: "read",
  inputSchema: StartTaskInputSchema,
  outputSchema: z.strictObject({
    taskId: z.string().min(1),
    criteria: z.array(TaskCriterionSchema),
  }),
  handler: async (input, ctx) => {
    // Validate the path before storing anything (constitution, rule 13).
    await resolveAssetPath(ctx.workspaceRoot, input.source);
    const taskId = randomUUID();
    const criteria = buildTaskCriteria(input.target, input.criteria);
    const task: Task = {
      taskId,
      createdAt: new Date().toISOString(),
      request: input.request,
      source: input.source,
      target: resolveTarget(input.target),
      criteria,
    };
    await ctx.storage.createTask(task);
    ctx.trace?.taskStarted(taskId);
    return { taskId, criteria };
  },
});
