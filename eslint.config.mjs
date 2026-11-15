import js from "@eslint/js";
import nx from "@nx/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", ".nx/", "spikes/", "specs/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
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
            { sourceTag: "scope:tools", onlyDependOnLibsWithTags: ["scope:core"] },
            {
              sourceTag: "scope:agent",
              onlyDependOnLibsWithTags: ["scope:tools", "scope:core"],
            },
            { sourceTag: "scope:adapter", onlyDependOnLibsWithTags: ["scope:core"] },
            {
              sourceTag: "scope:app",
              onlyDependOnLibsWithTags: [
                "scope:core",
                "scope:tools",
                "scope:agent",
                "scope:adapter",
              ],
            },
          ],
        },
      ],
    },
  },
  {
    // Constitution rule 6: core production code imports nothing external.
    // Bare specifiers ('zod', 'node:fs', '@scope/pkg') are banned; relative paths are fine.
    // Done here and not with bannedExternalImports because that option ignores Node built-ins.
    files: ["libs/core/**/*.ts"],
    ignores: ["libs/core/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^[^./]",
              message:
                "libs/core must not import external packages or Node modules (constitution, rule 6).",
            },
          ],
        },
      ],
    },
  },
);
