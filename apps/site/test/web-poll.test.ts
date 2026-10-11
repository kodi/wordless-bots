import { exports } from "cloudflare:workers";
import {
  FEED_MAX_LIMIT,
  LATEST_SNAPSHOT_SIZE,
  type FeedJson,
  type PostJson,
} from "@wordless/shared";
import { beforeEach, expect, test } from "vite-plus/test";
import { createApi } from "../src/web/api.ts";
import { receiveLatest, revealLatest, startLatest } from "../src/web/poll.ts";
import { ORIGIN, clearFeed, insertBot, insertPosts, rebuild, seedPost } from "./helpers.ts";

// The latest feed while it polls (§9.3): first against the real Worker, then the edges as data.

const api = createApi((path) => exports.default.fetch(`${ORIGIN}${path}`));
const ids = (posts: PostJson[]) => posts.map((post) => post.id);

/** A post with nothing but its id, for the cases that need no Worker. */
const post = (id: number): PostJson => ({
  id,
  author: { username: "poll_bot" },
  content: "⚡",
  created_at: "2026-10-11T12:00:00.000Z",
  reactions: { total: 0, top: [] },
  url: `${ORIGIN}/p/${id}`,
});
const page = (postIds: number[], extra: Partial<FeedJson> = {}): FeedJson => ({
  posts: postIds.map(post),
  cursor: postIds[0] ?? 0,
  next: null,
  ...extra,
});

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("poll_author")).id;
});

test("a new post waits behind the pill once, then goes on top", async () => {
  const first = await seedPost(botId, "☾");
  const second = await seedPost(botId, "☀");
  await rebuild();
  let state = startLatest(await api.feed());

  // Nothing new yet.
  state = receiveLatest(state, await api.feedSince(state.cursor));
  expect(state.pending).toEqual([]);

  const third = await seedPost(botId, "✦");
  await rebuild();
  state = receiveLatest(state, await api.feedSince(state.cursor));
  state = receiveLatest(state, await api.feedSince(state.cursor));

  expect(ids(state.pending)).toEqual([third]);
  expect(ids(state.shown)).toEqual([second, first]);
  expect(state.cursor).toBe(third);
  expect(state.overflow).toBe(false);

  state = revealLatest(state);
  expect(ids(state.shown)).toEqual([third, second, first]);
  expect(state.pending).toEqual([]);
});

test("on a busy feed, one new post is just one post", async () => {
  // A full snapshot: the latest page has a `next`, which a poll must not mistake for more new posts.
  await insertPosts(
    botId,
    Array.from({ length: LATEST_SNAPSHOT_SIZE + 1 }, () => ({ createdAt: Date.now() })),
  );
  await rebuild();
  let state = startLatest(await api.feed());
  const fresh = await seedPost(botId, "✦");
  await rebuild();

  state = receiveLatest(state, await api.feedSince(state.cursor));

  expect(ids(state.pending)).toEqual([fresh]);
  expect(state.overflow).toBe(false);
});

test("more new posts than the snapshot holds is an overflow", async () => {
  await seedPost(botId);
  await rebuild();
  let state = startLatest(await api.feed());

  await insertPosts(
    botId,
    Array.from({ length: LATEST_SNAPSHOT_SIZE + 1 }, () => ({ createdAt: Date.now() })),
  );
  await rebuild();
  state = receiveLatest(state, await api.feedSince(state.cursor));

  expect(state.overflow).toBe(true);
  expect(state.pending.length).toBeLessThanOrEqual(FEED_MAX_LIMIT);
});

test("an answer the state already holds adds nothing, and the cursor never moves back", () => {
  let state = startLatest(page([2, 1]));
  state = receiveLatest(state, page([5]));
  // An older answer (a cache that was a step behind) arrives late.
  state = receiveLatest(state, page([4, 3, 2], { cursor: 4 }));

  expect(ids(state.pending)).toEqual([5, 4, 3]);
  expect(state.cursor).toBe(5);
});

test("a gap or a next page is an overflow, and stays one", () => {
  const gap = receiveLatest(startLatest(page([1])), page([9], { gap: true }));
  const next = receiveLatest(startLatest(page([1])), page([9], { next: `${ORIGIN}/x` }));

  expect(gap.overflow).toBe(true);
  expect(next.overflow).toBe(true);
  expect(receiveLatest(gap, page([10])).overflow).toBe(true);
});

test("posts piling up past the limit are capped and make an overflow", () => {
  let state = startLatest(page([1]));
  for (let id = 2; id <= FEED_MAX_LIMIT + 2; id++) state = receiveLatest(state, page([id]));

  expect(state.pending).toHaveLength(FEED_MAX_LIMIT);
  expect(state.pending[0]?.id).toBe(FEED_MAX_LIMIT + 2);
  expect(state.overflow).toBe(true);
});

test("revealing keeps the page at the limit, newest first", () => {
  const shown = Array.from({ length: FEED_MAX_LIMIT }, (_, i) => FEED_MAX_LIMIT - i);
  const state = revealLatest(
    receiveLatest(startLatest(page(shown)), page([FEED_MAX_LIMIT + 2, FEED_MAX_LIMIT + 1])),
  );

  expect(state.shown).toHaveLength(FEED_MAX_LIMIT);
  expect(ids(state.shown).slice(0, 3)).toEqual([
    FEED_MAX_LIMIT + 2,
    FEED_MAX_LIMIT + 1,
    FEED_MAX_LIMIT,
  ]);
});
