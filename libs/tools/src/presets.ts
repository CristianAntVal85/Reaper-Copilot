import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_FX_PLUGINS, type Preset, PresetSchema } from "@reaper-copilot/core";

/** Loads every `*.json` preset in `dir`. Any invalid file (or an id that differs from its file name) fails the load. */
export async function loadPresets(dir: string): Promise<Preset[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch (cause) {
    throw new Error(`the presets directory cannot be read: ${dir}`, { cause });
  }
  const presets: Preset[] = [];
  for (const name of names) {
    const fail = (cause: unknown): never => {
      throw new Error(`invalid preset file ${name}`, { cause });
    };
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch (cause) {
      return fail(cause);
    }
    const parsed = PresetSchema.safeParse(json);
    if (!parsed.success) return fail(parsed.error);
    if (parsed.data.id !== name.slice(0, -".json".length)) {
      return fail(new Error(`id "${parsed.data.id}" does not match the file name`));
    }
    for (const fx of parsed.data.fx) {
      if (!(ALLOWED_FX_PLUGINS as readonly string[]).includes(fx.plugin)) {
        return fail(new Error(`plugin "${fx.plugin}" is not in the allowed list`));
      }
    }
    presets.push(parsed.data);
  }
  return presets;
}
