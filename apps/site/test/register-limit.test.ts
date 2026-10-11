import { env } from "cloudflare:workers";
import { REGISTER_IP_MAX, REGISTER_IP_WINDOW_S } from "@wordless/shared";
import { expect, test } from "vite-plus/test";
import { hashIp } from "../src/worker/ip-hash.ts";
import { api, insertBot } from "./helpers.ts";

// D1 is shared within a file: every test uses its own IP and its own names.

function register(username: string, ip: string, email = `${username}@example.com`) {
  return api("/register", {
    method: "POST",
    json: { username, email },
    headers: { "CF-Connecting-IP": ip },
  });
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: Record<string, unknown> }).error;
}

async function isAvailable(username: string) {
  const res = await api("/usernames/check", { method: "POST", json: { usernames: [username] } });
  const { results } = (await res.json()) as { results: { available: boolean }[] };
  return results[0]!.available;
}

/** Puts a signup from `ip` into the database `agoS` seconds ago. */
async function seedSignup(name: string, ip: string, agoS: number) {
  await insertBot(name, {
    regIpHash: await hashIp(env.IP_HASH_SECRET, ip),
    createdAt: Date.now() - agoS * 1000,
  });
}

test("the signup after the limit gets 429 with the wait, and nobody is registered", async () => {
  const ip = "198.51.100.1";
  for (let n = 1; n <= REGISTER_IP_MAX; n++) {
    expect((await register(`first_${n}`, ip)).status).toBe(201);
  }

  const res = await register("one_too_many", ip);
  expect(res.status).toBe(429);
  const error = await errorOf(res);
  expect(error).toMatchObject({ code: "rate_limited" });
  // The oldest signup is seconds old, so almost the whole window is left to wait.
  const retryAfter = error.retry_after_s as number;
  expect(retryAfter).toBeGreaterThan(REGISTER_IP_WINDOW_S - 60);
  expect(retryAfter).toBeLessThanOrEqual(REGISTER_IP_WINDOW_S);
  expect(res.headers.get("Retry-After")).toBe(String(retryAfter));
  expect(await isAvailable("one_too_many")).toBe(true);

  // Another address is unaffected.
  expect((await register("elsewhere", "198.51.100.2")).status).toBe(201);
});

test("the wait ends when the oldest signup in the window ages out", async () => {
  const ip = "198.51.100.3";
  await seedSignup("aging_1", ip, REGISTER_IP_WINDOW_S - 100);
  for (let n = 2; n <= REGISTER_IP_MAX; n++) await seedSignup(`aging_${n}`, ip, 60);

  const res = await register("aging_new", ip);
  expect(res.status).toBe(429);
  const error = await errorOf(res);
  expect(error.retry_after_s).toBeGreaterThanOrEqual(99);
  expect(error.retry_after_s).toBeLessThanOrEqual(100);
  expect(res.headers.get("Retry-After")).toBe(String(error.retry_after_s));
});

test("signups older than the window don't count", async () => {
  const ip = "198.51.100.4";
  for (let n = 1; n <= REGISTER_IP_MAX; n++) {
    await seedSignup(`stale_${n}`, ip, REGISTER_IP_WINDOW_S + 60);
  }
  expect((await register("stale_new", ip)).status).toBe(201);
});

test("requests that fail validation or conflict don't use up the limit", async () => {
  const ip = "198.51.100.5";
  expect((await register("taken_name", "198.51.100.6")).status).toBe(201);

  for (let n = 0; n < REGISTER_IP_MAX; n++) {
    expect((await register("9bad", ip)).status).toBe(422);
    expect((await register("taken_name", ip, `other${n}@example.com`)).status).toBe(409);
    expect((await register(`mail_clash_${n}`, ip, "taken_name@example.com")).status).toBe(409);
  }
  for (let n = 1; n <= REGISTER_IP_MAX; n++) {
    expect((await register(`counted_${n}`, ip)).status).toBe(201);
  }
  expect((await register("counted_extra", ip)).status).toBe(429);
});

test("parallel signups from one address can't overshoot the limit", async () => {
  const ip = "198.51.100.7";
  const attempts = REGISTER_IP_MAX * 3;
  const responses = await Promise.all(
    Array.from({ length: attempts }, (_, n) => register(`parallel_${n}`, ip)),
  );
  const statuses = responses.map((r) => r.status);
  expect(statuses.filter((s) => s === 201)).toHaveLength(REGISTER_IP_MAX);
  expect(statuses.filter((s) => s === 429)).toHaveLength(attempts - REGISTER_IP_MAX);
});
