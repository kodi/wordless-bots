import { env, exports } from "cloudflare:workers";
import { SITE_NAME } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { readBoot } from "../src/web/api.ts";
import { htmlPage } from "../src/worker/boot.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { bots } from "../src/worker/db/schema.ts";
import { ORIGIN, api, clearFeed, insertBot, rebuild, seedPost } from "./helpers.ts";

// The HTML pages (§9.2, §9.4). Static Assets is index.html itself in tests (vite.config.ts), so the shell
// rewritten here is the real one. D1 is shared within a file: every test uses bots of its own.

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'";

async function page(path: string) {
  const res = await exports.default.fetch(`${ORIGIN}${path}`);
  return { res, html: await res.text() };
}

/** The `#boot` script's text, read the way the SPA reads it. */
function bootOf(html: string) {
  const text = /<script id="boot" type="application\/json">(.*?)<\/script>/s.exec(html)?.[1];
  return { text, boot: readBoot(text) };
}

const titleOf = (html: string) => /<title>(.*?)<\/title>/s.exec(html)?.[1];
const metaOf = (html: string, attr: string) =>
  new RegExp(`<meta\\s+${attr}\\s+content="([^"]*)"`).exec(html)?.[1];

/** An attribute value as a browser reads it: the entities HTMLRewriter may write, decoded. */
const decode = (value: string | undefined) =>
  value
    ?.replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

beforeEach(clearFeed);

test("/ carries the feed the API serves, with its cache lifetime", async () => {
  const { id } = await insertBot("page_feed");
  await seedPost(id, "☾ → ☀");
  await rebuild();

  const { res, html } = await page("/");
  const json = await api("/feed");

  expect(res.status).toBe(200);
  expect(bootOf(html).boot).toEqual({ view: "feed", data: await json.json() });
  expect(res.headers.get("Cache-Control")).toBe(json.headers.get("Cache-Control"));
  expect(titleOf(html)).toBe(SITE_NAME);
});

test("/top carries the top list and its own title", async () => {
  const { res, html } = await page("/top");

  expect(res.status).toBe(200);
  expect(bootOf(html).boot).toEqual({ view: "top", data: await (await api("/top")).json() });
  expect(titleOf(html)).toBe(`🔥 top 24h · ${SITE_NAME}`);
});

test("a post can't end the boot script, and reads back as written", async () => {
  const { id } = await insertBot("page_breakout");
  const content = "</script><script>alert(1)</script> <!-- ⚡";
  await seedPost(id, content);
  await rebuild();

  const { html } = await page("/");
  const { text, boot } = bootOf(html);

  expect(text).not.toContain("<");
  expect(boot?.view === "feed" && boot.data.posts[0]?.content).toBe(content);
  expect(html).not.toContain("<script>alert(1)");
});

test("a permalink is titled after its author and shared with its content", async () => {
  const { id } = await insertBot("page_post");
  const content = '⚡ " onload="x &quot; & <b>';
  const postId = await seedPost(id, content);

  const { res, html } = await page(`/p/${postId}`);

  expect(res.status).toBe(200);
  expect(bootOf(html).boot).toEqual({
    view: "post",
    data: await (await api(`/posts/${postId}`)).json(),
  });
  expect(titleOf(html)).toBe(`@page_post · ${SITE_NAME}`);
  expect(metaOf(html, 'property="og:title"')).toBe(`@page_post · ${SITE_NAME}`);
  // An attribute value here: its quotes can't close it, and it reads back as written.
  expect(decode(metaOf(html, 'property="og:description"'))).toBe(content);
  expect(decode(metaOf(html, 'name="description"'))).toBe(content);
});

test("a profile is shared with its bio, or the site's description without one", async () => {
  await insertBot("page_bio", { bio: "∴ ∞" });
  await insertBot("page_nobio");

  const withBio = (await page("/@Page_Bio")).html;
  const without = (await page("/@page_nobio")).html;
  const site = (await page("/top")).html;

  expect(bootOf(withBio).boot?.view).toBe("bot");
  expect(titleOf(withBio)).toBe(`@page_bio · ${SITE_NAME}`);
  expect(metaOf(withBio, 'property="og:description"')).toBe("∴ ∞");
  expect(metaOf(without, 'property="og:description"')).toBe(
    metaOf(site, 'property="og:description"'),
  );
});

test("a bot or post that doesn't exist is a 404 page with no data that nothing keeps", async () => {
  const { id } = await insertBot("page_banned");
  await writeDb(env).update(bots).set({ status: 1 }).where(eq(bots.id, id));

  // `/@nobody` (reserved), `/@a` (too short) and `/p/012` (not canonical) can't exist; deployed, Static Assets
  // answered them with a redirect and then the shell with a 200.
  for (const path of [
    "/@page_ghost",
    "/@page_banned",
    "/p/999999999",
    "/@nobody",
    "/@a",
    "/p/012",
  ]) {
    const { res, html } = await page(path);
    expect(res.status, path).toBe(404);
    expect(bootOf(html).text, path).toBeUndefined();
    expect(res.headers.get("Cache-Control"), path).toBe("no-store");
    expect(titleOf(html), path).toBe(SITE_NAME);
  }
});

test("pages carry the §9.4 headers", async () => {
  for (const path of ["/", "/top", "/@page_ghost"]) {
    const { res } = await page(path);
    expect(res.headers.get("Content-Security-Policy"), path).toBe(CSP);
    expect(res.headers.get("Referrer-Policy"), path).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
    expect(res.headers.get("Content-Type"), path).toBe("text/html; charset=utf-8");
  }
});

describe("htmlPage", () => {
  test.each([
    ["/", { view: "feed", api: "/api/v1/feed" }],
    ["/top", { view: "top", api: "/api/v1/top" }],
    ["/@Glitch_Oracle", { view: "bot", api: "/api/v1/bots/glitch_oracle" }],
    ["/p/12", { view: "post", api: "/api/v1/posts/12" }],
    // A name no bot can have or a non-canonical id: a 404 page with nothing to read.
    ["/@a", { view: "bot" }],
    ["/@nobody", { view: "bot" }],
    ["/@..", { view: "bot" }],
    ["/p/012", { view: "post" }],
    ["/p/..", { view: "post" }],
    // Not pages: Static Assets gets them as they are. The first is Vite's in dev.
    ["/@vite/client", undefined],
    ["/p/12/x", undefined],
    ["/top/", undefined],
    ["/about", undefined],
  ])("%s", (path, expected) => {
    expect(htmlPage(path)).toEqual(expected);
  });
});

test("every page is shared with an absolute og:image on the request's origin", async () => {
  const { html } = await page("/");

  expect(metaOf(html, 'property="og:image"')).toBe(`${ORIGIN}/og.png`);
});
