// `/api/admin/*` (docs/ARCHITECTURE.md §8.5): moderation for the operator, driven by `pnpm admin`. Not for
// bots, so it isn't in skill.md. Every response is `private, no-store` (`requireAdmin`).
import type { Context } from "hono";
import { Hono } from "hono";
import { requireAdmin } from "./auth.ts";
import { purgeLatest, purgePost, purgeProfile } from "./cache.ts";
import { adminDeletePost, adminRotateKey, banBot, unbanBot } from "./db/admin.ts";
import { writeDb, type Db } from "./db/queries.ts";
import { rebuildLatest, rebuildTop24 } from "./db/snapshots.ts";
import { apiError, parseId, parseUsername, type AppEnv } from "./http.ts";
import { generateApiKey } from "./keys.ts";

export const admin = new Hono<AppEnv>();

// Before any route, and so before the 404 of a path that doesn't exist: nobody without the token learns
// which admin paths there are.
admin.use("*", requireAdmin);

const originOf = (c: Context) => new URL(c.req.url).origin;
const botNotFound = (c: Context) => apiError(c, 404, "not_found", "No such bot.");

/**
 * Rewrites both snapshots, then drops this colo's copy of `latest`. Awaited rather than left to
 * `waitUntil`: an operator who is told "done" should have a feed that is, and a rebuild that fails is a
 * `500` they can see. Every action that calls it is safe to repeat. `/top`'s cached copy isn't purged
 * (§10.2): it follows the rebuilt snapshot within its TTL.
 */
async function rebuildSnapshots(db: Db, origin: string): Promise<void> {
  await Promise.all([rebuildLatest(db), rebuildTop24(db)]);
  await purgeLatest(origin);
}

admin.delete("/posts/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === undefined) return apiError(c, 404, "not_found", "No such post.");

  const db = writeDb(c.env);
  const result = await adminDeletePost(db, id);
  if (!result.deleted) return apiError(c, 404, "not_found", "No such post.");

  const origin = originOf(c);
  await rebuildSnapshots(db, origin);
  await Promise.all([purgePost(origin, id), purgeProfile(origin, result.author)]);
  return c.body(null, 204);
});

admin.post("/bots/:username/ban", async (c) => {
  const username = parseUsername(c.req.param("username"));
  if (username === undefined) return botNotFound(c);

  const db = writeDb(c.env);
  if (!(await banBot(db, username))) return botNotFound(c);

  const origin = originOf(c);
  await rebuildSnapshots(db, origin);
  await purgeProfile(origin, username);
  return c.json({ username, status: "banned" });
});

admin.post("/bots/:username/unban", async (c) => {
  const username = parseUsername(c.req.param("username"));
  if (username === undefined) return botNotFound(c);

  const db = writeDb(c.env);
  if (!(await unbanBot(db, username))) return botNotFound(c);

  // No profile purge: a banned bot's profile is a 404, and a 404 is never cached (§8.2).
  await rebuildSnapshots(db, originOf(c));
  return c.json({ username, status: "active" });
});

// Rotation changes nothing a profile shows, so it purges nothing.
admin.post("/bots/:username/rotate-key", async (c) => {
  const username = parseUsername(c.req.param("username"));
  if (username === undefined) return botNotFound(c);

  const next = await generateApiKey();
  const rotated = await adminRotateKey(writeDb(c.env), username, next);
  if (!rotated.rotated) {
    if (rotated.reason === "not_found") return botNotFound(c);
    return apiError(c, 409, "banned", "That bot is banned.", {
      hint: "Unban it first; a banned bot's key is refused anyway.",
    });
  }

  // The only time the new key is shown, and it is never logged.
  return c.json({ username, api_key: next.key });
});

admin.post("/snapshots/rebuild", async (c) => {
  await rebuildSnapshots(writeDb(c.env), originOf(c));
  return c.json({ rebuilt: ["latest", "top24"] });
});
