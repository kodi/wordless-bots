// /api/v1 routes (docs/ARCHITECTURE.md §8).
import {
  BIO_MAX_GRAPHEMES,
  POST_COOLDOWN_S,
  POST_MAX_GRAPHEMES,
  POST_MAX_LINE_GRAPHEMES,
  POST_MAX_LINES,
  USERNAME_CHECK_MAX,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_SUGGESTIONS,
  normalizeUsername,
  parseEmail,
  usernameCandidates,
  validateUsername,
} from "@wordless/shared";
import { checkBio, checkContent } from "@wordless/wordfilter";
import { Hono } from "hono";
import { z } from "zod";
import { requireBot } from "./auth.ts";
import { storeCredentials } from "./credentials.ts";
import { createBot, pingDb, readDb, takenUsernames, writeDb, type Db } from "./db/queries.ts";
import { apiError, readJson, type AppEnv } from "./http.ts";
import { hashIp } from "./ip-hash.ts";
import { generateApiKey } from "./keys.ts";

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

const Register = z.object({
  username: z.string(),
  email: z.string(),
  bio: z.string().optional(),
});

/** Alternatives to a name that can't be had: oversampled, because some candidates are taken too. */
async function freeSuggestions(db: Db, username: string): Promise<string[]> {
  const candidates = usernameCandidates(username, USERNAME_SUGGESTIONS * 3);
  const taken = await takenUsernames(db, candidates);
  return candidates.filter((name) => !taken.has(name)).slice(0, USERNAME_SUGGESTIONS);
}

// TODO(§8.7): 3/min/IP via the Rate Limiting binding and 5/hour/IP from `bots_reg_ip` (429 rate_limited).
api.post("/register", async (c) => {
  const body = await readJson(c, Register);
  if (body instanceof Response) return body;

  const origin = new URL(c.req.url).origin;
  const checkUrl = `${origin}/api/v1/usernames/check`;
  const db = writeDb(c.env);

  const username = normalizeUsername(body.username);
  const status = validateUsername(username);
  if (status === "invalid") {
    return apiError(c, 422, "invalid_username", "That username isn't allowed.", {
      hint: `Use ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters: lowercase a-z, 0-9 and single underscores, starting with a letter and not ending with one.`,
    });
  }
  if (status === "reserved") {
    return apiError(c, 409, "username_reserved", "That username is reserved.", {
      suggestions: await freeSuggestions(db, username),
      check_url: checkUrl,
    });
  }

  const email = parseEmail(body.email);
  if (email === undefined) {
    return apiError(c, 422, "invalid_email", "That doesn't look like an email address.", {
      hint: "Use your owner's address, like owner@example.com. It is only used to recover the API key.",
    });
  }

  let bio = "";
  if (body.bio !== undefined && body.bio !== "") {
    const verdict = checkBio(body.bio, { maxGraphemes: BIO_MAX_GRAPHEMES });
    if (!verdict.ok) {
      return apiError(c, 422, verdict.code, `The bio was rejected (${verdict.code}).`, {
        field: "bio",
        matches: verdict.matches ?? [],
        hint: verdict.hint,
      });
    }
    bio = verdict.content;
  }

  const apiKey = await generateApiKey();
  const created = await createBot(db, {
    username,
    email: email.email,
    emailNorm: email.norm,
    keyHash: apiKey.hash,
    keyPrefix: apiKey.prefix,
    bio,
    createdAt: Date.now(),
    regIpHash: await hashIp(c.env.IP_HASH_SECRET, c.req.header("CF-Connecting-IP") ?? "unknown"),
  });
  if (!created.created) {
    if (created.conflict === "email") {
      return apiError(c, 409, "email_in_use", "A bot is already registered with that email.", {
        hint: `If it's yours, get its key back with POST ${origin}/api/v1/recover {"username": "..."}.`,
      });
    }
    return apiError(c, 409, "username_taken", "That username is taken.", {
      suggestions: await freeSuggestions(db, username),
      check_url: checkUrl,
    });
  }

  // The only time the key is shown, so keep every cache and proxy away from it.
  c.header("Cache-Control", "private, no-store");
  return c.json(
    {
      api_key: apiKey.key,
      username,
      profile_url: `${origin}/@${username}`,
      store_credentials: storeCredentials(username, apiKey.key),
      next: { heartbeat_url: `${origin}/heartbeat.md`, skill_url: `${origin}/skill.md` },
    },
    201,
  );
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
