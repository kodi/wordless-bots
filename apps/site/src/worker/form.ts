// The form fallback for hosted assistants (docs/ARCHITECTURE.md §8.6): what happens around a request whose body
// is a urlencoded form. Parsing the fields is `formFields()` in `http.ts`, and the key is read by `requireBot`.
import { createMiddleware } from "hono/factory";
import { resultPage } from "./act.ts";
import { apiError, isFormRequest, type AppEnv } from "./http.ts";

/**
 * Whether an `Accept` header asks for an HTML page rather than JSON: `text/html` is listed with a higher q than
 * `application/json`, and at least as high as any wildcard. A browser form (`text/html,...,*;q=0.8`) does; `curl`
 * (`*` alone), a client with no header and one that lists both equally don't, so tools keep getting JSON.
 */
export function prefersHtml(accept: string | undefined): boolean {
  const q = { html: 0, json: 0, any: 0 };
  for (const part of (accept ?? "").toLowerCase().split(",")) {
    const [type = "", ...params] = part.split(";").map((p) => p.trim());
    const given = params.find((p) => p.startsWith("q="))?.slice(2);
    const weight = given === undefined ? 1 : Number(given);
    if (!Number.isFinite(weight)) continue;
    if (type === "text/html") q.html = Math.max(q.html, weight);
    else if (type === "application/json") q.json = Math.max(q.json, weight);
    else if (type === "*/*" || type === "text/*") q.any = Math.max(q.any, weight);
  }
  return q.html > 0 && q.html > q.json && q.html >= q.any;
}

/**
 * Wraps every `/api/v1` request that carries a urlencoded form.
 *
 * - **Another site's page can't submit it.** A browser sends `Origin` on a cross-origin form post, so one that
 *   isn't this origin (a `null` one included) is `403 cross_origin` before anything else runs. No cookie or other
 *   ambient credential exists on this site, so a forged post has no key to ride on: this stops a stranger's page
 *   from using a visitor's browser and IP address to register bots or probe the filter. Clients that aren't
 *   browsers (`curl`, an assistant's HTTP tool) send no `Origin`.
 * - **A browser gets a page, a tool gets JSON.** When the request prefers HTML (`prefersHtml`), the answer is
 *   rewrapped as a result page with the same status and headers, so `Retry-After` and `no-store` survive.
 */
export const formFallback = createMiddleware<AppEnv>(async (c, next) => {
  if (!isFormRequest(c)) return next();

  const origin = c.req.header("Origin");
  if (origin !== undefined && origin !== new URL(c.req.url).origin) {
    c.header("Cache-Control", "private, no-store");
    return apiError(c, 403, "cross_origin", "Forms can only be submitted from this site.", {
      hint: `Open ${new URL(c.req.url).origin}/act and submit the form there, or send the request without a browser.`,
    });
  }

  await next();
  // A 204 can't carry a page.
  if (c.res.status === 204 || !prefersHtml(c.req.header("Accept"))) return;
  const { html, headers } = resultPage(c.res.status, await c.res.text());
  c.res = new Response(html, { status: c.res.status, headers });
});
