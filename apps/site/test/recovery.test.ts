import { env } from "cloudflare:workers";
import { RECOVERY_MAX, RECOVERY_TOKEN_TTL_S, RECOVERY_WINDOW_S } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { sendRecovery } from "../src/worker/api.ts";
import { recoverKey, writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, recoveryTokens } from "../src/worker/db/schema.ts";
import {
  generateApiKey,
  generateRecoveryToken,
  hashApiKey,
  hashRecoveryToken,
} from "../src/worker/keys.ts";
import { api, fakeEmail, insertBot, insertToken, ORIGIN, tokenIn } from "./helpers.ts";

// D1 and the caches are shared within a file: every test uses bots of its own.

const WINDOW_MS = RECOVERY_WINDOW_S * 1000;
const TTL_MS = RECOVERY_TOKEN_TTL_S * 1000;

const db = () => writeDb(env);
const rowsOf = (botId: number) =>
  db().select().from(recoveryTokens).where(eq(recoveryTokens.botId, botId));
const storedBot = (botId: number) => db().select().from(bots).where(eq(bots.id, botId)).get();
const confirm = (token: unknown) => api("/recover/confirm", { method: "POST", json: { token } });
const recover = (username: unknown) => api("/recover", { method: "POST", json: { username } });
const me = (key: string) => api("/me", { key });

afterEach(() => vi.restoreAllMocks());

/** Replaces the binding's `send`, so `POST /recover` mails nobody; returns what it was asked to send. */
function captureMail(): { to: string; text: string }[] {
  const sent: { to: string; text: string }[] = [];
  vi.spyOn(env.EMAIL, "send").mockImplementation(async (message) => {
    const { to, text } = message as unknown as { to: string; text: string };
    sent.push({ to, text });
    return { messageId: "test" };
  });
  return sent;
}

// --- sending the link ---

test("a recovery mail goes to the bot's address with a link whose token is stored only as a hash", async () => {
  const { id } = await insertBot("rec_mail");
  const mail = fakeEmail();
  const now = Date.now();

  expect(await sendRecovery(db(), mail.sender, "rec_mail", ORIGIN, now)).toBe(true);

  expect(mail.sent).toHaveLength(1);
  expect(mail.sent[0]!.to).toBe("rec_mail@example.com");
  expect(mail.sent[0]!.text).toContain(`${ORIGIN}/recover#t=`);
  expect(mail.sent[0]!.html).toContain(`${ORIGIN}/recover#t=`);
  const token = tokenIn(mail.sent[0]!);
  expect(token).toHaveLength(43);

  const [row, ...others] = await rowsOf(id);
  expect(others).toEqual([]);
  expect(row).toMatchObject({ createdAt: now, expiresAt: now + TTL_MS, usedAt: null });
  expect(row!.tokenHash).toEqual(await hashRecoveryToken(token));
  expect(row!.tokenHash).not.toEqual(new TextEncoder().encode(token));
});

test("a name that no active bot has gets no mail and no row", async () => {
  const banned = await insertBot("rec_banned_mail", { status: BOT_STATUS.banned });
  const mail = fakeEmail();

  expect(await sendRecovery(db(), mail.sender, "rec_nobody_here", ORIGIN, Date.now())).toBe(false);
  expect(await sendRecovery(db(), mail.sender, "rec_banned_mail", ORIGIN, Date.now())).toBe(false);

  expect(mail.sent).toEqual([]);
  expect(await rowsOf(banned.id)).toEqual([]);
});

test("a bot gets three links an hour, counted on the rows inside the window", async () => {
  const { id } = await insertBot("rec_limit");
  const other = await insertBot("rec_limit_other");
  const mail = fakeEmail();
  const now = Date.now();

  for (let n = 0; n < RECOVERY_MAX; n++) {
    expect(await sendRecovery(db(), mail.sender, "rec_limit", ORIGIN, now + n)).toBe(true);
  }
  expect(await sendRecovery(db(), mail.sender, "rec_limit", ORIGIN, now + 10)).toBe(false);
  expect(mail.sent).toHaveLength(RECOVERY_MAX);
  expect(await rowsOf(id)).toHaveLength(RECOVERY_MAX);

  // Another bot's quota is its own.
  expect(await sendRecovery(db(), mail.sender, "rec_limit_other", ORIGIN, now + 10)).toBe(true);
  expect(await rowsOf(other.id)).toHaveLength(1);

  // The oldest row leaves the window, and exactly one slot frees up. A row made exactly one window ago no
  // longer counts; one made a millisecond later still does.
  expect(await sendRecovery(db(), mail.sender, "rec_limit", ORIGIN, now + WINDOW_MS - 1)).toBe(
    false,
  );
  expect(await sendRecovery(db(), mail.sender, "rec_limit", ORIGIN, now + WINDOW_MS)).toBe(true);
  expect(await sendRecovery(db(), mail.sender, "rec_limit", ORIGIN, now + WINDOW_MS)).toBe(false);
});

test("a used or expired token still counts toward the hourly limit", async () => {
  const { id } = await insertBot("rec_counts_dead");
  const now = Date.now();
  await insertToken(id, { createdAt: now - 50 * 60_000, usedAt: now - 49 * 60_000 });
  await insertToken(id, { createdAt: now - 45 * 60_000 });
  await insertToken(id, { createdAt: now - 40 * 60_000 });

  expect(await sendRecovery(db(), fakeEmail().sender, "rec_counts_dead", ORIGIN, now)).toBe(false);
});

test("parallel requests for one bot send exactly the limit", async () => {
  const { id } = await insertBot("rec_parallel");
  const mail = fakeEmail();
  const now = Date.now();

  const results = await Promise.all(
    Array.from({ length: 8 }, () => sendRecovery(db(), mail.sender, "rec_parallel", ORIGIN, now)),
  );

  expect(results.filter(Boolean)).toHaveLength(RECOVERY_MAX);
  expect(mail.sent).toHaveLength(RECOVERY_MAX);
  expect(await rowsOf(id)).toHaveLength(RECOVERY_MAX);
});

test("a mail that can't be sent takes its token back and costs no quota", async () => {
  const { id } = await insertBot("rec_outage");
  const mail = fakeEmail();
  mail.state.fail = true;

  for (let n = 0; n < RECOVERY_MAX + 2; n++) {
    await expect(
      sendRecovery(db(), mail.sender, "rec_outage", ORIGIN, Date.now()),
    ).rejects.toThrow();
  }
  expect(await rowsOf(id)).toEqual([]);

  mail.state.fail = false;
  expect(await sendRecovery(db(), mail.sender, "rec_outage", ORIGIN, Date.now())).toBe(true);
});

// --- POST /recover ---

test("POST /recover answers every username the same way, whatever it names", async () => {
  captureMail();
  await insertBot("rec_same_live");
  await insertBot("rec_same_banned", { status: BOT_STATUS.banned });
  const limited = await insertBot("rec_same_limited");
  const now = Date.now();
  for (let n = 0; n < RECOVERY_MAX; n++) await insertToken(limited.id, { createdAt: now - n });

  const answers = [];
  for (const username of [
    "rec_same_live",
    "rec_same_banned",
    "rec_same_limited",
    "rec_same_nobody",
    "Rec_Same_Live",
    "not a name!",
    "",
    "admin",
  ]) {
    const res = await recover(username);
    answers.push({
      username,
      status: res.status,
      headers: [...res.headers].filter(([name]) => name !== "content-length"),
      body: await res.text(),
    });
  }

  const [first, ...rest] = answers;
  expect(first!.status).toBe(202);
  expect(first!.headers).toContainEqual(["cache-control", "private, no-store"]);
  for (const answer of rest)
    expect(answer, answer.username).toMatchObject({ ...first!, username: answer.username });
});

test("POST /recover with a body that isn't {username: string} is a 400", async () => {
  captureMail();
  for (const json of [{}, { username: 5 }, { user: "x" }, [], "rec"]) {
    const res = await api("/recover", { method: "POST", json });
    expect(res.status, JSON.stringify(json)).toBe(400);
  }
  const notJson = await api("/recover", { method: "POST", body: "username=rec" });
  expect(notJson.status).toBe(400);
});

test("POST /recover mails the owner a link that recovers the key", async () => {
  const sent = captureMail();
  const { id, key } = await insertBot("rec_flow");

  expect((await recover("rec_flow")).status).toBe(202);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]!.to).toBe("rec_flow@example.com");
  const token = /\/recover#t=([0-9A-Za-z]+)/.exec(sent[0]!.text)![1]!;

  const res = await confirm(token);
  expect(res.status).toBe(200);
  const { api_key } = (await res.json()) as { api_key: string };
  expect((await me(key)).status).toBe(401);
  expect((await me(api_key)).status).toBe(200);
  expect((await storedBot(id))?.keyHash).toEqual(await hashApiKey(api_key));
});

test("POST /recover answers before the mail is sent", async () => {
  // A response that waited for the send would take longer for a real bot than for an unknown name.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let started = false;
  vi.spyOn(env.EMAIL, "send").mockImplementation(async () => {
    started = true;
    await held;
    return { messageId: "test" };
  });
  await insertBot("rec_fast");

  const res = await recover("rec_fast");
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(started).toBe(true));
  release();
});

test("a failing mail is not a failure of the request, and nothing about it is logged", async () => {
  vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("rejected rec_logged@example.com"));
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { id } = await insertBot("rec_logged");

  expect((await recover("rec_logged")).status).toBe(202);
  await vi.waitFor(() => expect(logged).toHaveBeenCalled());
  const text = logged.mock.calls
    .flat()
    .map((arg) => (arg instanceof Error ? `${arg.name} ${arg.message}` : String(arg)))
    .join(" ");
  expect(text).toContain("recover");
  expect(text).not.toContain("rec_logged");
  await vi.waitFor(async () => expect(await rowsOf(id)).toEqual([]));
});

// --- POST /recover/confirm ---

test("a token gives the bot a new key once, and the old key dies at once", async () => {
  const { id, key } = await insertBot("rec_once");
  const token = await insertToken(id);
  const now = Date.now();

  const res = await confirm(token);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  const body = (await res.json()) as { api_key: string; username: string };
  expect(Object.keys(body).sort()).toEqual(["api_key", "username"]);
  expect(body.username).toBe("rec_once");

  expect((await me(key)).status).toBe(401);
  expect(await (await me(body.api_key)).json()).toMatchObject({ username: "rec_once" });
  const bot = await storedBot(id);
  expect(bot?.keyHash).toEqual(await hashApiKey(body.api_key));
  expect(bot?.keyPrefix).toBe(body.api_key.slice(0, 10));
  const [row] = await rowsOf(id);
  expect(row!.usedAt).toBeGreaterThanOrEqual(now);

  // A second try with the same link finds it spent and changes nothing.
  const again = await confirm(token);
  expect(again.status).toBe(410);
  expect(again.headers.get("Cache-Control")).toBe("private, no-store");
  expect((await storedBot(id))?.keyHash).toEqual(await hashApiKey(body.api_key));
});

test("a bad, used or expired token is 410 token_invalid, and the answers match", async () => {
  const { id, key } = await insertBot("rec_invalid");
  const now = Date.now();
  const used = await insertToken(id, { usedAt: now - 1000 });
  const expired = await insertToken(id, { createdAt: now - 40 * 60_000 });
  const stranger = (await generateRecoveryToken()).token;

  const answers = [];
  for (const token of [used, expired, stranger, "", "short", `${stranger}x`, "!".repeat(43)]) {
    const res = await confirm(token);
    answers.push({ status: res.status, body: await res.json() });
  }
  expect(answers[0]!.status).toBe(410);
  expect(answers[0]!.body).toMatchObject({ error: { code: "token_invalid" } });
  for (const answer of answers) expect(answer).toEqual(answers[0]);

  expect((await me(key)).status).toBe(200);
});

test("a token of the wrong shape never reaches the database", async () => {
  const batch = vi.spyOn(env.DB, "batch");

  for (const token of ["", "short", "!".repeat(43), `${"a".repeat(43)}x`]) {
    expect((await confirm(token)).status).toBe(410);
  }
  expect(batch).not.toHaveBeenCalled();

  // The right shape is looked up, and found wanting.
  expect((await confirm("a".repeat(43))).status).toBe(410);
  expect(batch).toHaveBeenCalledTimes(1);
});

test("a token expires exactly at its expiry", async () => {
  const { id } = await insertBot("rec_edge");
  const { hash } = await generateRecoveryToken();
  const at = Date.now();
  await db()
    .insert(recoveryTokens)
    .values({ tokenHash: hash, botId: id, createdAt: at - TTL_MS, expiresAt: at });

  const late = await recoverKey(db(), hash, await generateApiKey(), at);
  expect(late).toEqual({ recovered: false, reason: "token_invalid" });
  const early = await recoverKey(db(), hash, await generateApiKey(), at - 1);
  expect(early).toEqual({ recovered: true, username: "rec_edge" });
});

test("a token is read from the body only, never the query string", async () => {
  const { id, key } = await insertBot("rec_query");
  const token = await insertToken(id);

  const viaQuery = await api(`/recover/confirm?token=${token}&t=${token}`, {
    method: "POST",
    json: { token: "x".repeat(43) },
  });
  expect(viaQuery.status).toBe(410);
  const noBody = await api(`/recover/confirm?token=${token}`, { method: "POST", json: {} });
  expect(noBody.status).toBe(400);

  expect((await me(key)).status).toBe(200);
  expect((await rowsOf(id))[0]!.usedAt).toBeNull();
  expect((await confirm(token)).status).toBe(200);
});

test("confirm with a body that isn't {token: string} is a 400", async () => {
  for (const json of [{}, { token: 1 }, { t: "x" }, []]) {
    const res = await api("/recover/confirm", { method: "POST", json });
    expect(res.status, JSON.stringify(json)).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  }
});

test("parallel confirms of one token give exactly one new key", async () => {
  const { id } = await insertBot("rec_race");
  const { hash } = await generateRecoveryToken();
  const now = Date.now();
  await db()
    .insert(recoveryTokens)
    .values({ tokenHash: hash, botId: id, createdAt: now, expiresAt: now + TTL_MS });
  const keys = await Promise.all(Array.from({ length: 8 }, () => generateApiKey()));

  const results = await Promise.all(keys.map((next) => recoverKey(db(), hash, next, now)));

  const winners = results.flatMap((result, n) => (result.recovered ? [n] : []));
  expect(winners).toHaveLength(1);
  for (const result of results.filter((r) => !r.recovered)) {
    expect(result).toEqual({ recovered: false, reason: "token_invalid" });
  }
  // The key in the table is the winner's, so no other caller was handed a key that is already dead.
  expect((await storedBot(id))?.keyHash).toEqual(keys[winners[0]!]!.hash);
});

test("parallel HTTP confirms of one token give one 200 and a key that works", async () => {
  const { id } = await insertBot("rec_race_http");
  const token = await insertToken(id);

  const responses = await Promise.all(Array.from({ length: 6 }, () => confirm(token)));

  const ok = responses.filter((res) => res.status === 200);
  expect(ok).toHaveLength(1);
  expect(responses.filter((res) => res.status === 410)).toHaveLength(5);
  const { api_key } = (await ok[0]!.json()) as { api_key: string };
  expect((await me(api_key)).status).toBe(200);
});

test("recovering spends every unused link of the bot, and only that bot's", async () => {
  const { id } = await insertBot("rec_siblings");
  const stranger = await insertBot("rec_siblings_other");
  const first = await insertToken(id);
  const second = await insertToken(id);
  const strangers = await insertToken(stranger.id);

  expect((await confirm(first)).status).toBe(200);
  expect((await confirm(second)).status).toBe(410);

  const { key } = stranger;
  expect((await me(key)).status).toBe(200);
  expect((await confirm(strangers)).status).toBe(200);
});

test("a banned bot's live token is 403 banned and stays unspent; a dead one is 410", async () => {
  const { id, key } = await insertBot("rec_ban");
  const live = await insertToken(id);
  const dead = await insertToken(id, { usedAt: Date.now() - 1000 });
  await db().update(bots).set({ status: BOT_STATUS.banned }).where(eq(bots.id, id));

  const res = await confirm(live);
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "banned" } });
  expect((await confirm(dead)).status).toBe(410);

  const bot = await storedBot(id);
  expect(bot?.keyHash).toEqual(await hashApiKey(key));
  expect((await rowsOf(id)).map((row) => row.usedAt === null)).toEqual([true, false]);
});
