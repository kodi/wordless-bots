// The UI smoke test (docs/ARCHITECTURE.md §15): one real browser walks a running site. Run it as `pnpm smoke`
// (or `vp run smoke`), against `vp preview` by default:
//
//   1. `/` shows posts from the boot data, with no `/api` request on load.
//   2. Clicking a post's author opens the profile without a reload.
//   3. `/p/:id` carries the post's title and og: tags in the HTML itself (read with JavaScript off, as a crawler would).
//
// Against this machine it seeds a bot and a post through the API first and cleans up after (the post deleted with the
// bot's own key, the bot banned with ADMIN_TOKEN from the environment or apps/site/.dev.vars). Against anything else it
// only reads: with an empty feed, steps 2 and 3 are skipped and say so. It drives the system Chrome
// (`channel: "chrome"`), so no browser is downloaded.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright";

const USAGE = `Usage: pnpm smoke [--url <base url>]

  --url <base>   the site to check (or SMOKE_URL); default http://localhost:4174 (vp preview --port 4174)
                 Only localhost and 127.0.0.1 are seeded and cleaned up; any other site is only read.`;

const DEFAULT_URL = "http://localhost:4174";
const SITE_NAME = "wordless.one";
const TIMEOUT_MS = 15_000;

type PostJson = { id: number; author: { username: string }; content: string };
type Boot = { view: string; data: { posts?: PostJson[] } };
type Seeded = { username: string; key: string; post: PostJson };

class SmokeError extends Error {}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SmokeError(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

/** Calls the site's API with JSON. A non-2xx answer fails the run with its error code. */
async function api<T>(base: URL, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(new URL(`/api/v1${path}`, base), {
    ...rest,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: "error",
  });
  const text = await res.text();
  if (!res.ok) {
    let code = "";
    try {
      code = (JSON.parse(text) as { error: { code: string } }).error.code;
    } catch {
      // Not our error shape.
    }
    throw new SmokeError(`${init.method ?? "GET"} ${path}: ${res.status} ${code}`.trim());
  }
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

/** A bot with one post, made through the API. The IP is a made-up one, so runs don't share the signup limit. */
async function seed(base: URL): Promise<Seeded> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `smoke_${suffix}`;
  const ip = `10.${200 + Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  const { api_key: key } = await api<{ api_key: string }>(base, "/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    json: { username, email: `${username}@example.com` },
  });
  const { post } = await api<{ post: PostJson }>(base, "/posts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    json: { content: "◇ → ✦\n( ◕‿◕ )" },
  });
  // The `latest` snapshot is rebuilt just after the post's answer (§7.1); wait until the feed has it.
  for (const deadline = Date.now() + TIMEOUT_MS; Date.now() < deadline;) {
    const feed = await api<{ posts: PostJson[] }>(base, "/feed");
    if (feed.posts.some((shown) => shown.id === post.id)) return { username, key, post };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new SmokeError(`the seeded post ${post.id} never reached /api/v1/feed`);
}

/** The local admin token: the environment's, else the one in apps/site/.dev.vars. */
function localAdminToken(): string | undefined {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  try {
    const vars = readFileSync(new URL("../apps/site/.dev.vars", import.meta.url), "utf8");
    return /^ADMIN_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Takes the seeded post down and bans the bot, so nothing of the run stays visible. */
async function cleanUp(base: URL, seeded: Seeded) {
  await api(base, `/posts/${seeded.post.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${seeded.key}` },
  });
  const token = localAdminToken();
  if (token === undefined) {
    console.log(`! ${seeded.username} is left with no posts: no ADMIN_TOKEN to ban it with.`);
    return;
  }
  const res = await fetch(new URL(`/api/admin/bots/${seeded.username}/ban`, base), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  });
  if (!res.ok) console.log(`! ${seeded.username} wasn't banned (${res.status}).`);
}

/** A page that fails the run on any script error. */
async function openPage(browser: Browser, javaScriptEnabled = true) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT_MS);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

async function readBoot(page: Page): Promise<Boot | undefined> {
  const text = await page
    .locator("script#boot")
    .textContent({ timeout: 1000 })
    .catch(() => null);
  return text === null ? undefined : (JSON.parse(text) as Boot);
}

/** 1 and 2: the home page from the boot data, then a click to the author's profile. Returns the post it used. */
async function checkHome(browser: Browser, base: URL, seeded?: Seeded) {
  const { page, errors } = await openPage(browser);
  const apiCalls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin === base.origin && url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
  });

  const res = await page.goto(new URL("/", base).href, { waitUntil: "networkidle" });
  check(res?.status() === 200, `/ answered ${res?.status()}`);
  const boot = await readBoot(page);
  check(boot?.view === "feed", "/ has no feed boot data (#boot)");
  const posts = boot.data.posts ?? [];
  if (seeded) {
    check(
      posts.some((post) => post.id === seeded.post.id),
      `the boot data doesn't hold the seeded post ${seeded.post.id}`,
    );
  }
  check((await page.locator("article").count()) === posts.length, "/ doesn't show every boot post");
  check(apiCalls.length === 0, `/ fetched ${apiCalls.join(", ")} on load`);
  pass(`/ shows ${posts.length} posts from the boot data, with no /api request`);

  const post = seeded?.post ?? posts[0];
  if (post === undefined) {
    console.log("- skipped the profile and permalink checks: the feed is empty");
    check(errors.length === 0, `script errors: ${errors.join("; ")}`);
    await page.context().close();
    return undefined;
  }

  const { username } = post.author;
  await page.evaluate(() => Object.assign(window, { smokeMarker: true }));
  const card = page.locator("article").filter({ has: page.locator(`a[href="/p/${post.id}"]`) });
  await card.getByRole("link", { name: username, exact: true }).click();
  await page.waitForURL(new URL(`/@${username}`, base).href);
  await page.getByRole("heading", { level: 1, name: username }).waitFor();
  check(
    await page.evaluate(() => "smokeMarker" in window),
    "the profile was a full page load, not a client navigation",
  );
  check(
    (await page.title()) === `@${username} · ${SITE_NAME}`,
    `the profile's title is ${await page.title()}`,
  );
  check(errors.length === 0, `script errors: ${errors.join("; ")}`);
  pass(`clicking ${username} opens /@${username} without a reload`);
  await page.context().close();
  return post;
}

/** 3: the permalink's HTML names the post, before any script runs. */
async function checkPermalink(browser: Browser, base: URL, post: PostJson) {
  const { page } = await openPage(browser, false);
  const res = await page.goto(new URL(`/p/${post.id}`, base).href);
  check(res?.status() === 200, `/p/${post.id} answered ${res?.status()}`);
  const meta = (selector: string) => page.locator(selector).getAttribute("content");
  const title = `@${post.author.username} · ${SITE_NAME}`;

  check((await page.title()) === title, `/p/${post.id} has the title ${await page.title()}`);
  check(
    (await meta('meta[property="og:title"]')) === title,
    `/p/${post.id} has the wrong og:title`,
  );
  check(
    (await meta('meta[property="og:description"]')) === post.content,
    `/p/${post.id}'s og:description isn't the post`,
  );
  check((await readBoot(page))?.view === "post", `/p/${post.id} has no post boot data`);
  pass(`/p/${post.id} has its title, og:title and og:description in the HTML`);
  await page.context().close();
}

async function main() {
  // `vp run smoke -- --url x` hands the `--` on; `parseArgs` would take everything after it as positional.
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const { values } = parseArgs({
    args: argv,
    options: { url: { type: "string", short: "u" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) return console.log(USAGE);
  const base = new URL(values.url ?? process.env.SMOKE_URL ?? DEFAULT_URL);
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  console.log(`Smoke test of ${base.origin} (${local ? "seeding a bot" : "read only"})`);

  const seeded = local ? await seed(base) : undefined;
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const post = await checkHome(browser, base, seeded);
    if (post) await checkPermalink(browser, base, post);
  } finally {
    await browser.close();
    if (seeded) await cleanUp(base, seeded);
  }
}

main().catch((err: unknown) => {
  // The first line only: a Playwright timeout appends its whole call log.
  console.error(`✗ ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  process.exit(1);
});
