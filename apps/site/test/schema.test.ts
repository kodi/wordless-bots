import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { bots, posts, reactions } from "../src/worker/db/schema.ts";

// D1 state is shared by the tests in a file, so each bot needs its own unique fields.
function newBot(username: string, keyHash: Uint8Array) {
  return {
    username,
    email: `${username}@example.com`,
    emailNorm: `${username}@example.com`,
    keyHash,
    keyPrefix: "wl_abcdefg",
    createdAt: 0,
    regIpHash: new Uint8Array([9, 9]),
  };
}

test("BLOB columns round-trip as Uint8Array and match by value", async () => {
  const db = writeDb(env);
  const keyHash = new Uint8Array([0, 1, 254, 255]);
  await db.insert(bots).values(newBot("blob_bot", keyHash));

  const found = await db.select().from(bots).where(eq(bots.keyHash, keyHash)).get();
  expect(found?.keyHash).toEqual(keyHash);
  expect(found?.keyHash).toBeInstanceOf(Uint8Array);
});

test("deleting a post removes its reactions and only those", async () => {
  const db = writeDb(env);
  const [author, fan] = await db
    .insert(bots)
    .values([
      newBot("cascade_author", new Uint8Array([2])),
      newBot("cascade_fan", new Uint8Array([3])),
    ])
    .returning({ id: bots.id });
  const [doomed, kept] = await db
    .insert(posts)
    .values([
      { botId: author!.id, content: "⚡", createdAt: 0 },
      { botId: author!.id, content: "🔥", createdAt: 0 },
    ])
    .returning({ id: posts.id });
  const reaction = (postId: number, botId: number) => ({
    postId,
    botId,
    emoji: "🔥",
    createdAt: 0,
  });
  await db
    .insert(reactions)
    .values([
      reaction(doomed!.id, author!.id),
      reaction(doomed!.id, fan!.id),
      reaction(kept!.id, fan!.id),
    ]);

  await db.delete(posts).where(eq(posts.id, doomed!.id));

  const left = await db
    .select()
    .from(reactions)
    .where(inArray(reactions.botId, [author!.id, fan!.id]));
  expect(left).toEqual([reaction(kept!.id, fan!.id)]);
});

test("a deleted newest post's id is never reused", async () => {
  const db = writeDb(env);
  const bot = await db
    .insert(bots)
    .values(newBot("cursor_bot", new Uint8Array([1])))
    .returning({ id: bots.id })
    .get();
  const post = { botId: bot.id, content: "⚡", createdAt: 0 };

  const first = await db.insert(posts).values(post).returning({ id: posts.id }).get();
  await db.delete(posts).where(eq(posts.id, first.id));
  const second = await db.insert(posts).values(post).returning({ id: posts.id }).get();

  expect(second.id).toBeGreaterThan(first.id);
});
