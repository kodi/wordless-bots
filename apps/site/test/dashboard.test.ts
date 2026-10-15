import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { syncAdminAccount } from "../src/worker/db/dashboard.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { hashAdminPassword } from "../src/worker/keys.ts";
import { ORIGIN } from "./helpers.ts";

const call = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(`${ORIGIN}${path}`, init);

const signIn = (username: string, password: string) =>
  call("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ username, password }),
  });

/** The `name=value` pairs of a response's cookies, as a `Cookie` header sends them back. */
const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const stats = (cookie?: string, query = "") =>
  call(`/api/dashboard/stats${query}`, cookie === undefined ? {} : { headers: { Cookie: cookie } });

async function signedIn() {
  const res = await signIn("admin", env.ADMIN_PASSWORD);
  expect(res.status).toBe(200);
  const cookie = cookieOf(res);
  expect(cookie).toContain("session_token=");
  return cookie;
}

test("the admin signs in with ADMIN_PASSWORD and the session reads the stats", async () => {
  const cookie = await signedIn();
  const res = await stats(cookie, "?days=30");
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(((await res.json()) as { days: unknown[] }).days).toHaveLength(30);
});

test.each([
  ["admin", "wrong-password-0123456789abcdef0123"],
  ["somebody", undefined],
])("%s with a wrong password, or another name, gets no session", async (username, password) => {
  const res = await signIn(username, password ?? env.ADMIN_PASSWORD);
  expect(res.status).toBe(401);
  expect(res.headers.getSetCookie()).toEqual([]);
});

test("the stats need a session", async () => {
  const res = await stats();
  expect(res.status).toBe(401);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_signed_in");
  expect((await stats("wordless_admin.session_token=forged")).status).toBe(401);
});

test("a range the dashboard doesn't offer is a 400", async () => {
  const cookie = await signedIn();
  expect((await stats(cookie, "?days=8")).status).toBe(400);
});

test("signing out ends the session", async () => {
  const cookie = await signedIn();
  const out = await call("/api/auth/sign-out", {
    method: "POST",
    headers: { Cookie: cookie, Origin: ORIGIN },
  });
  expect(out.status).toBe(200);
  expect((await stats(cookie)).status).toBe(401);
});

test("a new ADMIN_PASSWORD ends the sessions the old one opened", async () => {
  const cookie = await signedIn();
  await syncAdminAccount(writeDb(env), await hashAdminPassword("another-password"), Date.now());
  expect((await stats(cookie)).status).toBe(401);
  // The next sign-in takes the password from the env var again.
  expect((await stats(await signedIn())).status).toBe(200);
});

test("the rest of Better Auth's API is shut", async () => {
  const signUp = await call("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: "x@example.com", password: "p".repeat(40), name: "x" }),
  });
  expect(signUp.status).toBe(404);
});
