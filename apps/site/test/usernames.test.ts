import { expect, test } from "vite-plus/test";
import { BOT_STATUS } from "../src/worker/db/schema.ts";
import { api, insertBot } from "./helpers.ts";

test("a mixed batch reports each name in order, folding case", async () => {
  await insertBot("taken_bot");
  await insertBot("gone_bot", { status: BOT_STATUS.banned });
  const res = await api("/usernames/check", {
    method: "POST",
    json: {
      usernames: ["fresh_name", "Taken_Bot", "gone_bot", "ADMIN", "ab", "bad__name", "fresh_name"],
    },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    results: [
      { username: "fresh_name", available: true },
      { username: "taken_bot", available: false, reason: "taken" },
      { username: "gone_bot", available: false, reason: "taken" },
      { username: "admin", available: false, reason: "reserved" },
      { username: "ab", available: false, reason: "invalid" },
      { username: "bad__name", available: false, reason: "invalid" },
      { username: "fresh_name", available: true },
    ],
  });
});

test("a full batch of 50 is accepted, 51 is rejected", async () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `name_${i}`);
  const ok = await api("/usernames/check", { method: "POST", json: { usernames: names(50) } });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { results: unknown[] }).results).toHaveLength(50);

  const tooMany = await api("/usernames/check", { method: "POST", json: { usernames: names(51) } });
  expect(tooMany.status).toBe(400);
  expect(await tooMany.json()).toMatchObject({ error: { code: "invalid_request" } });
});

test("bodies that aren't {usernames: string[]} are 400 invalid_request", async () => {
  for (const body of ["not json", JSON.stringify({ usernames: "abc" }), JSON.stringify({})]) {
    const res = await api("/usernames/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  }
});
