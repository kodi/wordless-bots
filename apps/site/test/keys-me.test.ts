import { env } from "cloudflare:workers";
import { BIO_MAX_GRAPHEMES } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { findBotByKeyHash, rotateKey, setBio, writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots } from "../src/worker/db/schema.ts";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "../src/worker/keys.ts";
import { api, insertBot, nextIp } from "./helpers.ts";

// D1 and the caches are shared within a file: every test uses bots of its own.

const patchBio = (key: string, bio: unknown) => api("/me", { method: "PATCH", key, json: { bio } });
const rotate = (key: string) => api("/keys/rotate", { method: "POST", key });
const stored = (username: string) =>
  writeDb(env).select().from(bots).where(eq(bots.username, username)).get();

async function register(username: string, bio?: string): Promise<string> {
  const res = await api("/register", {
    method: "POST",
    headers: { "CF-Connecting-IP": nextIp() },
    json: { username, email: `${username}@example.com`, bio },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { api_key: string }).api_key;
}

const profileBio = async (username: string) => {
  const res = await api(`/bots/${username}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { bot: { bio: string } }).bot.bio;
};

test("PATCH /me stores the canonical bio and answers with it", async () => {
  const { key } = await insertBot("bio_set", { bio: "🔥" });

  const res = await patchBio(key, "⚡🧠  ");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ bio: "⚡🧠" });
  expect((await stored("bio_set"))?.bio).toBe("⚡🧠");
  expect(await (await api("/me", { key })).json()).toMatchObject({ bio: "⚡🧠" });
});

test("PATCH /me drops the cached profile before it answers", async () => {
  const key = await register("bio_purge", "🔥");
  expect(await profileBio("bio_purge")).toBe("🔥");

  expect((await patchBio(key, "⚡")).status).toBe(200);
  expect(await profileBio("bio_purge")).toBe("⚡");
});

test("an empty bio clears it, on the profile too", async () => {
  const key = await register("bio_clear", "🔥");
  expect(await profileBio("bio_clear")).toBe("🔥");

  const res = await patchBio(key, "");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ bio: "" });
  expect((await stored("bio_clear"))?.bio).toBe("");
  expect(await profileBio("bio_clear")).toBe("");
});

test("a rejected bio is a 422 with the filter's code and changes nothing", async () => {
  const key = await register("bio_reject", "🔥");
  expect(await profileBio("bio_reject")).toBe("🔥");

  const cases: [string, string][] = [
    ["⚡ hello ⚡", "contains_words"],
    ["   ", "empty"],
    ["⚡\n⚡", "too_many_lines"],
    ["⚡".repeat(BIO_MAX_GRAPHEMES + 1), "too_long"],
  ];
  for (const [bio, code] of cases) {
    const res = await patchBio(key, bio);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code, field: "bio", matches: expect.any(Array) },
    });
  }
  expect((await stored("bio_reject"))?.bio).toBe("🔥");
  expect(await profileBio("bio_reject")).toBe("🔥");
});

test("bodies that aren't {bio: string} are 400 and change nothing", async () => {
  const { key } = await insertBot("bio_shape", { bio: "🔥" });
  for (const json of [{}, { bio: 5 }, { bio: null }, [], "⚡"]) {
    const res = await api("/me", { method: "PATCH", key, json });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  }
  expect((await api("/me", { method: "PATCH", key })).status).toBe(400);
  expect((await stored("bio_shape"))?.bio).toBe("🔥");
});

test("PATCH /me needs a key, and a banned bot can't change its bio", async () => {
  expect((await api("/me", { method: "PATCH", json: { bio: "⚡" } })).status).toBe(401);

  const { key } = await insertBot("bio_banned", { status: BOT_STATUS.banned, bio: "🔥" });
  expect((await patchBio(key, "⚡")).status).toBe(403);
  expect((await stored("bio_banned"))?.bio).toBe("🔥");
});

test("a ban between the key check and the write leaves the bio alone", async () => {
  const { id } = await insertBot("bio_ban_race", { status: BOT_STATUS.banned, bio: "🔥" });
  expect(await setBio(writeDb(env), id, "⚡")).toBe(false);
  expect((await stored("bio_ban_race"))?.bio).toBe("🔥");
});

test("rotating returns a new key at once, and the old key is dead on the very next request", async () => {
  const oldKey = await register("rot_basic");

  const res = await rotate(oldKey);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await res.json()) as { api_key: string };
  // The key and nothing else: no old key, no hash.
  expect(Object.keys(body)).toEqual(["api_key"]);
  const newKey = body.api_key;
  expect(looksLikeApiKey(newKey)).toBe(true);
  expect(newKey).not.toBe(oldKey);

  const old = await api("/me", { key: oldKey });
  expect(old.status).toBe(401);
  expect(await old.json()).toMatchObject({ error: { code: "invalid_api_key" } });
  expect(await (await api("/me", { key: newKey })).json()).toMatchObject({ username: "rot_basic" });

  const row = await stored("rot_basic");
  expect(row?.keyHash).toEqual(await hashApiKey(newKey));
  expect(row?.keyPrefix).toBe(newKey.slice(0, 10));
});

test("a rotated key rotates again, and only the latest key works", async () => {
  const first = await register("rot_twice");
  const second = ((await (await rotate(first)).json()) as { api_key: string }).api_key;
  const third = ((await (await rotate(second)).json()) as { api_key: string }).api_key;

  expect((await api("/me", { key: first })).status).toBe(401);
  expect((await api("/me", { key: second })).status).toBe(401);
  expect((await api("/me", { key: third })).status).toBe(200);
});

test("rotating touches nothing else of the bot, and not another bot's key", async () => {
  const mine = await register("rot_mine", "🔥");
  const other = await register("rot_other");
  const before = await stored("rot_mine");

  await rotate(mine);
  const after = await stored("rot_mine");
  expect({ ...after, keyHash: null, keyPrefix: null }).toEqual({
    ...before,
    keyHash: null,
    keyPrefix: null,
  });
  expect((await api("/me", { key: other })).status).toBe(200);
});

test("rotating needs a key, and a banned bot can't rotate", async () => {
  expect((await api("/keys/rotate", { method: "POST" })).status).toBe(401);

  const { key } = await insertBot("rot_banned", { status: BOT_STATUS.banned });
  const before = await stored("rot_banned");
  expect((await rotate(key)).status).toBe(403);
  expect((await stored("rot_banned"))?.keyHash).toEqual(before?.keyHash);
});

test("a ban between the key check and the write leaves the key alone", async () => {
  const { key } = await insertBot("rot_ban_race", { status: BOT_STATUS.banned });
  const bot = await findBotByKeyHash(writeDb(env), await hashApiKey(key));
  const next = await generateApiKey();

  expect(await rotateKey(writeDb(env), bot!, next)).toEqual({ rotated: false, reason: "banned" });
  expect((await stored("rot_ban_race"))?.keyHash).toEqual(await hashApiKey(key));
});

test("of parallel rotations from one key exactly one wins, and its key is the one that works", async () => {
  const { key } = await insertBot("rot_race");
  const bot = (await findBotByKeyHash(writeDb(env), await hashApiKey(key)))!;
  const nexts = await Promise.all(Array.from({ length: 8 }, () => generateApiKey()));

  const results = await Promise.all(nexts.map((next) => rotateKey(writeDb(env), bot, next)));
  const winners = results.flatMap((result, i) => (result.rotated ? [nexts[i]!] : []));
  expect(winners).toHaveLength(1);
  expect(results.filter((r) => !r.rotated)).toEqual(
    Array(7).fill({ rotated: false, reason: "stale_key" }),
  );
  expect((await stored("rot_race"))?.keyHash).toEqual(winners[0]!.hash);
  expect((await api("/me", { key: winners[0]!.key })).status).toBe(200);
});

test("of parallel rotate requests one answers 200 and the key it hands out works", async () => {
  const key = await register("rot_race_http");

  const responses = await Promise.all(Array.from({ length: 6 }, () => rotate(key)));
  const ok = responses.filter((res) => res.status === 200);
  expect(ok).toHaveLength(1);
  for (const res of responses.filter((r) => r.status !== 200)) {
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_api_key" } });
  }
  const { api_key } = (await ok[0]!.json()) as { api_key: string };
  expect((await api("/me", { key: api_key })).status).toBe(200);
  expect((await api("/me", { key })).status).toBe(401);
});
