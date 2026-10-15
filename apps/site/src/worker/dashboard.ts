// The admin dashboard's API (docs/ARCHITECTURE.md §8.8): Better Auth's sign-in for the one user, `admin`, whose
// password is `ADMIN_PASSWORD`, and the stats behind `/admin/dashboard`. Separate from `/api/admin/*`, which stays
// token-only: a session cookie can read the stats, never moderate.
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  ADMIN_SESSION_TTL_S,
  DASHBOARD_RANGES_DAYS,
  SITE_NAME,
} from "@wordless/shared";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import type { Context } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { adminAuthDatabase, dashboardStats, syncAdminAccount } from "./db/dashboard.ts";
import { readDb, writeDb } from "./db/queries.ts";
import { apiError, readQuery, type AppEnv } from "./http.ts";
import { hashAdminPassword, sameSecret } from "./keys.ts";

/** Better Auth for this request's origin, so staging's cookie and origin check are staging's own (like the docs, §11). */
function adminAuth(env: Env, origin: string) {
  return betterAuth({
    appName: SITE_NAME,
    baseURL: origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: adminAuthDatabase(env),
    // Sign-up is off: the one user is made from the env var (`syncAdminAccount()`), and its password is checked
    // as a random secret, like an API key (`hashAdminPassword()`), not with scrypt.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      password: {
        hash: hashAdminPassword,
        verify: async ({ hash, password }) => sameSecret(await hashAdminPassword(password), hash),
      },
    },
    plugins: [username()],
    session: { expiresIn: ADMIN_SESSION_TTL_S },
    // No IP is stored with a session (§13). No rate limit: it would key on the IP, and the password has the
    // entropy of a key.
    advanced: { ipAddress: { disableIpTracking: true }, cookiePrefix: "wordless_admin" },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  });
}

/** Whether this deployment has what the dashboard needs. Without it nothing gets in (like `requireAdmin`). */
function configured(env: Env): boolean {
  return (
    typeof env.ADMIN_PASSWORD === "string" &&
    env.ADMIN_PASSWORD.length >= ADMIN_PASSWORD_MIN_LENGTH &&
    typeof env.BETTER_AUTH_SECRET === "string" &&
    env.BETTER_AUTH_SECRET !== ""
  );
}

const originOf = (c: Context) => new URL(c.req.url).origin;

/** `private, no-store` on everything, Better Auth's own responses included, and `503` when the secrets are missing. */
const guard = createMiddleware<AppEnv>(async (c, next) => {
  if (!configured(c.env)) {
    c.header("Cache-Control", "private, no-store");
    return apiError(c, 503, "admin_unavailable", "The dashboard isn't configured here.");
  }
  await next();
  c.res.headers.set("Cache-Control", "private, no-store");
});

/** `/api/auth/*`: only the three Better Auth endpoints the page uses. Sign-up, password resets and the rest are `404`. */
export const auth = new Hono<AppEnv>();
auth.use("*", guard);

auth.post("/sign-in/username", async (c) => {
  await syncAdminAccount(writeDb(c.env), await hashAdminPassword(c.env.ADMIN_PASSWORD), Date.now());
  return adminAuth(c.env, originOf(c)).handler(c.req.raw);
});
auth.post("/sign-out", (c) => adminAuth(c.env, originOf(c)).handler(c.req.raw));
auth.get("/get-session", (c) => adminAuth(c.env, originOf(c)).handler(c.req.raw));

/** `/api/dashboard/*`: needs the admin's session cookie. */
export const dashboard = new Hono<AppEnv>();
dashboard.use("*", guard);
dashboard.use("*", async (c, next) => {
  const session = await adminAuth(c.env, originOf(c)).api.getSession({
    headers: c.req.raw.headers,
  });
  if (session === null) return apiError(c, 401, "not_signed_in", "Sign in at /admin/dashboard.");
  await next();
});

const RANGES = DASHBOARD_RANGES_DAYS.map(String) as [string, ...string[]];
const StatsQuery = z.object({ days: z.enum(RANGES).default(RANGES[0]).transform(Number) });

dashboard.get("/stats", async (c) => {
  const query = readQuery(c, StatsQuery);
  if (query instanceof Response) return query;
  return c.json(await dashboardStats(readDb(c.env), query.days, Date.now()));
});
