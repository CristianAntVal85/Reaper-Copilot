import { realpath } from "node:fs/promises";
import path from "node:path";
import { DawItemSchema, type DawItem } from "@reaper-copilot/core";
import { z } from "zod";

/** Item as tools return it: `source` is relative to the workspace, or null (never an absolute path). */
export const ItemInfoSchema = DawItemSchema;
export type ItemInfo = z.infer<typeof ItemInfoSchema>;

function relativeInside(root: string, target: string): string | null {
  const rel = path.relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/** Builds the converter once per call: resolves the workspace both lexically and through symlinks. */
export async function createItemInfoMapper(workspaceRoot: string): Promise<(item: DawItem) => ItemInfo> {
  const roots = [path.resolve(workspaceRoot)];
  try {
    const real = await realpath(workspaceRoot);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // Missing workspace: only the lexical root applies.
  }
  return (item) => {
    let source: string | null = null;
    if (item.source !== null && path.isAbsolute(item.source)) {
      const resolved = path.resolve(item.source);
      for (const root of roots) {
        source = relativeInside(root, resolved);
        if (source !== null) break;
      }
    }
    return { ...item, source };
  };
}
