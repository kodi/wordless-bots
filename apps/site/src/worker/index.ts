import { Hono } from "hono";
import { pingDb, readDb } from "./db/queries.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", async (c) => {
  const db = await pingDb(readDb(c.env));
  return c.json({ ok: db });
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "not_found", message: "No such endpoint." } }, 404);
  }
  // HTML routes in run_worker_first: serve the SPA shell. Boot-data injection (§9.2) comes later.
  // Fetch the shell itself: passing the raw request lets Static Assets redirect /@user to /%40user.
  return c.env.ASSETS.fetch(new URL("/", c.req.url));
});

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
