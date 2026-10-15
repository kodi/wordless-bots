import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, expect, test } from "vite-plus/test";
import { dashboardStats } from "../src/worker/db/dashboard.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts, reactions } from "../src/worker/db/schema.ts";
import { insertBot } from "./helpers.ts";

// This file's D1 holds only the bots below, so the totals are theirs. Today is 2031-01-10 (UTC); the 7-day
// range is 01-04 to 01-10.
const at = (day: number, h = 12) => Date.UTC(2031, 0, day, h);
const NOW = at(10, 18);

beforeAll(async () => {
  const db = writeDb(env);
  const old = await insertBot("st_old", { createdAt: Date.UTC(2030, 11, 1), lastPostAt: at(10) });
  // The last millisecond before the range: it counts in the total the range starts from.
  const edge = await insertBot("st_edge", { createdAt: at(4, 0) - 1 });
  const banned = await insertBot("st_banned", {
    createdAt: at(5),
    lastPostAt: at(5),
    status: BOT_STATUS.banned,
  });
  // The first millisecond of today.
  const fresh = await insertBot("st_fresh", { createdAt: at(10, 0) });
  await db.update(bots).set({ postCount: 3, reactionsReceived: 2 }).where(eq(bots.id, old.id));

  const [p1, , p3, p4] = await db
    .insert(posts)
    .values([
      { botId: old.id, content: "⚡", createdAt: at(5, 1) },
      { botId: old.id, content: "⚡", createdAt: at(5, 23) },
      { botId: old.id, content: "⚡", createdAt: at(10) },
      { botId: banned.id, content: "⚡", createdAt: at(5), hidden: 1 },
      { botId: banned.id, content: "⚡", createdAt: at(3) },
    ])
    .returning({ id: posts.id });
  await db.insert(reactions).values([
    { postId: p1!.id, botId: fresh.id, emoji: "🔥", createdAt: at(6) },
    { postId: p3!.id, botId: edge.id, emoji: "🔥", createdAt: at(10) },
    { postId: p4!.id, botId: fresh.id, emoji: "🤖", createdAt: at(9) },
    // Before the range: not in the days, nor in the top.
    { postId: p4!.id, botId: old.id, emoji: "🤖", createdAt: at(2) },
  ]);
});

test("each day of the range counts what was made on it, oldest first", async () => {
  const stats = await dashboardStats(writeDb(env), 7, NOW);
  expect(stats.days).toEqual([
    { date: "2031-01-04", new_bots: 0, total_bots: 2, posts: 0, active_bots: 0, reactions: 0 },
    { date: "2031-01-05", new_bots: 1, total_bots: 3, posts: 3, active_bots: 2, reactions: 0 },
    { date: "2031-01-06", new_bots: 0, total_bots: 3, posts: 0, active_bots: 0, reactions: 1 },
    { date: "2031-01-07", new_bots: 0, total_bots: 3, posts: 0, active_bots: 0, reactions: 0 },
    { date: "2031-01-08", new_bots: 0, total_bots: 3, posts: 0, active_bots: 0, reactions: 0 },
    { date: "2031-01-09", new_bots: 0, total_bots: 3, posts: 0, active_bots: 0, reactions: 1 },
    { date: "2031-01-10", new_bots: 1, total_bots: 4, posts: 1, active_bots: 1, reactions: 1 },
  ]);
  expect(stats.range).toEqual({ new_bots: 2, posts: 4, reactions: 3, active_bots: 2 });
});

test("the totals are all time, and the top bots are ranked by the reactions they got in the range", async () => {
  const stats = await dashboardStats(writeDb(env), 7, NOW);
  expect(stats.totals).toEqual({ bots: 4, posted: 2, banned: 1, posts: 3, reactions: 2 });
  expect(stats.top_bots).toEqual([
    { username: "st_old", reactions: 2, banned: false },
    { username: "st_banned", reactions: 1, banned: true },
  ]);
});

test("a 30-day range starts from fewer bots and reaches back further", async () => {
  const stats = await dashboardStats(writeDb(env), 30, NOW);
  expect(stats.days).toHaveLength(30);
  expect(stats.days[0]).toMatchObject({ date: "2030-12-12", total_bots: 1 });
  expect(stats.range).toEqual({ new_bots: 3, posts: 5, reactions: 4, active_bots: 2 });
  // A tie goes to the name that sorts first.
  expect(stats.top_bots).toEqual([
    { username: "st_banned", reactions: 2, banned: true },
    { username: "st_old", reactions: 2, banned: false },
  ]);
});
