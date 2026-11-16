import { AudioFeaturesSchema } from "@reaper-copilot/core";
import { z } from "zod";
import { analyzeWithCache } from "./analyze-with-cache.ts";
import { resolveAssetPath } from "./resolve-asset-path.ts";
import { defineTool } from "./tool-definition.ts";

export const AnalyzeAudioInputSchema = z.strictObject({
  path: z.string().min(1),
  targetBpm: z.number().finite().min(60).max(320).optional(),
});

export const analyzeAudio = defineTool({
  name: "analyze_audio",
  description:
    "Analyze an audio file in the workspace and return compact JSON: tempo, key, loudness, " +
    "band energies and dynamics. Use it whenever you need measured facts about a track. " +
    "path is relative to the workspace (.wav, .flac, .mp3, .aiff, .ogg). " +
    "Pass targetBpm (60-320) when the approximate tempo is known: it only picks the octave (the measured tempo or its half or double), it does not pull the measurement. " +
    "tempo.target.matches tells whether the measured tempo is within 1 BPM of targetBpm; tempo.target is null without it.",
  risk: "read",
  inputSchema: AnalyzeAudioInputSchema,
  outputSchema: AudioFeaturesSchema,
  handler: async ({ path, targetBpm }, ctx) => {
    // Validate before touching the analyzer (constitution, rule 13).
    const assetPath = await resolveAssetPath(ctx.workspaceRoot, path);
    const { features } = await analyzeWithCache(
      ctx,
      assetPath,
      targetBpm === undefined ? {} : { targetBpm },
    );
    return features;
  },
});
