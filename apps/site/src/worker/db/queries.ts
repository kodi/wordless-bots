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
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { REACTION_TOP_SIZE } from "@wordless/shared";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { BOT_STATUS, bots, posts, reactions } from "./schema.ts";

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

/** A post's stored reaction counters: what the `reactions` of the §8.1 post object is made from. */
export type ReactionCounts = { reactionTotal: number; reactionTop: string };

export type ReactResult =
  /** `changed` is false when the bot had already sent this emoji: nothing was written. */
  | ({ ok: true; changed: boolean } & ReactionCounts)
  | { ok: false; reason: "banned" | "not_found" | "self_reaction" }
  /** `oldest`: when the oldest reaction in the window was sent, the first to age out and free a slot. */
  | { ok: false; reason: "rate_limited"; oldest: number };

export type UnreactResult =
  | ({ ok: true; changed: boolean } & ReactionCounts)
  | { ok: false; reason: "banned" | "not_found" };

/** `posts.reaction_total` and `reaction_top` of one post, recomputed from its `reactions` rows. */
function recountReactions(db: Db, postId: number) {
  const total = db.select({ n: count() }).from(reactions).where(eq(reactions.postId, postId));
  const perEmoji = db
    .select({ emoji: reactions.emoji, c: count().as("c") })
    .from(reactions)
    .where(eq(reactions.postId, postId))
    .groupBy(reactions.emoji)
    .orderBy(desc(sql`c`), reactions.emoji)
    .limit(REACTION_TOP_SIZE)
    .as("per_emoji");
  const top = db
    .select({
      top: sql<string>`COALESCE(json_group_array(json_array(${perEmoji.emoji}, ${perEmoji.c})), '[]')`,
    })
    .from(perEmoji);
  return db
    .update(posts)
    .set({ reactionTotal: sql`${total}`, reactionTop: sql`${top}` })
    .where(eq(posts.id, postId));
}

/**
 * Sends `emoji` as the bot's reaction to a post (§7.1): a new reaction, or a swap of the one it had.
 * One batch, like `createPost()`:
 *
 * 1. the author's `reactions_received` + 1, only if the bot has no reaction here yet. New versus swap
 *    is decided in SQL, not from a read before the batch, so two parallel first reactions from one bot
 *    can't both count as new. It goes first because the upsert changes what it looks at;
 * 2. the upsert, which also refreshes `created_at`, so a swap costs a quota slot only if the old row
 *    had aged out of the window;
 * 3. the post's `reaction_total` and `reaction_top`, recomputed from its rows (derived data, so it is
 *    safe to rewrite even when nothing above changed);
 * 4. read-backs, which tell a refusal's reason and give the counts for the `200`.
 *
 * Steps 1 and 2 share one predicate: the bot is active, the post is visible and isn't the bot's own,
 * and the bot's other reactions inside the window number fewer than `limit.max`. "Other" leaves the
 * row being replaced out, so a bot at the limit can still change an emoji it sent a minute ago. Step 2
 * also skips a row that already holds `emoji`, so repeating a reaction writes nothing and uses no quota.
 */
export async function reactToPost(
  db: Db,
  reaction: { botId: number; postId: number; emoji: string; createdAt: number },
  limit: { max: number; windowMs: number },
): Promise<ReactResult> {
  const { botId, postId, emoji, createdAt } = reaction;
  const since = createdAt - limit.windowMs;
  const othersInWindow = db
    .select({ n: count() })
    .from(reactions)
    .where(
      and(eq(reactions.botId, botId), ne(reactions.postId, postId), gt(reactions.createdAt, since)),
    );
  const mine = (...conditions: SQL[]) =>
    and(eq(reactions.postId, postId), eq(reactions.botId, botId), ...conditions);
  const allowed = [
    exists(
      db
        .select({ one: sql`1` })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.hidden, 0), ne(posts.botId, botId))),
    ),
    sql`${othersInWindow} < ${limit.max}`,
  ];
  const isActive = and(eq(bots.id, botId), eq(bots.status, BOT_STATUS.active));
  const author = db.select({ id: posts.botId }).from(posts).where(eq(posts.id, postId));
  const hasRow = db
    .select({ one: sql`1` })
    .from(reactions)
    .where(mine());
  const hasSameEmoji = db
    .select({ one: sql`1` })
    .from(reactions)
    .where(mine(eq(reactions.emoji, emoji)));

  const [, upserted, , postRows, botRows, ownRows, windowRows] = await db.batch([
    db
      .update(bots)
      .set({ reactionsReceived: sql`${bots.reactionsReceived} + 1` })
      .where(
        and(
          sql`${bots.id} = ${author}`,
          notExists(hasRow),
          exists(
            db
              .select({ one: sql`1` })
              .from(bots)
              .where(isActive),
          ),
          ...allowed,
        ),
      ),
    db
      .insert(reactions)
      .select(
        db
          .select({
            postId: sql<number>`${postId}`.as("post_id"),
            botId: bots.id,
            emoji: sql<string>`${emoji}`.as("emoji"),
            createdAt: sql<number>`${createdAt}`.as("created_at"),
          })
          .from(bots)
          .where(and(isActive, notExists(hasSameEmoji), ...allowed)),
      )
      .onConflictDoUpdate({
        target: [reactions.postId, reactions.botId],
        set: { emoji: sql`excluded.emoji`, createdAt: sql`excluded.created_at` },
      })
      .returning({ postId: reactions.postId }),
    recountReactions(db, postId),
    db
      .select({
        authorId: posts.botId,
        reactionTotal: posts.reactionTotal,
        reactionTop: posts.reactionTop,
      })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.hidden, 0))),
    db.select({ status: bots.status }).from(bots).where(eq(bots.id, botId)),
    db.select({ emoji: reactions.emoji }).from(reactions).where(mine()),
    db
      .select({ oldest: min(reactions.createdAt) })
      .from(reactions)
      .where(
        and(
          eq(reactions.botId, botId),
          ne(reactions.postId, postId),
          gt(reactions.createdAt, since),
        ),
      ),
  ]);
  const post = postRows[0];
  if (botRows[0]?.status !== BOT_STATUS.active) return { ok: false, reason: "banned" };
  if (post === undefined) return { ok: false, reason: "not_found" };
  if (post.authorId === botId) return { ok: false, reason: "self_reaction" };
  if (ownRows[0]?.emoji === emoji) {
    return {
      ok: true,
      changed: upserted.length > 0,
      reactionTotal: post.reactionTotal,
      reactionTop: post.reactionTop,
    };
  }
  // Nothing else refuses a visible post to an active bot, so the window is full.
  const oldest = windowRows[0]?.oldest;
  if (oldest === null || oldest === undefined) throw new Error("reaction refused with room left");
  return { ok: false, reason: "rate_limited", oldest };
}

/**
 * Takes back the bot's reaction to a post (§7.1), in one batch like `reactToPost()`: the author's
 * `reactions_received` - 1 (only if the row exists, so it goes first), the delete, the recount, then
 * read-backs. The two writes share a predicate: the bot is active and the post is visible. There being no
 * reaction to take back isn't a refusal: it ends as `ok` with the current counts and `changed: false`.
 */
export async function unreactToPost(db: Db, botId: number, postId: number): Promise<UnreactResult> {
  const mine = and(eq(reactions.postId, postId), eq(reactions.botId, botId));
  const allowed = [
    exists(
      db
        .select({ one: sql`1` })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.hidden, 0))),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(bots)
        .where(and(eq(bots.id, botId), eq(bots.status, BOT_STATUS.active))),
    ),
  ];
  const author = db.select({ id: posts.botId }).from(posts).where(eq(posts.id, postId));
  const [, deleted, , postRows, botRows] = await db.batch([
    db
      .update(bots)
      .set({ reactionsReceived: sql`${bots.reactionsReceived} - 1` })
      .where(
        and(
          sql`${bots.id} = ${author}`,
          exists(
            db
              .select({ one: sql`1` })
              .from(reactions)
              .where(mine),
          ),
          ...allowed,
        ),
      ),
    db
      .delete(reactions)
      .where(and(mine, ...allowed))
      .returning({ postId: reactions.postId }),
    recountReactions(db, postId),
    db
      .select({ reactionTotal: posts.reactionTotal, reactionTop: posts.reactionTop })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.hidden, 0))),
    db.select({ status: bots.status }).from(bots).where(eq(bots.id, botId)),
  ]);
  if (botRows[0]?.status !== BOT_STATUS.active) return { ok: false, reason: "banned" };
  const post = postRows[0];
  if (post === undefined) return { ok: false, reason: "not_found" };
  return { ok: true, changed: deleted.length > 0, ...post };
}

/** Drizzle wraps the driver error, so look through `cause` too. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
