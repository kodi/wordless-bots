import { env, exports } from "cloudflare:workers";
import { ISOLATE_TTL_S } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  cachedResponse,
  latestKey,
  postKey,
  readLatestCached,
  rebuildAndPurgeLatest,
} from "../src/worker/cache.ts";
import { findPost, readDb, writeDb } from "../src/worker/db/queries.ts";
import { bots, posts } from "../src/worker/db/schema.ts";
import { readLatest, rebuildLatest } from "../src/worker/db/snapshots.ts";
import {
  ORIGIN,
  api,
  clearFeed,
  gatedDb,
  insertBot,
  insertPosts,
  rebuild,
  seedPost,
} from "./helpers.ts";

// "Underneath" below means a change made straight in D1 that no purge follows, so whatever a read still
// shows after it came from a cache. D1 and the caches are shared within a file: every test starts from an
// empty feed, and ids are never reused, so each test's `before` pages and posts are keys of its own.

type Feed = { posts: { id: number }[]; cursor: number; next: string | null; gap?: boolean };

async function feed(query = ""): Promise<Feed> {
  const res = await api(`/feed${query}`);
  expect(res.status).toBe(200);
  return res.json();
}
const feedIds = async (query = "") => (await feed(query)).posts.map((post) => post.id);

/** Moves the snapshot in D1 without purging anything. */
const rebuildUnderneath = () => rebuildLatest(writeDb(env));
const deleteUnderneath = (id: number) => writeDb(env).delete(posts).where(eq(posts.id, id));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A promise that stays pending until `open()`, to hold a read at the point a test wants to act. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("cache_author")).id;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a warm snapshot answers every limit and since, until it is purged", async () => {
  const [a, b, c] = await insertPosts(botId, [{}, {}, {}]);
  await rebuild();
  expect(await feedIds(`?since=${a}`)).toEqual([c, b]);

  const [d] = await insertPosts(botId, [{}]);
  await rebuildUnderneath();

  // None of these may make an entry of its own, or they would read the new snapshot from D1.
  expect(await feedIds(`?since=${b}`)).toEqual([c]);
  expect(await feedIds("?limit=2")).toEqual([c, b]);
  expect(await feedIds("?since=0&junk=1")).toEqual([c, b, a]);
  expect(await feedIds(`?limit=1&since=${a}`)).toEqual([c]);

  await rebuild();
  expect(await feedIds("?limit=2")).toEqual([d, c]);
});

test("a before page and a post are kept whole, headers included", async () => {
  const [a, b, c] = await insertPosts(botId, [{}, {}, {}]);

  const page = await api(`/feed?before=${c}`);
  const single = await api(`/posts/${b}`);
  const [pageBody, singleBody] = [await page.json(), await single.json()];
  await deleteUnderneath(a);
  await deleteUnderneath(b);

  const pageAgain = await api(`/feed?before=${c}`);
  expect(await pageAgain.json()).toEqual(pageBody);
  expect(pageAgain.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=60");
  expect(pageAgain.headers.get("X-Wordless-Docs")).not.toBeNull();

  const singleAgain = await api(`/posts/${b}`);
  expect(singleAgain.status).toBe(200);
  expect(await singleAgain.json()).toEqual(singleBody);
  expect(singleAgain.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=30");
  expect(singleAgain.headers.get("X-Wordless-Docs")).not.toBeNull();
});

test("junk params, param order and limit don't make another entry for a before page", async () => {
  const ids = await insertPosts(
    botId,
    Array.from({ length: 8 }, () => ({})),
  );
  const target = ids[5]!;

  const first = await feed(`?before=${target}&junk=1`);
  expect(first.posts.map((post) => post.id)).toEqual(ids.slice(0, 5).toReversed());
  await deleteUnderneath(ids[0]!);

  for (const query of [
    `?junk=2&before=${target}`,
    `?before=${target}&limit=3`,
    `?before=${target}`,
    `?limit=3&b=c&before=${target}&junk=x`,
  ]) {
    expect(await feed(query), query).toEqual(first);
  }
  // Another id is another entry, and sees the delete.
  expect(await feedIds(`?before=${ids[6]}`)).toEqual(ids.slice(1, 6).toReversed());
});

test("junk params don't make another entry for a post, and a delete drops it for all of them", async () => {
  const { id, key } = await insertBot("cache_junk_post");
  const kept = await seedPost(id);
  const doomed = await seedPost(id);

  expect((await api(`/posts/${kept}?junk=1`)).status).toBe(200);
  await deleteUnderneath(kept);
  for (const query of ["", "?other=2", "?b=c&junk=3"]) {
    expect((await api(`/posts/${kept}${query}`)).status, query).toBe(200);
  }

  expect((await api(`/posts/${doomed}?junk=1`)).status).toBe(200);
  expect((await api(`/posts/${doomed}`, { method: "DELETE", key })).status).toBe(204);
  expect((await api(`/posts/${doomed}?junk=1`)).status).toBe(404);
  expect((await api(`/posts/${doomed}`)).status).toBe(404);
});

test("a before page is cached for the origin it was asked on", async () => {
  const [a, b] = await insertPosts(botId, [{}, {}]);

  // Both origins in turn, so the second would find the first's entry if the key left the origin out.
  for (const origin of [ORIGIN, "https://staging.example"]) {
    const post = await exports.default.fetch(`${origin}/api/v1/posts/${a}`);
    expect(await post.json()).toMatchObject({ post: { url: `${origin}/p/${a}` } });

    const page = await exports.default.fetch(`${origin}/api/v1/feed?before=${b}`);
    expect(await page.json()).toMatchObject({ posts: [{ url: `${origin}/p/${a}` }] });
  }
});

test("a 404 is not kept, so a post shows as soon as it exists", async () => {
  const [first] = await insertPosts(botId, [{}]);
  const next = first! + 1;
  expect((await api(`/posts/${next}`)).status).toBe(404);

  const [second] = await insertPosts(botId, [{}]);
  expect(second).toBe(next);
  expect((await api(`/posts/${next}`)).status).toBe(200);
});

test("what is behind a key is not kept", async () => {
  const { id, key } = await insertBot("cache_private");
  const bio = async () => ((await (await api("/me", { key })).json()) as { bio: string }).bio;
  expect(await bio()).toBe("");

  await writeDb(env).update(bots).set({ bio: "new" }).where(eq(bots.id, id));
  expect(await bio()).toBe("new");
});

test("L0 answers alone while it is fresh, and stops after its TTL", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const [a] = await insertPosts(botId, [{}]);
  await rebuild();
  expect(await feedIds()).toEqual([a]);

  // Only L0 still holds the old snapshot.
  const [b] = await insertPosts(botId, [{}]);
  await rebuildUnderneath();
  await caches.default.delete(latestKey(ORIGIN));
  expect(await feedIds()).toEqual([a]);

  vi.setSystemTime(Date.now() + ISOLATE_TTL_S * 1000 + 100);
  expect(await feedIds()).toEqual([b, a]);
});

test("L1 answers once L0 has run out", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const [a] = await insertPosts(botId, [{}]);
  await rebuild();
  expect(await feedIds()).toEqual([a]);

  await insertPosts(botId, [{}]);
  await rebuildUnderneath();
  vi.setSystemTime(Date.now() + ISOLATE_TTL_S * 1000 + 100);
  expect(await feedIds()).toEqual([a]);
});

test("a post shows in a warm feed within the TTL, without waiting it out", async () => {
  const { key } = await insertBot("cache_poster");
  await rebuild();
  expect(await feedIds()).toEqual([]);

  const created = await api("/posts", { method: "POST", key, json: { content: "⚡🧠" } });
  const { post } = (await created.json()) as { post: { id: number } };

  // Far less than the 10 s the snapshot may stay in L1: only the purge can make it show.
  await vi.waitFor(async () => expect(await feedIds()).toEqual([post.id]), { timeout: 3000 });
});

test("a deleted post is a 404 as soon as the DELETE returns, and leaves the feed", async () => {
  const { id, key } = await insertBot("cache_deleter");
  const keep = await seedPost(id);
  const doomed = await seedPost(id);
  await rebuild();
  expect(await feedIds()).toEqual([doomed, keep]);
  expect((await api(`/posts/${doomed}`)).status).toBe(200);
  expect((await api(`/feed?before=${doomed + 1}`)).status).toBe(200);

  expect((await api(`/posts/${doomed}`, { method: "DELETE", key })).status).toBe(204);

  // No waiting: this entry has no rebuild to wait for.
  expect((await api(`/posts/${doomed}`)).status).toBe(404);
  await vi.waitFor(async () => expect(await feedIds()).toEqual([keep]), { timeout: 3000 });
});

test("the DELETE waits for the post's entry to go, however slow the cache is", async () => {
  const { id, key } = await insertBot("cache_slow_purge");
  const postId = await seedPost(id);
  expect((await api(`/posts/${postId}`)).status).toBe(200);

  const cache = caches.default;
  const drop = cache.delete.bind(cache);
  vi.spyOn(cache, "delete").mockImplementation(async (...args) => {
    await sleep(100);
    return drop(...args);
  });

  expect((await api(`/posts/${postId}`, { method: "DELETE", key })).status).toBe(204);
  expect((await api(`/posts/${postId}`)).status).toBe(404);
});

test("a read in the gap before the rebuild lands can't keep the old snapshot", async () => {
  const [a] = await insertPosts(botId, [{}]);
  await rebuild();
  expect(await feedIds()).toEqual([a]);

  // `b` is in `posts`, but the snapshot only catches up when the held rebuild is released.
  const [b] = await insertPosts(botId, [{}]);
  const held = gatedDb();
  const refresh = rebuildAndPurgeLatest(held.db, ORIGIN);
  await sleep(30);
  expect(await feedIds()).toEqual([a]);

  held.release();
  await refresh;
  expect(await feedIds()).toEqual([b, a]);
});

test("a snapshot read that began before a purge can't fill the caches after it", async () => {
  const [a] = await insertPosts(botId, [{}]);
  await rebuild();

  // A reader that has the old rows in hand but hasn't stored them yet.
  const hasRows = latch();
  const hold = latch();
  const slow = readLatestCached(ORIGIN, async () => {
    const rows = await readLatest(readDb(env));
    hasRows.open();
    await hold.opened;
    return rows;
  });
  await hasRows.opened;

  const [b] = await insertPosts(botId, [{}]);
  await rebuild();
  hold.open();
  expect((await slow).map((row) => row.id)).toEqual([a]);

  expect(await feedIds()).toEqual([b, a]);
});

test("a post read that began before its delete can't fill the cache after it", async () => {
  const { id, key } = await insertBot("cache_late_post");
  const postId = await seedPost(id);

  const hasPost = latch();
  const hold = latch();
  const slow = cachedResponse(postKey(ORIGIN, postId), async () => {
    const post = await findPost(readDb(env), postId);
    hasPost.open();
    await hold.opened;
    return Response.json({ post }, { headers: { "Cache-Control": "public, s-maxage=30" } });
  });
  await hasPost.opened;

  expect((await api(`/posts/${postId}`, { method: "DELETE", key })).status).toBe(204);
  hold.open();
  expect((await slow).status).toBe(200);

  expect((await api(`/posts/${postId}`)).status).toBe(404);
});
