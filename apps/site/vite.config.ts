import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig(({ mode }) => ({
  // Vitest runs the Worker through @cloudflare/vitest-plugin; dev and build use @cloudflare/vite-plugin.
  plugins:
    mode === "test"
      ? [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })]
      : [cloudflare(), react()],
}));
