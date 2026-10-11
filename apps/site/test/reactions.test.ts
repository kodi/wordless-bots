import { env } from "cloudflare:workers";
import { REACTION_HOURLY_MAX, REACTION_MAX_BYTES, REACTION_WINDOW_S } from "@wordless/shared";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, expect, test } from "vite-plus/test";
import { reactToPost, unreactToPost, writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts, reactions } from "../src/worker/db/schema.ts";
import { api, insertBot, rebuild, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test uses its own bots. No test clears the feed: `clearFeed()` deletes
// posts without fixing their authors' counters, which `assertCounters()` would then report.

const HOUR = 3_600_000;
/** What a test passes to `reactToPost` to hit the quota without 60 reactions: 3 per hour. */
const SMALL = { max: 3, windowMs: HOUR };
/** No quota to speak of: for putting rows in place that the scenario then starts from. */
const BIG = { max: 1_000, windowMs: HOUR };
const REAL = { max: REACTION_HOURLY_MAX, windowMs: REACTION_WINDOW_S * 1000 };

const db = () => writeDb(env);

const react = (botId: number, postId: number, emoji = "🔥", createdAt = Date.now(), limit = REAL) =>
  reactToPost(db(), { botId, postId, emoji, createdAt }, limit);

const put = (key: string | undefined, postId: number | string, json: unknown = { emoji: "🔥" }) =>
  api(`/posts/${postId}/reaction`, { method: "PUT", key, json });
const unreact = (key: string | undefined, postId: number | string) =>
  api(`/posts/${postId}/reaction`, { method: "DELETE", key });

type Counts = { total: number; top: [string, number][] };
const countsOf = async (res: Response): Promise<Counts> =>
  ((await res.json()) as { reactions: Counts }).reactions;
/** The `reactions` of `GET /posts/:id`. */
const readCounts = async (postId: number): Promise<Counts> =>
  ((await (await api(`/posts/${postId}`)).json()) as { post: { reactions: Counts } }).post
    .reactions;

async function received(botId: number) {
  const bot = await db().select().from(bots).where(eq(bots.id, botId)).get();
  return bot!.reactionsReceived;
}

async function counterOf(postId: number) {
  const post = await db().select().from(posts).where(eq(posts.id, postId)).get();
  return { total: post!.reactionTotal, top: JSON.parse(post!.reactionTop) as [string, number][] };
}

const rowsOn = (postId: number) =>
  db().select().from(reactions).where(eq(reactions.postId, postId));
const rowOf = (postId: number, botId: number) =>
  db()
    .select()
    .from(reactions)
    .where(and(eq(reactions.postId, postId), eq(reactions.botId, botId)))
    .get();
const rowsBy = (botId: number) => db().select().from(reactions).where(eq(reactions.botId, botId));

/** Moves a reaction's `created_at` without touching anything else, to put a row inside or outside the window. */
const setCreatedAt = (postId: number, botId: number, createdAt: number) =>
  db()
    .update(reactions)
    .set({ createdAt })
    .where(and(eq(reactions.postId, postId), eq(reactions.botId, botId)));

/** SQLite orders text by its UTF-8 bytes, which is what the `reaction_top` tie-break is. */
const byBytes = (a: string, b: string) => {
  const [x, y] = [a, b].map((s) => new TextEncoder().encode(s));
  for (let i = 0; i < Math.min(x!.length, y!.length); i++)
    if (x![i] !== y![i]) return x![i]! - y![i]!;
  return x!.length - y!.length;
};

/** The authors the current test made: `assertCounters()` checks their posts, so one test's drift can't fail another. */
let authorIds: number[] = [];
beforeEach(() => {
  authorIds = [];
});

/**
 * Recomputes the counters of the test's authors' posts, and their `reactions_received`, from the
 * `reactions` rows and compares them with what is stored (§7.1). Call it after a scenario: a counter
 * that drifted, on the post or on its author, fails here even if the scenario's own assertions were
 * about something else.
 */
async function assertCounters() {
  const [allReactions, allPosts, allBots] = await Promise.all([
    db().select().from(reactions),
    db().select().from(posts).where(inArray(posts.botId, authorIds)),
    db().select().from(bots).where(inArray(bots.id, authorIds)),
  ]);
  const receivedBy = new Map<number, number>();
  for (const post of allPosts) {
    const mine = allReactions.filter((r) => r.postId === post.id);
    const tally = new Map<string, number>();
    for (const r of mine) tally.set(r.emoji, (tally.get(r.emoji) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1] || byBytes(a[0], b[0])).slice(0, 5);
    expect({ post: post.id, total: post.reactionTotal, top: JSON.parse(post.reactionTop) }).toEqual(
      {
        post: post.id,
        total: mine.length,
        top,
      },
    );
    receivedBy.set(post.botId, (receivedBy.get(post.botId) ?? 0) + mine.length);
  }
  expect(allBots).toHaveLength(authorIds.length);
  for (const bot of allBots) {
    expect({ bot: bot.id, received: bot.reactionsReceived }).toEqual({
      bot: bot.id,
      received: receivedBy.get(bot.id) ?? 0,
    });
  }
}

/** An author with one post, and a function to make reactors. */
async function setup(tag: string) {
  const author = await insertBot(`${tag}_author`);
  authorIds.push(author.id);
  const postId = await seedPost(author.id);
  return { author, postId, bot: (name: string) => insertBot(`${tag}_${name}`) };
}

/** An author with `n` posts. */
async function manyPosts(tag: string, n: number) {
  const author = await insertBot(`${tag}_author`);
  authorIds.push(author.id);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(await seedPost(author.id));
  return { author, ids };
}

test("a reaction is stored and counted for the post and its author", async () => {
  const { author, postId, bot } = await setup("react_basic");
  const reactor = await bot("reactor");

  const res = await put(reactor.key, postId, { emoji: "🔥" });
  expect(res.status).toBe(200);
  expect(await countsOf(res)).toEqual({ total: 1, top: [["🔥", 1]] });

  expect(await rowOf(postId, reactor.id)).toMatchObject({ emoji: "🔥" });
  expect(await received(author.id)).toBe(1);
  const me = (await (await api("/me", { key: author.key })).json()) as {
    reactions_received: number;
  };
  expect(me.reactions_received).toBe(1);
  expect(await readCounts(postId)).toEqual({ total: 1, top: [["🔥", 1]] });
  await assertCounters();
});

test("changing the emoji swaps it: the total stays, the top changes, created_at is refreshed", async () => {
  const { author, postId, bot } = await setup("react_swap");
  const reactor = await bot("reactor");
  const other = await bot("other");
  await put(other.key, postId, { emoji: "🤖" });
  await put(reactor.key, postId, { emoji: "🔥" });
  await setCreatedAt(postId, reactor.id, 1_000);

  const before = Date.now();
  const res = await put(reactor.key, postId, { emoji: "💀" });
  expect(res.status).toBe(200);
  expect(await countsOf(res)).toEqual({
    total: 2,
    top: [
      ["💀", 1],
      ["🤖", 1],
    ],
  });
  const row = await rowOf(postId, reactor.id);
  expect(row).toMatchObject({ emoji: "💀" });
  expect(row!.createdAt).toBeGreaterThanOrEqual(before);
  expect(await received(author.id)).toBe(2);
  await assertCounters();
});

test("the same emoji again is a 200 that writes nothing", async () => {
  const { author, postId, bot } = await setup("react_same");
  const reactor = await bot("reactor");
  await put(reactor.key, postId, { emoji: "🔥" });
  await setCreatedAt(postId, reactor.id, 1_000);

  const res = await put(reactor.key, postId, { emoji: "🔥" });
  expect(res.status).toBe(200);
  expect(await countsOf(res)).toEqual({ total: 1, top: [["🔥", 1]] });
  expect((await rowOf(postId, reactor.id))!.createdAt).toBe(1_000);
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test("unreacting removes the reaction and the author's count; a second DELETE changes nothing", async () => {
  const { author, postId, bot } = await setup("react_unreact");
  const reactor = await bot("reactor");
  const other = await bot("other");
  await put(other.key, postId, { emoji: "🤖" });
  await put(reactor.key, postId, { emoji: "🔥" });
  expect(await received(author.id)).toBe(2);

  const res = await unreact(reactor.key, postId);
  expect(res.status).toBe(200);
  expect(await countsOf(res)).toEqual({ total: 1, top: [["🤖", 1]] });
  expect(await rowOf(postId, reactor.id)).toBeUndefined();
  expect(await received(author.id)).toBe(1);
  await assertCounters();

  const again = await unreact(reactor.key, postId);
  expect(again.status).toBe(200);
  expect(await countsOf(again)).toEqual({ total: 1, top: [["🤖", 1]] });
  expect(await received(author.id)).toBe(1);
  expect(await rowOf(postId, other.id)).toMatchObject({ emoji: "🤖" });
  await assertCounters();
});

test("a bot's own post can't be reacted to, and nothing is written", async () => {
  const { author, postId } = await setup("react_self");

  const res = await put(author.key, postId);
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "self_reaction" } });
  expect(await rowsOn(postId)).toHaveLength(0);
  expect(await received(author.id)).toBe(0);
  await assertCounters();
});

test.each([
  ["missing", () => "999999"],
  ["non_canonical", (postId: number) => `0${postId}`],
])("a %s id is 404 for PUT and DELETE, and nothing is written", async (name, idFor) => {
  const { author, postId, bot } = await setup(`react_404_${name}`);
  const reactor = await bot("reactor");
  const id = idFor(postId);

  for (const res of [await put(reactor.key, id), await unreact(reactor.key, id)]) {
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  }
  expect(await rowsBy(reactor.id)).toHaveLength(0);
  expect(await received(author.id)).toBe(0);
  await assertCounters();
});

test("a hidden post is 404 for PUT and DELETE, even for a reaction the bot already had", async () => {
  const { author, postId, bot } = await setup("react_hidden");
  const reactor = await bot("reactor");
  await put(reactor.key, postId, { emoji: "🔥" });
  await db().update(posts).set({ hidden: 1 }).where(eq(posts.id, postId));

  expect((await put(reactor.key, postId, { emoji: "💀" })).status).toBe(404);
  expect((await unreact(reactor.key, postId)).status).toBe(404);
  expect(await rowOf(postId, reactor.id)).toMatchObject({ emoji: "🔥" });
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test("both routes need an API key", async () => {
  const { author, postId } = await setup("react_anon");
  expect((await put(undefined, postId)).status).toBe(401);
  expect((await unreact(undefined, postId)).status).toBe(401);
  expect(await rowsOn(postId)).toHaveLength(0);
  expect(await received(author.id)).toBe(0);
});

test("a bot banned after auth can't react or unreact, and nothing is written", async () => {
  const { author, postId, bot } = await setup("react_banned");
  const reactor = await bot("reactor");
  await react(reactor.id, postId, "🔥");
  await db().update(bots).set({ status: BOT_STATUS.banned }).where(eq(bots.id, reactor.id));

  expect(await react(reactor.id, postId, "💀")).toEqual({ ok: false, reason: "banned" });
  // A first reaction is the case where the author's counter would move.
  const fresh = await seedPost(author.id);
  expect(await react(reactor.id, fresh, "💀")).toEqual({ ok: false, reason: "banned" });
  expect(await rowOf(fresh, reactor.id)).toBeUndefined();
  expect(await unreactToPost(db(), reactor.id, postId)).toEqual({ ok: false, reason: "banned" });
  expect(await rowOf(postId, reactor.id)).toMatchObject({ emoji: "🔥" });
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test.each([
  ["a letter emoji", "🅰️", "contains_words"],
  ["text", "hi", "invalid_characters"],
  ["two emoji", "🔥🔥", "invalid_characters"],
  ["nothing", "", "empty"],
  ["over the byte limit", "👨‍👩‍👧‍👦".repeat(3), "too_long"],
])("%s is 422 %s and writes nothing", async (name, emoji, code) => {
  expect(new TextEncoder().encode(emoji).length > REACTION_MAX_BYTES).toBe(code === "too_long");
  const { author, postId, bot } = await setup(`react_422_${name.replaceAll(" ", "_")}`);
  const reactor = await bot("reactor");

  const res = await put(reactor.key, postId, { emoji });
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ error: { code, matches: expect.any(Array) } });
  expect(await rowsBy(reactor.id)).toHaveLength(0);
  expect(await received(author.id)).toBe(0);
  await assertCounters();
});

test.each([
  ["no emoji", {}],
  ["an emoji that isn't a string", { emoji: 5 }],
])("%s is 400 invalid_request", async (name, json) => {
  const { postId, bot } = await setup(`react_400_${name.replaceAll(" ", "_")}`);
  const reactor = await bot("reactor");
  const res = await put(reactor.key, postId, json);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
});

test("unreacting with no reaction to take back is a 200 with the current counts", async () => {
  const { author, postId, bot } = await setup("react_unreact_none");
  const reactor = await bot("reactor");
  const other = await bot("other");
  await put(other.key, postId, { emoji: "🤖" });

  const res = await unreact(reactor.key, postId);
  expect(res.status).toBe(200);
  expect(await countsOf(res)).toEqual({ total: 1, top: [["🤖", 1]] });
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test("the top is five emoji, most first, ties broken by the emoji's bytes", async () => {
  // SQLite doesn't promise that json_group_array keeps its input's order, so this pins it. The single
  // reactions come in reverse of the order the tie-break must give.
  const { author, postId, bot } = await setup("react_top");
  const emoji = ["💀", "👀", "🎲", "🍀", "🌀", "🤖", "🤖", "🔥", "🔥", "🔥"];
  for (const [n, e] of emoji.entries()) await react((await bot(`r${n}`)).id, postId, e);

  expect(await counterOf(postId)).toEqual({
    total: 10,
    top: [
      ["🔥", 3],
      ["🤖", 2],
      ["🌀", 1],
      ["🍀", 1],
      ["🎲", 1],
    ],
  });
  expect(await received(author.id)).toBe(10);
  await assertCounters();
});

test("reacting to one post doesn't touch another post's counters", async () => {
  const { author, ids } = await manyPosts("react_scope", 2);
  const reactor = await insertBot("react_scope_reactor");
  await react(reactor.id, ids[1]!, "💀");
  await react(reactor.id, ids[0]!, "🔥");

  expect(await counterOf(ids[0]!)).toEqual({ total: 1, top: [["🔥", 1]] });
  expect(await counterOf(ids[1]!)).toEqual({ total: 1, top: [["💀", 1]] });
  expect(await received(author.id)).toBe(2);
  await assertCounters();
});

// The hourly limit: live rows of `reactions_by_bot` inside the window (§8.7, decision 37).

/** Gives `botId` one reaction on each of `postIds`, sent at `at`, past the quota check. */
async function seedReactions(botId: number, postIds: number[], at: number) {
  for (const postId of postIds) await react(botId, postId, "🔥", at, BIG);
}

test("the 61st new reaction in an hour is 429 rate_limited, with the wait for the oldest to age out", async () => {
  const { ids } = await manyPosts("quota_http", REACTION_HOURLY_MAX + 1);
  const reactor = await insertBot("quota_http_reactor");
  const sent = Date.now() - 600_000;
  for (const [n, id] of ids.slice(0, REACTION_HOURLY_MAX).entries()) {
    await react(reactor.id, id, "🔥", sent + n * 1000);
  }
  const last = ids[REACTION_HOURLY_MAX]!;

  const res = await put(reactor.key, last);
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: { code: string; retry_after_s: number } };
  expect(body.error.code).toBe("rate_limited");
  expect(body.error.retry_after_s).toBeGreaterThan(2990);
  expect(body.error.retry_after_s).toBeLessThanOrEqual(3000);
  expect(res.headers.get("Retry-After")).toBe(String(body.error.retry_after_s));
  expect(await rowOf(last, reactor.id)).toBeUndefined();
  await assertCounters();

  // At the limit, a reaction sent inside the window can still be changed, and taking one back frees a slot.
  expect((await put(reactor.key, ids[0]!, { emoji: "💀" })).status).toBe(200);
  expect((await unreact(reactor.key, ids[1]!)).status).toBe(200);
  expect((await put(reactor.key, last)).status).toBe(200);
  await assertCounters();
});

test("reactions older than the window don't count; one exactly at its edge doesn't either", async () => {
  const { ids } = await manyPosts("quota_window", 8);
  const aged = await insertBot("quota_window_aged");
  const edge = await insertBot("quota_window_edge");
  const now = Date.now();
  await seedReactions(aged.id, ids.slice(0, 3), now - HOUR - 1);
  await seedReactions(edge.id, ids.slice(0, 3), now - HOUR);

  expect(await react(aged.id, ids[3]!, "🔥", now, SMALL)).toMatchObject({ ok: true });
  expect(await react(edge.id, ids[3]!, "🔥", now, SMALL)).toMatchObject({ ok: true });
});

test("a reaction one millisecond inside the window counts, and the wait is for the oldest of them", async () => {
  const { ids } = await manyPosts("quota_inside", 5);
  const reactor = await insertBot("quota_inside_reactor");
  const now = Date.now();
  await seedReactions(reactor.id, [ids[0]!], now - HOUR + 1);
  await seedReactions(reactor.id, ids.slice(1, 3), now - 60_000);

  const result = await react(reactor.id, ids[3]!, "🔥", now, SMALL);
  expect(result).toEqual({ ok: false, reason: "rate_limited", oldest: now - HOUR + 1 });
  expect(await rowOf(ids[3]!, reactor.id)).toBeUndefined();
  await assertCounters();
});

test("a bot at the limit can change an emoji it sent inside the window", async () => {
  const { ids } = await manyPosts("quota_swap", 4);
  const reactor = await insertBot("quota_swap_reactor");
  const now = Date.now();
  await seedReactions(reactor.id, ids.slice(0, 3), now - 60_000);

  expect(await react(reactor.id, ids[0]!, "💀", now, SMALL)).toMatchObject({
    ok: true,
    changed: true,
  });
  expect(await react(reactor.id, ids[3]!, "💀", now, SMALL)).toMatchObject({
    ok: false,
    reason: "rate_limited",
  });
  const row = await rowOf(ids[0]!, reactor.id);
  expect(row).toMatchObject({ emoji: "💀", createdAt: now });
  await assertCounters();
});

test("changing the emoji of a reaction that has aged out costs a slot: 429 at the limit", async () => {
  const { ids } = await manyPosts("quota_aged_swap", 4);
  const reactor = await insertBot("quota_aged_swap_reactor");
  const now = Date.now();
  await seedReactions(reactor.id, [ids[0]!], now - HOUR - 1000);
  await seedReactions(reactor.id, ids.slice(1, 4), now - 60_000);

  expect(await react(reactor.id, ids[0]!, "💀", now, SMALL)).toMatchObject({
    ok: false,
    reason: "rate_limited",
  });
  expect(await rowOf(ids[0]!, reactor.id)).toMatchObject({
    emoji: "🔥",
    createdAt: now - HOUR - 1000,
  });

  // Sending the old emoji again is no swap at all: no write, no quota, and the row keeps its age.
  expect(await react(reactor.id, ids[0]!, "🔥", now, SMALL)).toMatchObject({
    ok: true,
    changed: false,
  });
  expect((await rowOf(ids[0]!, reactor.id))!.createdAt).toBe(now - HOUR - 1000);
  await assertCounters();
});

test("unreacting frees a slot at once; the author deleting the post frees the reactors' slots", async () => {
  const { ids, author } = await manyPosts("quota_refund", 5);
  const reactor = await insertBot("quota_refund_reactor");
  const now = Date.now();
  await seedReactions(reactor.id, ids.slice(0, 3), now - 60_000);
  expect(await react(reactor.id, ids[3]!, "🔥", now, SMALL)).toMatchObject({ ok: false });

  await unreactToPost(db(), reactor.id, ids[0]!);
  expect(await react(reactor.id, ids[3]!, "🔥", now, SMALL)).toMatchObject({ ok: true });
  expect(await react(reactor.id, ids[4]!, "🔥", now, SMALL)).toMatchObject({ ok: false });

  expect((await api(`/posts/${ids[1]!}`, { method: "DELETE", key: author.key })).status).toBe(204);
  expect(await react(reactor.id, ids[4]!, "🔥", now, SMALL)).toMatchObject({ ok: true });
  await assertCounters();
});

// Concurrency (§15): every call is in flight before any lands, so a read-then-write would see them all
// as first reactions.

test("parallel first reactions from one bot on one post: one row, total 1, the author +1 once", async () => {
  const { author, postId, bot } = await setup("race_same");
  const reactor = await bot("reactor");

  const results = await Promise.all(Array.from({ length: 8 }, () => react(reactor.id, postId)));
  expect(results.every((r) => r.ok)).toBe(true);
  expect(results.filter((r) => r.ok && r.changed)).toHaveLength(1);
  expect(await rowsOn(postId)).toHaveLength(1);
  expect(await counterOf(postId)).toEqual({ total: 1, top: [["🔥", 1]] });
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test("parallel first reactions with different emoji from one bot: still one row, counted once", async () => {
  const { author, postId, bot } = await setup("race_emoji");
  const reactor = await bot("reactor");

  await Promise.all(["🔥", "🤖", "💀", "👀"].map((e) => react(reactor.id, postId, e)));
  expect(await rowsOn(postId)).toHaveLength(1);
  expect((await counterOf(postId)).total).toBe(1);
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

test("parallel reactions from N bots on one post: N rows, the author +N", async () => {
  const { author, postId, bot } = await setup("race_bots");
  const reactors = await Promise.all(Array.from({ length: 6 }, (_, n) => bot(`reactor_${n}`)));

  await Promise.all(reactors.map((r) => react(r.id, postId)));
  expect(await counterOf(postId)).toEqual({ total: 6, top: [["🔥", 6]] });
  expect(await received(author.id)).toBe(6);
  await assertCounters();
});

test("a PUT racing a DELETE from one bot ends consistent", async () => {
  const { postId, bot } = await setup("race_put_delete");
  const reactor = await bot("reactor");
  const bystander = await bot("bystander");
  await react(bystander.id, postId, "🤖");

  await Promise.all([
    react(reactor.id, postId, "🔥"),
    unreactToPost(db(), reactor.id, postId),
    react(reactor.id, postId, "💀"),
    unreactToPost(db(), reactor.id, postId),
    react(reactor.id, postId, "🔥"),
    unreactToPost(db(), reactor.id, postId),
  ]);
  expect((await rowsBy(reactor.id)).length).toBeLessThanOrEqual(1);
  await assertCounters();
});

test("a parallel burst can't pass the hourly limit", async () => {
  const { ids } = await manyPosts("race_quota", 6);
  const reactor = await insertBot("race_quota_reactor");
  const now = Date.now();
  await seedReactions(reactor.id, ids.slice(0, 2), now - 60_000);

  const results = await Promise.all(
    ids.slice(2).map((id) => react(reactor.id, id, "🔥", now, SMALL)),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok && r.reason === "rate_limited")).toHaveLength(3);
  expect(await rowsBy(reactor.id)).toHaveLength(3);
  await assertCounters();
});

test("concurrent PUT requests from one bot: all 200, one reaction", async () => {
  // End to end. Miniflare often hands these requests to the Worker one or two at a time, so this alone
  // wouldn't reliably catch a check-then-write; the direct tests above do.
  const { author, postId, bot } = await setup("race_http");
  const reactor = await bot("reactor");

  const responses = await Promise.all([1, 2, 3].map(() => put(reactor.key, postId)));
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(await counterOf(postId)).toEqual({ total: 1, top: [["🔥", 1]] });
  expect(await received(author.id)).toBe(1);
  await assertCounters();
});

// Caches (§10.2): a reaction drops the post's own entry and leaves the `latest` snapshot alone.

test("the reactor's next GET of the post shows the new counts, with no waiting", async () => {
  const { postId, bot } = await setup("react_cache");
  const reactor = await bot("reactor");
  expect((await readCounts(postId)).total).toBe(0);

  await put(reactor.key, postId, { emoji: "🔥" });
  expect(await readCounts(postId)).toEqual({ total: 1, top: [["🔥", 1]] });

  await unreact(reactor.key, postId);
  expect((await readCounts(postId)).total).toBe(0);
});

test("a reaction leaves the feed's counts as they were until the snapshot is rebuilt", async () => {
  const { postId, bot } = await setup("react_snapshot");
  const reactor = await bot("reactor");
  await rebuild();
  const feedTotal = async () => {
    const feed = (await (await api("/feed")).json()) as {
      posts: { id: number; reactions: Counts }[];
    };
    return feed.posts.find((p) => p.id === postId)?.reactions.total;
  };
  expect(await feedTotal()).toBe(0);

  await put(reactor.key, postId, { emoji: "🔥" });
  expect(await feedTotal()).toBe(0);

  await rebuild();
  expect(await feedTotal()).toBe(1);
});

test("deleting a post whose reactions came through PUT fixes both counters", async () => {
  const { author, postId, bot } = await setup("react_delete");
  const reactors = await Promise.all([bot("a"), bot("b"), bot("c")]);
  const keep = await seedPost(author.id);
  for (const r of reactors) await put(r.key, postId, { emoji: "🔥" });
  await put(reactors[0]!.key, keep, { emoji: "🤖" });
  expect(await received(author.id)).toBe(4);

  expect((await api(`/posts/${postId}`, { method: "DELETE", key: author.key })).status).toBe(204);
  expect(await received(author.id)).toBe(1);
  expect(await rowsOn(postId)).toHaveLength(0);
  expect(await rowsBy(reactors[0]!.id)).toHaveLength(1);
  await assertCounters();
});
