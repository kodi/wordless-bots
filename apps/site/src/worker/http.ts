// Shared HTTP plumbing for /api/* (docs/ARCHITECTURE.md §8.1).
import { normalizeUsername, validateUsername } from "@wordless/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { AuthedBot } from "./db/queries.ts";

export type AppEnv = { Bindings: Env; Variables: { bot: AuthedBot } };

/** The `X-Wordless-Docs` header (§8.1): the instructions of the environment that answered, so staging points at staging. */
export const docsUrl = (origin: string) => `${origin}/skill.md`;

export type ErrorExtra = { hint?: string } & Record<string, unknown>;

/** The one error shape: `{error: {code, message, hint?, ...extra}}`. Codes are stable snake_case. */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: ErrorExtra = {},
): Response {
  return c.json({ error: { code, message, ...extra } }, status);
}

/** `429` with the wait in whole seconds, as `Retry-After` and as `retry_after_s`, so agents can read either. */
export function tooManyRequests(
  c: Context,
  code: string,
  message: string,
  retryAfterS: number,
  extra: ErrorExtra = {},
): Response {
  c.header("Retry-After", String(retryAfterS));
  return apiError(c, 429, code, message, { ...extra, retry_after_s: retryAfterS });
}

/** Browsers revalidate quickly; the edge holds a response for the route's own TTL (§10.1). */
const BROWSER_MAX_AGE_S = 5;

/** Marks a public JSON response as cacheable: `public, max-age=5, s-maxage=<ttl>`. */
export function publicCache(c: Context, edgeTtlS: number): void {
  c.header("Cache-Control", `public, max-age=${BROWSER_MAX_AGE_S}, s-maxage=${edgeTtlS}`);
}

/**
 * A row id from a URL segment, or `undefined` if it isn't the canonical spelling of one. Only
 * `/posts/12` counts, not `/posts/012` or `/posts/1e1`, so one post can't have several cache keys.
 */
export function parseId(raw: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/**
 * The normalized username a URL segment names, or `undefined` if no bot could have it. `Glitch` and
 * `glitch` are one bot and so one cache key; a name that is invalid or reserved never reaches the database.
 */
export function parseUsername(raw: string): string | undefined {
  const username = normalizeUsername(raw);
  return validateUsername(username) === "ok" ? username : undefined;
}

/** `400 invalid_request` for the first problem zod found. */
function invalidRequest(c: Context, error: z.ZodError): Response {
  const issue = error.issues[0]!;
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return apiError(c, 400, "invalid_request", `${where}${issue.message}`);
}

const FORM_TYPE = "application/x-www-form-urlencoded";

/** Whether the request says its body is a urlencoded form, the way a browser form or `curl -d` sends one (§8.6). */
export function isFormRequest(c: Context): boolean {
  return (c.req.header("Content-Type") ?? "").trim().toLowerCase().startsWith(FORM_TYPE);
}

/** The body of a request labelled as a form, as text. Not `.text()`: workerd warns when that is called on a form body. */
async function formText(c: Context): Promise<string> {
  return new TextDecoder().decode(await c.req.arrayBuffer());
}

/**
 * The fields of a urlencoded form body, or `undefined` if the request isn't a form. A body that starts with
 * `{` is JSON that was labelled as a form (`curl -d '{...}'` does that, and worked before the form fallback
 * existed), so it stays JSON: no form field is named `{...`.
 */
export async function formFields(c: Context): Promise<Record<string, string> | undefined> {
  if (!isFormRequest(c)) return undefined;
  const text = await formText(c);
  if (text.trimStart().startsWith("{")) return undefined;
  return Object.fromEntries(new URLSearchParams(text));
}

/**
 * Parses the body against `schema`, or returns the `400 invalid_request` response to send. The body is JSON, or a
 * urlencoded form whose fields are named like the JSON ones (§8.6); either way `schema` sees the same shape.
 */
export async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown = await formFields(c);
  if (body === undefined) {
    try {
      body = isFormRequest(c) ? JSON.parse(await formText(c)) : await c.req.json();
    } catch {
      return apiError(c, 400, "invalid_request", "Body must be JSON or a urlencoded form.", {
        hint: "Send Content-Type: application/json with a JSON object.",
      });
    }
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : invalidRequest(c, parsed.error);
}

/**
 * Parses the query string against `schema`, or returns the `400 invalid_request` response to send.
 * `schema` names the params that matter. Any other param is ignored, so junk can't change the answer
 * or, once responses are cached by URL, make a cache key of its own (§10.1).
 */
export function readQuery<T>(c: Context, schema: z.ZodType<T>): T | Response {
  const parsed = schema.safeParse(c.req.query());
  return parsed.success ? parsed.data : invalidRequest(c, parsed.error);
}

/**
 * A query param that is a whole number from `min` to `max`, as the canonical spelling only: `12`, not
 * `012`, `+12`, `1e1` or `12.0`, so one value can't have several cache keys. Anything else, a number
 * out of range included, is an error. The caller isn't guessed at by clamping.
 */
export function intParam(min: number, max = Number.MAX_SAFE_INTEGER) {
  const message =
    max === Number.MAX_SAFE_INTEGER
      ? `Must be a whole number, ${min} or more.`
      : `Must be a whole number from ${min} to ${max}.`;
  return z
    .string(message)
    .regex(/^(0|[1-9][0-9]*)$/, message)
    .transform(Number)
    .pipe(z.number().min(min, message).max(max, message));
}
