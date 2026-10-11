import { env } from "cloudflare:workers";
import { eq, inArray, sql } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { deletePost, writeDb } from "../src/worker/db/queries.ts";
import { bots, posts, reactions } from "../src/worker/db/schema.ts";
import { api, insertBot, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test uses its own bots.

type Me = {
  post_count: number;
  reactions_received: number;
  last_post_at: string | null;
  next_post_at: string | null;
};

async function me(key: string): Promise<Me> {
  return (await api("/me", { key })).json();
}

function del(key: string | undefined, postId: number | string) {
  return api(`/posts/${postId}`, { method: "DELETE", key });
}

/**
 * Gives a post one reaction from each of `count` new bots and moves the counters the way a reaction
 * write does (§7.1), because the real write path comes with Slice 5.
 */
async function addReactions(postId: number, authorId: number, count: number, tag: string) {
  const db = writeDb(env);
  const reactors = [];
  for (let n = 0; n < count; n++) reactors.push(await insertBot(`${tag}_reactor_${n}`));
  await db
    .insert(reactions)
    .values(reactors.map((r) => ({ postId, botId: r.id, emoji: "🔥", createdAt: Date.now() })));
  await db
    .update(posts)
    .set({ reactionTotal: count, reactionTop: JSON.stringify([["🔥", count]]) })
    .where(eq(posts.id, postId));
  await db
    .update(bots)
    .set({ reactionsReceived: sql`${bots.reactionsReceived} + ${count}` })
    .where(eq(bots.id, authorId));
}

async function reactionsOn(...postIds: number[]) {
  return writeDb(env).select().from(reactions).where(inArray(reactions.postId, postIds));
}

test("deleting a post removes it but doesn't free the cooldown", async () => {
  const { key } = await insertBot("deleter_cooldown");
  const created = await api("/posts", { method: "POST", key, json: { content: "⚡" } });
  const { post } = (await created.json()) as { post: { id: number } };
  const before = await me(key);
  expect(before.post_count).toBe(1);

  const res = await del(key, post.id);
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");

  expect((await api(`/posts/${post.id}`)).status).toBe(404);
  const after = await me(key);
  expect(after).toMatchObject({
    post_count: 0,
    last_post_at: before.last_post_at,
    next_post_at: before.next_post_at,
  });
  expect(after.last_post_at).not.toBeNull();
  const again = await api("/posts", { method: "POST", key, json: { content: "🔥" } });
  expect(again.status).toBe(429);
});

test("another bot's post is 403 not_owner and nothing changes", async () => {
  const owner = await insertBot("deleter_owner");
  const other = await insertBot("deleter_other");
  const postId = await seedPost(owner.id);
  const otherPost = await seedPost(other.id);

  const res = await del(other.key, postId);
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "not_owner" } });

  expect((await api(`/posts/${postId}`)).status).toBe(200);
  expect((await me(owner.key)).post_count).toBe(1);
  expect((await me(other.key)).post_count).toBe(1);
  expect((await api(`/posts/${otherPost}`)).status).toBe(200);
});

test.each(["999999", "abc"])("deleting /posts/%s is 404 and counts nothing", async (raw) => {
  const { id, key } = await insertBot(`deleter_missing_${raw}`);
  await seedPost(id);

  const res = await del(key, raw);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  expect(await me(key)).toMatchObject({ post_count: 1, reactions_received: 0 });
});

test("deleting needs an API key", async () => {
  const { id } = await insertBot("deleter_anon");
  const postId = await seedPost(id);
  expect((await del(undefined, postId)).status).toBe(401);
  expect((await api(`/posts/${postId}`)).status).toBe(200);
});

test("counters drop by the post and its reactions; the reactions go with it", async () => {
  const author = await insertBot("deleter_counters");
  const bystander = await insertBot("deleter_bystander");
  const doomed = await seedPost(author.id);
  const kept = await seedPost(author.id);
  const theirs = await seedPost(bystander.id);
  await addReactions(doomed, author.id, 3, "doomed");
  await addReactions(kept, author.id, 2, "kept");
  await addReactions(theirs, bystander.id, 4, "theirs");
  expect(await me(author.key)).toMatchObject({ post_count: 2, reactions_received: 5 });

  expect((await del(author.key, doomed)).status).toBe(204);

  expect(await me(author.key)).toMatchObject({ post_count: 1, reactions_received: 2 });
  expect(await me(bystander.key)).toMatchObject({ post_count: 1, reactions_received: 4 });
  expect(await reactionsOn(doomed)).toHaveLength(0);
  expect(await reactionsOn(kept)).toHaveLength(2);
  expect(await reactionsOn(theirs)).toHaveLength(4);
});

test("concurrent deletes of one post: one wins and the counters drop once", async () => {
  // Every call is in flight before any lands, so a read-then-write would decrement for each.
  const db = writeDb(env);
  const author = await insertBot("deleter_race_direct");
  const doomed = await seedPost(author.id);
  await seedPost(author.id);
  await addReactions(doomed, author.id, 3, "race_direct");

  const results = await Promise.all(
    Array.from({ length: 5 }, () => deletePost(db, author.id, doomed)),
  );
  expect(results.filter((r) => r.deleted)).toHaveLength(1);
  expect(results.filter((r) => !r.deleted)).toEqual(
    Array.from({ length: 4 }, () => ({ deleted: false, reason: "not_found" })),
  );
  expect(await me(author.key)).toMatchObject({ post_count: 1, reactions_received: 0 });
});

test("concurrent DELETE requests for one post: one 204, the rest 404", async () => {
  // End to end. Miniflare often hands these requests to the Worker one or two at a time, so this
  // alone wouldn't reliably catch a check-then-delete; the deletePost test above does.
  const author = await insertBot("deleter_race_http");
  const doomed = await seedPost(author.id);
  await seedPost(author.id);

  const responses = await Promise.all([1, 2, 3].map(() => del(author.key, doomed)));
  expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([204, 404, 404]);
  expect((await me(author.key)).post_count).toBe(1);
});
