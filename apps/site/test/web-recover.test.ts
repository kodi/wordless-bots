import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots } from "../src/worker/db/schema.ts";
import {
  confirmRecovery,
  readRecoveryToken,
  requestRecovery,
  type PostJson,
} from "../src/web/recover.ts";
import { api, insertBot, insertToken, ORIGIN } from "./helpers.ts";

// The `/recover` page's parts, run against the real Worker.

/** A `PostJson` to the Worker that keeps the paths it was asked for. */
function worker() {
  const paths: string[] = [];
  const post: PostJson = (path, body) => {
    paths.push(path);
    return exports.default.fetch(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };
  return { post, paths };
}

const TOKEN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg";

test.each([
  [`#t=${TOKEN}`, TOKEN],
  ["", undefined],
  ["#", undefined],
  ["#t=", undefined],
  [`t=${TOKEN}`, undefined],
  [`#T=${TOKEN}`, undefined],
  [`#x=${TOKEN}`, undefined],
  [`#t=${TOKEN.slice(1)}`, undefined],
  [`#t=${TOKEN}h`, undefined],
  [`#t=${TOKEN.slice(1)}-`, undefined],
  [`#t=${TOKEN}&t=${TOKEN}`, undefined],
  [`#a=1&t=${TOKEN}`, undefined],
  [`#a#t=${TOKEN}`, undefined],
  [`#t=${TOKEN.slice(0, 40)}%20A`, undefined],
])("readRecoveryToken(%j)", (hash, expected) => {
  expect(readRecoveryToken(hash)).toBe(expected);
});

test("a live link gives a working key once, kills the old one, and is dead after", async () => {
  const { id, key: oldKey } = await insertBot("web_recover");
  const token = await insertToken(id);
  const { post, paths } = worker();

  const first = await confirmRecovery(post, token);

  expect(first).toMatchObject({ status: "recovered", username: "web_recover" });
  const newKey = first.status === "recovered" ? first.apiKey : "";
  expect((await api("/me", { key: newKey })).status).toBe(200);
  expect((await api("/me", { key: oldKey })).status).toBe(401);

  expect(await confirmRecovery(post, token)).toEqual({ status: "invalid" });
  expect(paths).toEqual(["/api/v1/recover/confirm", "/api/v1/recover/confirm"]);
});

test("a banned bot's live link says so and isn't spent", async () => {
  const { id } = await insertBot("web_recover_banned", { status: BOT_STATUS.banned });
  const token = await insertToken(id);
  const { post } = worker();

  expect(await confirmRecovery(post, token)).toEqual({ status: "banned" });

  await writeDb(env).update(bots).set({ status: BOT_STATUS.active }).where(eq(bots.id, id));
  expect(await confirmRecovery(post, token)).toMatchObject({ status: "recovered" });
});

test("an unknown token is invalid; a server error or no network is a failure to retry", async () => {
  expect(await confirmRecovery(worker().post, TOKEN)).toEqual({ status: "invalid" });

  const down: PostJson = async () => new Response("{}", { status: 503 });
  const offline: PostJson = () => Promise.reject(new TypeError("Failed to fetch"));
  expect(await confirmRecovery(down, TOKEN)).toEqual({ status: "failed" });
  expect(await confirmRecovery(offline, TOKEN)).toEqual({ status: "failed" });
});

test("asking for a link goes through for any name, and a failure says so", async () => {
  const { post, paths } = worker();

  expect(await requestRecovery(post, "web_nobody_here")).toBe(true);
  expect(paths).toEqual(["/api/v1/recover"]);

  const down: PostJson = async () => new Response("{}", { status: 500 });
  const offline: PostJson = () => Promise.reject(new TypeError("Failed to fetch"));
  expect(await requestRecovery(down, "web_nobody_here")).toBe(false);
  expect(await requestRecovery(offline, "web_nobody_here")).toBe(false);
});
