import { env } from "cloudflare:workers";
import { TOP_SNAPSHOT_SIZE, TOP_WINDOW_S } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { posts, snapshots } from "../src/worker/db/schema.ts";
import { rebuildTop24, topPosts } from "../src/worker/db/snapshots.ts";
import { api, clearFeed, insertBot, insertPosts, lateDb } from "./helpers.ts";

// D1 is shared within a file: every test starts from an empty feed.

type Row = { id: number; username: string; reactionTotal: number; reactionTop: string };
type TopBody = {
  posts: { id: number; url: string; reactions: { total: number; top: [string, number][] } }[];
};

const NOW = 1_800_000_000_000;
const DAY_MS = TOP_WINDOW_S * 1000;

/** The stored `top24` row: its parsed body and when it was written. */
async function top24() {
  const row = await writeDb(env).select().from(snapshots).where(eq(snapshots.name, "top24")).get();
  return row === undefined ? undefined : { rows: JSON.parse(row.body) as Row[], at: row.updatedAt };
}
const topIds = async () => (await top24())?.rows.map((row) => row.id);

async function getTop() {
  const res = await api("/top");
  expect(res.status).toBe(200);
  return { res, body: (await res.json()) as TopBody };
}

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("top_author")).id;
});

test("the most reacted come first, and a tie goes to the newest", async () => {
  // Ids rise with the specs. Expected: both 5s (newest first), the 3, the 1. A post nobody reacted to is out.
  const ids = await insertPosts(
    botId,
    [3, 5, 0, 5, 1].map((reactionTotal) => ({ reactionTotal, createdAt: NOW })),
  );

  await rebuildTop24(writeDb(env), NOW);

  expect(await topIds()).toEqual([ids[3], ids[1], ids[0], ids[4]]);
});

test("posts tied at the cut-off: the newest keep their place", async () => {
  // The aggregate orders what the subquery lets through, so the subquery's own tie-break decides who is cut.
  const ids = await insertPosts(
    botId,
    Array.from({ length: TOP_SNAPSHOT_SIZE + 3 }, () => ({ reactionTotal: 2, createdAt: NOW })),
  );

  await rebuildTop24(writeDb(env), NOW);

  expect(await topIds()).toEqual(ids.slice(-TOP_SNAPSHOT_SIZE).toReversed());
});

test("only posts created inside the last 24 hours count", async () => {
  const [, , inside, fresh] = await insertPosts(
    botId,
    [NOW - DAY_MS - 1, NOW - DAY_MS, NOW - DAY_MS + 1, NOW].map((createdAt) => ({
      createdAt,
      reactionTotal: 1,
    })),
  );

  await rebuildTop24(writeDb(env), NOW);

  // A post exactly 24 hours old is out, as `created_at > now - 24h` says.
  expect(await topIds()).toEqual([fresh, inside]);
});

test("a hidden post never shows, however many reactions it has", async () => {
  const [shown] = await insertPosts(botId, [
    { reactionTotal: 1, createdAt: NOW },
    { reactionTotal: 9, createdAt: NOW, hidden: 1 },
  ]);

  await rebuildTop24(writeDb(env), NOW);

  expect(await topIds()).toEqual([shown]);
});

test("the snapshot keeps the best TOP_SNAPSHOT_SIZE, not the oldest or the newest", async () => {
  // Totals rise with the ids, so the best are the newest, and the tail is cut. Then the reverse.
  const count = TOP_SNAPSHOT_SIZE + 3;
  const rising = await insertPosts(
    botId,
    Array.from({ length: count }, (_, n) => ({ reactionTotal: n + 1, createdAt: NOW })),
  );
  await rebuildTop24(writeDb(env), NOW);
  expect(await topIds()).toEqual(rising.slice(-TOP_SNAPSHOT_SIZE).toReversed());

  await writeDb(env).delete(posts);
  const falling = await insertPosts(
    botId,
    Array.from({ length: count }, (_, n) => ({ reactionTotal: count - n, createdAt: NOW })),
  );
  await rebuildTop24(writeDb(env), NOW);
  expect(await topIds()).toEqual(falling.slice(0, TOP_SNAPSHOT_SIZE));
});

test("rows carry the author and the stored reaction JSON, and no url", async () => {
  await insertPosts(botId, [{ reactionTotal: 2, reactionTop: '[["🔥",2]]', createdAt: NOW }]);
  await rebuildTop24(writeDb(env), NOW);

  const [row] = (await top24())!.rows;
  expect(row).toMatchObject({ username: "top_author", reactionTotal: 2 });
  expect(row?.reactionTop).toBe('[["🔥",2]]');
  expect(row).not.toHaveProperty("url");
});

test("a rebuild replaces the row, and with nothing to show it is an empty array", async () => {
  const db = writeDb(env);
  await rebuildTop24(db, NOW);
  expect(await top24()).toEqual({ rows: [], at: NOW });

  const [id] = await insertPosts(botId, [{ reactionTotal: 1, createdAt: NOW }]);
  await rebuildTop24(db, NOW + 1);
  const stored = await top24();
  expect(stored?.at).toBe(NOW + 1);
  expect(stored?.rows.map((row) => row.id)).toEqual([id]);
  expect(await db.select().from(snapshots)).toHaveLength(1);
});

test("a rebuild that hears back late can't put an older view over a newer one", async () => {
  // As for `latest`: the slow rebuild sees one post but its caller hears back after 60ms, by which time a
  // second reacted post and a quick rebuild are done. A read-then-write rebuild would put the one-post view
  // back. Both are in flight at once.
  const [first] = await insertPosts(botId, [{ reactionTotal: 1, createdAt: NOW }]);
  let second = 0;
  await Promise.all([
    rebuildTop24(lateDb(60), NOW),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      [second] = await insertPosts(botId, [{ reactionTotal: 2, createdAt: NOW }]);
      await rebuildTop24(writeDb(env), NOW);
    })(),
  ]);

  expect(await topIds()).toEqual([second, first]);
});

test("the query reads the posts_reacted partial index", async () => {
  // The index is used only if the query's `WHERE` implies the index's. Without one of its terms this
  // would quietly be a scan of every post.
  const { sql: text, params } = topPosts(writeDb(env), NOW).toSQL();
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${text}`)
    .bind(...params)
    .all<{ detail: string }>();

  expect(results.map((step) => step.detail).join("\n")).toContain("posts_reacted");
});

test("GET /top answers from the snapshot, with the post object and the 60 second cache header", async () => {
  const [id] = await insertPosts(botId, [
    { reactionTotal: 4, reactionTop: '[["🔥",3],["🤖",1]]', createdAt: Date.now() },
  ]);
  await rebuildTop24(writeDb(env));

  const { res, body } = await getTop();

  expect(res.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=60");
  expect(body.posts).toEqual([
    expect.objectContaining({
      id,
      url: `https://wordless.one/p/${id}`,
      reactions: {
        total: 4,
        top: [
          ["🔥", 3],
          ["🤖", 1],
        ],
      },
    }),
  ]);
});

test("before the first rebuild GET /top reads the posts live instead of answering empty", async () => {
  const [id] = await insertPosts(botId, [{ reactionTotal: 1, createdAt: Date.now() }]);
  expect(await top24()).toBeUndefined();

  expect((await getTop()).body.posts.map((post) => post.id)).toEqual([id]);
});

test("a snapshot that exists wins over the posts, which move on at the next rebuild", async () => {
  const [kept] = await insertPosts(botId, [{ reactionTotal: 1, createdAt: Date.now() }]);
  await rebuildTop24(writeDb(env));
  await insertPosts(botId, [{ reactionTotal: 9, createdAt: Date.now() }]);

  expect((await getTop()).body.posts.map((post) => post.id)).toEqual([kept]);
});

test("GET /top is kept for its TTL: a change underneath isn't seen", async () => {
  const [id] = await insertPosts(botId, [{ reactionTotal: 1, createdAt: Date.now() }]);
  await rebuildTop24(writeDb(env));
  await getTop();

  await rebuildTopUnderneath();

  const again = await getTop();
  expect(again.body.posts.map((post) => post.id)).toEqual([id]);
  // A hit is served with the headers it was stored with and the ones every API response gets.
  expect(again.res.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=60");
  expect(again.res.headers.get("X-Wordless-Docs")).toBe("https://wordless.one/skill.md");
});

/** Moves `top24` in D1 without purging anything: the posts it holds are gone. */
async function rebuildTopUnderneath() {
  await writeDb(env).delete(posts);
  await rebuildTop24(writeDb(env));
}
