export type PathStyle = "unc" | "identity";

export interface PathOptions {
  readonly style: PathStyle;
  /** WSL distribution name; required for `unc`. */
  readonly distro?: string;
}

const UNC_PREFIX = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i;

/** Linux absolute path -> the path Reaper (Windows) must use. Returns null if it cannot be mapped. */
export function toDawPath(linuxPath: string, options: PathOptions): string | null {
  if (!linuxPath.startsWith("/") || linuxPath.includes("\0")) return null;
  if (options.style === "identity") return linuxPath;
  if (!options.distro) return null;
  return `\\\\wsl.localhost\\${options.distro}${linuxPath.replaceAll("/", "\\")}`;
}

/**
 * Path reported by Reaper -> Linux absolute path. Returns null when it does not name a place in
 * this Linux distribution (a Windows drive, a relative name, another distribution).
 */
export function fromDawPath(dawPath: string, options: PathOptions): string | null {
  if (dawPath.includes("\0")) return null;
  if (options.style === "identity") return dawPath.startsWith("/") ? dawPath : null;
  const match = UNC_PREFIX.exec(dawPath.replaceAll("/", "\\"));
  if (!match) return null;
  const distro = match[1] ?? "";
  if (!options.distro || distro.toLowerCase() !== options.distro.toLowerCase()) return null;
  const rest = (match[2] ?? "").split("\\").filter((part) => part !== "");
  return `/${rest.join("/")}`;
}
