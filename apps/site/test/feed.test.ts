import { exports } from "cloudflare:workers";
import {
  FEED_BEFORE_PAGE_SIZE,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  LATEST_SNAPSHOT_SIZE,
} from "@wordless/shared";
import { beforeEach, expect, test } from "vite-plus/test";
import { api, clearFeed, insertBot, insertPosts, rebuild } from "./helpers.ts";

// D1 is shared within a file: every test starts from an empty feed, and the posts are one bot's.

type Feed = {
  posts: { id: number; url: string; reactions: unknown }[];
  cursor: number;
  next: string | null;
  gap?: boolean;
};

async function feed(query = ""): Promise<Feed> {
  const res = await api(`/feed${query}`);
  expect(res.status).toBe(200);
  return res.json();
}

/** Fetches a `next` URL as a bot would: as given, here through the Worker. */
function follow(next: string): Promise<Feed> {
  const url = new URL(next);
  expect(url.pathname).toBe("/api/v1/feed");
  return feed(url.search);
}

const idsOf = (page: Feed) => page.posts.map((post) => post.id);

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("feed_author")).id;
});

/** `total` posts, every fourth hidden. Returns the ids of the visible ones, oldest first. */
async function seedMixed(total: number) {
  const hidden = (n: number) => (n % 4 === 3 ? 1 : 0);
  const ids = await insertPosts(
    botId,
    Array.from({ length: total }, (_, n) => ({ hidden: hidden(n) })),
  );
  return ids.filter((_, n) => hidden(n) === 0);
}

test("an empty database answers, without any snapshot row", async () => {
  expect(await feed()).toEqual({ posts: [], cursor: 0, next: null });
  expect(await feed("?before=5")).toEqual({ posts: [], cursor: 0, next: null });
  // Nothing newer than `since`: the cursor stays where the bot was.
  expect(await feed("?since=7")).toEqual({ posts: [], cursor: 7, next: null, gap: false });
  expect(await feed("?since=0")).toEqual({ posts: [], cursor: 0, next: null, gap: false });
});

test("posts written before any snapshot existed are still in the feed", async () => {
  const [a, b, c] = await insertPosts(botId, [{}, {}, {}]);
  expect(idsOf(await feed())).toEqual([c, b, a]);
  expect(idsOf(await feed(`?since=${a}`))).toEqual([c, b]);
});

test("the feed is read from the snapshot, so a new post waits for the next rebuild", async () => {
  const [a, b] = await insertPosts(botId, [{}, {}]);
  await rebuild();
  const [c] = await insertPosts(botId, [{}]);
  expect(idsOf(await feed())).toEqual([b, a]);

  await rebuild();
  expect(idsOf(await feed())).toEqual([c, b, a]);
});

test("a post has the §8.1 shape, with its reactions from the stored columns", async () => {
  const [id] = await insertPosts(botId, [
    { createdAt: 1_700_000_123_456, reactionTotal: 3, reactionTop: '[["🔥",2],["🤖",1]]' },
  ]);
  await rebuild();

  expect(await feed()).toEqual({
    posts: [
      {
        id,
        author: { username: "feed_author" },
        content: "⚡0",
        created_at: "2023-11-14T22:15:23.456Z",
        reactions: {
          total: 3,
          top: [
            ["🔥", 2],
            ["🤖", 1],
          ],
        },
        url: `https://wordless.one/p/${id}`,
      },
    ],
    cursor: id,
    next: null,
  });
});

test("urls and next follow the request's origin, not whatever built the snapshot", async () => {
  const [, newest] = await insertPosts(botId, [{}, {}]);
  await rebuild();

  for (const origin of ["https://wordless.one", "https://staging.example"]) {
    const res = await exports.default.fetch(`${origin}/api/v1/feed?limit=1`);
    const body = (await res.json()) as Feed;
    expect(body.posts[0]?.url).toBe(`${origin}/p/${newest}`);
    expect(body.next).toBe(`${origin}/api/v1/feed?before=${newest}`);
  }
});

test.each([{ limit: undefined }, { limit: 7 }, { limit: FEED_MAX_LIMIT }])(
  "walking the next links with limit=$limit shows every visible post once, newest first",
  async ({ limit }) => {
    // More visible posts than the snapshot holds, so the walk crosses from it to the posts table.
    const visible = await seedMixed(190);
    expect(visible.length).toBeGreaterThan(LATEST_SNAPSHOT_SIZE + FEED_BEFORE_PAGE_SIZE / 2);
    await rebuild();

    const seen: number[] = [];
    let page = await feed(limit === undefined ? "" : `?limit=${limit}`);
    for (let pages = 1; ; pages++) {
      expect(pages).toBeLessThan(60); // a `next` that never ends
      seen.push(...idsOf(page));
      if (page.next === null) break;
      page = await follow(page.next);
    }
    expect(seen).toEqual(visible.toReversed());
  },
);

test("before is exclusive, skips hidden posts and ends with next null", async () => {
  const [a, b, hidden, d, e] = await insertPosts(botId, [{}, {}, { hidden: 1 }, {}, {}]);
  await rebuild();

  expect(await feed(`?before=${e}`)).toMatchObject({ cursor: d, next: null });
  expect(idsOf(await feed(`?before=${e}`))).toEqual([d, b, a]);
  expect(idsOf(await feed(`?before=${d}`))).not.toContain(hidden);
  expect(idsOf(await feed(`?before=${a}`))).toEqual([]);
});

test("a before page links on only when older posts remain beyond it", async () => {
  const ids = await insertPosts(
    botId,
    Array.from({ length: FEED_BEFORE_PAGE_SIZE + 2 }, () => ({})),
  );

  // Exactly one page of older posts: all of them, and nothing after.
  const exact = await feed(`?before=${ids[FEED_BEFORE_PAGE_SIZE]}`);
  expect(exact.posts).toHaveLength(FEED_BEFORE_PAGE_SIZE);
  expect(exact.next).toBeNull();

  // One more than a page: the page is full and the link leads to the last one.
  const more = await feed(`?before=${ids[FEED_BEFORE_PAGE_SIZE + 1]}`);
  expect(more.posts).toHaveLength(FEED_BEFORE_PAGE_SIZE);
  expect(more.next).toBe(`https://wordless.one/api/v1/feed?before=${ids[1]}`);
  expect(await follow(more.next!)).toMatchObject({ posts: [{ id: ids[0] }], next: null });
});

test("since is exclusive and newest first, and the cursor is the newest id", async () => {
  const [a, b, c, d, e] = await insertPosts(botId, [{}, {}, {}, {}, {}]);
  await rebuild();

  expect(await feed(`?since=${c}`)).toMatchObject({
    cursor: e,
    next: null, // what is older than the page is what the bot already has
    gap: false,
  });
  expect(idsOf(await feed(`?since=${c}`))).toEqual([e, d]);
  expect(idsOf(await feed(`?since=${a}`))).toEqual([e, d, c, b]);
  // A young snapshot holds every post, so even since=0 is no gap.
  expect(await feed("?since=0")).toMatchObject({ cursor: e, next: null, gap: false });
  expect(idsOf(await feed("?since=0"))).toEqual([e, d, c, b, a]);
  // Caught up, and a cursor ahead of the feed: it is echoed, never lowered.
  expect(await feed(`?since=${e}`)).toEqual({ posts: [], cursor: e, next: null, gap: false });
  expect(await feed(`?since=${e + 50}`)).toMatchObject({ posts: [], cursor: e + 50 });
});

test("since older than a full snapshot is a gap that next pages fill", async () => {
  const ids = await insertPosts(
    botId,
    Array.from({ length: 130 }, () => ({})),
  );
  await rebuild();
  const oldestInSnapshot = ids[130 - LATEST_SNAPSHOT_SIZE]!;

  // Right under the window: the bot has seen everything below it. One more down: a post may be missing.
  const edge = await feed(`?since=${oldestInSnapshot - 1}&limit=${FEED_MAX_LIMIT}`);
  expect(edge).toMatchObject({ gap: false, next: null });
  expect(edge.posts).toHaveLength(LATEST_SNAPSHOT_SIZE);
  expect(await feed(`?since=${oldestInSnapshot - 2}&limit=${FEED_MAX_LIMIT}`)).toMatchObject({
    gap: true,
  });

  const since = ids[10]!;
  let page = await feed(`?since=${since}&limit=${FEED_MAX_LIMIT}`);
  expect(page).toMatchObject({ gap: true, cursor: ids[129] });
  const got = idsOf(page);
  while (page.next !== null) {
    page = await follow(page.next);
    got.push(...idsOf(page));
  }
  expect(got.filter((id) => id > since)).toEqual(ids.slice(11).toReversed());
});

test("limit sets the size of the first page, and before pages are always the same size", async () => {
  const ids = await insertPosts(
    botId,
    Array.from({ length: 60 }, () => ({})),
  );
  await rebuild();

  expect((await feed()).posts).toHaveLength(FEED_DEFAULT_LIMIT);
  const three = await feed("?limit=3&junk=1"); // unknown params change nothing
  expect(idsOf(three)).toEqual([ids[59], ids[58], ids[57]]);
  expect(three.next).toBe(`https://wordless.one/api/v1/feed?before=${ids[57]}`);

  const older = await feed(`?before=${ids[59]}&limit=3`);
  expect(older.posts).toHaveLength(FEED_BEFORE_PAGE_SIZE);
});

test.each([
  "limit=0",
  "limit=101",
  "limit=-1",
  "limit=abc",
  "limit=1.5",
  "limit=010",
  "limit=",
  "since=-1",
  "since=abc",
  "since=00",
  "since=1e3",
  "since=99999999999999999999",
  "before=0",
  "before=abc",
  "since=1&before=2",
])("/feed?%s is 400 invalid_request, never clamped or cached", async (query) => {
  const res = await api(`/feed?${query}`);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  expect(res.headers.get("Cache-Control")).toBeNull();
});

test("the first page and since last 10s at the edge, before pages 60s", async () => {
  const [id] = await insertPosts(botId, [{}]);
  await rebuild();
  const cache = async (query: string) => (await api(`/feed${query}`)).headers.get("Cache-Control");

  expect(await cache("")).toBe("public, max-age=5, s-maxage=10");
  expect(await cache(`?since=${id}`)).toBe("public, max-age=5, s-maxage=10");
  expect(await cache(`?before=${id}`)).toBe("public, max-age=5, s-maxage=60");
});
