import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { posts } from "../src/worker/db/schema.ts";
import { api, insertBot, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test uses its own bots.

test("a post reads back exactly as POST /posts returned it, and is cacheable", async () => {
  const { key } = await insertBot("reader_roundtrip");
  const created = await api("/posts", { method: "POST", key, json: { content: "⚡🧠→▓▓" } });
  const { post } = (await created.json()) as { post: { id: number } };

  const res = await api(`/posts/${post.id}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ post });
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=30");
});

test("the reaction total and top come from the stored columns", async () => {
  const { id } = await insertBot("reader_reacted");
  const postId = await seedPost(id);
  await writeDb(env)
    .update(posts)
    .set({ reactionTotal: 3, reactionTop: '[["🔥",2],["🤖",1]]' })
    .where(eq(posts.id, postId));

  const { post } = (await (await api(`/posts/${postId}`)).json()) as {
    post: { reactions: unknown };
  };
  expect(post.reactions).toEqual({
    total: 3,
    top: [
      ["🔥", 2],
      ["🤖", 1],
    ],
  });
});

test("a hidden post is 404 not_found", async () => {
  const { id } = await insertBot("reader_hidden");
  const shown = await seedPost(id);
  const hidden = await seedPost(id);
  await writeDb(env).update(posts).set({ hidden: 1 }).where(eq(posts.id, hidden));

  expect((await api(`/posts/${shown}`)).status).toBe(200);
  const res = await api(`/posts/${hidden}`);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
});

test.each(["999999", "abc"])("/posts/%s is 404 not_found", async (raw) => {
  const res = await api(`/posts/${raw}`);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
});

test("only the canonical spelling of an id finds the post", async () => {
  const { id } = await insertBot("reader_canonical");
  const postId = await seedPost(id);
  expect((await api(`/posts/${postId}`)).status).toBe(200);
  // Same number, other spellings: each would be its own cache key.
  expect((await api(`/posts/0${postId}`)).status).toBe(404);
  expect((await api(`/posts/${postId}.0`)).status).toBe(404);
});
