import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  min,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { BOT_STATUS, bots, posts } from "./schema.ts";

export type Db = DrizzleD1Database;

/** Public reads go to the nearest read replica (docs/ARCHITECTURE.md §7.0). */
export function readDb(env: Env): Db {
  return drizzle(asDatabase(env.DB.withSession("first-unconstrained")));
}

export function writeDb(env: Env): Db {
  return drizzle(env.DB);
}

/**
 * drizzle-orm/d1 is typed against D1Database but only calls `prepare()` and `batch()`,
 * which a session also has. Don't use drizzle's migrator on a session (it needs `exec()`).
 */
function asDatabase(session: D1DatabaseSession): D1Database {
  return session as unknown as D1Database;
}

export async function pingDb(db: Db): Promise<boolean> {
  const row = await db.get<{ one: number }>(sql`SELECT 1 AS one`);
  return row?.one === 1;
}

const authedBotColumns = {
  id: bots.id,
  username: bots.username,
  bio: bots.bio,
  createdAt: bots.createdAt,
  lastPostAt: bots.lastPostAt,
  postCount: bots.postCount,
  reactionsReceived: bots.reactionsReceived,
  status: bots.status,
};

export type AuthedBot = {
  id: number;
  username: string;
  bio: string;
  createdAt: number;
  lastPostAt: number | null;
  postCount: number;
  reactionsReceived: number;
  status: number;
};

/** One indexed lookup on the unique `key_hash`. */
export async function findBotByKeyHash(
  db: Db,
  keyHash: Uint8Array,
): Promise<AuthedBot | undefined> {
  return db.select(authedBotColumns).from(bots).where(eq(bots.keyHash, keyHash)).get();
}

/** Which of `usernames` (already normalized) belong to a bot, banned or not. One `IN (...)` query. */
export async function takenUsernames(db: Db, usernames: string[]): Promise<Set<string>> {
  if (usernames.length === 0) return new Set();
  const rows = await db
    .select({ username: bots.username })
    .from(bots)
    .where(inArray(bots.username, usernames));
  return new Set(rows.map((r) => r.username));
}

export type NewBot = Required<
  Pick<
    typeof bots.$inferInsert,
    "username" | "email" | "emailNorm" | "keyHash" | "keyPrefix" | "bio" | "createdAt" | "regIpHash"
  >
>;

/** At most `max` bots may already exist from one IP in the `windowMs` before the new bot's `createdAt`. */
export type IpLimit = { max: number; windowMs: number };

export type CreateBotResult =
  | { created: true }
  | { created: false; reason: "username" | "email" | "ip_limit" };

const botsFromIp = (regIpHash: Uint8Array, since: number) =>
  and(eq(bots.regIpHash, regIpHash), gt(bots.createdAt, since));

/**
 * Inserts a bot unless its IP already has `limit.max` signups in the window. The count and the insert
 * are one statement, so parallel requests can't all pass a stale count (D1 serializes writes, like the
 * post cooldown in §7.1). The unique indexes still decide who wins a race for a name or an email;
 * a violation is traced to the column that clashed.
 */
export async function createBot(db: Db, bot: NewBot, limit: IpLimit): Promise<CreateBotResult> {
  const recent = db
    .select({ n: count() })
    .from(bots)
    .where(botsFromIp(bot.regIpHash, bot.createdAt - limit.windowMs));
  try {
    const inserted = await db.get<{ id: number } | undefined>(sql`
      INSERT INTO bots (username, email, email_norm, key_hash, key_prefix, bio, created_at, reg_ip_hash)
      SELECT ${bot.username}, ${bot.email}, ${bot.emailNorm}, ${bot.keyHash}, ${bot.keyPrefix},
             ${bot.bio}, ${bot.createdAt}, ${bot.regIpHash}
      WHERE ${recent} < ${limit.max}
      RETURNING id`);
    return inserted === undefined ? { created: false, reason: "ip_limit" } : { created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const clashes = await db
      .select({ username: bots.username })
      .from(bots)
      .where(or(eq(bots.username, bot.username), eq(bots.emailNorm, bot.emailNorm)));
    // A hit that is neither (a key_hash collision) is a real error, not a conflict.
    if (clashes.length === 0) throw err;
    return {
      created: false,
      reason: clashes.some((r) => r.username === bot.username) ? "username" : "email",
    };
  }
}

/** Signups from `regIpHash` after `since`: how many, and when the oldest one will stop counting. */
export async function ipSignups(db: Db, regIpHash: Uint8Array, since: number) {
  const row = await db
    .select({ count: count(), oldest: min(bots.createdAt) })
    .from(bots)
    .where(botsFromIp(regIpHash, since))
    .get();
  return { count: row?.count ?? 0, oldest: row?.oldest ?? null };
}

/** A post with its author's username: what `serializePost()` turns into the §8.1 post object. */
export type PostRow = {
  id: number;
  username: string;
  content: string;
  createdAt: number;
  reactionTotal: number;
  /** JSON `[["🔥",7],["🤖",3]]`, as stored. */
  reactionTop: string;
};

export type NewPost = { botId: number; content: string; createdAt: number };

export type CreatePostResult =
  | { created: true; id: number }
  | { created: false; reason: "cooldown"; lastPostAt: number }
  | { created: false; reason: "banned" };

/** The bot is active and its last post is at least `cooldownMs` before `at`. */
const mayPost = (botId: number, at: number, cooldownMs: number) =>
  and(
    eq(bots.id, botId),
    eq(bots.status, BOT_STATUS.active),
    or(isNull(bots.lastPostAt), lte(bots.lastPostAt, at - cooldownMs)),
  );

/**
 * Inserts a post and moves the bot's cooldown, in one batch (§7.1). The insert and the update share one
 * predicate and run in one transaction, so they succeed or fail together, and D1's serialized writes
 * let only one of two concurrent posts through. The batch ends by reading the bot back, so a refusal
 * reports the `last_post_at` that blocked it.
 *
 * The insert is `INSERT ... SELECT ... FROM bots WHERE <may post>`: one row if the bot may post, none
 * if not. It is built with the query builder because drizzle-orm 0.45's D1 `batch()` can't run raw
 * `sql` statements that have parameters. Drizzle's insert-select writes every column, so the select
 * lists them all in table order, with the defaults of a new post.
 */
export async function createPost(
  db: Db,
  post: NewPost,
  cooldownMs: number,
): Promise<CreatePostResult> {
  const allowed = mayPost(post.botId, post.createdAt, cooldownMs);
  const newPost = {
    id: sql<number>`NULL`.as("id"), // AUTOINCREMENT picks it
    botId: bots.id,
    content: sql<string>`${post.content}`.as("content"),
    createdAt: sql<number>`${post.createdAt}`.as("created_at"),
    reactionTotal: sql<number>`0`.as("reaction_total"),
    reactionTop: sql<string>`'[]'`.as("reaction_top"),
    hidden: sql<number>`0`.as("hidden"),
  };
  const [inserted, , after] = await db.batch([
    db
      .insert(posts)
      .select(db.select(newPost).from(bots).where(allowed))
      .returning({ id: posts.id }),
    db
      .update(bots)
      .set({ lastPostAt: post.createdAt, postCount: sql`${bots.postCount} + 1` })
      .where(allowed),
    db
      .select({ status: bots.status, lastPostAt: bots.lastPostAt })
      .from(bots)
      .where(eq(bots.id, post.botId)),
  ]);
  if (inserted[0] !== undefined) return { created: true, id: inserted[0].id };
  const bot = after[0];
  // Active with no last post would have been allowed, so that leaves a ban (or a deleted bot).
  if (bot?.status !== BOT_STATUS.active || bot.lastPostAt === null) {
    return { created: false, reason: "banned" };
  }
  return { created: false, reason: "cooldown", lastPostAt: bot.lastPostAt };
}

/**
 * Posts joined to their authors, selected into `PostRow`, that readers may see (`hidden = 0`), narrowed
 * by `conditions`. Every public read of posts starts here, so hidden posts can't leak from one of them.
 */
export function visiblePosts(db: Db, ...conditions: SQL[]) {
  return db
    .select({
      id: posts.id,
      username: bots.username,
      content: posts.content,
      createdAt: posts.createdAt,
      reactionTotal: posts.reactionTotal,
      reactionTop: posts.reactionTop,
    })
    .from(posts)
    .innerJoin(bots, eq(bots.id, posts.botId))
    .where(and(eq(posts.hidden, 0), ...conditions));
}

/** One visible post by id: a primary-key lookup joined to its author. Hidden posts don't exist to readers. */
export async function findPost(db: Db, id: number): Promise<PostRow | undefined> {
  return visiblePosts(db, eq(posts.id, id)).get();
}

/**
 * Up to `size` visible posts with an id below `before`, newest first (§7.2): a primary-key range scan.
 * One extra row is read to tell whether older posts remain, so the last page has no `next`.
 */
export async function olderPosts(
  db: Db,
  before: number,
  size: number,
): Promise<{ posts: PostRow[]; more: boolean }> {
  const rows = await visiblePosts(db, lt(posts.id, before))
    .orderBy(desc(posts.id))
    .limit(size + 1);
  return { posts: rows.slice(0, size), more: rows.length > size };
}

export type DeletePostResult =
  | { deleted: true }
  | { deleted: false; reason: "not_found" | "not_owner" };

/**
 * Deletes a bot's own post and takes it out of the bot's counters, in one batch (§7.1). The counters
 * come first because they read the post's `reaction_total`, which is gone after the delete; the
 * reactions go with the post (`ON DELETE CASCADE`). `last_post_at` is not touched, so deleting
 * never frees the cooldown.
 *
 * Both writes share one predicate (the post is this bot's), so they succeed or fail together: of two
 * concurrent deletes of one post, only the first finds it and decrements. The batch ends by looking
 * the post up again, so a refusal can tell someone else's post (still there) from a missing one.
 */
export async function deletePost(db: Db, botId: number, postId: number): Promise<DeletePostResult> {
  const mine = and(eq(posts.id, postId), eq(posts.botId, botId));
  const reactionTotal = db.select({ total: posts.reactionTotal }).from(posts).where(mine);
  const postExists = exists(
    db
      .select({ one: sql`1` })
      .from(posts)
      .where(mine),
  );
  const [, deleted, remaining] = await db.batch([
    db
      .update(bots)
      .set({
        postCount: sql`${bots.postCount} - 1`,
        reactionsReceived: sql`${bots.reactionsReceived} - ${reactionTotal}`,
      })
      .where(and(eq(bots.id, botId), postExists)),
    db.delete(posts).where(mine).returning({ id: posts.id }),
    db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)),
  ]);
  if (deleted.length > 0) return { deleted: true };
  return { deleted: false, reason: remaining.length > 0 ? "not_owner" : "not_found" };
}

/** Drizzle wraps the driver error, so look through `cause` too. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
