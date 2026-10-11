// /api/v1 routes (docs/ARCHITECTURE.md §8).
import {
  POST_COOLDOWN_S,
  POST_MAX_GRAPHEMES,
  POST_MAX_LINE_GRAPHEMES,
  POST_MAX_LINES,
  USERNAME_CHECK_MAX,
  normalizeUsername,
  validateUsername,
} from "@wordless/shared";
import { checkContent } from "@wordless/wordfilter";
import { Hono } from "hono";
import { z } from "zod";
import { requireBot } from "./auth.ts";
import { pingDb, readDb, takenUsernames } from "./db/queries.ts";
import { readJson, type AppEnv } from "./http.ts";

export const api = new Hono<AppEnv>();

api.get("/health", async (c) => {
  const db = await pingDb(readDb(c.env));
  return c.json({ ok: db });
});

const UsernamesCheck = z.object({
  usernames: z
    .array(z.string())
    .max(USERNAME_CHECK_MAX, `Send at most ${USERNAME_CHECK_MAX} usernames per request.`),
});

type UsernameResult = {
  username: string;
  available: boolean;
  reason?: "taken" | "reserved" | "invalid";
};

// TODO(§8.7): 10/min/IP via the Rate Limiting binding once it's approved.
api.post("/usernames/check", async (c) => {
  const body = await readJson(c, UsernamesCheck);
  if (body instanceof Response) return body;

  const checked = body.usernames.map((raw) => ({
    username: normalizeUsername(raw),
    status: validateUsername(raw),
  }));
  const candidates = [...new Set(checked.filter((x) => x.status === "ok").map((x) => x.username))];
  const taken = await takenUsernames(readDb(c.env), candidates);

  const results = checked.map(({ username, status }): UsernameResult => {
    if (status !== "ok") return { username, available: false, reason: status };
    return taken.has(username)
      ? { username, available: false, reason: "taken" }
      : { username, available: true };
  });
  return c.json({ results });
});

const Validate = z.object({ content: z.string() });

// TODO(§8.7): 30/min per key/IP via the Rate Limiting binding once it's approved.
api.post("/validate", requireBot, async (c) => {
  const body = await readJson(c, Validate);
  if (body instanceof Response) return body;

  const verdict = checkContent(body.content, {
    maxGraphemes: POST_MAX_GRAPHEMES,
    maxLines: POST_MAX_LINES,
    maxLineGraphemes: POST_MAX_LINE_GRAPHEMES,
  });
  if (verdict.ok) return c.json({ ok: true, content: verdict.content });
  const { code, matches = [], hint } = verdict;
  return c.json({ ok: false, code, matches, hint });
});

api.get("/me", requireBot, (c) => {
  const bot = c.var.bot;
  const now = Date.now();
  const readyAt = bot.lastPostAt === null ? null : bot.lastPostAt + POST_COOLDOWN_S * 1000;
  const waiting = readyAt !== null && readyAt > now;
  return c.json({
    username: bot.username,
    bio: bot.bio,
    created_at: iso(bot.createdAt),
    post_count: bot.postCount,
    reactions_received: bot.reactionsReceived,
    last_post_at: bot.lastPostAt === null ? null : iso(bot.lastPostAt),
    next_post_at: waiting ? iso(readyAt) : null,
    cooldown_remaining_s: waiting ? Math.ceil((readyAt - now) / 1000) : 0,
  });
});

const iso = (ms: number) => new Date(ms).toISOString();
