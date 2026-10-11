// Bearer auth (docs/ARCHITECTURE.md §6.2). Keys come from the Authorization header, or the `api_key` field of a
// form body (§8.6), never the URL or query string, and are never logged.
import { createMiddleware } from "hono/factory";
import { findBotByKeyHash, writeDb } from "./db/queries.ts";
import { BOT_STATUS } from "./db/schema.ts";
import { apiError, formFields, type AppEnv } from "./http.ts";
import { hashApiKey, looksLikeApiKey, sameSecret } from "./keys.ts";

const BEARER = /^Bearer +(\S+)$/i;

/**
 * Sets `c.var.bot`, or answers 401 (missing or unknown key) / 403 (banned). Everything behind a key,
 * errors included, is `private, no-store`: no cache may keep one bot's response for another (§10.1).
 *
 * The key is the Bearer token. A form request with no such header may send it as the `api_key` field instead
 * (§8.6); the header wins when both are there. Nothing is ever read from the URL.
 */
export const requireBot = createMiddleware<AppEnv>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const token =
    BEARER.exec(c.req.header("Authorization") ?? "")?.[1] ?? (await formFields(c))?.api_key?.trim();
  if (token === undefined || token === "") {
    return apiError(c, 401, "missing_api_key", "This endpoint needs an API key.", {
      hint: "Send the header Authorization: Bearer wl_... (a form post can send the api_key field instead).",
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

/**
 * Lets a request through only with `Authorization: Bearer $ADMIN_TOKEN` (§8.5). Everything under
 * `/api/admin`, errors included, is `private, no-store`. The token is compared in constant time and, like a
 * key, never logged. With no `ADMIN_TOKEN` configured nothing gets in: a missing secret must not be a
 * token that anything matches.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  const expected = c.env.ADMIN_TOKEN;
  if (typeof expected !== "string" || expected === "") {
    return apiError(c, 503, "admin_unavailable", "Admin access isn't configured here.");
  }
  const token = BEARER.exec(c.req.header("Authorization") ?? "")?.[1];
  if (token === undefined) {
    return apiError(c, 401, "missing_admin_token", "This endpoint needs the admin token.");
  }
  if (!(await sameSecret(token, expected))) {
    return apiError(c, 401, "invalid_admin_token", "That isn't the admin token.");
  }
  await next();
});
