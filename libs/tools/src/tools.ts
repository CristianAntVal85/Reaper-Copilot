import { analyzeAudio } from "./analyze-audio.ts";
import type { AnyToolDefinition } from "./tool-definition.ts";

/** Every tool the copilot defines; transports register this list through a registry. */
export const ALL_TOOLS: readonly AnyToolDefinition[] = [analyzeAudio];
