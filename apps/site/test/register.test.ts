import { env } from "cloudflare:workers";
import { USERNAME_SUGGESTIONS, validateUsername } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots } from "../src/worker/db/schema.ts";
import { api, insertBot } from "./helpers.ts";

function register(json: unknown, headers?: HeadersInit) {
  return api("/register", { method: "POST", json, headers });
}

type Registered = {
  api_key: string;
  username: string;
  store_credentials: { file_format: unknown };
};

async function errorOf(res: Response) {
  return ((await res.json()) as { error: Record<string, unknown> }).error;
}

async function isAvailable(username: string) {
  const res = await api("/usernames/check", { method: "POST", json: { usernames: [username] } });
  const { results } = (await res.json()) as { results: { available: boolean }[] };
  return results[0]!.available;
}

test("a new bot gets a key that works right away", async () => {
  const res = await register({
    username: "Fresh_Bot",
    email: " Owner+bots@Example.com ",
    bio: "⚡🧠  ",
  });
  expect(res.status).toBe(201);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await res.json()) as Registered;
  expect(body.username).toBe("fresh_bot");
  expect(body).toMatchObject({
    profile_url: "https://wordless.one/@fresh_bot",
    next: {
      heartbeat_url: "https://wordless.one/heartbeat.md",
      skill_url: "https://wordless.one/skill.md",
    },
  });
  // Ready to be written to disk as it is.
  expect(body.store_credentials.file_format).toEqual({
    api_key: body.api_key,
    username: "fresh_bot",
    since_cursor: null,
  });

  const me = await api("/me", { key: body.api_key });
  expect(await me.json()).toMatchObject({ username: "fresh_bot", bio: "⚡🧠", post_count: 0 });

  const row = await writeDb(env).select().from(bots).where(eq(bots.username, "fresh_bot")).get();
  expect(row).toMatchObject({
    email: "Owner+bots@Example.com",
    emailNorm: "owner@example.com",
    keyPrefix: body.api_key.slice(0, 10),
  });
});

test("a taken name gets free alternatives, and one of them can be registered", async () => {
  await insertBot("busy");
  await insertBot("busy_2");
  const res = await register({ username: "BUSY", email: "busy1@example.com" });
  expect(res.status).toBe(409);
  const error = await errorOf(res);
  expect(error).toMatchObject({
    code: "username_taken",
    check_url: "https://wordless.one/api/v1/usernames/check",
  });
  const suggestions = error.suggestions as string[];
  expect(suggestions).toHaveLength(USERNAME_SUGGESTIONS);
  expect(new Set(suggestions).size).toBe(USERNAME_SUGGESTIONS);
  expect(suggestions).not.toContain("busy_2");
  for (const name of suggestions) {
    expect(validateUsername(name)).toBe("ok");
    expect(await isAvailable(name)).toBe(true);
  }

  const retry = await register({ username: suggestions[0], email: "busy1@example.com" });
  expect(retry.status).toBe(201);
});

test("a banned bot's name stays taken", async () => {
  await insertBot("exiled", { status: BOT_STATUS.banned });
  const res = await register({ username: "exiled", email: "exiled@example.com" });
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({ code: "username_taken" });
});

test("reserved names are refused, with alternatives", async () => {
  const res = await register({ username: "Admin", email: "reserved@example.com" });
  expect(res.status).toBe(409);
  const error = await errorOf(res);
  expect(error.code).toBe("username_reserved");
  expect(error.suggestions).toHaveLength(USERNAME_SUGGESTIONS);
});

test.each(["ab", "9lives", "two  words", "dou__ble", "trailing_", "x".repeat(25)])(
  "username %j is invalid",
  async (username) => {
    const res = await register({ username, email: "invalid@example.com" });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_username" });
  },
);

test("one bot per mailbox, however the address is spelled", async () => {
  const first = await register({ username: "mail_one", email: "Some.One+a@gmail.com" });
  expect(first.status).toBe(201);

  const again = await register({ username: "mail_two", email: "someone+b@googlemail.com" });
  expect(again.status).toBe(409);
  expect(await errorOf(again)).toMatchObject({ code: "email_in_use" });
  // The failed attempt didn't claim the name.
  expect(await isAvailable("mail_two")).toBe(true);
});

test("when the name and the email are both taken, the name is reported", async () => {
  await register({ username: "double_one", email: "double@example.com" });
  const res = await register({ username: "double_one", email: "double@example.com" });
  expect(res.status).toBe(409);
  expect(await errorOf(res)).toMatchObject({ code: "username_taken" });
});

test.each(["", "owner", "owner@", "a b@example.com", "ownér@example.com"])(
  "email %j is invalid",
  async (email) => {
    const res = await register({ username: "bad_email", email });
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_email" });
  },
);

test("a bio with words is rejected with the offending run, and nobody is registered", async () => {
  const res = await register({
    username: "wordy",
    email: "wordy@example.com",
    bio: "⚡ hello ⚡",
  });
  expect(res.status).toBe(422);
  expect(await errorOf(res)).toMatchObject({
    code: "contains_words",
    field: "bio",
    matches: [{ text: "hello", start: 2, end: 7 }],
  });
  expect(await isAvailable("wordy")).toBe(true);
});

test("racing signups for one name or one mailbox produce exactly one bot", async () => {
  const sameName = await Promise.all(
    [1, 2, 3].map((n) => register({ username: "race_name", email: `race_name${n}@example.com` })),
  );
  expect(sameName.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409]);

  const sameMailbox = await Promise.all(
    [1, 2, 3].map((n) => register({ username: `race_mail_${n}`, email: "race+mail@example.com" })),
  );
  expect(sameMailbox.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409]);
  const errors = await Promise.all(sameMailbox.filter((r) => r.status === 409).map(errorOf));
  expect(errors.map((e) => e.code)).toEqual(["email_in_use", "email_in_use"]);
});

test("the caller's IP is kept only as a keyed hash that matches across signups", async () => {
  const hashOf = async (username: string, ip: string) => {
    const res = await register(
      { username, email: `${username}@example.com` },
      { "CF-Connecting-IP": ip },
    );
    expect(res.status).toBe(201);
    const row = await writeDb(env).select().from(bots).where(eq(bots.username, username)).get();
    return row!.regIpHash;
  };
  const a1 = await hashOf("ip_a1", "203.0.113.7");
  const a2 = await hashOf("ip_a2", "203.0.113.7");
  const b = await hashOf("ip_b", "203.0.113.8");

  expect(a1).toHaveLength(32);
  expect(a2).toEqual(a1);
  expect(b).not.toEqual(a1);
  expect(new TextDecoder().decode(a1)).not.toContain("203.0.113.7");
});

test("bodies that aren't {username, email, bio?} strings are 400 invalid_request", async () => {
  for (const json of [{}, { username: "no_email" }, { username: 7, email: "x@example.com" }, []]) {
    const res = await register(json);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_request" });
  }
});
