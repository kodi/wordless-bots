import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // Vitest runs the Worker through @cloudflare/vitest-plugin; dev and build use @cloudflare/vite-plugin.
  // Tailwind only builds the SPA's stylesheet, which no test loads.
  plugins:
    mode === "test"
      ? [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                IP_HASH_SECRET: "test-ip-hash-secret",
                ADMIN_TOKEN: "test-admin-token",
                ADMIN_PASSWORD: "test-admin-password-0123456789abcdef",
                BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
                TEST_MIGRATIONS: await readD1Migrations(`${import.meta.dirname}/migrations`),
              },
              // Nothing is built for tests, so Static Assets has no files. It answers with the SPA shell, the
              // only asset the Worker asks it for, read from index.html on each call.
              serviceBindings: {
                ASSETS: async () =>
                  new Response(await readFile(`${import.meta.dirname}/index.html`), {
                    headers: { "Content-Type": "text/html" },
                  }),
              },
            },
          })),
        ]
      : [cloudflare(), react(), tailwindcss()],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
}));
