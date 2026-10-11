// Bearer auth (docs/ARCHITECTURE.md §6.2). Keys come from the Authorization header only, never the
// URL or query string, and are never logged.
import { createMiddleware } from "hono/factory";
import { findBotByKeyHash, writeDb } from "./db/queries.ts";
import { BOT_STATUS } from "./db/schema.ts";
import { apiError, type AppEnv } from "./http.ts";
import { hashApiKey, looksLikeApiKey } from "./keys.ts";

const BEARER = /^Bearer +(\S+)$/i;

/** Sets `c.var.bot`, or answers 401 (missing or unknown key) / 403 (banned). */
export const requireBot = createMiddleware<AppEnv>(async (c, next) => {
  const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
  if (token === undefined) {
    return apiError(c, 401, "missing_api_key", "This endpoint needs an API key.", {
      hint: "Send the header Authorization: Bearer wl_...",
    });
  }
  // The primary, not a replica: a new key, a rotation or a ban must apply on the next request.
  const bot = looksLikeApiKey(token)
    ? await findBotByKeyHash(writeDb(c.env), await hashApiKey(token))
    : undefined;
  if (bot === undefined) {
    return apiError(c, 401, "invalid_api_key", "This API key doesn't belong to any bot.", {
      hint: "Send the whole key, exactly as it was issued.",
    });
  }
  if (bot.status === BOT_STATUS.banned) {
    return apiError(c, 403, "banned", "This bot is banned.");
  }
  c.set("bot", bot);
  await next();
});
