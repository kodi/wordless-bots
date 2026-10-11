import { env } from "cloudflare:workers";
import { RECOVERY_WINDOW_S } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { dueJobs } from "../src/worker/cron.ts";
import worker from "../src/worker/index.ts";
import { reconcileBotCounters } from "../src/worker/db/maintenance.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { bots, recoveryTokens, snapshots } from "../src/worker/db/schema.ts";
import { readLatest, readTop } from "../src/worker/db/snapshots.ts";
import { api, clearFeed, insertBot, insertPosts } from "./helpers.ts";

// D1 is shared within a file: every test starts from an empty feed. Reconciling fixes every bot, so
// the tests look at their own bots only.

const HOUR_MS = 3_600_000;

/** Runs the Worker's `scheduled` handler at a UTC time, as the platform would. */
function tick(iso: string) {
  const controller = { scheduledTime: Date.parse(iso), cron: "* * * * *", noRetry() {} };
  return worker.scheduled(controller, env);
}

async function counters(id: number) {
  return writeDb(env)
    .select({ posts: bots.postCount, reactions: bots.reactionsReceived })
    .from(bots)
    .where(eq(bots.id, id))
    .get();
}

let tokenSeq = 0;
async function insertToken(botId: number, createdAt: number, expiresAt: number) {
  tokenSeq += 1;
  await writeDb(env)
    .insert(recoveryTokens)
    .values({ tokenHash: new Uint8Array([7, tokenSeq]), botId, createdAt, expiresAt });
  return new Uint8Array([7, tokenSeq]);
}
const tokenCount = async () => (await writeDb(env).select().from(recoveryTokens)).length;

let botId: number;
beforeEach(async () => {
  await clearFeed();
  await writeDb(env).delete(recoveryTokens);
  botId ??= (await insertBot("cron_author")).id;
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("the slower jobs are due on the hour, and the nightly one at its hour only", () => {
  expect(dueJobs(Date.parse("2026-10-11T12:34:00Z"))).toEqual({ hourly: false, nightly: false });
  expect(dueJobs(Date.parse("2026-10-11T12:00:00Z"))).toEqual({ hourly: true, nightly: false });
  expect(dueJobs(Date.parse("2026-10-11T03:00:00Z"))).toEqual({ hourly: true, nightly: true });
  expect(dueJobs(Date.parse("2026-10-11T03:01:00Z"))).toEqual({ hourly: false, nightly: false });
});

test("a run rebuilds both snapshots, which is what puts new reactions into latest and top", async () => {
  const { key: reactorKey } = await insertBot("cron_reactor");
  const { key: authorKey } = await insertBot("cron_poster");
  const created = await api("/posts", { method: "POST", key: authorKey, json: { content: "⚡" } });
  const { post } = (await created.json()) as { post: { id: number } };
  // A first run writes both rows, so what follows reads snapshots and not the posts live.
  await vi.waitFor(async () => expect((await readLatest(writeDb(env))).length).toBe(1));
  await tick("2026-10-11T12:33:00Z");

  const reacted = await api(`/posts/${post.id}/reaction`, {
    method: "PUT",
    key: reactorKey,
    json: { emoji: "🔥" },
  });
  expect(reacted.status).toBe(200);
  // A reaction rebuilds nothing (§7.2): both snapshots still say 0.
  expect((await readLatest(writeDb(env)))[0]?.reactionTotal).toBe(0);
  expect(await readTop(writeDb(env))).toEqual([]);

  await tick("2026-10-11T12:34:00Z");

  expect((await readLatest(writeDb(env)))[0]?.reactionTotal).toBe(1);
  expect((await readTop(writeDb(env))).map((row) => row.id)).toEqual([post.id]);
  const top = (await (await api("/top")).json()) as { posts: { id: number }[] };
  expect(top.posts.map((p) => p.id)).toEqual([post.id]);
});

test("the hourly job deletes tokens that are expired and past the recovery window, and no others", async () => {
  const now = Date.now();
  const window = RECOVERY_WINDOW_S * 1000;
  const live = await insertToken(botId, now - 60_000, now + 29 * 60_000);
  // Dead, but made inside the window: `/recover` still counts it toward 3 an hour.
  const counted = await insertToken(botId, now - 45 * 60_000, now - 15 * 60_000);
  const gone = await insertToken(botId, now - window - 1, now - window + 29 * 60_000);
  // Old enough, but not expired: a token is never deleted while it can still be used.
  const valid = await insertToken(botId, now - window - 1, now + 60_000);

  await tick("2026-10-11T12:34:00Z");
  expect(await tokenCount()).toBe(4);

  await tick("2026-10-11T12:00:00Z");
  const left = (await writeDb(env).select().from(recoveryTokens)).map((row) => row.tokenHash);
  expect(left).toEqual([live, counted, valid]);
  expect(left).not.toContainEqual(gone);
});

test("the nightly job corrects the counters of the bots that drifted, and only then", async () => {
  const drifted = await insertBot("cron_drifted");
  // Two posts (one hidden) with 3 reactions between them; the bot says otherwise.
  await insertPosts(drifted.id, [{ reactionTotal: 2 }, { reactionTotal: 1, hidden: 1 }]);
  await writeDb(env)
    .update(bots)
    .set({ postCount: 9, reactionsReceived: 9 })
    .where(eq(bots.id, drifted.id));

  await tick("2026-10-11T04:00:00Z");
  expect(await counters(drifted.id)).toEqual({ posts: 9, reactions: 9 });

  await tick("2026-10-11T03:00:00Z");
  expect(await counters(drifted.id)).toEqual({ posts: 2, reactions: 3 });
});

test("a reconcile walks every id range and writes only the bots that differ", async () => {
  // Five bots over ranges of 2 ids, so the walk crosses boundaries; bots with ids in between are others'.
  const made = [];
  for (let n = 0; n < 5; n++) {
    const bot = await insertBot(`cron_range_${n}`);
    await insertPosts(
      bot.id,
      Array.from({ length: n }, () => ({ reactionTotal: 2 })),
    );
    made.push(bot.id);
  }
  await writeDb(env).update(bots).set({ postCount: 0, reactionsReceived: 0 });

  const fixed = await reconcileBotCounters(writeDb(env), 2);

  expect(fixed).toBeGreaterThanOrEqual(4);
  for (const [n, id] of made.entries()) {
    expect(await counters(id)).toEqual({ posts: n, reactions: n * 2 });
  }
  // Everything is right now, so a second run writes nothing.
  expect(await reconcileBotCounters(writeDb(env), 2)).toBe(0);
});

test("one failing job doesn't stop the others, and the run fails", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await insertPosts(botId, [{ reactionTotal: 1, createdAt: Date.now() }]);
  const now = Date.now();
  await insertToken(botId, now - 3 * HOUR_MS, now - 2 * HOUR_MS);
  // The top24 write fails inside D1 itself, so no mock is in the way.
  await env.DB.exec(
    "CREATE TRIGGER fail_top24 BEFORE INSERT ON snapshots WHEN NEW.name = 'top24' BEGIN SELECT RAISE(ABORT, 'boom'); END",
  );
  try {
    await expect(tick("2026-10-11T12:00:00Z")).rejects.toThrow("rebuild top24");
  } finally {
    await env.DB.exec("DROP TRIGGER fail_top24");
  }

  expect(await readLatest(writeDb(env))).toHaveLength(1);
  const stored = await writeDb(env).select().from(snapshots).where(eq(snapshots.name, "latest"));
  expect(stored).toHaveLength(1);
  expect(await tokenCount()).toBe(0);
  expect(errors).toHaveBeenCalledWith(expect.stringContaining("rebuild top24"), expect.anything());
});
