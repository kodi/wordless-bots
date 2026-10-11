import { env } from "cloudflare:workers";
import { PROFILE_PAGE_SIZE } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { cachedResponse, profileKey } from "../src/worker/cache.ts";
import { botPostsQuery, findBotProfile, readDb, writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts } from "../src/worker/db/schema.ts";
import { ORIGIN, api, insertBot, insertPosts, seedPost } from "./helpers.ts";

// D1 and the caches are shared within a file: every test uses bots of its own, so profile keys never repeat.
// "Underneath" is a change made straight in D1 that no purge follows, so a read that still shows the old
// answer came from the cache.

type Profile = {
  bot: Record<string, unknown> & {
    username: string;
    post_count: number;
    reactions_received: number;
  };
  posts: { id: number; reactions: { total: number } }[];
  next: string | null;
};
type Page = { posts: { id: number }[]; next: string | null };

const profile = async (name: string): Promise<Profile> => {
  const res = await api(`/bots/${name}`);
  expect(res.status).toBe(200);
  return res.json();
};
const ids = (page: Page) => page.posts.map((post) => post.id);

const setBot = (username: string, set: Partial<typeof bots.$inferInsert>) =>
  writeDb(env).update(bots).set(set).where(eq(bots.username, username));

let ipSeed = 0;
async function register(username: string): Promise<string> {
  ipSeed += 1;
  const res = await api("/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": `10.77.0.${ipSeed}` },
    json: { username, email: `${username}@example.com` },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { api_key: string }).api_key;
}

test("a profile shows the public fields and nothing else", async () => {
  const { id } = await insertBot("prof_fields", { bio: "⚡∞", createdAt: 1_700_000_000_000 });
  await seedPost(id);
  await setBot("prof_fields", { reactionsReceived: 7 });

  const res = await api("/bots/prof_fields");
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=30");
  const body = await res.json();
  expect((body as Profile).bot).toEqual({
    username: "prof_fields",
    bio: "⚡∞",
    created_at: "2023-11-14T22:13:20.000Z",
    post_count: 1,
    reactions_received: 7,
    avatar_url: "https://wordless.one/a/prof_fields.svg",
  });
  // Nothing but these keys, in case a column is added to the select.
  expect(Object.keys(body as object).toSorted()).toEqual(["bot", "next", "posts"]);
});

test("posts are the bot's own visible ones, newest first, with the post object", async () => {
  const { id } = await insertBot("prof_posts");
  const other = await insertBot("prof_posts_other");
  const [first, hidden, last] = await insertPosts(id, [
    {},
    { hidden: 1 },
    { reactionTotal: 2, reactionTop: '[["🔥",2]]' },
  ]);
  await insertPosts(other.id, [{}]);

  const body = await profile("prof_posts");
  expect(ids(body)).toEqual([last, first]);
  expect(ids(body)).not.toContain(hidden);
  expect(body.posts[0]).toMatchObject({
    author: { username: "prof_posts" },
    reactions: { total: 2, top: [["🔥", 2]] },
    url: `https://wordless.one/p/${last}`,
  });
  expect(body.next).toBeNull();
});

test("an exact page has no next; one more post makes next walk to the rest", async () => {
  const { id } = await insertBot("prof_paging");
  const all = await insertPosts(
    id,
    Array.from({ length: PROFILE_PAGE_SIZE }, () => ({})),
  );

  const exact = await profile("prof_paging");
  expect(ids(exact)).toEqual(all.toReversed());
  expect(exact.next).toBeNull();

  // Not through the cache: a bot nobody has read yet.
  const { id: bigId } = await insertBot("prof_paging_big");
  const big = await insertPosts(
    bigId,
    Array.from({ length: PROFILE_PAGE_SIZE + 3 }, () => ({})),
  );
  const first = await profile("prof_paging_big");
  expect(ids(first)).toEqual(big.slice(3).toReversed());
  expect(first.next).toBe(
    `https://wordless.one/api/v1/bots/prof_paging_big/posts?before=${big[3]}`,
  );

  const second = (await (
    await api(new URL(first.next!).pathname.slice("/api/v1".length) + new URL(first.next!).search)
  ).json()) as Page;
  expect(ids(second)).toEqual(big.slice(0, 3).toReversed());
  expect(second.next).toBeNull();
});

test("a before page starts below its id and a bot with no older posts gets an empty page", async () => {
  const { id } = await insertBot("prof_before");
  const [a, b, c] = await insertPosts(id, [{}, {}, {}]);

  const res = await api(`/bots/prof_before/posts?before=${c}`);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=5, s-maxage=60");
  expect(ids((await res.json()) as Page)).toEqual([b, a]);

  const end = await api(`/bots/prof_before/posts?before=${a}`);
  expect(end.status).toBe(200);
  expect(await end.json()).toEqual({ posts: [], next: null });
});

test.each(["", "?before=0", "?before=012", "?before=1.0", "?before=x"])(
  "/bots/:username/posts%s is 400 invalid_request",
  async (query) => {
    const res = await api(`/bots/prof_badquery/posts${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  },
);

test("a banned bot, an unknown name and a name no bot can have are 404 not_found", async () => {
  const { id } = await insertBot("prof_banned");
  await seedPost(id);
  await setBot("prof_banned", { status: BOT_STATUS.banned });

  for (const name of ["prof_banned", "prof_nobody", "a", "admin", "bad__name", "x".repeat(40)]) {
    for (const path of [`/bots/${name}`, `/bots/${name}/posts?before=99999999`]) {
      const res = await api(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("Cache-Control") ?? "", path).not.toContain("s-maxage");
      expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
    }
  }
});

test("a banned bot's posts stay hidden even if the ban hid none", async () => {
  const { id } = await insertBot("prof_ban_posts");
  await seedPost(id);
  await setBot("prof_ban_posts", { status: BOT_STATUS.banned });
  // The row is `hidden = 0`: only the status keeps it out.
  const rows = await botPostsQuery(writeDb(env), "prof_ban_posts");
  expect(rows).toEqual([]);
});

test("a 404 isn't kept: the profile shows once the bot exists", async () => {
  expect((await api("/bots/prof_late")).status).toBe(404);
  await insertBot("prof_late");
  expect((await api("/bots/prof_late")).status).toBe(200);
});

test("every spelling of a name is one entry", async () => {
  const { id } = await insertBot("prof_spelling");
  await seedPost(id);

  const lower = await profile("prof_spelling");
  await setBot("prof_spelling", { bio: "changed" });
  expect(await profile("PROF_Spelling")).toEqual(lower);
  expect(await profile("prof_spelling")).toEqual(lower);
  expect(lower.bot.username).toBe("prof_spelling");
});

test("junk params don't make another entry for a profile or a before page", async () => {
  const { id } = await insertBot("prof_junk");
  const [a, b] = await insertPosts(id, [{}, {}]);

  const page = (await (await api(`/bots/prof_junk/posts?before=${b}&junk=1`)).json()) as Page;
  expect(ids(page)).toEqual([a]);
  const body = await profile("prof_junk");
  await writeDb(env).delete(posts).where(eq(posts.id, a));
  await setBot("prof_junk", { bio: "changed" });

  expect(await (await api(`/bots/prof_junk/posts?z=1&before=${b}`)).json()).toEqual(page);
  expect(await (await api("/bots/prof_junk?junk=1")).json()).toEqual(body);
});

test("a profile is cached: a change underneath stays unseen", async () => {
  const { id } = await insertBot("prof_cached");
  const first = await seedPost(id);
  const before = await profile("prof_cached");

  await seedPost(id);
  expect(await profile("prof_cached")).toEqual(before);
  expect(ids(before)).toEqual([first]);
});

test("POST /posts drops the author's cached profile before it answers", async () => {
  const key = await register("prof_create");
  expect((await profile("prof_create")).bot.post_count).toBe(0);

  const created = await api("/posts", { method: "POST", key, json: { content: "⚡" } });
  const { post } = (await created.json()) as { post: { id: number } };

  const after = await profile("prof_create");
  expect(after.bot.post_count).toBe(1);
  expect(ids(after)).toEqual([post.id]);
});

test("DELETE /posts/:id drops the author's cached profile before it answers", async () => {
  const key = await register("prof_delete");
  const { post } = (await (
    await api("/posts", { method: "POST", key, json: { content: "⚡" } })
  ).json()) as { post: { id: number } };
  expect(ids(await profile("prof_delete"))).toEqual([post.id]);

  expect((await api(`/posts/${post.id}`, { method: "DELETE", key })).status).toBe(204);
  const after = await profile("prof_delete");
  expect(after.bot.post_count).toBe(0);
  expect(after.posts).toEqual([]);
});

test("a reaction and its removal drop the author's cached profile, and a repeat does not", async () => {
  const author = await insertBot("prof_react_author");
  const reactor = await insertBot("prof_react_reactor");
  const postId = await seedPost(author.id);
  const react = (method: "PUT" | "DELETE") =>
    api(`/posts/${postId}/reaction`, {
      method,
      key: reactor.key,
      json: method === "PUT" ? { emoji: "🔥" } : undefined,
    });

  expect((await profile("prof_react_author")).bot.reactions_received).toBe(0);

  expect((await react("PUT")).status).toBe(200);
  const reacted = await profile("prof_react_author");
  expect(reacted.bot.reactions_received).toBe(1);
  expect(reacted.posts[0]!.reactions.total).toBe(1);

  // The same emoji again changes nothing, so nothing is purged: a change underneath stays unseen.
  await setBot("prof_react_author", { bio: "underneath" });
  expect((await react("PUT")).status).toBe(200);
  expect((await profile("prof_react_author")).bot.bio).toBe("");

  expect((await react("DELETE")).status).toBe(200);
  const taken = await profile("prof_react_author");
  expect(taken.bot.reactions_received).toBe(0);
  expect(taken.bot.bio).toBe("underneath");
  expect(taken.posts[0]!.reactions.total).toBe(0);
});

test("only the bot's own profile is purged: another bot's stays cached", async () => {
  const key = await register("prof_purge_mine");
  await insertBot("prof_purge_other");
  const other = await profile("prof_purge_other");
  await setBot("prof_purge_other", { bio: "underneath" });

  await api("/posts", { method: "POST", key, json: { content: "⚡" } });
  expect(await profile("prof_purge_other")).toEqual(other);
});

test("the profile's post query walks posts_by_bot", async () => {
  // The range scan is why a profile page costs about 51 rows (§7.2); without the index it would read every post.
  const { sql: text, params } = botPostsQuery(writeDb(env), "prof_plan", 100).limit(51).toSQL();
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${text}`)
    .bind(...params)
    .all<{ detail: string }>();
  const plan = results.map((step) => step.detail).join("\n");

  expect(plan).toContain("posts_by_bot");
  expect(plan).not.toContain("USE TEMP B-TREE");
});

test("a profile read that began before a post can't fill the cache after the purge", async () => {
  const key = await register("prof_late_fill");

  // A reader that has the profile as it was in hand, but hasn't stored it yet.
  let hasProfile!: () => void;
  const profileRead = new Promise<void>((resolve) => (hasProfile = resolve));
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  const slow = cachedResponse(profileKey(ORIGIN, "prof_late_fill"), async () => {
    const bot = await findBotProfile(readDb(env), "prof_late_fill");
    hasProfile();
    await hold;
    return Response.json({ bot }, { headers: { "Cache-Control": "public, s-maxage=30" } });
  });
  await profileRead;

  expect((await api("/posts", { method: "POST", key, json: { content: "⚡" } })).status).toBe(201);
  release();
  expect((await slow).status).toBe(200);

  expect((await profile("prof_late_fill")).bot.post_count).toBe(1);
});
