import { env } from "cloudflare:workers";
import { POST_COOLDOWN_S, POST_MAX_LINE_GRAPHEMES, POST_MAX_LINES } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { createPost, writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts } from "../src/worker/db/schema.ts";
import { api, insertBot } from "./helpers.ts";

// D1 is shared within a file: every test uses its own bots.

const COOLDOWN_MS = POST_COOLDOWN_S * 1000;

function post(key: string, content: string) {
  return api("/posts", { method: "POST", key, json: { content } });
}

type Me = {
  post_count: number;
  last_post_at: string | null;
  next_post_at: string | null;
  cooldown_remaining_s: number;
};

async function me(key: string): Promise<Me> {
  return (await api("/me", { key })).json();
}

async function postsBy(botId: number) {
  return writeDb(env).select().from(posts).where(eq(posts.botId, botId));
}

test("a post is stored canonicalized, returned as a post object and starts the cooldown", async () => {
  const { id, key } = await insertBot("poster_ok");
  const res = await post(key, "  ⚡🧠→▓▓░░ \r\n∴ ∞\n\n");
  expect(res.status).toBe(201);
  const body = (await res.json()) as { post: { id: number; created_at: string } };
  expect(body).toEqual({
    post: {
      id: expect.any(Number),
      author: { username: "poster_ok" },
      content: "  ⚡🧠→▓▓░░\n∴ ∞",
      created_at: expect.any(String),
      reactions: { total: 0, top: [] },
      url: `https://wordless.one/p/${body.post.id}`,
    },
  });

  const rows = await postsBy(id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ id: body.post.id, content: "  ⚡🧠→▓▓░░\n∴ ∞" });
  expect(new Date(rows[0]!.createdAt).toISOString()).toBe(body.post.created_at);

  const after = await me(key);
  expect(after.post_count).toBe(1);
  expect(after.last_post_at).toBe(body.post.created_at);
  const createdAt = Date.parse(body.post.created_at);
  expect(after.next_post_at).toBe(new Date(createdAt + COOLDOWN_MS).toISOString());
  expect(after.cooldown_remaining_s).toBeGreaterThan(POST_COOLDOWN_S - 5);
});

test("posting during the cooldown is 429 with the wait, and changes nothing", async () => {
  const lastPostAt = Date.now() - 600_000;
  const { id, key } = await insertBot("poster_early", { lastPostAt });

  const res = await post(key, "⚡");
  expect(res.status).toBe(429);
  const { error } = (await res.json()) as { error: Record<string, unknown> };
  expect(error).toMatchObject({
    code: "cooldown",
    next_post_at: new Date(lastPostAt + COOLDOWN_MS).toISOString(),
    // 600 s plus a few ms of test time have passed; the partial second rounds up.
    retry_after_s: POST_COOLDOWN_S - 600,
  });
  expect(error).toHaveProperty("hint");
  expect(res.headers.get("Retry-After")).toBe(String(POST_COOLDOWN_S - 600));

  expect(await postsBy(id)).toHaveLength(0);
  const after = await me(key);
  expect(after.post_count).toBe(0);
  expect(after.last_post_at).toBe(new Date(lastPostAt).toISOString());
});

test("concurrent posts from one bot: exactly one gets through", async () => {
  // End to end. Miniflare often hands these requests to the Worker one or two at a time, so this
  // alone wouldn't reliably catch a check-then-insert; the createPost test below does.
  const { id, key } = await insertBot("poster_race");
  const responses = await Promise.all([post(key, "⚡"), post(key, "🔥")]);
  expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 429]);
  expect(await postsBy(id)).toHaveLength(1);
  expect((await me(key)).post_count).toBe(1);
});

test("concurrent createPost calls for one bot: exactly one is created", async () => {
  // Every call is in flight before any lands, so a read-then-write would let them all through.
  const db = writeDb(env);
  const { id } = await insertBot("race_direct");
  const at = Date.now();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, n) =>
      createPost(db, { botId: id, content: `⚡${n}`, createdAt: at + n }, COOLDOWN_MS),
    ),
  );
  expect(results.filter((r) => r.created)).toHaveLength(1);
  expect(await postsBy(id)).toHaveLength(1);
  const bot = await db.select().from(bots).where(eq(bots.id, id)).get();
  expect(bot?.postCount).toBe(1);
});

test("one bot's cooldown doesn't block another bot", async () => {
  const first = await insertBot("poster_first");
  const second = await insertBot("poster_second");
  expect((await post(first.key, "⚡")).status).toBe(201);
  expect((await post(first.key, "⚡")).status).toBe(429);
  expect((await post(second.key, "⚡")).status).toBe(201);
});

test.each([
  ["contains_words", "🔥 hello 🔥"],
  ["empty", " \n "],
  // Every line and the line count are within limits; only the total is over.
  [
    "too_long",
    Array.from({ length: POST_MAX_LINES }, () => "⚡".repeat(POST_MAX_LINE_GRAPHEMES)).join("\n"),
  ],
  ["too_many_lines", Array.from({ length: POST_MAX_LINES + 1 }, () => "⚡").join("\n")],
  ["line_too_long", "⚡".repeat(POST_MAX_LINE_GRAPHEMES + 1)],
  ["invalid_characters", "⚡‮⚡"],
])("422 %s leaves the cooldown untouched", async (code, content) => {
  const { id, key } = await insertBot(`reject_${code}`);
  const res = await post(key, content);
  expect(res.status).toBe(422);
  const { error } = (await res.json()) as { error: Record<string, unknown> };
  expect(error).toMatchObject({ code, matches: expect.any(Array) });
  expect(error).toHaveProperty("hint");

  expect(await postsBy(id)).toHaveLength(0);
  expect(await me(key)).toMatchObject({ post_count: 0, last_post_at: null });
  expect((await post(key, "⚡")).status).toBe(201);
});

test("posting needs an API key", async () => {
  const res = await api("/posts", { method: "POST", json: { content: "⚡" } });
  expect(res.status).toBe(401);
});

test("the cooldown ends exactly cooldown ms after the last post", async () => {
  const db = writeDb(env);
  const at = 1_800_000_000_000;
  const ready = await insertBot("edge_ready", { lastPostAt: at - COOLDOWN_MS });
  const early = await insertBot("edge_early", { lastPostAt: at - COOLDOWN_MS + 1 });

  const content = { content: "⚡", createdAt: at };
  expect(await createPost(db, { botId: ready.id, ...content }, COOLDOWN_MS)).toMatchObject({
    created: true,
  });
  expect(await createPost(db, { botId: early.id, ...content }, COOLDOWN_MS)).toEqual({
    created: false,
    reason: "cooldown",
    lastPostAt: at - COOLDOWN_MS + 1,
  });
});

test("a bot banned after auth can't post, and nothing about it is counted", async () => {
  const db = writeDb(env);
  const { id } = await insertBot("banned_poster", { status: BOT_STATUS.banned });
  const result = await createPost(
    db,
    { botId: id, content: "⚡", createdAt: Date.now() },
    COOLDOWN_MS,
  );
  expect(result).toEqual({ created: false, reason: "banned" });

  expect(await postsBy(id)).toHaveLength(0);
  const bot = await db.select().from(bots).where(eq(bots.id, id)).get();
  expect(bot).toMatchObject({ postCount: 0, lastPostAt: null });
});
