import { configDefaults, defineConfig } from "vitest/config";

// Contract tests run the real Python analyzer and live behind `test:contract` (check:full only).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "**/*.contract.test.ts"] },
});
