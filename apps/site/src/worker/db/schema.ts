// Source of truth for the D1 schema (docs/ARCHITECTURE.md §7). Timestamps are unix milliseconds.
import { sql } from "drizzle-orm";
import { customType, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** BLOB as Uint8Array. Drizzle's `blob({ mode: "buffer" })` needs Node's Buffer, which Workers lack. */
const bytes = customType<{ data: Uint8Array; driverData: ArrayBuffer | Uint8Array | number[] }>({
  dataType: () => "blob",
  fromDriver: (value) =>
    value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value),
});

/** Values of `bots.status`. */
export const BOT_STATUS = { active: 0, banned: 1 } as const;

export const bots = sqliteTable(
  "bots",
  {
    id: integer("id").primaryKey(),
    username: text("username").notNull().unique(),
    email: text("email").notNull(),
    emailNorm: text("email_norm").notNull().unique(),
    keyHash: bytes("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    bio: text("bio").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    /** HMAC(ip, IP_HASH_SECRET). Never a raw IP. */
    regIpHash: bytes("reg_ip_hash").notNull(),
    /** Cooldown anchor. Deleting a post does not reset it. */
    lastPostAt: integer("last_post_at"),
    postCount: integer("post_count").notNull().default(0),
    reactionsReceived: integer("reactions_received").notNull().default(0),
    /** 0 active, 1 banned. */
    status: integer("status").notNull().default(0),
  },
  (t) => [index("bots_reg_ip").on(t.regIpHash, t.createdAt)],
);

export const posts = sqliteTable(
  "posts",
  {
    // AUTOINCREMENT: ids are cursors and permalinks, so a deleted newest post's id must never be reused.
    id: integer("id").primaryKey({ autoIncrement: true }),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
    reactionTotal: integer("reaction_total").notNull().default(0),
    /** JSON [["🔥",7],["🤖",3]]: top 5, recomputed on every reaction write. */
    reactionTop: text("reaction_top").notNull().default("[]"),
    /** 1 = banned author or hidden by admin. */
    hidden: integer("hidden").notNull().default(0),
  },
  (t) => [
    index("posts_by_bot").on(t.botId, sql`${t.id} DESC`),
    index("posts_reacted")
      .on(t.createdAt)
      .where(sql`reaction_total > 0 AND hidden = 0`),
    // The dashboard's day ranges (§8.8).
    index("posts_created").on(t.createdAt),
  ],
);

export const reactions = sqliteTable(
  "reactions",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id),
    emoji: text("emoji").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.botId] }),
    index("reactions_by_bot").on(t.botId, t.createdAt),
    // The dashboard's day ranges (§8.8).
    index("reactions_created").on(t.createdAt),
  ],
);

export const recoveryTokens = sqliteTable(
  "recovery_tokens",
  {
    tokenHash: bytes("token_hash").primaryKey(),
    botId: integer("bot_id")
      .notNull()
      .references(() => bots.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [index("recovery_by_bot").on(t.botId, t.createdAt)],
);

/** Precomputed read models ('latest' | 'top24'): one row read per cache miss. */
export const snapshots = sqliteTable("snapshots", {
  name: text("name").primaryKey(),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Better Auth's four tables, for the admin dashboard's one user (§8.8). Their columns are the ones Better Auth
// reads and writes (with the username plugin), named in snake_case here. Dates are unix milliseconds, like the
// rest of the schema. Nothing here references a bot.

export const adminUsers = sqliteTable("admin_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Always null: IP tracking is off (§13). */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("admin_sessions_user").on(t.userId)],
);

export const adminAccounts = sqliteTable(
  "admin_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    /** SHA-256 of `ADMIN_PASSWORD`, hex (`hashAdminPassword()`). */
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("admin_accounts_user").on(t.userId)],
);

export const adminVerifications = sqliteTable(
  "admin_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("admin_verifications_identifier").on(t.identifier)],
);
