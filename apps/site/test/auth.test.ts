import { expect, test } from "vite-plus/test";
import { BOT_STATUS } from "../src/worker/db/schema.ts";
import { generateApiKey } from "../src/worker/keys.ts";
import { api, insertBot } from "./helpers.ts";

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
