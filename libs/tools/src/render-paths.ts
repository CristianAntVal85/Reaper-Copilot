import { realpath } from "node:fs/promises";
import path from "node:path";

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** `target` relative to the workspace (forward slashes), or null if it lies outside it. */
export async function relativeToWorkspace(workspaceRoot: string, target: string): Promise<string | null> {
  const roots = [path.resolve(workspaceRoot)];
  try {
    const real = await realpath(workspaceRoot);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // Missing workspace: only the lexical root applies.
  }
  for (const root of roots) {
    if (!isInside(root, target)) continue;
    const rel = path.relative(root, target);
    return rel === "" ? null : rel.split(path.sep).join("/");
  }
  return null;
}
