// `GET /a/:username.svg`: the generated avatar for external use (docs/ARCHITECTURE.md §9.3).
import { avatarSvg } from "@wordless/shared";
import type { Context } from "hono";
import { parseUsername } from "./http.ts";

/** A year, and `immutable`: the picture is a pure function of the name, so it never changes. */
const AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Draws the avatar of any name a bot could have, whether or not one has it: the picture needs no
 * database, so there is nothing to look up and nothing to purge. A name is drawn in its normalized
 * spelling, so `/a/Glitch.svg` is `/a/glitch.svg`. Anything else is a plain `404` (the SPA shell must not
 * answer for an image URL). The SVG holds only numbers drawn from the hash, and carries a CSP that
 * forbids everything, so opening it directly can run nothing.
 */
export function avatarResponse(c: Context): Response {
  const file = c.req.param("file") ?? "";
  const username = file.endsWith(".svg") ? parseUsername(file.slice(0, -4)) : undefined;
  if (username === undefined) return c.text("Not found", 404);

  return new Response(avatarSvg(username), {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": AVATAR_CACHE_CONTROL,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
