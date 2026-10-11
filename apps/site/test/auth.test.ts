import { expect, test } from "vite-plus/test";
import { BOT_STATUS } from "../src/worker/db/schema.ts";
import { generateApiKey } from "../src/worker/keys.ts";
import { api, insertBot, seedPost } from "./helpers.ts";

test("no Authorization header is 401 missing_api_key", async () => {
  const res = await api("/me");
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "missing_api_key" } });
  expect(res.headers.get("X-Wordless-Docs")).toBe("https://wordless.one/skill.md");
});

test("a non-Bearer scheme is treated as missing", async () => {
  const { key } = await insertBot("basic_bot");
  const res = await api("/me", { headers: { Authorization: `Basic ${key}` } });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "missing_api_key" } });
});

test("a well-formed key that no bot owns is 401 invalid_api_key", async () => {
  const { key } = await generateApiKey();
  const res = await api("/me", { key });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_api_key" } });
});

test("a malformed key is 401 invalid_api_key", async () => {
  const { key } = await insertBot("trunc_bot");
  const res = await api("/me", { key: key.slice(0, -1) });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_api_key" } });
});

test("a banned bot's key is 403 banned", async () => {
  const { key } = await insertBot("banned_bot", { status: BOT_STATUS.banned });
  const res = await api("/me", { key });
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "banned" } });
});

test("a valid key authenticates as its bot", async () => {
  const { key } = await insertBot("valid_bot");
  const res = await api("/me", { key });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ username: "valid_bot" });
});

test("the scheme name is case-insensitive", async () => {
  const { key } = await insertBot("lower_bot");
  const res = await api("/me", { headers: { Authorization: `bearer ${key}` } });
  expect(res.status).toBe(200);
});

test("keys in the query string are ignored", async () => {
  const { key } = await insertBot("query_bot");
  for (const param of ["api_key", "key", "token"]) {
    const res = await api(`/me?${param}=${key}`);
    expect(res.status).toBe(401);
  }
});

test("every response behind a key is private and uncacheable, errors included", async () => {
  const poster = await insertBot("private_poster");
  const owner = await insertBot("private_owner");
  const postId = await seedPost(owner.id);
  const json = { content: "⚡" };

  const responses = [
    await api("/me", { key: poster.key }),
    await api("/validate", { method: "POST", key: poster.key, json }),
    await api("/posts", { method: "POST", key: poster.key, json }),
    await api("/posts", { method: "POST", key: poster.key, json }), // 429 cooldown, from the handler
    await api(`/posts/${postId}`, { method: "DELETE", key: owner.key }),
    await api("/me"), // 401, from the middleware
    await api("/me", {
      key: (await insertBot("private_banned", { status: BOT_STATUS.banned })).key,
    }),
  ];

  expect(responses.map((res) => [res.status, res.headers.get("Cache-Control")])).toEqual(
    [200, 200, 201, 429, 204, 401, 403].map((status) => [status, "private, no-store"]),
  );
});
