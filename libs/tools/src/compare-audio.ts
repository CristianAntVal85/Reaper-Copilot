import { compareFeatures, FeatureDiffSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { analyzeWithCache } from "./analyze-with-cache.ts";
import { resolveAssetPath } from "./resolve-asset-path.ts";
import { defineTool } from "./tool-definition.ts";

const AudioRefSchema = z.strictObject({
  path: z.string().min(1),
  targetBpm: z.number().finite().min(60).max(320).optional(),
});

export const CompareAudioInputSchema = z.strictObject({
  a: AudioRefSchema,
  b: AudioRefSchema,
});

export const compareAudio = defineTool({
  name: "compare_audio",
  description:
    "Compare two audio files in the workspace and return the measured differences. " +
    "Use it to compare one version of a track with another, or a track with a reference. " +
    "Each numeric metric reports a, b and delta, where delta = b - a; key.same tells whether both tracks share key and mode. " +
    "a.path and b.path are relative to the workspace (.wav, .flac, .mp3, .aiff, .ogg). " +
    "targetBpm (60-320) is optional per file: it only picks the tempo octave, it does not pull the measurement.",
  risk: "read",
  inputSchema: CompareAudioInputSchema,
  outputSchema: FeatureDiffSchema,
  handler: async ({ a, b }, ctx) => {
    // Validate both paths before touching the analyzer (constitution, rule 13).
    const pathA = await resolveAssetPath(ctx.workspaceRoot, a.path);
    const pathB = await resolveAssetPath(ctx.workspaceRoot, b.path);
    // Sequential on purpose: the Python analysis is heavy.
    const first = await analyzeWithCache(
      ctx,
      pathA,
      a.targetBpm === undefined ? {} : { targetBpm: a.targetBpm },
    );
    const second = await analyzeWithCache(
      ctx,
      pathB,
      b.targetBpm === undefined ? {} : { targetBpm: b.targetBpm },
    );
    return compareFeatures(first.features, second.features, { a: a.path, b: b.path });
  },
});
