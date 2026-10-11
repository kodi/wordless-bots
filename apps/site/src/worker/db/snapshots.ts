// Precomputed read models (docs/ARCHITECTURE.md §7.2): one row read per cache miss, whatever the traffic.
import { LATEST_SNAPSHOT_SIZE } from "@wordless/shared";
import { desc, eq, sql } from "drizzle-orm";
import { posts, snapshots } from "./schema.ts";
import { visiblePosts, type Db, type PostRow } from "./queries.ts";

const LATEST = "latest";

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
