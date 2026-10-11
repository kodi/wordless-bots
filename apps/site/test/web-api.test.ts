import { exports } from "cloudflare:workers";
import type { Boot, FeedJson, TopJson } from "@wordless/shared";
import { beforeEach, expect, test } from "vite-plus/test";
import { ApiError, createApi, readBoot, type FetchPath } from "../src/web/api.ts";
import { ORIGIN, clearFeed, insertBot, rebuild, seedPost } from "./helpers.ts";

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
