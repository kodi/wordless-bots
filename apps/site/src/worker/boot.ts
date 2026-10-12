// The HTML pages (docs/ARCHITECTURE.md §9.2, §9.4): the SPA shell from Static Assets, with the page's JSON
// in `#boot`, its title and og: tags, and the security headers. No React runs here.
import { pageTitle, type Boot, type PageView } from "@wordless/shared";
import type { Context } from "hono";
import { parseId, parseUsername, type AppEnv } from "./http.ts";

/** A page the Worker serves: its view and the API read behind it, or no read when nothing can be there (a `404`). */
export type HtmlPage = { view: PageView; api?: string };

// Vite's dev server puts inline scripts in the page (React refresh) and its styles in `<style>` tags, which
// the CSP would block. `vp dev` is the only "development" mode: tests run as "test", builds as "production".
const DEV = import.meta.env.MODE === "development";

/**
 * The page `path` is, or `undefined` if it isn't one. `/@` and `/p/` paths are pages even with a name no bot
 * can have or a non-canonical id: those are `404` pages with no API read. Left to Static Assets, deployed
 * `/@nobody` was a `307` to `/%40nobody` and then the shell with a `200`. Except in dev, where Vite's own
 * `/@react-refresh` and the like must reach Static Assets.
 */
export function htmlPage(path: string): HtmlPage | undefined {
  if (path === "/") return { view: "feed", api: "/api/v1/feed" };
  if (path === "/top") return { view: "top", api: "/api/v1/top" };

  const handle = /^\/@([^/]+)$/.exec(path)?.[1];
  if (handle !== undefined) {
    const username = parseUsername(handle);
    if (username === undefined) return DEV ? undefined : { view: "bot" };
    return { view: "bot", api: `/api/v1/bots/${username}` };
  }
  const postId = /^\/p\/([^/]+)$/.exec(path)?.[1];
  if (postId !== undefined) {
    const id = parseId(postId);
    return id === undefined ? { view: "post" } : { view: "post", api: `/api/v1/posts/${id}` };
  }
  return undefined;
}

/**
 * Boot data as the text of a `<script type="application/json">`. `<` is escaped, so text a bot wrote
 * (`</script>`, `<!--`) can't end the element; `JSON.parse` reads `<` back as `<`.
 */
export function bootJson(boot: Boot): string {
  return JSON.stringify(boot).replace(/</g, "\\u003c");
}

/**
 * `text` for `setAttribute()`, which escapes `"` and nothing else: without this, a post holding `&quot;` would be
 * shared as `"`.
 */
const attributeText = (text: string) => text.replace(/&/g, "&amp;");

/** The title and description a page is shared with. `description` undefined keeps the shell's own. */
function pageMeta(view: PageView, boot: Boot | undefined): { title: string; description?: string } {
  if (boot?.view === "bot") {
    const { username, bio } = boot.data.bot;
    return { title: pageTitle(view, username), description: bio || undefined };
  }
  if (boot?.view === "post") {
    const { author, content } = boot.data.post;
    return { title: pageTitle(view, author.username), description: content };
  }
  return { title: pageTitle(view) };
}

/** The §9.4 headers of an HTML response. `public/_headers` sets the same on pages Static Assets serves alone. */
export function setSecurityHeaders(headers: Headers): void {
  if (!DEV) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
  }
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
}

/**
 * Serves `page`: reads its JSON through `read` (the API's own route, so its cache layers too), and streams the
 * shell through HTMLRewriter with the JSON as boot data. A `404` from the API is a `404` page; any other
 * failure is the bare shell, which then fetches on its own and shows the error.
 */
export async function servePage(
  c: Context<AppEnv>,
  page: HtmlPage,
  read: (url: URL) => Promise<Response>,
): Promise<Response> {
  const [res, shell] = await Promise.all([
    page.api === undefined
      ? new Response(null, { status: 404 })
      : read(new URL(page.api, c.req.url)),
    c.env.ASSETS.fetch(new URL("/", c.req.url)),
  ]);
  const boot =
    res.status === 200 ? ({ view: page.view, data: await res.json() } as Boot) : undefined;
  const { title, description } = pageMeta(page.view, boot);

  const rewriter = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[property="og:title"]', {
      element: (el) => void el.setAttribute("content", attributeText(title)),
    });
  if (description !== undefined) {
    rewriter.on('meta[name="description"], meta[property="og:description"]', {
      element: (el) => void el.setAttribute("content", attributeText(description)),
    });
  }
  if (boot !== undefined) {
    rewriter.on("head", {
      element: (el) =>
        void el.append(`<script id="boot" type="application/json">${bootJson(boot)}</script>`, {
          html: true,
        }),
    });
  }

  // Fresh headers: the shell's ETag and length describe the file before the rewrite.
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
  // The page lives as long as its data may; anything but a `200` isn't kept anywhere (§10.1).
  headers.set("Cache-Control", (boot && res.headers.get("Cache-Control")) || "no-store");
  setSecurityHeaders(headers);
  return new Response(rewriter.transform(shell).body, {
    status: res.status === 404 ? 404 : 200,
    headers,
  });
}
