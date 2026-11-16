import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { asAssetPath, CopilotError, type AssetPath } from "@reaper-copilot/core";

export const AUDIO_EXTENSIONS = [".wav", ".flac", ".mp3", ".aiff", ".ogg"] as const;

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

/**
 * Validates a user-supplied path (relative to the workspace, or absolute) and returns the
 * absolute, symlink-resolved path of an existing audio file inside the workspace.
 * Containment is checked lexically first (so nothing leaks about files outside) and again
 * after resolving symlinks.
 */
export async function resolveAssetPath(workspaceRoot: string, input: string): Promise<AssetPath> {
  if (input.length === 0 || input.includes("\0")) {
    throw new CopilotError("path_outside_workspace", "invalid path");
  }

  let realRoot: string;
  try {
    realRoot = await realpath(workspaceRoot);
  } catch (error) {
    throw new CopilotError("file_not_found", "workspace directory does not exist", {
      cause: error,
    });
  }

  const candidate = path.resolve(workspaceRoot, input);
  if (!isInside(path.resolve(workspaceRoot), candidate) && !isInside(realRoot, candidate)) {
    throw new CopilotError("path_outside_workspace", `path is outside the workspace: ${input}`);
  }

  let real: string;
  try {
    real = await realpath(candidate);
  } catch (error) {
    if (isMissing(error)) throw new CopilotError("file_not_found", `file not found: ${input}`);
    throw error;
  }
  if (!isInside(realRoot, real)) {
    throw new CopilotError("path_outside_workspace", `path is outside the workspace: ${input}`);
  }

  if (!(await stat(real)).isFile()) {
    throw new CopilotError("unsupported_format", `not a regular file: ${input}`);
  }
  const extension = path.extname(real).toLowerCase();
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new CopilotError(
      "unsupported_format",
      `unsupported extension "${extension}"; expected one of ${AUDIO_EXTENSIONS.join(", ")}`,
    );
  }
  return asAssetPath(real);
}
