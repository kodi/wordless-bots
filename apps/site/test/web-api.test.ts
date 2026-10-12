import { exports } from "cloudflare:workers";
import {
  PROFILE_PAGE_SIZE,
  type BotPageJson,
  type Boot,
  type FeedJson,
  type PostPageJson,
  type TopJson,
} from "@wordless/shared";
import { beforeEach, expect, test } from "vite-plus/test";
import { ApiError, createApi, readBoot, type FetchPath } from "../src/web/api.ts";
import { BOT_STATUS } from "../src/worker/db/schema.ts";
import { ORIGIN, clearFeed, insertBot, insertPosts, rebuild, seedPost } from "./helpers.ts";

// The SPA's reads, run against the real Worker: what a page gets on its first load and after.

/** A `FetchPath` to the Worker that keeps the paths it was asked for. */
function worker() {
  const paths: string[] = [];
  const fetchPath: FetchPath = (path) => {
    paths.push(path);
    return exports.default.fetch(`${ORIGIN}${path}`);
  };
  return { fetchPath, paths };
}

const bootedFeed: FeedJson = { posts: [], cursor: 7, next: null };

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("web_reader")).id;
});

test("without boot data, the feed and top come from the API", async () => {
  const id = await seedPost(botId, "⚡ → ✦");
  await rebuild();
  const { fetchPath, paths } = worker();
  const api = createApi(fetchPath);

  const feed = await api.feed();
  const top = await api.top();

  expect(paths).toEqual(["/api/v1/feed", "/api/v1/top"]);
  expect(feed.posts.map((post) => [post.id, post.content])).toEqual([[id, "⚡ → ✦"]]);
  expect(top.posts).toEqual([]);
});

test("the first read takes the boot data of its page, and only once", async () => {
  const { fetchPath, paths } = worker();
  const api = createApi(fetchPath, { view: "feed", data: bootedFeed });

  expect(await api.feed()).toEqual(bootedFeed);
  expect(paths).toEqual([]);

  // Coming back to the page later reads what is there now.
  expect((await api.feed()).cursor).toBe(0);
  expect(paths).toEqual(["/api/v1/feed"]);
});

test("boot data for another page is dropped, not kept for later", async () => {
  const { fetchPath, paths } = worker();
  const bootedTop: TopJson = { posts: [] };
  const api = createApi(fetchPath, { view: "top", data: bootedTop });

  await api.feed();
  await api.top();

  expect(paths).toEqual(["/api/v1/feed", "/api/v1/top"]);
});

test("an answer that isn't a 200 is an ApiError with its status", async () => {
  const api = createApi(async () => new Response("{}", { status: 404 }));

  const error = await api.feed().catch((err: unknown) => err);

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
});

/** What a rejected read was rejected with: an `ApiError`'s status, or the error itself. */
const rejection = (read: Promise<unknown>) =>
  read.then(
    () => "resolved",
    (err: unknown) => (err instanceof ApiError ? err.status : err),
  );

test("a profile and a post take their boot data once, then come from the API", async () => {
  const id = await seedPost(botId, "◇ ∞");
  const bootedBot: BotPageJson = {
    bot: {
      username: "web_reader",
      bio: "booted",
      created_at: "2026-10-11T00:00:00.000Z",
      post_count: 0,
      reactions_received: 0,
      avatar_url: "",
    },
    posts: [],
    next: null,
  };
  const bot = worker();
  const botApi = createApi(bot.fetchPath, { view: "bot", data: bootedBot });

  expect(await botApi.bot("web_reader")).toEqual(bootedBot);
  expect(bot.paths).toEqual([]);
  const fresh = await botApi.bot("web_reader");
  expect(bot.paths).toEqual(["/api/v1/bots/web_reader"]);
  expect(fresh.posts.map((post) => post.id)).toContain(id);

  const bootedPost = { post: { ...fresh.posts[0]!, content: "booted" } } satisfies PostPageJson;
  const post = worker();
  const postApi = createApi(post.fetchPath, { view: "post", data: bootedPost });

  expect(await postApi.post(String(id))).toEqual(bootedPost);
  expect(post.paths).toEqual([]);
  expect((await postApi.post(String(id))).post.content).toBe("◇ ∞");
  expect(post.paths).toEqual([`/api/v1/posts/${id}`]);
});

test("a missing or banned bot and a missing post are an ApiError(404)", async () => {
  await insertBot("web_banned", { status: BOT_STATUS.banned });
  const api = createApi(worker().fetchPath);

  expect(await rejection(api.bot("web_nobody"))).toBe(404);
  expect(await rejection(api.bot("web_banned"))).toBe(404);
  expect(await rejection(api.post("99999999"))).toBe(404);
  expect(await rejection(api.post("012"))).toBe(404);
});

test("a param a path can't hold as is reaches the API's 404, not another route", async () => {
  const id = await seedPost(botId);
  const { fetchPath, paths } = worker();
  const api = createApi(fetchPath);

  // Unencoded, these would be `/bots/x/posts` (a `400`: no `before`) and post `id` itself with a query (a `200`).
  expect(await rejection(api.bot("x/posts"))).toBe(404);
  expect(await rejection(api.post(`${id}?x`))).toBe(404);
  expect(paths).toEqual(["/api/v1/bots/x%2Fposts", `/api/v1/posts/${id}%3Fx`]);
});

test("botPosts pages from the oldest post shown down to the first, with no gaps or repeats", async () => {
  const { id: pagedId } = await insertBot("web_paged");
  const total = 2 * PROFILE_PAGE_SIZE + 3;
  const ids = await insertPosts(
    pagedId,
    Array.from({ length: total }, (_, n) => ({ createdAt: 1_700_000_100_000 + n })),
  );
  const { fetchPath, paths } = worker();
  const api = createApi(fetchPath);

  const first = await api.bot("web_paged");
  const shown = first.posts.map((post) => post.id);
  let next = first.next;
  while (next !== null) {
    const page = await api.botPosts("web_paged", shown.at(-1)!);
    shown.push(...page.posts.map((post) => post.id));
    next = page.next;
  }

  expect(shown).toEqual(ids.toReversed());
  expect(paths).toEqual([
    "/api/v1/bots/web_paged",
    `/api/v1/bots/web_paged/posts?before=${shown[PROFILE_PAGE_SIZE - 1]}`,
    `/api/v1/bots/web_paged/posts?before=${shown[2 * PROFILE_PAGE_SIZE - 1]}`,
  ]);
});

test.each([
  [undefined, undefined],
  ["", undefined],
  ["{not json", undefined],
  ["null", undefined],
  ['{"view":"feed"}', undefined],
  [
    '{"view":"feed","data":{"posts":[],"cursor":0,"next":null}}',
    { view: "feed", data: { posts: [], cursor: 0, next: null } },
  ],
])("readBoot(%j)", (text, expected) => {
  expect(readBoot(text)).toEqual(expected as Boot | undefined);
});
