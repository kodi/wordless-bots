import { env, exports } from "cloudflare:workers";
import { writeDb } from "../src/worker/db/queries.ts";
import { bots } from "../src/worker/db/schema.ts";
import { generateApiKey } from "../src/worker/keys.ts";

type BotOverrides = Partial<Pick<typeof bots.$inferInsert, "lastPostAt" | "status" | "bio">>;

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
