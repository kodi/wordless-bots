import { env } from "cloudflare:workers";
import { LATEST_SNAPSHOT_SIZE } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { snapshots } from "../src/worker/db/schema.ts";
import { rebuildLatest } from "../src/worker/db/snapshots.ts";
import { api, clearFeed, insertBot, insertPosts, lateDb, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test starts from an empty feed.

type Row = { id: number; username: string; reactionTop: string };

/** The stored `latest` row: its parsed body and when it was written. */
async function latest() {
  const row = await writeDb(env).select().from(snapshots).where(eq(snapshots.name, "latest")).get();
  return row === undefined ? undefined : { rows: JSON.parse(row.body) as Row[], at: row.updatedAt };
}

async function feedIds(): Promise<number[]> {
  const body = (await (await api("/feed")).json()) as { posts: { id: number }[] };
  return body.posts.map((post) => post.id);
}

let botId: number;
beforeEach(async () => {
  await clearFeed();
  botId ??= (await insertBot("snapshot_author")).id;
});

test("rebuildLatest keeps the newest visible posts, newest first", async () => {
  // Oldest first: 4 more than fit, with a hidden post among the newest.
  const specs = Array.from({ length: LATEST_SNAPSHOT_SIZE + 5 }, (_, n) => ({
    hidden: n === LATEST_SNAPSHOT_SIZE ? 1 : 0,
  }));
  const ids = await insertPosts(botId, specs);
  const visible = ids.filter((_, n) => specs[n]!.hidden === 0);

  await rebuildLatest(writeDb(env));

  const stored = await latest();
  expect(stored?.rows.map((row) => row.id)).toEqual(
    visible.slice(-LATEST_SNAPSHOT_SIZE).toReversed(),
  );
});

test("rows carry the author and the stored reaction JSON, and no url", async () => {
  await insertPosts(botId, [{ reactionTotal: 2, reactionTop: '[["🔥",2]]' }]);
  await rebuildLatest(writeDb(env));

  const [row] = (await latest())!.rows;
  expect(row).toMatchObject({ username: "snapshot_author", reactionTotal: 2 });
  expect(row?.reactionTop).toBe('[["🔥",2]]');
  expect(row).not.toHaveProperty("url");
});

test("a rebuild replaces the row, and with no posts it is an empty array", async () => {
  const db = writeDb(env);
  await rebuildLatest(db, 111);
  expect(await latest()).toEqual({ rows: [], at: 111 });

  const [id] = await insertPosts(botId, [{}]);
  await rebuildLatest(db, 222);
  const stored = await latest();
  expect(stored?.at).toBe(222);
  expect(stored?.rows.map((row) => row.id)).toEqual([id]);
  expect(await db.select().from(snapshots)).toHaveLength(1);
});

test("a rebuild that hears back late can't put an older view over a newer one", async () => {
  // The slow rebuild runs first and sees one post, but its caller only hears back after 60ms. By then
  // a second post and a quick rebuild are done. A rebuild that reads, then writes what it read, would
  // put the one-post view back over the two-post one. Both are in flight at once, as in §15.
  const [first] = await insertPosts(botId, [{}]);
  let second = 0;
  await Promise.all([
    rebuildLatest(lateDb(60)),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      [second] = await insertPosts(botId, [{}]);
      await rebuildLatest(writeDb(env));
    })(),
  ]);

  expect((await latest())?.rows.map((row) => row.id)).toEqual([second, first]);
});

test("a post made through the API shows up in the feed", async () => {
  const { key } = await insertBot("snapshot_poster");
  // A snapshot exists already, so the feed can't be reading the posts live.
  await rebuildLatest(writeDb(env));
  expect(await feedIds()).toEqual([]);

  const res = await api("/posts", { method: "POST", key, json: { content: "⚡🧠" } });
  const { post } = (await res.json()) as { post: { id: number } };

  // The rebuild runs after the response (waitUntil), so poll.
  await vi.waitFor(async () => expect(await feedIds()).toEqual([post.id]), { timeout: 3000 });
});

test("a post deleted through the API leaves the feed", async () => {
  const { id, key } = await insertBot("snapshot_deleter");
  const keep = await seedPost(id);
  const doomed = await seedPost(id);
  await rebuildLatest(writeDb(env));
  expect(await feedIds()).toEqual([doomed, keep]);

  expect((await api(`/posts/${doomed}`, { method: "DELETE", key })).status).toBe(204);

  await vi.waitFor(async () => expect(await feedIds()).toEqual([keep]), { timeout: 3000 });
});
