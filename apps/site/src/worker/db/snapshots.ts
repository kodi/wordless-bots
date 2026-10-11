// Precomputed read models (docs/ARCHITECTURE.md §7.2): one row read per cache miss, whatever the traffic.
import { LATEST_SNAPSHOT_SIZE, TOP_SNAPSHOT_SIZE, TOP_WINDOW_S } from "@wordless/shared";
import { desc, eq, sql } from "drizzle-orm";
import { bots, posts, snapshots } from "./schema.ts";
import { postRowColumns, visiblePosts, type Db, type PostRow } from "./queries.ts";

const LATEST = "latest";
const TOP24 = "top24";

/** The newest visible posts, newest first: what the `latest` snapshot holds. */
const newestPosts = (db: Db) =>
  visiblePosts(db).orderBy(desc(posts.id)).limit(LATEST_SNAPSHOT_SIZE);

/**
 * Rewrites `snapshots('latest')` with the newest visible posts, as a JSON array of `PostRow`s, newest
 * first. The rows have no `url`: the post object's `url` needs the request's origin, which a cron
 * rebuild doesn't have, so `serializePost()` adds it when a request reads the snapshot. `reactionTop`
 * stays the JSON string the post stores.
 *
 * It is one statement (`INSERT ... SELECT json_group_array(...) ... ON CONFLICT DO UPDATE`), so the
 * rows are read and written at one instant, and D1 runs it one at a time like any write. Of two
 * rebuilds running at once, the later one sees every write the earlier one saw, so a slow rebuild
 * can't put an older view over a newer one. A read-then-write rebuild could. Run it on the primary
 * (`writeDb()`): a replica may lag.
 *
 * Rows reach the aggregate in the order of the subquery's `ORDER BY ... LIMIT`, which is newest first.
 * SQLite doesn't promise that for aggregates, so `snapshot.test.ts` checks it. The `WHERE true` is
 * what SQLite's upsert docs ask of any `INSERT ... SELECT ... ON CONFLICT`, so the parser can't take
 * `ON CONFLICT` for the `ON` of a join.
 */
export async function rebuildLatest(db: Db, now = Date.now()): Promise<void> {
  await db.run(sql`
    INSERT INTO snapshots (name, body, updated_at)
    SELECT ${LATEST},
           json_group_array(json_object(
             'id', id, 'username', username, 'content', content, 'createdAt', created_at,
             'reactionTotal', reaction_total, 'reactionTop', reaction_top)),
           ${now}
    FROM ${newestPosts(db)}
    WHERE true
    ON CONFLICT (name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
}

/**
 * The newest visible posts, newest first, from the `latest` snapshot. Before the first rebuild there is
 * no row (a fresh database, or posts written before snapshots existed), and answering "no posts" would
 * be wrong, so the same posts are read live instead: at most `LATEST_SNAPSHOT_SIZE` rows, once, until
 * the first post, delete or cron run writes the snapshot. A read never writes it, because it may be
 * on a read replica.
 */
export async function readLatest(db: Db): Promise<PostRow[]> {
  const row = await db
    .select({ body: snapshots.body })
    .from(snapshots)
    .where(eq(snapshots.name, LATEST))
    .get();
  return row === undefined ? newestPosts(db) : (JSON.parse(row.body) as PostRow[]);
}

/**
 * The posts `top24` holds: visible posts created in the last `TOP_WINDOW_S` with at least one reaction,
 * most reacted first, ties broken by the newest id, at most `TOP_SNAPSHOT_SIZE`.
 *
 * The filter is spelled as the partial index `posts_reacted` spells its own (`reaction_total > 0 AND
 * hidden = 0`), so SQLite can use it and read only posts that have reactions inside the window.
 * `top.test.ts` checks the query plan, so dropping one of the two terms fails there.
 */
export const topPosts = (db: Db, now: number) =>
  db
    .select(postRowColumns)
    .from(posts)
    .innerJoin(bots, eq(bots.id, posts.botId))
    .where(
      sql`${posts.reactionTotal} > 0 AND ${posts.hidden} = 0 AND ${posts.createdAt} > ${now - TOP_WINDOW_S * 1000}`,
    )
    .orderBy(desc(posts.reactionTotal), desc(posts.id))
    .limit(TOP_SNAPSHOT_SIZE);

/**
 * Rewrites `snapshots('top24')` with the most reacted posts of the last 24 hours, as a JSON array of
 * `PostRow`s, best first (the same row shape as `latest`, with no `url`). Built like `rebuildLatest()`:
 * one statement that reads and writes, run on the primary, so an overlapping rebuild can't put an older
 * view over a newer one.
 *
 * The aggregate carries its own `ORDER BY`, so the order is promised rather than inherited from the
 * subquery as `rebuildLatest()` does; `snapshot.test.ts` pins it all the same.
 */
export async function rebuildTop24(db: Db, now = Date.now()): Promise<void> {
  await db.run(sql`
    INSERT INTO snapshots (name, body, updated_at)
    SELECT ${TOP24},
           json_group_array(json_object(
             'id', id, 'username', username, 'content', content, 'createdAt', created_at,
             'reactionTotal', reaction_total, 'reactionTop', reaction_top)
             ORDER BY reaction_total DESC, id DESC),
           ${now}
    FROM ${topPosts(db, now)}
    WHERE true
    ON CONFLICT (name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`);
}

/**
 * The top posts, best first, from the `top24` snapshot. Before the first rebuild there is no row, and
 * answering "nothing" would be wrong, so the same posts are read live, as `readLatest()` does.
 */
export async function readTop(db: Db, now = Date.now()): Promise<PostRow[]> {
  const row = await db
    .select({ body: snapshots.body })
    .from(snapshots)
    .where(eq(snapshots.name, TOP24))
    .get();
  return row === undefined ? topPosts(db, now) : (JSON.parse(row.body) as PostRow[]);
}

export type SnapshotAges = { latest: number | null; top24: number | null };

/**
 * Seconds since each snapshot was last written, `null` for one that has no row yet. This is what an alert
 * on a stopped cron watches (`GET /health`).
 */
export async function snapshotAges(db: Db, now = Date.now()): Promise<SnapshotAges> {
  const rows = await db
    .select({ name: snapshots.name, updatedAt: snapshots.updatedAt })
    .from(snapshots);
  const age = (name: string) => {
    const row = rows.find((r) => r.name === name);
    return row === undefined ? null : Math.max(0, Math.floor((now - row.updatedAt) / 1000));
  };
  return { latest: age(LATEST), top24: age(TOP24) };
}
