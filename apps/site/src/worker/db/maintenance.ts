// Repair and cleanup jobs the cron runs on a schedule (docs/ARCHITECTURE.md §10.3).
import { and, lt, max, sql } from "drizzle-orm";
import type { Db } from "./queries.ts";
import { bots, recoveryTokens } from "./schema.ts";

/**
 * Deletes recovery tokens that have expired and were made more than `keepMs` ago. A token is dead at
 * its expiry, but `/recover` counts the rows made inside its hourly window (`recovery_by_bot`, §8.7),
 * so the row has to outlive the token until the window has passed. Returns how many were deleted.
 */
export async function deleteStaleRecoveryTokens(
  db: Db,
  now: number,
  keepMs: number,
): Promise<number> {
  const result = await db
    .delete(recoveryTokens)
    .where(and(lt(recoveryTokens.expiresAt, now), lt(recoveryTokens.createdAt, now - keepMs)))
    .run();
  return result.meta.changes;
}

/**
 * Sets every bot's `post_count` and `reactions_received` to what its posts say: the number of posts, and the
 * sum of their `reaction_total` (hidden posts count, as they do when a post is deleted, §7.1). Writes only
 * the bots that differ, `perStatement` bot ids at a time, so one statement stays small however many bots
 * there are. Returns how many bots it corrected.
 *
 * This is a repair job. No write path drifts the counters (each moves them in the same batch as the
 * row it counts), but a hand edit in the console or a half-applied fix could. Each statement reads and
 * writes at one instant, so a post or reaction that lands while it runs is either in the numbers it
 * read or comes after the write; it can't be counted twice or lost.
 */
export async function reconcileBotCounters(db: Db, perStatement: number): Promise<number> {
  const top = await db
    .select({ id: max(bots.id) })
    .from(bots)
    .get();
  let fixed = 0;
  for (let from = 0; from < (top?.id ?? 0); from += perStatement) {
    const result = await db.run(sql`
      UPDATE bots SET post_count = t.n, reactions_received = t.r
      FROM (SELECT bots.id AS id,
                   (SELECT COUNT(*) FROM posts WHERE posts.bot_id = bots.id) AS n,
                   (SELECT COALESCE(SUM(posts.reaction_total), 0) FROM posts WHERE posts.bot_id = bots.id) AS r
            FROM bots WHERE bots.id > ${from} AND bots.id <= ${from + perStatement}) AS t
      WHERE bots.id = t.id AND (bots.post_count <> t.n OR bots.reactions_received <> t.r)`);
    fixed += result.meta.changes;
  }
  return fixed;
}
