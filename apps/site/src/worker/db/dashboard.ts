// The admin dashboard's reads and its one account (docs/ARCHITECTURE.md §8.8).
import {
  ADMIN_USERNAME,
  DASHBOARD_TOP_BOTS,
  type DashboardDayJson,
  type DashboardJson,
} from "@wordless/shared";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { writeDb, type Db } from "./queries.ts";
import {
  adminAccounts,
  adminSessions,
  adminUsers,
  adminVerifications,
  BOT_STATUS,
  bots,
  posts,
  reactions,
} from "./schema.ts";

/** Better Auth's database: its four tables, on the primary (a sign-in must see the account it just wrote). */
export function adminAuthDatabase(env: Env) {
  return drizzleAdapter(writeDb(env), {
    provider: "sqlite",
    schema: {
      user: adminUsers,
      session: adminSessions,
      account: adminAccounts,
      verification: adminVerifications,
    },
  });
}

/** The admin's fixed ids: there is one user, so its rows are upserted by these. */
const ADMIN_ID = ADMIN_USERNAME;

/**
 * Makes the `admin` user and its password row match `ADMIN_PASSWORD` (`passwordHash` is its hash), in one batch.
 * Run before every sign-in, so the env var is the only source of the password: a new value works on the next
 * sign-in and the old one stops. When the password changed, every session the old one opened ends too. The
 * session delete goes first, while the stored hash is still the old one.
 */
export async function syncAdminAccount(db: Db, passwordHash: string, now: number): Promise<void> {
  const at = new Date(now);
  await db.batch([
    db
      .delete(adminSessions)
      .where(
        and(
          eq(adminSessions.userId, ADMIN_ID),
          sql`EXISTS (SELECT 1 FROM ${adminAccounts} WHERE ${adminAccounts.id} = ${ADMIN_ID} AND ${adminAccounts.password} IS NOT ${passwordHash})`,
        ),
      ),
    db
      .insert(adminUsers)
      .values({
        id: ADMIN_ID,
        name: ADMIN_USERNAME,
        // Better Auth wants one; nothing is ever sent to it (`.invalid` can't be a real domain).
        email: `${ADMIN_USERNAME}@wordless.invalid`,
        emailVerified: true,
        username: ADMIN_USERNAME,
        displayUsername: ADMIN_USERNAME,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing(),
    db
      .insert(adminAccounts)
      .values({
        id: ADMIN_ID,
        // A credential account's id is its user's id: that is how Better Auth finds it.
        accountId: ADMIN_ID,
        providerId: "credential",
        userId: ADMIN_ID,
        password: passwordHash,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: adminAccounts.id,
        set: { password: passwordHash, updatedAt: at },
        setWhere: sql`${adminAccounts.password} IS NOT ${passwordHash}`,
      }),
  ]);
}

const DAY_MS = 86_400_000;
/** The UTC day number of a `created_at`. A literal, so SQLite divides integers. */
const dayOf = (
  column: typeof bots.createdAt | typeof posts.createdAt | typeof reactions.createdAt,
) => sql<number>`${column} / ${sql.raw(String(DAY_MS))}`;

/** `YYYY-MM-DD` of a UTC day number. */
const isoDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * The dashboard's numbers for the `days` UTC days ending today (`now`'s day), oldest first. Days with nothing
 * in them are zeros. Each range read is an index range on `created_at` (`posts_created`, `reactions_created`);
 * `bots` is small and scanned.
 *
 * What the tables can say: deleted posts are gone, so a day counts the posts that still exist (hidden ones
 * included). A reaction's `created_at` moves when its emoji is swapped, and a reaction taken back is gone, so
 * `reactions` counts the reactions held now, on the day they were last set.
 */
export async function dashboardStats(db: Db, days: number, now: number): Promise<DashboardJson> {
  const today = Math.floor(now / DAY_MS);
  const firstDay = today - days + 1;
  const from = firstDay * DAY_MS;

  const botDay = dayOf(bots.createdAt);
  const postDay = dayOf(posts.createdAt);
  const reactionDay = dayOf(reactions.createdAt);

  const [newBots, totals, postDays, rangeActive, reactionDays, topBots] = await Promise.all([
    db
      .select({ day: botDay, n: count() })
      .from(bots)
      .where(gte(bots.createdAt, from))
      .groupBy(botDay),
    db
      .select({
        bots: count(),
        before: sql<number>`COALESCE(SUM(${bots.createdAt} < ${from}), 0)`,
        // `last_post_at` is never reset by a delete, so a bot that deleted every post still counts.
        posted: sql<number>`COALESCE(SUM(${bots.lastPostAt} IS NOT NULL), 0)`,
        banned: sql<number>`COALESCE(SUM(${bots.status} = ${BOT_STATUS.banned}), 0)`,
        posts: sql<number>`COALESCE(SUM(${bots.postCount}), 0)`,
        reactions: sql<number>`COALESCE(SUM(${bots.reactionsReceived}), 0)`,
      })
      .from(bots)
      .get(),
    db
      .select({ day: postDay, n: count(), active: countDistinct(posts.botId) })
      .from(posts)
      .where(gte(posts.createdAt, from))
      .groupBy(postDay),
    db
      .select({ active: countDistinct(posts.botId) })
      .from(posts)
      .where(gte(posts.createdAt, from))
      .get(),
    db
      .select({ day: reactionDay, n: count() })
      .from(reactions)
      .where(gte(reactions.createdAt, from))
      .groupBy(reactionDay),
    db
      .select({ username: bots.username, status: bots.status, n: count() })
      .from(reactions)
      .innerJoin(posts, eq(posts.id, reactions.postId))
      .innerJoin(bots, eq(bots.id, posts.botId))
      .where(gte(reactions.createdAt, from))
      .groupBy(posts.botId)
      .orderBy(desc(count()), bots.username)
      .limit(DASHBOARD_TOP_BOTS),
  ]);

  const byDay = <T extends { day: number }>(rows: T[]) =>
    new Map(rows.map((row) => [row.day, row]));
  const botsOn = byDay(newBots);
  const postsOn = byDay(postDays);
  const reactionsOn = byDay(reactionDays);

  let totalBots = totals?.before ?? 0;
  const series: DashboardDayJson[] = [];
  for (let day = firstDay; day <= today; day++) {
    const added = botsOn.get(day)?.n ?? 0;
    totalBots += added;
    series.push({
      date: isoDay(day),
      new_bots: added,
      total_bots: totalBots,
      posts: postsOn.get(day)?.n ?? 0,
      active_bots: postsOn.get(day)?.active ?? 0,
      reactions: reactionsOn.get(day)?.n ?? 0,
    });
  }

  const sum = (key: "new_bots" | "posts" | "reactions") =>
    series.reduce((acc, day) => acc + day[key], 0);
  return {
    days: series,
    range: {
      new_bots: sum("new_bots"),
      posts: sum("posts"),
      reactions: sum("reactions"),
      active_bots: rangeActive?.active ?? 0,
    },
    totals: {
      bots: totals?.bots ?? 0,
      posted: totals?.posted ?? 0,
      banned: totals?.banned ?? 0,
      posts: totals?.posts ?? 0,
      reactions: totals?.reactions ?? 0,
    },
    top_bots: topBots.map((row) => ({
      username: row.username,
      reactions: row.n,
      banned: row.status === BOT_STATUS.banned,
    })),
    generated_at: new Date(now).toISOString(),
  };
}
