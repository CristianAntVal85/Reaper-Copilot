import { CopilotError, type CopilotErrorCode, ProjectStateSchema, TrackRefSchema } from "@reaper-copilot/core";
import { z } from "zod";

/** Version of the request envelope; the bridge refuses any other. */
export const BRIDGE_PROTOCOL_VERSION = 1;

export const BRIDGE_METHODS = ["ping", "get_project_state", "import_audio", "set_tempo", "slice", "stretch", "apply_fx_chain", "render", "undo", "quit"] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export const BRIDGE_ERROR_CODES = [
  "bad_request",
  "unknown_method",
  "invalid_params",
  "file_not_found",
  "item_not_found",
  "track_not_found",
  "fx_not_found",
  "param_not_found",
  "out_of_range",
  "output_exists",
  "media_offline",
  "render_failed",
  "nothing_to_undo",
  "internal",
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

export const ResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string().optional() }),
  }),
]);

export const HeartbeatSchema = z.object({
  state: z.enum(["idle", "rendering"]),
  instance: z.string().min(1),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const PingResultSchema = z.object({
  pong: z.literal(true),
  protocol: z.literal(BRIDGE_PROTOCOL_VERSION),
  instance: z.string().min(1),
  reaper: z.string(),
});
export type PingResult = z.infer<typeof PingResultSchema>;

export const BridgeItemSchema = ProjectStateSchema.shape.tracks.element.shape.items.element
  .omit({ source: true })
  .extend({ source: z.string().nullable() });

export type BridgeItem = z.infer<typeof BridgeItemSchema>;

export const BridgeImportResultSchema = z.object({
  track: TrackRefSchema,
  item: BridgeItemSchema,
});

export const BridgeItemResultSchema = BridgeItemSchema;

export const SetTempoResultSchema = z.object({ tempo: z.number().finite().positive() });
export const UndoResultSchema = z.object({ undone: z.string().min(1) });

/** Render result: the bounds of the rendered item, used when the WAV header cannot be read. */
export const BridgeRenderResultSchema = z.object({ lengthSec: z.number().finite().positive() });

export const QuitResultSchema = z.object({ bye: z.literal(true) });

/** Project state as Reaper reports it: item sources are still Windows paths (or null). */
export const BridgeProjectStateSchema = z.object({
  tempo: ProjectStateSchema.shape.tempo,
  lengthSec: ProjectStateSchema.shape.lengthSec,
  tracks: z.array(
    z.object({
      id: ProjectStateSchema.shape.tracks.element.shape.id,
      name: z.string(),
      fx: z.array(z.string()),
      items: z.array(
        ProjectStateSchema.shape.tracks.element.shape.items.element.omit({ source: true }).extend({
          source: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type BridgeProjectState = z.infer<typeof BridgeProjectStateSchema>;

/** Fixed client-facing text and domain code per bridge code. Reaper's own text never reaches the client. */
const TRANSLATION: Record<BridgeErrorCode, { code: CopilotErrorCode; message: string }> = {
  bad_request: { code: "daw_error", message: "the Reaper bridge rejected the request" },
  unknown_method: { code: "daw_error", message: "the Reaper bridge does not know this command" },
  invalid_params: { code: "daw_error", message: "the Reaper bridge rejected the parameters" },
  file_not_found: { code: "file_not_found", message: "Reaper could not find the file" },
  item_not_found: { code: "item_not_found", message: "no such item in the Reaper project" },
  track_not_found: { code: "track_not_found", message: "no such track in the Reaper project" },
  fx_not_found: { code: "daw_error", message: "Reaper could not load the requested plugin" },
  param_not_found: { code: "daw_error", message: "the plugin has no such parameter" },
  out_of_range: { code: "out_of_range", message: "the value is outside the allowed range" },
  output_exists: { code: "render_failed", message: "the render output already exists" },
  media_offline: { code: "daw_error", message: "the item's media is offline" },
  render_failed: { code: "render_failed", message: "Reaper could not render the item" },
  nothing_to_undo: { code: "nothing_to_undo", message: "there is nothing of the copilot's to undo" },
  internal: { code: "daw_error", message: "the Reaper bridge failed unexpectedly" },
};

/** Codes that mean a failed render only when they come from the `render` method. */
const RENDER_ONLY: Partial<Record<BridgeErrorCode, { code: CopilotErrorCode; message: string }>> = {
  media_offline: { code: "render_failed", message: "the item's media is offline" },
};

export function translateBridgeError(
  error: { code: string; message?: string | undefined },
  method?: BridgeMethod,
): CopilotError {
  const isKnown = (BRIDGE_ERROR_CODES as readonly string[]).includes(error.code);
  const known = isKnown
    ? ((method === "render" ? RENDER_ONLY[error.code as BridgeErrorCode] : undefined) ??
      TRANSLATION[error.code as BridgeErrorCode])
    : { code: "daw_error" as const, message: "the Reaper bridge reported an unknown error" };
  return new CopilotError(known.code, known.message, {
    cause: new Error(`bridge ${error.code}: ${error.message ?? ""}`),
  });
}
