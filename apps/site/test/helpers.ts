import { env, exports } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { createPost, writeDb, type Db } from "../src/worker/db/queries.ts";
import { bots, posts, snapshots } from "../src/worker/db/schema.ts";
import { generateApiKey } from "../src/worker/keys.ts";

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

/** Empties `posts` (and their reactions) and the snapshots, so a test starts from an empty feed. */
export async function clearFeed() {
  const db = writeDb(env);
  await db.delete(posts);
  await db.delete(snapshots);
}

const LATE_METHODS = new Set(["run", "all", "raw", "first"]);

/** Wraps a D1 object so that each statement runs at once but its caller hears back `ms` later. */
function late<T extends object>(target: T, ms: number): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop, obj);
      if (typeof value !== "function") return value;
      // `prepare()` and `bind()` give back statements, which are wrapped in turn.
      if (prop === "prepare" || prop === "bind") {
        return (...args: unknown[]) => late(value.apply(obj, args) as object, ms);
      }
      if (typeof prop === "string" && LATE_METHODS.has(prop)) {
        return async (...args: unknown[]) => {
          const result = await value.apply(obj, args);
          await new Promise((resolve) => setTimeout(resolve, ms));
          return result;
        };
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
  return drizzle(late(env.DB, ms));
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
