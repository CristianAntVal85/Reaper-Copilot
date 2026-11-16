import { configDefaults, defineConfig } from "vitest/config";

// Tests against the real Reaper live behind `test:reaper` (local only, Reaper open).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/*.reaper.test.ts"] },
});
