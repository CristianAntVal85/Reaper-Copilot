import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  ANALYSIS_CACHE_REVISION,
  AudioFeaturesSchema,
  CopilotError,
  type AnalysisCacheKey,
  type AnalyzeOptions,
  type AssetPath,
  type AudioFeatures,
} from "@reaper-copilot/core";
import type { ToolContext } from "./tool-definition.ts";

export interface CachedAnalysis {
  readonly features: AudioFeatures;
  readonly cacheHit: boolean;
}

/** Streams the file through sha256 so large audio never sits in memory. */
async function hashFile(path: AssetPath): Promise<string> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  } catch (error) {
    // The message must not carry the absolute path (constitution: no paths in responses).
    throw new CopilotError("file_not_found", "could not read the audio file", { cause: error });
  }
  return hash.digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Analyzes `assetPath`, reusing a stored result when the same bytes were analyzed with the same
 * `targetBpm` and cache revision. The cache is an optimization: a failing or corrupt cache is
 * logged and ignored, never propagated. Analyzer errors propagate as `analyze_audio` always did.
 * A hit is reported to `ctx.trace` so the per-call trace can count it.
 *
 * `revision` is a parameter only so tests can simulate a bump; production uses the default.
 */
export async function analyzeWithCache(
  ctx: ToolContext,
  assetPath: AssetPath,
  options: AnalyzeOptions = {},
  revision: string = ANALYSIS_CACHE_REVISION,
): Promise<CachedAnalysis> {
  const key: AnalysisCacheKey = {
    sha256: await hashFile(assetPath),
    targetBpm: options.targetBpm ?? null,
    revision,
  };

  try {
    const stored = await ctx.storage.getCachedAnalysis(key);
    if (stored !== null) {
      const parsed = AudioFeaturesSchema.safeParse(stored);
      if (parsed.success) {
        ctx.trace?.cacheHit();
        return { features: parsed.data, cacheHit: true };
      }
      ctx.log("analysis cache: stored result does not match the schema; re-analyzing");
    }
  } catch (error) {
    ctx.log(`analysis cache: read failed: ${describe(error)}`);
  }

  let features: AudioFeatures;
  try {
    features = await ctx.analyzer.analyze(assetPath, options);
  } catch (error) {
    if (error instanceof CopilotError) throw error;
    throw new CopilotError("analysis_failed", "the analyzer failed unexpectedly", {
      cause: error,
    });
  }

  try {
    await ctx.storage.putCachedAnalysis(key, features);
  } catch (error) {
    ctx.log(`analysis cache: write failed: ${describe(error)}`);
  }
  return { features, cacheHit: false };
}
