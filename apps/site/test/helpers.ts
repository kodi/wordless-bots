import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { purgeLatest, rebuildAndPurgeLatest, topKey } from "../src/worker/cache.ts";
import { createPost, writeDb, type Db } from "../src/worker/db/queries.ts";
import { bots, posts, recoveryTokens, snapshots } from "../src/worker/db/schema.ts";
import type { EmailSender } from "../src/worker/email.ts";
import { generateApiKey, generateRecoveryToken } from "../src/worker/keys.ts";

type BotOverrides = Partial<
  Pick<typeof bots.$inferInsert, "lastPostAt" | "status" | "bio" | "createdAt" | "regIpHash">
>;

/** Inserts a bot with a real key. D1 state is shared within a file, so usernames must be unique. */
export async function insertBot(username: string, overrides: BotOverrides = {}) {
  const { key, hash, prefix } = await generateApiKey();
  const bot = await writeDb(env)
    .insert(bots)
    .values({
      username,
      email: `${username}@example.com`,
      emailNorm: `${username}@example.com`,
      keyHash: hash,
      keyPrefix: prefix,
      createdAt: 1_700_000_000_000,
      regIpHash: new Uint8Array([9, 9]),
      ...overrides,
    })
    .returning({ id: bots.id })
    .get();
  return { id: bot.id, key };
}

type TokenOverrides = Partial<
  Pick<typeof recoveryTokens.$inferInsert, "createdAt" | "expiresAt" | "usedAt">
>;

/** Inserts a recovery token for a bot, live for 30 minutes from `createdAt` unless told otherwise. Returns the raw token. */
export async function insertToken(botId: number, overrides: TokenOverrides = {}) {
  const { token, hash } = await generateRecoveryToken();
  const createdAt = overrides.createdAt ?? Date.now();
  await writeDb(env)
    .insert(recoveryTokens)
    .values({ tokenHash: hash, botId, createdAt, expiresAt: createdAt + 1_800_000, ...overrides });
  return token;
}

/**
 * Creates a post through `createPost()`, so the bot's counters and cooldown move as in production,
 * but with no cooldown wait, so a test can make several. Returns the post id.
 */
export async function seedPost(botId: number, content = "⚡", createdAt = Date.now()) {
  const result = await createPost(writeDb(env), { botId, content, createdAt }, 0);
  if (!result.created) throw new Error(`seedPost: ${result.reason}`);
  return result.id;
}

type PostOverrides = Partial<
  Pick<typeof posts.$inferInsert, "createdAt" | "reactionTotal" | "reactionTop" | "hidden">
>;

/**
 * Bulk-inserts posts, oldest first, and returns their ids in that order. Unlike `seedPost()` it skips
 * `createPost()`, so no bot counters or cooldowns move; use it to fill a feed. Statements are chunked
 * to stay under D1's limit of 100 bound variables.
 */
export async function insertPosts(botId: number, specs: PostOverrides[]) {
  const db = writeDb(env);
  const ids: number[] = [];
  for (let from = 0; from < specs.length; from += 12) {
    const rows = specs.slice(from, from + 12).map((spec, n) => ({
      botId,
      content: `⚡${from + n}`,
      createdAt: 1_700_000_000_000 + from + n,
      ...spec,
    }));
    const inserted = await db.insert(posts).values(rows).returning({ id: posts.id });
    ids.push(...inserted.map((row) => row.id));
  }
  return ids;
}

/** The origin `api()` calls: what the cache keys of its requests are built from. */
export const ORIGIN = "https://wordless.one";

/**
 * Empties `posts` (and their reactions), the snapshots and the cached copies of `latest` and `/top`, so a
 * test starts from an empty feed. Isolate memory and the Cache API outlive a test, and D1 doesn't hold them.
 */
export async function clearFeed() {
  const db = writeDb(env);
  await db.delete(posts);
  await db.delete(snapshots);
  await purgeLatest(ORIGIN);
  await caches.default.delete(topKey(ORIGIN));
}

/** What a post or delete does after its response: rebuild `latest`, then drop the cached copies of it. */
export function rebuild() {
  return rebuildAndPurgeLatest(writeDb(env), ORIGIN);
}

const STATEMENT_METHODS = new Set(["run", "all", "raw", "first"]);

/** Wraps a D1 object so that each statement it runs goes through `around`. */
function intercept<T extends object>(
  target: T,
  around: (run: () => Promise<unknown>) => Promise<unknown>,
): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      if (typeof value !== "function") return value;
      // `prepare()` and `bind()` give back statements, which are wrapped in turn.
      if (prop === "prepare" || prop === "bind") {
        return (...args: unknown[]) => intercept(value.apply(obj, args) as object, around);
      }
      if (typeof prop === "string" && STATEMENT_METHODS.has(prop)) {
        return (...args: unknown[]) => around(async () => value.apply(obj, args));
      }
      return value.bind(obj);
    },
  });
}

/**
 * A `Db` on the primary whose answers arrive `ms` late, like calls from a far colo. D1 runs statements
 * in the order they arrive, so equal latencies hide races between a read and a later write; this makes
 * the gap between them wide.
 */
export function lateDb(ms: number): Db {
  return drizzle(
    intercept(env.DB, async (run) => {
      const result = await run();
      await new Promise((resolve) => setTimeout(resolve, ms));
      return result;
    }),
  );
}

/**
 * A `Db` on the primary whose statements wait for `release()` before they run, like a write that lands
 * after the request has already moved on. `lateDb()` delays only the answer, so its write has landed by
 * the time anything else happens; this holds the statement itself back, so a test can say what happens
 * in the gap before it lands.
 */
export function gatedDb(): { db: Db; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const db = drizzle(
    intercept(env.DB, async (run) => {
      await gate;
      return run();
    }),
  );
  return { db, release };
}

let ipCounter = 0;

/** A fresh address per call, so signups in one test file don't share a `POST /register` IP bucket. */
export function nextIp() {
  ipCounter += 1;
  return `10.0.${ipCounter >> 8}.${ipCounter & 255}`;
}

export function api(path: string, init: RequestInit & { key?: string; json?: unknown } = {}) {
  const { key, json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (key !== undefined) headers.set("Authorization", `Bearer ${key}`);
  if (json !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(`https://wordless.one/api/v1${path}`, {
    ...rest,
    headers,
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
}

export type SentMail = { to: string; subject: string; text: string; html: string };

/** An `EmailSender` that keeps what it was asked to send. `fail` makes the next sends reject. */
export function fakeEmail() {
  const sent: SentMail[] = [];
  const state = { fail: false };
  const sender: EmailSender = {
    async send(to, subject, text, html) {
      if (state.fail) throw new Error(`refused for ${to}`);
      sent.push({ to, subject, text, html });
    },
  };
  return { sender, sent, state };
}

/** The recovery token in a mail's link (`/recover#t=<token>`). */
export function tokenIn(mail: SentMail): string {
  const token = /\/recover#t=([0-9A-Za-z]+)/.exec(mail.text)?.[1];
  if (token === undefined) throw new Error("no recovery link in the mail");
  return token;
}
