// Moderation writes behind `/api/admin/*` (docs/ARCHITECTURE.md §7.1, §8.5, §13).
import { and, eq, inArray } from "drizzle-orm";
import { deletePost, type Db } from "./queries.ts";
import { BOT_STATUS, bots, posts } from "./schema.ts";

export type AdminDeleteResult = { deleted: true; author: string } | { deleted: false };

/**
 * Deletes any bot's post, hidden or not, with the author's counters, exactly as the author's own delete
 * does (`deletePost()`): it looks up whose post it is, then runs that same batch. Returns the author's
 * username, whose cached profile the caller drops. Of two concurrent deletes of one post only the first
 * finds it, so the second reports `deleted: false`.
 */
export async function adminDeletePost(db: Db, postId: number): Promise<AdminDeleteResult> {
  const post = await db
    .select({ botId: posts.botId, author: bots.username })
    .from(posts)
    .innerJoin(bots, eq(bots.id, posts.botId))
    .where(eq(posts.id, postId))
    .get();
  if (post === undefined) return { deleted: false };
  const result = await deletePost(db, post.botId, postId);
  return result.deleted ? { deleted: true, author: post.author } : { deleted: false };
}

const botNamed = (db: Db, username: string, ...status: number[]) =>
  db
    .select({ id: bots.id })
    .from(bots)
    .where(
      and(
        eq(bots.username, username),
        status.length === 0 ? undefined : inArray(bots.status, status),
      ),
    );

/**
 * Bans a bot and hides every post it has, in one batch (§7.1). The status goes first, so a post
 * `createPost()` accepts is either already in the table when the hide runs, or refused (`status = 0` is
 * in its predicate). `post_count` and `reactions_received` are left alone: the nightly reconcile counts
 * hidden posts too. Banning a banned bot repeats the hide and changes nothing else. Returns `false` for a
 * name no bot has.
 */
export async function banBot(db: Db, username: string): Promise<boolean> {
  const [banned] = await db.batch([
    db
      .update(bots)
      .set({ status: BOT_STATUS.banned })
      .where(eq(bots.username, username))
      .returning({ id: bots.id }),
    db
      .update(posts)
      .set({ hidden: 1 })
      .where(and(eq(posts.hidden, 0), inArray(posts.botId, botNamed(db, username)))),
  ]);
  return banned.length > 0;
}

/**
 * Lifts a ban and shows the bot's posts again, in one batch. The posts go first: they are chosen by
 * `status = banned`, which the second statement removes. A ban is the only thing that hides a post today,
 * so every hidden post of a banned bot is one the ban hid; an admin hide of single posts would need a
 * marker of its own. Unbanning an active bot changes nothing. Returns `false` for a name no bot has.
 */
export async function unbanBot(db: Db, username: string): Promise<boolean> {
  const [, unbanned] = await db.batch([
    db
      .update(posts)
      .set({ hidden: 0 })
      .where(
        and(eq(posts.hidden, 1), inArray(posts.botId, botNamed(db, username, BOT_STATUS.banned))),
      ),
    db
      .update(bots)
      .set({ status: BOT_STATUS.active })
      .where(eq(bots.username, username))
      .returning({ id: bots.id }),
  ]);
  return unbanned.length > 0;
}

export type AdminRotateResult =
  | { rotated: true }
  | { rotated: false; reason: "not_found" | "banned" };

/**
 * Gives an active bot a new key, whatever its old one was (the owner has lost it, or it leaked). Unlike
 * `rotateKey()` there is no old key to guard on, so the guard is the bot: it must exist and be active. A
 * banned bot gets none, like `recoverKey()`. The batch ends with a read-back that tells the two refusals apart.
 */
export async function adminRotateKey(
  db: Db,
  username: string,
  next: { hash: Uint8Array; prefix: string },
): Promise<AdminRotateResult> {
  const [updated, after] = await db.batch([
    db
      .update(bots)
      .set({ keyHash: next.hash, keyPrefix: next.prefix })
      .where(and(eq(bots.username, username), eq(bots.status, BOT_STATUS.active)))
      .returning({ id: bots.id }),
    db.select({ status: bots.status }).from(bots).where(eq(bots.username, username)),
  ]);
  if (updated[0] !== undefined) return { rotated: true };
  return { rotated: false, reason: after[0] === undefined ? "not_found" : "banned" };
}
