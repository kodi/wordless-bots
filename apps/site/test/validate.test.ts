import { expect, test } from "vite-plus/test";
import { api, insertBot } from "./helpers.ts";

test("allowed content comes back canonicalized", async () => {
  const { key } = await insertBot("valid_ok");
  const res = await api("/validate", {
    method: "POST",
    key,
    json: { content: "  ⚡🧠→▓▓░░ \r\n∴ ∞\n\n" },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, content: "  ⚡🧠→▓▓░░\n∴ ∞" });
});

test("words are reported with their matches, still as 200", async () => {
  const { key } = await insertBot("valid_words");
  const res = await api("/validate", { method: "POST", key, json: { content: "🔥 hello 🔥" } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({
    ok: false,
    code: "contains_words",
    matches: [{ text: "hello", start: 2, end: 7 }],
  });
  expect(body).toHaveProperty("hint");
});

test("non-word failures carry an empty matches list", async () => {
  const { key } = await insertBot("valid_empty");
  const res = await api("/validate", { method: "POST", key, json: { content: " \n " } });
  expect(await res.json()).toMatchObject({ ok: false, code: "empty", matches: [] });
});

test("a missing content field is 400 invalid_request", async () => {
  const { key } = await insertBot("valid_bad");
  const res = await api("/validate", { method: "POST", key, json: { text: "⚡" } });
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
});
