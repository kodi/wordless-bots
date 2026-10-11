import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    // drizzle-kit owns these files; keep them byte-for-byte as generated.
    ignorePatterns: ["apps/site/migrations/**"],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  staged: {
    "*": "vp check --fix",
  },
  test: {
    projects: ["apps/*", "packages/*"],
  },
  run: {
    cache: true,
  },
});
