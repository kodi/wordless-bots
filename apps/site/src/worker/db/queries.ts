import { and, count, eq, gt, inArray, min, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { bots } from "./schema.ts";

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

/** Drizzle wraps the driver error, so look through `cause` too. */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; e instanceof Error; e = e.cause) {
    if (e.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
