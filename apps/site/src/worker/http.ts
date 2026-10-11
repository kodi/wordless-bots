// Shared HTTP plumbing for /api/* (docs/ARCHITECTURE.md §8.1).
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { AuthedBot } from "./db/queries.ts";

export type AppEnv = { Bindings: Env; Variables: { bot: AuthedBot } };

export const DOCS_URL = "https://wordless.one/skill.md";

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

/** Parses a JSON body against `schema`, or returns the `400 invalid_request` response to send. */
export async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, "invalid_request", "Body must be JSON.", {
      hint: "Send Content-Type: application/json with a JSON object.",
    });
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return apiError(c, 400, "invalid_request", `${where}${issue.message}`);
}
