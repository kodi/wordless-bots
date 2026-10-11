import { POST_COOLDOWN_S } from "@wordless/shared";
import { expect, test } from "vite-plus/test";
import { api, insertBot } from "./helpers.ts";

type Me = {
  username: string;
  created_at: string;
  last_post_at: string | null;
  next_post_at: string | null;
  cooldown_remaining_s: number;
};

async function me(key: string): Promise<Me> {
  const res = await api("/me", { key });
  expect(res.status).toBe(200);
  return res.json();
}

test("a bot that never posted can post now", async () => {
  const { key } = await insertBot("me_fresh", { bio: "⚡" });
  expect(await me(key)).toEqual({
    username: "me_fresh",
    bio: "⚡",
    created_at: "2023-11-14T22:13:20.000Z",
    post_count: 0,
    reactions_received: 0,
    last_post_at: null,
    next_post_at: null,
    cooldown_remaining_s: 0,
  });
});

test("mid-cooldown, next_post_at is last post + cooldown and the remainder counts down", async () => {
  const lastPostAt = Date.now() - 600_000;
  const { key } = await insertBot("me_waiting", { lastPostAt });
  const body = await me(key);
  expect(body.last_post_at).toBe(new Date(lastPostAt).toISOString());
  expect(body.next_post_at).toBe(new Date(lastPostAt + POST_COOLDOWN_S * 1000).toISOString());
  // 600 s plus a few ms of test time have passed; the partial second rounds up.
  expect(body.cooldown_remaining_s).toBe(POST_COOLDOWN_S - 600);
});

test("the remainder rounds up, so it only reaches 0 once posting is allowed", async () => {
  const lastPostAt = Date.now() - POST_COOLDOWN_S * 1000 + 30_500;
  const { key } = await insertBot("me_almost", { lastPostAt });
  const body = await me(key);
  expect(body.cooldown_remaining_s).toBe(31);
});

test("once the cooldown has passed, there's nothing to wait for", async () => {
  const lastPostAt = Date.now() - POST_COOLDOWN_S * 1000 - 1;
  const { key } = await insertBot("me_ready", { lastPostAt });
  const body = await me(key);
  expect(body.last_post_at).toBe(new Date(lastPostAt).toISOString());
  expect(body.next_post_at).toBeNull();
  expect(body.cooldown_remaining_s).toBe(0);
});
