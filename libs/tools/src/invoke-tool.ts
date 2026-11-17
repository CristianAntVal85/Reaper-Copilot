import { CopilotError, type ToolCallTrace } from "@reaper-copilot/core";
import { z } from "zod";
import type { AnyToolDefinition, ToolContext } from "./tool-definition.ts";

/**
 * Protocol-level codes, not domain errors (not in `COPILOT_ERROR_CODES`): they describe a call that
 * never reached the domain (`invalid_input`) or a bug on our side (`internal_error`).
 */
export const INVALID_INPUT_CODE = "invalid_input";
export const INTERNAL_ERROR_CODE = "internal_error";

export type InvokeResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly message: string };

/** Numbers the calls of one server run: `step` starts at 1 and grows by one per call. */
export interface ToolSession {
  readonly sessionId: string;
  nextStep(): number;
}

export function createToolSession(sessionId: string): ToolSession {
  let step = 0;
  return {
    sessionId,
    nextStep: () => {
      step += 1;
      return step;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Runs one tool call: validates input, runs the handler, validates output and records a trace
 * (failures included). Never throws. A failing trace write is logged and the reply is unchanged.
 *
 * Messages are client-safe: a `CopilotError` message already starts with its code; its `cause`
 * and anything unexpected go to `ctx.log` only, never to the reply or the trace.
 */
export async function invokeTool(
  tool: AnyToolDefinition,
  input: unknown,
  ctx: ToolContext,
  session: ToolSession,
): Promise<InvokeResult> {
  const step = session.nextStep();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let cacheHits = 0;
  const log = ctx.log;

  const run = async (): Promise<{ output: unknown } | { code: string; message: string }> => {
    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      log(`tool ${tool.name} received invalid input: ${parsedInput.error.message}`);
      return { code: INVALID_INPUT_CODE, message: `${INVALID_INPUT_CODE}: the tool input does not match its schema` };
    }
    try {
      const output = await tool.handler(parsedInput.data as never, {
        ...ctx,
        trace: {
          cacheHit: () => {
            cacheHits += 1;
          },
        },
      });
      const checked = tool.outputSchema.safeParse(output);
      if (!checked.success) {
        log(`tool ${tool.name} produced output that does not match its schema: ${checked.error.message}`);
        return { code: INTERNAL_ERROR_CODE, message: `${INTERNAL_ERROR_CODE}: the tool failed unexpectedly` };
      }
      return { output: checked.data };
    } catch (error) {
      if (error instanceof CopilotError) {
        if (error.cause !== undefined) {
          log(`tool ${tool.name} failed with ${error.code}; cause: ${describe(error.cause)}`);
        }
        return { code: error.code, message: error.message };
      }
      log(`tool ${tool.name} failed unexpectedly: ${describe(error)}`);
      return { code: INTERNAL_ERROR_CODE, message: `${INTERNAL_ERROR_CODE}: the tool failed unexpectedly` };
    }
  };

  const outcome = await run();
  const args = z.json().safeParse(input);
  const base = {
    sessionId: session.sessionId,
    step,
    tool: tool.name,
    args: args.success ? args.data : null,
    durationMs: performance.now() - started,
    startedAt,
    cacheHits,
    taskId: null,
  };
  const trace: ToolCallTrace =
    "output" in outcome
      ? { ...base, ok: true, result: outcome.output as ToolCallTrace["result"], errorCode: null }
      : { ...base, ok: false, result: null, errorCode: outcome.code };

  try {
    await ctx.storage.recordToolCall(trace);
  } catch (error) {
    log(`tool ${tool.name}: could not record the trace: ${describe(error)}`);
  }

  return "output" in outcome
    ? { ok: true, output: outcome.output }
    : { ok: false, message: outcome.message };
}
