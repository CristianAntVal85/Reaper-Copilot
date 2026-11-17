import js from "@eslint/js";
import nx from "@nx/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", ".nx/", ".angular/", "spikes/", "specs/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,mts,cts}"],
    plugins: { "@nx": nx },
    rules: {
      // Dependency direction between workspace packages, driven by nx.tags in each package.json.
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            { sourceTag: "scope:core", onlyDependOnLibsWithTags: [] },
            { sourceTag: "scope:testing", onlyDependOnLibsWithTags: ["scope:core"] },
            {
              sourceTag: "scope:tools",
              onlyDependOnLibsWithTags: ["scope:core", "scope:testing"],
            },
            {
              sourceTag: "scope:agent",
              onlyDependOnLibsWithTags: ["scope:tools", "scope:core", "scope:testing"],
            },
            { sourceTag: "scope:adapter", onlyDependOnLibsWithTags: ["scope:core"] },
            {
              sourceTag: "scope:app",
              onlyDependOnLibsWithTags: [
                "scope:core",
                "scope:tools",
                "scope:agent",
                "scope:adapter",
                "scope:testing",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // Constitution rule 6, syntax side: dynamic imports (import("zod"), import("zod").ZodType)
    // bypass no-restricted-imports, so they are banned in all of core, tests included.
    files: ["libs/core/**/*.{ts,mts,cts,js,mjs,cjs}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "libs/core must not use dynamic import() (constitution, rule 6).",
        },
        {
          selector: "TSImportType",
          message: "libs/core must not use import() types (constitution, rule 6).",
        },
      ],
    },
  },
  {
    // Constitution rule 6: core production code imports nothing external except zod
    // (the single exception, decided in F1a). Other bare specifiers ('node:fs', '@scope/pkg')
    // are banned; relative paths are fine. The regex matches every non-relative specifier
    // other than exactly 'zod': npm packages and Node modules alike.
    files: ["libs/core/**/*.{ts,mts,cts,js,mjs,cjs}"],
    ignores: ["libs/core/**/*.test.{ts,mts,cts,js,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!zod$)[^./]",
              message:
                "libs/core may import only zod and relative paths (constitution, rule 6).",
            },
          ],
        },
      ],
    },
  },
  {
    // Core tests may import only vitest and zod (plus relative paths).
    files: ["libs/core/**/*.test.{ts,mts,cts,js,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!(?:vitest|zod)$)[^./]",
              message:
                "Tests in libs/core may import only vitest, zod and relative paths (constitution, rule 6).",
            },
          ],
        },
      ],
    },
  },
);
