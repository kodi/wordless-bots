import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // Vitest runs the Worker through @cloudflare/vitest-plugin; dev and build use @cloudflare/vite-plugin.
  plugins:
    mode === "test"
      ? [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                IP_HASH_SECRET: "test-ip-hash-secret",
                ADMIN_TOKEN: "test-admin-token",
                TEST_MIGRATIONS: await readD1Migrations(`${import.meta.dirname}/migrations`),
              },
            },
          })),
        ]
      : [cloudflare(), react()],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
