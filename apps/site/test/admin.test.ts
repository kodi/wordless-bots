import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, expect, test } from "vite-plus/test";
import { admin } from "../src/worker/admin.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts, reactions, snapshots } from "../src/worker/db/schema.ts";
import { looksLikeApiKey } from "../src/worker/keys.ts";
import { adminApi, api, clearFeed, insertBot, insertPosts, rebuild, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test uses bots of its own. The feed, though, is shared, so each test
// starts from an empty one.
beforeEach(clearFeed);

type FeedBody = { posts: { id: number; author: { username: string } }[] };
const feedIds = async () =>
  ((await (await api("/feed")).json()) as FeedBody).posts.map((p) => p.id);

const ban = (username: string) => adminApi(`/bots/${username}/ban`, { method: "POST" });
const unban = (username: string) => adminApi(`/bots/${username}/unban`, { method: "POST" });

const botRow = (username: string) =>
  writeDb(env).select().from(bots).where(eq(bots.username, username)).get();
const postRow = (id: number) => writeDb(env).select().from(posts).where(eq(posts.id, id)).get();

let authBotKey: string;
beforeAll(async () => {
  authBotKey = (await insertBot("adm_auth")).key;
});

/** The ids in the stored `top24` row. Not `readTop()`: with no row that falls back to a live query and hides a missing rebuild. */
async function top24Ids() {
  const row = await writeDb(env).select().from(snapshots).where(eq(snapshots.name, "top24")).get();
  expect(row).toBeDefined();
  return (JSON.parse(row!.body) as { id: number }[]).map((r) => r.id);
}

const ENDPOINTS: [method: string, path: string][] = [
  ["DELETE", "/posts/1"],
  ["POST", "/bots/adm_auth/ban"],
  ["POST", "/bots/adm_auth/unban"],
  ["POST", "/bots/adm_auth/rotate-key"],
  ["POST", "/snapshots/rebuild"],
];

test.each(ENDPOINTS)(
  "%s %s answers 401 without the right token and changes nothing",
  async (method, path) => {
    const wrong = [
      { token: null, code: "missing_admin_token" },
      { token: "wrong-token", code: "invalid_admin_token" },
      // One character off, and the real token with something after it: no prefix match.
      { token: env.ADMIN_TOKEN.slice(0, -1), code: "invalid_admin_token" },
      { token: `${env.ADMIN_TOKEN}x`, code: "invalid_admin_token" },
    ];
    for (const { token, code } of wrong) {
      const res = await adminApi(path, { method, token });
      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    }
    // A bot's own key is not the admin token.
    expect((await adminApi(path, { method, token: authBotKey })).status).toBe(401);
    expect((await botRow("adm_auth"))?.status).toBe(BOT_STATUS.active);
  },
);

test("the token is read from the Authorization header only", async () => {
  await insertBot("adm_query");
  const res = await adminApi(
    `/bots/adm_query/ban?token=${env.ADMIN_TOKEN}&admin_token=${env.ADMIN_TOKEN}`,
    {
      method: "POST",
      token: null,
    },
  );
  expect(res.status).toBe(401);
  expect((await botRow("adm_query"))?.status).toBe(BOT_STATUS.active);
});

test("a path that doesn't exist is 401 without the token and 404 with it", async () => {
  expect((await adminApi("/nope", { token: null })).status).toBe(401);
  const res = await adminApi("/nope");
  expect(res.status).toBe(404);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});

test("with no ADMIN_TOKEN configured nothing gets in", async () => {
  const res = await admin.request(
    "/snapshots/rebuild",
    { method: "POST", headers: { Authorization: "Bearer anything" } },
    { ...env, ADMIN_TOKEN: "" },
  );
  expect(res.status).toBe(503);
});

test("a ban hides the bot's posts from the feed, its profile and its post pages, and keeps the counters", async () => {
  const { id, key } = await insertBot("adm_ban");
  const other = await insertBot("adm_ban_other");
  const mine = [await seedPost(id), await seedPost(id)];
  const theirs = await seedPost(other.id);
  await rebuild();

  // Warm every cache the ban has to purge.
  expect(await feedIds()).toEqual([theirs, ...mine.toReversed()]);
  expect((await api("/bots/adm_ban")).status).toBe(200);

  const res = await ban("adm_ban");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ username: "adm_ban", status: "banned" });

  expect(await feedIds()).toEqual([theirs]);
  expect((await api("/bots/adm_ban")).status).toBe(404);
  expect((await api(`/posts/${mine[1]}`)).status).toBe(404);
  expect((await api("/me", { key })).status).toBe(403);
  // post_count counts hidden posts, as the nightly reconcile does.
  expect((await botRow("adm_ban"))?.postCount).toBe(2);
  expect((await postRow(mine[1]!))?.hidden).toBe(1);
  expect((await postRow(theirs))?.hidden).toBe(0);
});

test("a ban takes the bot's posts out of top24 as well", async () => {
  const { id } = await insertBot("adm_ban_top");
  const [post] = await insertPosts(id, [{ createdAt: Date.now(), reactionTotal: 3 }]);
  await adminApi("/snapshots/rebuild", { method: "POST" });
  expect(await top24Ids()).toEqual([post]);

  await ban("adm_ban_top");
  expect(await top24Ids()).toEqual([]);
});

test("banning an unknown or malformed name is 404, and banning twice is fine", async () => {
  for (const name of ["adm_nobody", "x", "has space", "admin"]) {
    const res = await ban(name);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  }
  const { id } = await insertBot("adm_twice");
  const post = await seedPost(id);
  expect((await ban("adm_twice")).status).toBe(200);
  expect((await ban("adm_twice")).status).toBe(200);
  expect((await postRow(post))?.hidden).toBe(1);
});

test("an unban shows the posts again and the old key works", async () => {
  const { id, key } = await insertBot("adm_unban");
  const mine = await seedPost(id);
  await ban("adm_unban");
  expect(await feedIds()).toEqual([]);
  expect((await api("/bots/adm_unban")).status).toBe(404);

  const res = await unban("adm_unban");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ username: "adm_unban", status: "active" });

  expect(await feedIds()).toEqual([mine]);
  expect(
    ((await (await api("/bots/adm_unban")).json()) as { bot: { post_count: number } }).bot
      .post_count,
  ).toBe(1);
  expect((await api("/me", { key })).status).toBe(200);
  expect((await unban("adm_nobody")).status).toBe(404);
});

test("unbanning an active bot unhides nothing", async () => {
  const { id } = await insertBot("adm_unban_active");
  const [post] = await insertPosts(id, [{ hidden: 1 }]);
  expect((await unban("adm_unban_active")).status).toBe(200);
  expect((await postRow(post!))?.hidden).toBe(1);
});

test("deleting a post removes it everywhere and fixes the author's counters, not the cooldown", async () => {
  const { id } = await insertBot("adm_del", { lastPostAt: 1_700_000_000_000 });
  const reactor = await insertBot("adm_del_reactor");
  const gone = await seedPost(id);
  const kept = await seedPost(id);
  const at = Date.now();
  await writeDb(env)
    .insert(reactions)
    .values({ postId: gone, botId: reactor.id, emoji: "🔥", createdAt: at });
  await writeDb(env).update(posts).set({ reactionTotal: 1 }).where(eq(posts.id, gone));
  await writeDb(env).update(bots).set({ reactionsReceived: 1 }).where(eq(bots.id, id));
  await rebuild();
  const lastPostAt = (await botRow("adm_del"))?.lastPostAt;

  expect((await api(`/posts/${gone}`)).status).toBe(200);
  expect((await api("/bots/adm_del")).status).toBe(200);

  const res = await adminApi(`/posts/${gone}`, { method: "DELETE" });
  expect(res.status).toBe(204);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");

  expect(await feedIds()).toEqual([kept]);
  expect((await api(`/posts/${gone}`)).status).toBe(404);
  const profile = (await (await api("/bots/adm_del")).json()) as {
    bot: { post_count: number; reactions_received: number };
  };
  expect(profile.bot).toMatchObject({ post_count: 1, reactions_received: 0 });
  expect((await botRow("adm_del"))?.lastPostAt).toBe(lastPostAt);
  expect(await writeDb(env).select().from(reactions).where(eq(reactions.postId, gone))).toEqual([]);
});

test("an admin can delete a hidden post, and an unknown id is 404", async () => {
  const { id } = await insertBot("adm_del_hidden");
  const post = await seedPost(id);
  await ban("adm_del_hidden");

  expect((await adminApi(`/posts/${post}`, { method: "DELETE" })).status).toBe(204);
  expect(await postRow(post)).toBeUndefined();
  expect((await botRow("adm_del_hidden"))?.postCount).toBe(0);

  for (const bad of [String(post), "999999999", "012", "abc"]) {
    expect((await adminApi(`/posts/${bad}`, { method: "DELETE" })).status).toBe(404);
  }
});

test("rotating a key returns the new one once and kills the old one", async () => {
  const { key } = await insertBot("adm_rot");
  const res = await adminApi("/bots/adm_rot/rotate-key", { method: "POST" });
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await res.json()) as { username: string; api_key: string };
  expect(body.username).toBe("adm_rot");
  expect(looksLikeApiKey(body.api_key)).toBe(true);
  expect(body.api_key).not.toBe(key);

  expect((await api("/me", { key })).status).toBe(401);
  expect((await api("/me", { key: body.api_key })).status).toBe(200);
  expect((await botRow("adm_rot"))?.keyPrefix).toBe(body.api_key.slice(0, 10));
});

test("a banned bot's key isn't rotated, and an unknown bot is 404", async () => {
  const { key } = await insertBot("adm_rot_banned");
  await ban("adm_rot_banned");
  const res = await adminApi("/bots/adm_rot_banned/rotate-key", { method: "POST" });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("banned");

  // The key is untouched: it works again once the ban is lifted.
  await unban("adm_rot_banned");
  expect((await api("/me", { key })).status).toBe(200);
  expect((await adminApi("/bots/adm_rot_nobody/rotate-key", { method: "POST" })).status).toBe(404);
});

test("a rebuild brings both snapshots up to date", async () => {
  const { id } = await insertBot("adm_rebuild");
  // Written straight to the table, so no snapshot has seen them.
  const [plain, reacted] = await insertPosts(id, [{}, { createdAt: Date.now(), reactionTotal: 2 }]);
  await rebuild();
  const [late] = await insertPosts(id, [{}]);
  expect(await feedIds()).not.toContain(late);

  const res = await adminApi("/snapshots/rebuild", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ rebuilt: ["latest", "top24"] });

  expect(await feedIds()).toEqual([late, reacted, plain]);
  expect(await top24Ids()).toEqual([reacted]);
});
