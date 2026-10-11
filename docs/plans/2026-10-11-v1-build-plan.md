# wordless.one v1 build plan

Handoff record between sessions. `docs/ARCHITECTURE.md` stays the source of truth for product rules,
the API, the data model and infra. This file only tracks the order of work, what was learned, and
what to do next.

Last updated: 2026-10-11 (end of the Slice 2 session: `POST /posts`).

## Summary

Build v1 (ARCHITECTURE §1.3) as small slices. Each slice is one focused PR that leaves `main` green
and working. The API comes first (bots are the users), then the agent docs, then the human UI, then
deploy.

## Cross-slice rules

- Read `AGENTS.md` first. The ones that bite most often:
  - DB access only in `apps/site/src/worker/db/`.
  - `db.batch([...])`, never `db.transaction()`.
  - Limits live in `packages/shared`.
  - Never edit an applied migration, and never commit a drizzle-kit migration that rebuilds `bots`,
    `posts` or `reactions`.
  - Never log or return keys, emails or IPs.
  - No new infra or dependencies without asking the user (bindings count: `ratelimits`, `send_email`,
    Analytics Engine, cron triggers).
- If code and ARCHITECTURE.md disagree, update the doc in the same PR. Also update this file's
  statuses and `Next Slice`.
- Tests: only ones that can fail for a real regression (AGENTS.md "Tests"). Do a mutation check for
  anything non-trivial: break the code, watch the test fail, restore. Record it in the PR.
- Error responses go through `apiError()` (`http.ts`), bodies through `readJson()` with zod. New
  public routes set the §10.1 `Cache-Control`. Anything that returns a key is `private, no-store`.
- Commits are Conventional Commits. PR bodies follow #3 and #4: intro line, "What's in it",
  "Decisions worth a look", "Out of scope", "Tests".
- Every slice ends with `vp check`, `vp test` and `vp run -r build` green. Record the exact result
  in the PR and under Working Notes.

## Current State (2026-10-11)

Merged on `main`:

- #1 scaffold: Vite+ workspace, hello-world SPA, D1 schema (`bots`, `posts`, `reactions`,
  `recovery_tokens`, `snapshots`) and the CodeQuality workflow.
- #2 `packages/wordfilter`: `checkContent`, `checkBio`, `checkReaction` with corpus, property and
  guard tests.
- #3 `packages/shared` username rules and limits, API keys, `requireBot` auth, `GET /health`,
  `POST /usernames/check`, `POST /validate`, `GET /me`.
- `mise.toml` for one-command local setup.
- #4 `POST /register` (squash-merged as `521914b`): `parseEmail()` in `packages/shared`, `createBot()`,
  `hashIp()`, `storeCredentials()`, the `IP_HASH_SECRET` secret and `.dev.vars` flow.
- #5 register rate limit, 5/hour/IP in D1 (squash-merged as `765be6d`).

Open: the Slice 2 PR `feat(api): add POST /posts` (branch `feat/post-create`, from `765be6d`). Check
with `git fetch origin && git log origin/main --oneline -3` before branching (see Next Slice).

Worker layout (`apps/site/src/worker/`): `index.ts` (Hono app, error handlers),
`api.ts` (all `/api/v1` routes so far), `auth.ts`, `http.ts`, `keys.ts`, `credentials.ts`,
`ip-hash.ts`, `serialize.ts` (`iso()`, `serializePost()`), `db/schema.ts`, `db/queries.ts`. Tests are in `apps/site/test/` with helpers
`insertBot()` (accepts `lastPostAt`, `status`, `bio`, `createdAt`, `regIpHash`), `api()` and
`nextIp()` in `helpers.ts`. `http.ts` has `apiError()`, `readJson()` and `tooManyRequests()`
(`429` with `Retry-After` and `retry_after_s`; reuse it for `429 cooldown` and reaction limits).

Baseline: `vp test` runs 620 tests (49 shared, 506 wordfilter, 65 worker) on the Slice 2 branch.
On `main` at `765be6d` (before Slice 2) it is 606.

Not built yet: reading or deleting posts, feed, top, reactions, profiles, key rotation, `PATCH /me`, recovery, email,
admin, form fallback, snapshots, caching, cron, burst rate limits (the register hourly limit exists),
agent docs (`/skill.md` etc.), all of
the real UI, Analytics Engine events.

Infra reality:

- No code is deployed. The Workers `wordless` and `wordless-staging` exist only as empty
  placeholders that `wrangler secret put` created, and **`IP_HASH_SECRET` is set on both** (the user
  ran it on 2026-10-11; `wrangler secret list` shows it for prod with `--env=""` and for `--env
  staging`). Later secrets follow ARCHITECTURE §14.
- `wrangler.jsonc` has only `DB`, `ASSETS`, the `secrets.required` list and observability. No
  `ratelimits`, `send_email`, `analytics_engine_datasets` or `triggers.crons`.
- CI runs only `vp check`. **Tests and build are not in CI** (§14 says the PR pipeline should be
  check → test → build).
- The prod and staging D1 ids in `wrangler.jsonc` are filled in. Whether the databases hold the
  migrations is unverified.
- Email Sending is enabled for `wordless.one` (account tag `132abfb887f74b398992af69fad0eaed`), but
  its DNS records are **not in the zone yet** (ARCHITECTURE §12). No `send_email` binding yet.

## Working Notes

### 2026-10-11, `POST /register` session

- Verified for PR #4: `vp check` clean (37 files); `vp test` 601 passed; `vp run -r build` passed;
  `wrangler types` plus `vp check` pass with no `.dev.vars` (the CI path); a real `vp dev` server
  returned 201, then `username_taken` and `email_in_use` on repeats.
- Mutation checks: making `createBot` rethrow every error fails 5 register tests (conflicts and
  races). Making `hashIp` ignore the IP fails the IP-hash test.
- Not checked: the CodeQuality run on PR #4 (the GitHub API rate limit was exhausted at the end of
  the session; `git push` over SSH still worked).
- `vp dev` and `vp test` print `Using secrets defined in .dev.vars` or a harmless "Missing required
  secrets" warning (tests bind their own `IP_HASH_SECRET`).
- A `vp dev` server may already be running on :5173 (it was, started before `.dev.vars` existed, so
  `/register` returned 500 there). Check `lsof -ti :5173` before starting yours, use another port if
  needed, and never kill a server you didn't start.
- Worker tests share one D1 per test file, so usernames and emails must be unique per test.
- The Windows PowerShell snippet in `credentials.ts` was written from docs and never run on Windows.
- `CF-Connecting-IP` may be absent under `vp dev`. `register` hashes a missing header as `"unknown"`.
  Not yet checked whether the Vite plugin sets it. Slice 1 has to deal with this. (Checked in Slice 1:
  it is set to `127.0.0.1`; see the Slice 1 notes below.)
- The scaffold SPA (React 19 + TanStack Router, hello world) was already **95 KB gzip**, over the
  old §9.3 budget of 80 KB. Resolved below: the budget is now 130 KB.

### 2026-10-11, decisions after PR #4 was opened

- The user decided: keep `AGENTS.md` untouched (the pointer I added was reverted, so the user will
  point new sessions at this file); stay on React and raise the JS budget to 130 KB gzip (ARCHITECTURE
  §9.3, §19.3); defer running tests in CI (Slice A) until later.
- Ran `wrangler email sending enable wordless.one`: it printed "enabled: true" and `wrangler email
  sending settings wordless.one` shows it enabled (DKIM selector `cf-bounce`, return-path
  `cf-bounce.wordless.one`). `wrangler email sending dns get wordless.one` lists the five records
  needed (3 MX + SPF TXT on `cf-bounce.`, DKIM TXT on `cf-bounce._domainkey.`, `_dmarc` TXT with
  `p=reject`). `dig` against `henrik.ns.cloudflare.com` and 1.1.1.1 returned nothing for all of
  them, even after a retry 20 s later: **the CLI does not create the DNS records**. They have to be
  added in the dashboard (or with an API token that can edit DNS). Not done by me: no DNS token.
- Not verified: whether the account is on Workers Paid (needed to send to arbitrary recipients).
- The user then ran `secret put IP_HASH_SECRET` for prod and staging. Wrangler asked to create the
  missing Worker (non-interactive fallback: yes) and uploaded the secret, so no deploy was needed
  first. I confirmed with `wrangler secret list` for both environments. Prod needs `--env=""` to
  avoid a "multiple environments" warning.

### 2026-10-11, Slice 1 session (register rate limits)

Done on branch `feat/register-rate-limit`, branched from `main` at `521914b`. Not merged yet.

- Design: the hourly limit is **atomic**. `createBot()` runs one `INSERT ... SELECT ... WHERE (SELECT
  COUNT(*) ... reg_ip_hash = ? AND created_at > ?) < ? RETURNING id` (ARCHITECTURE §7.1, like the post
  cooldown). No row means `ip_limit`. The handler then calls `ipSignups()` (count + oldest
  `created_at`) only to compute `retry_after_s`. I chose this over count-then-insert because a
  non-atomic check is not "a little" off: see the mutation below.
- Constants `REGISTER_IP_MAX = 5` and `REGISTER_IP_WINDOW_S = 3600` live in `packages/shared`.
  (The earlier plan text called it `REGISTER_MAX_PER_IP_PER_HOUR`.)
- `CreateBotResult` now has `reason: "username" | "email" | "ip_limit"` (it was `conflict`).
- Only successful signups count, so `422`/`409` responses use up no quota.
- `retry_after_s` is `ceil((oldest + window - now) / 1000)`, at least 1. If the window emptied between
  the refused insert and the follow-up query, it is 1.
- Tests: `test/register-limit.test.ts` (5 new tests, fixed IPs, own D1). `register.test.ts` now sends
  a distinct `CF-Connecting-IP` per call via `nextIp()`.

Verified (all run from the repo root):

- `vp check`: clean (38 files, all 58 formatted).
- `vp test`: 15 files, **606 passed** (601 baseline + 5 new).
- `vp run -r build`: passed (SPA 94.96 kB gzip).
- Mutation checks (each reverted afterwards, then `vp test apps/site/test/register` green):
  - `<` to `<=` in the insert: 4 of 5 limit tests fail.
  - Drop the window filter (`gt(createdAt, 0 * since)`): "signups older than the window don't count"
    fails.
  - `retry_after_s` = whole window instead of oldest + window: "the wait ends when the oldest signup
    ages out" fails.
  - Count-then-insert instead of the atomic insert: the parallel test fails with **15 of 15 requests
    getting `201`** (limit 5), so the race is wide open without the atomic form.
- Live check on a second dev server (`vp dev --port 5174 --strictPort`, stopped afterwards; the
  server on :5173 was left alone): with no header, signups 1 to 5 were `201` and the 6th `429` with
  `retry-after: 3600` and the `rate_limited` body. Six signups with distinct `CF-Connecting-IP`
  headers were all `201`. The probe bots were deleted from the local D1 afterwards (it was empty before).

Findings:

- **Under `vp dev` the header is not missing.** The stored `reg_ip_hash` matches HMAC(secret,
  `"127.0.0.1"`), so the Vite plugin sets `CF-Connecting-IP: 127.0.0.1`. A header sent by the client
  passes through. Effect: all local signups share one bucket and the 6th in an hour is a `429`. Workaround:
  send your own `CF-Connecting-IP` with `curl`, or `mise run db:reset`. Documented in README and
  ARCHITECTURE §8.7. `"unknown"` now only happens when the header is absent (the Worker tests, if a
  test sends none); Cloudflare always sets it in production.
- D1 serializes writes, so one `INSERT ... WHERE (count) < n` is atomic. Locally (miniflare) the
  parallel test confirms it, but this has not been run against remote D1.
- `INSERT ... RETURNING` through drizzle's `db.get(sql)` returns the row, or `undefined` when the
  `WHERE` filtered everything out. Embedding a Drizzle select inside `sql` shares the window predicate
  (`botsFromIp`) between the insert guard and `ipSignups()`.
- The raw insert lists the `bots` columns by hand. A new `NOT NULL` column without a default breaks
  it, and every register test would fail, so drift is caught.
- Not touched, as instructed: `wrangler.jsonc`, tests-in-CI.

### 2026-10-11, Slice 2 session (`POST /posts`)

Done on branch `feat/post-create`, branched from `main` at `765be6d` (PR #5 was merged). Not merged yet.

- Design: `createPost()` (`db/queries.ts`) is one `db.batch()` of three statements: a conditional
  `INSERT INTO posts ... SELECT ... FROM bots WHERE <may post> RETURNING id`, `UPDATE bots ... WHERE
  <may post>`, and a read-back `SELECT status, last_post_at FROM bots WHERE id = ?`. One Drizzle
  predicate (`mayPost`) is shared by both writes, so they succeed or fail together. If no row comes
  back, the read-back (same transaction) gives the `last_post_at` that blocked it, which becomes
  `next_post_at`. Result: `{created: true, id} | {created: false, reason: "cooldown", lastPostAt} |
  {created: false, reason: "banned"}`.
- Deviation from the old §7.1 SQL, now updated in the doc: the `UPDATE` also checks `status = 0`.
  Without it, a bot banned between `requireBot` and the batch would get no post but would still have
  `post_count` incremented and its cooldown moved. That case now answers `403 banned`.
- The route filters first (`checkContent` with the shared `POST_LIMITS`, also used by `/validate`),
  so a `422` never touches the DB. `422` bodies are `{code, message, matches, hint}` (`matches` is `[]`
  when the filter gives none). `429 cooldown` goes through `tooManyRequests()` with `hint` and
  `next_post_at`.
- `serializePost(row: PostRow, origin)` in `serialize.ts` builds the §8.1 object. `PostRow`
  (`id, username, content, createdAt, reactionTotal, reactionTop` as the stored JSON string) is
  exported from `db/queries.ts` for Slices 3 to 7 to select into. `iso()` moved there from `api.ts`.
- `TODO(§7.1)` in the route marks the `latest` rebuild and cache purge for Slice 4.
- Tests: `test/posts.test.ts`, 14 tests (happy path with DB row and `/me`, `429` body and header with
  nothing changed, HTTP race, direct `createPost` race, other bot unaffected, six `422` codes, `401`
  without a key, exact cooldown boundary, banned-after-auth).

Verified (all run from the repo root):

- `vp check`: clean (40 files linted and type-checked, 60 formatted).
- `vp test`: 16 files, **620 passed** (606 baseline + 14 new).
- `vp run -r build`: passed (Worker 90.70 kB gzip, SPA 94.96 kB gzip).
- Mutation checks, each reverted afterwards (`vp test apps/site/test/posts.test.ts`):
  - `lte` to `lt` in `mayPost`: the boundary test fails.
  - Cooldown window dropped (`<= at`): 4 tests fail.
  - Cooldown passed in seconds instead of ms: the `429` test fails.
  - `UPDATE` guarded by `id` only: 4 tests fail (incl. `429` changes nothing, banned-after-auth).
  - `status` dropped from `mayPost`: the banned-after-auth test fails.
  - Raw `body.content` stored instead of the canonical form: the happy-path test fails.
  - Post written before the filter: all six `422` tests (and 3 others) fail.
  - `createPost` rewritten as read-then-write (separate `SELECT`, unconditional batch): the direct
    `createPost` race test fails 11 of 11 runs.
- Live check on a second dev server (`vp dev --port 5174 --strictPort`, stopped afterwards; the
  server on :5173 was left alone): register, then `422 contains_words`, `201` with the canonical
  content and `url` `http://localhost:5174/p/1`, `429 cooldown` with `retry-after: 3300`, and `/me`
  showing `post_count: 1` and the matching `next_post_at`. The local D1 was empty before; the probe
  bot, its post and the `posts` `sqlite_sequence` row were deleted afterwards.

Findings:

- **drizzle-orm 0.45.4's D1 `batch()` can't run raw `db.get(sql...)` / `db.run` / `db.all` items that
  have parameters**: it calls `preparedQuery.stmt.bind`, and `SQLiteRaw` has no `stmt` ("Cannot read
  properties of undefined (reading 'bind')"). Raw items without parameters work. So the insert uses
  `db.insert(posts).select(db.select({...}).from(bots).where(...))`. Drizzle's insert-select writes
  **every** column in table order, so the select lists `id` (`NULL`, AUTOINCREMENT picks it) and the
  defaults `0, '[]', 0`, and each `sql` field needs `.as("<column>")` or `tsc` rejects it. Adding a
  `posts` column breaks this at runtime (Drizzle throws on mismatched keys), and every post test would
  catch that. Recorded in ARCHITECTURE §7.0. Slice 5's reaction batch must use query-builder
  items with `sql` fragments inside (for example `db.update(posts).set({...})` with `sql` values), not
  raw `sql` statements.
- **Concurrent requests through `exports.default.fetch` are not reliably concurrent.** A trace showed
  the Worker receiving them in waves (one or two first, the rest only after those finished). With a
  check-then-insert in the handler, the HTTP race test caught it in only ~1 of 10 warm runs, whether
  with 5 or 10 requests. Calling `createPost()` directly with `Promise.all` catches a read-then-write
  every time, so that test is the real proof; the HTTP test stays as the end-to-end check §15 asks
  for. Recorded in ARCHITECTURE §15. Use the same pattern for reactions (Slice 5).
- Vitest here prints `console.log` output only for failing tests, so add a deliberate `throw` when
  tracing a passing test.
- Not changed, but noticed: §10.1 says authed responses carry `Cache-Control: private, no-store`.
  Neither `/me` nor `POST /posts` sets it (requests with `Authorization` aren't stored by shared
  caches anyway). Worth a one-line fix in `requireBot` some time; ask first.
- Not touched, as instructed: `wrangler.jsonc`, tests-in-CI (Slice A), burst limits (Slice 1.1).

## Open Questions

Ask the user rather than assuming:

1. **Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`): approved? Three `TODO(§8.7)`
   comments in `api.ts` (register 3/min, `/usernames/check`, `/validate`) are waiting on this.
   Blocks Slice 1.1 only.
2. **Cloudflare Email Service** (ARCHITECTURE §19.1): sending is enabled, but the user must add the
   DNS records (or provide a DNS-edit token) and confirm Workers Paid. Also confirm the `send_email`
   binding. Blocks Slice 9. Fallback is Resend behind the same `EmailSender` interface.
3. ~~JS budget vs React~~ Resolved 2026-10-11: React stays, budget is 130 KB gzip.
4. **First deploy** of staging and prod (Slice 14), and who sets any new remote secrets, such as
   `ADMIN_TOKEN` in Slice 11. `IP_HASH_SECRET` is already set on both.
5. **Cron triggers** (`triggers.crons`, needed in Slice 6): treat as infra and confirm.
6. Minor, decide in Slice 4: what `cursor` is when the feed is empty.

## Slices

Status legend: `[ ]` not started, `[-]` in progress, `[x]` done (verified).

### Slice 0: `POST /register`

Status: `[x]` Done and verified. Merged as `521914b` (PR #4).

Verification: see Working Notes 2026-10-11.

### Slice A (later): run tests and build in CI

Status: `[ ]` Deferred by the user on 2026-10-11 ("test in ci later"). Don't start it unasked.

- Goal: the 601 tests and the build gate PRs, as §14 describes.
- Why here: it's independent and tiny, and it would protect every later slice. The user chose to
  do it later.
- Implement: add `vp test` and `vp run -r build` steps to `.github/workflows/code-quality.yml` (or a
  second workflow; rename the doc's description in §14 to match). Make sure the `wrangler types`
  postinstall and workerd tests work on `ubuntu-latest`.
- Verification: the PR's own checks run all three and pass. Update §14 ("No tests") in the same PR.
- Dependencies: none.

### Slice 1: register rate limits, hourly window in D1

Status: `[x]` Done and verified. Merged as `765be6d` (PR #5). See Working Notes 2026-10-11, Slice 1
session. The implementation differs from the sketch below in one way: the check is
an atomic conditional insert (the plan's second option), not a count before the insert.

- Goal: at most 5 registrations per IP per hour (§8.7), answered with `429 rate_limited` and a
  `Retry-After` header.
- Why here: it finishes `/register`. It needs no new infra: the `bots_reg_ip(reg_ip_hash,
  created_at)` index already exists.
- Implement:
  - Add `REGISTER_IP_MAX = 5` and `REGISTER_IP_WINDOW_S = 3600`, the one-hour window, to `packages/shared/src/index.ts`
    (named constants, not literals in the route).
  - In `db/queries.ts`, add one query that returns the count and the oldest `created_at` for an
    `reg_ip_hash` since `now - window`.
  - In the `/register` handler (`api.ts`, the `TODO(§8.7)` line), run the check after input
    validation and before the insert, so `422`/`409` responses don't cost anything. Error shape:
    `{error: {code: "rate_limited", message, hint, retry_after_s}}` plus `Retry-After`.
    `retry_after_s` = when the oldest row in the window ages out.
  - The count-then-insert is not atomic, so a burst can overshoot a little. Accept that (the burst
    binding in Slice 1.1 is meant for bursts) and write it down in §8.7, or make it atomic with a
    conditional insert like §7.1. Say which in the PR.
  - Keep the `TODO(§8.7)` for the 3/min binding.
- Gotchas:
  - `register.test.ts` registers about 20 bots from the same IP bucket (no header → `"unknown"`).
    Give the test helper a distinct `CF-Connecting-IP` per call by default, and use a fixed IP only
    in the new limit tests.
  - `insertBot()` in `test/helpers.ts` hard-codes `regIpHash`. Allow overriding it (or `createdAt`)
    to seed old rows for the "window slides" test.
  - Locally, if `vp dev` sends no `CF-Connecting-IP`, every dev signup shares one bucket and the 6th
    in an hour is blocked. Check what the Vite plugin sends. If it doesn't set it, keep counting
    `"unknown"` (stricter is safer; Cloudflare always sets the header in production), and document
    `mise run db:reset` in the PR.
- Expected output: updated `api.ts`, `queries.ts`, shared constants, tests, ARCHITECTURE §8.3/§8.7.
- Verification: `vp check`, `vp test`. New tests: the 6th signup from one IP is `429` with
  `Retry-After` and `retry_after_s`; another IP is unaffected; rows older than the window don't
  count; rejected requests (`422`/`409`) don't count. Mutation check: change `<` to `<=` or drop the
  window filter and watch a test fail.
- Dependencies: PR #4 merged (done).

### Slice 1.1: burst limits with the Rate Limiting binding

Status: `[ ]` Blocked on Open Question 1.

- Add `ratelimits` bindings to `wrangler.jsonc` (top level and `env.staging`; bindings aren't
  inherited) and a small `limits.ts` wrapper. Apply: register 3/min/IP, `/usernames/check`
  10/min/IP, `/validate` 30/min per key (bot id) or IP. Remove the three `TODO(§8.7)` comments.
- First prove the binding is simulated inside `@cloudflare/vitest-plugin` tests. If it isn't,
  decide with the user how to test it.
- Never put a raw IP in a limiter key: use the hex of `hashIp()`. The `/register` handler computes
  that hash inline (`CF-Connecting-IP`, else `"unknown"`); extract a small `clientIpHash(c)` helper
  when a second caller appears, so the limiter key and `reg_ip_hash` can't diverge.
- The register burst check can run before `readJson` (cheapest first). It must not change the hourly
  logic in `createBot()`.
- Locally every request is `127.0.0.1`, so a 3/min limit will also trip during manual testing.
- Document the bindings in §14 and run `pnpm --filter site cf-typegen`.

### Slice 2: `POST /posts`

Status: `[x]` Done and verified on `feat/post-create` (PR pending). See Working Notes 2026-10-11,
Slice 2 session. Differences from the sketch below: the `UPDATE` also checks `status = 0`, the batch
ends with a read-back of the bot, and the insert is a Drizzle insert-select (raw `sql` can't go in a
D1 batch in drizzle-orm 0.45).

- Goal: a bot can post. Cooldown enforced atomically (§7.1, §8.4).
- Why here: the core write. Reads (feed) come after there is something to read.
- Implement:
  - `createPost()` in `db/queries.ts` as one `db.batch()`: the conditional `INSERT ... SELECT ...
    WHERE EXISTS (...)  RETURNING id` and the guarded `UPDATE bots` from §7.1. No row returned
    means `429 cooldown`.
  - Route: `checkContent` with the `POST_MAX_*` limits (as `/validate` does), store the canonical
    content. Errors: `422` with the filter's code, `matches`, `hint`. A rejected post must not touch
    the cooldown. `429 cooldown {next_post_at, retry_after_s}` plus `Retry-After`: use `tooManyRequests()` from
    `http.ts` with `next_post_at` as `extra`.
  - A `serializePost()` helper for the §8.1 post object (id, author, content, ISO `created_at`,
    `reactions {total, top}`, `url`). Slices 3 to 7 reuse it.
  - Leave `TODO(§7.1)` for "rebuild `latest` snapshot and purge cache keys"; Slice 4 wires it.
- Verification: tests for the happy path (`/me` shows the new `post_count`, `last_post_at` and
  cooldown); **two concurrent posts produce exactly one `201`** (§15); each `422` code leaves the
  cooldown untouched; the `429` body and header; another bot isn't affected. Mutation check on the
  cooldown predicate.
- Dependencies: none beyond #4.

### Slice 3: `GET /posts/:id` and `DELETE /posts/:id`

Status: `[ ]`

- Read: PK lookup joined to `bots`; hidden posts are `404`. Set the §10.1 `Cache-Control` headers
  (the cache layer itself comes in Slice 4.1).
- Delete: `204` / `403 not_owner` / `404`. One batch: decrement `bots.post_count` and
  `reactions_received` (by the post's `reaction_total`, read in SQL before the delete), then delete
  the post (reactions cascade). **`last_post_at` must not change.**
- The `ON DELETE CASCADE` on `reactions` is not tested yet (`test/schema.test.ts` covers only BLOB
  round-trips and id non-reuse). Prove here that deleting a post removes its reactions on D1.
- Verification: delete leaves the cooldown intact; counters are right after a delete of a reacted
  post (seed reactions by hand until Slice 5); the cascade removes reactions.
- Dependencies: Slice 2.

### Slice 4: `latest` snapshot and `GET /feed`

Status: `[ ]`

- New `db/snapshots.ts`: `rebuildLatest()` writes the newest 100 visible posts as ready-to-serve JSON
  to `snapshots('latest')`. The feed reads that one row (§7.2).
- `GET /feed?limit`, `?since=<id>` (filter the snapshot in memory; `gap: true` plus `next` when the
  id is older than the window) and `?before=<id>` (PK range, 50 rows, join `bots`). Responses carry
  `cursor` and `next` (§8.1).
- Wire `ctx.waitUntil(rebuildLatest(...))` into post create (Slice 2) and delete (Slice 3). Check
  that `waitUntil` works under `exports.default.fetch` in the vitest plugin.
- Reads use `readDb()`; snapshot rebuilds read the primary.
- Verification: pagination across pages with no gaps or duplicates; `since` and `gap`; a post made
  now is in the feed after the response; hidden posts excluded.

### Slice 4.1: cache layers

Status: `[ ]`

- L0 isolate memory (2 s, snapshots only), L1 Cache API with canonical keys (known params only),
  local purge on writes (§10.1, §10.2). Test that junk query strings don't create new cache entries.

### Slice 5: reactions

Status: `[ ]`

- `PUT` and `DELETE /posts/:id/reaction`: `checkReaction`, `403 self_reaction`, `404`,
  `429 rate_limited` (via `tooManyRequests()`). §8.4 says `422 invalid_emoji`, but `checkReaction` returns its own codes
  (`contains_words`, `invalid_characters`, `empty`, `too_long`). Decide the mapping and fix whichever
  side is wrong in the same PR.
- The §7.1 batch: upsert, recompute `reaction_total` and `reaction_top`, adjust `reactions_received`
  from a pre-read of the existing row. Concurrent PUTs from one bot can drift the counter. Note it;
  the nightly reconcile in Slice 6 repairs it.
- Limits: 60/hour per bot counted in D1 (`reactions_by_bot`), 20/min burst via the binding once
  Slice 1.1 exists. Constants in `packages/shared`.
- Rebuild `latest` after reaction writes only if cheap; otherwise the cron does it.

### Slice 6: `top24`, `GET /top`, cron

Status: `[ ]`

- `rebuildTop24()` over the `posts_reacted` partial index; `GET /top`; `scheduled()` every minute to
  rebuild both snapshots; hourly cleanup of expired `recovery_tokens`; nightly reconcile of
  `post_count` and `reactions_received`. `/health` also reports snapshot age.
- Needs the `triggers.crons` config: confirm first (Open Question 5).

### Slice 7: profiles and avatars

Status: `[ ]`

- `GET /bots/:username` (profile plus first 50 posts) and `/bots/:username/posts?before=`. Never
  expose email or IP data. Put the FNV-1a avatar generator in `packages/shared` so the SPA and
  `GET /a/:username.svg` share it.

### Slice 8: `POST /keys/rotate` and `PATCH /me`

Status: `[ ]` Small and independent. Can be pulled forward as a warm-up.

- Rotate: new key, old one dead on the next request (auth reads the primary). `PATCH /me {bio}` uses
  `checkBio` like register. Never log keys.

### Slice 9: key recovery and email

Status: `[ ]` Blocked on Open Question 2.

- First, check the DNS records exist: `dig +short MX cf-bounce.wordless.one @henrik.ns.cloudflare.com`.

- `EmailSender` interface plus the Cloudflare implementation (`send_email` binding: ask first),
  `POST /recover` (always `202`, 3/hour per bot counted on `recovery_by_bot`), `POST
  /recover/confirm` (single-use, 30-minute tokens, `410 token_invalid`). Tests use a fake sender.
  Remove the `/recover` caveat from the `email_in_use` hint when this lands.

### Slice 10: agent docs

Status: `[ ]`

- `public/llms.txt`, `skill.md`, `heartbeat.md` with `{{BASE_URL}}` templating, served by the Worker
  with 5-minute caching (§11). Check the OpenClaw and Hermes cron syntax against their current docs
  while writing (§11 note). Replace the hard-coded `DOCS_URL` in `http.ts` if staging should differ.

### Slice 11: admin endpoints and CLI

Status: `[ ]`

- `/api/admin/*` with `ADMIN_TOKEN` (add it to `secrets.required` and `.dev.vars.example`) and
  `scripts/admin.ts`. Ban hides all of the bot's posts and rebuilds snapshots.

### Slice 12: form fallback

Status: `[ ]`

- Form-encoded writes with `api_key` in the body, and the no-JS `GET /act` page (§8.6). Never accept
  keys in URLs.

### Slice 13: the web UI (several PRs)

Status: `[ ]` React stays and the JS budget is 130 KB gzip (decided 2026-10-11).

- 13a router and feed view from the API; 13b `HTMLRewriter` boot-data injection, titles and OG tags,
  security headers (§9.2, §9.4); 13c polling and the `↑ N` pill; 13d profile, permalink, about and
  recover pages; 13e styles and the Playwright smoke test.

### Slice 14: deploy

Status: `[ ]`

- Staging deploy on push to `main`, prod on tag, remote migrations, first-deploy secrets, custom
  domains and DNS (§14). Needs the user's Cloudflare credentials in GitHub secrets.

### Slice 15: observability

Status: `[ ]`

- Analytics Engine dataset and events (§16), the 5 GB D1 alert. Needs the binding (ask first).

## Final verification (before calling v1 done)

`vp check`, `vp test`, `vp run -r build`, the Playwright smoke test against staging, and a manual
run of the §2.3 heartbeat with `curl` against staging.

## Next Slice

**Slice 3: `GET /posts/:id` and `DELETE /posts/:id`.** Slice A (tests in CI) is still deferred by the
user and Slice 1.1 still waits on the Rate Limiting binding (Open Question 1). `AGENTS.md` is
deliberately unchanged, so the user will point you at this file.

Start here:

1. `git fetch origin`. If the Slice 2 PR (`feat/post-create`) is merged:
   `git switch main && git pull`, then `git switch -c feat/post-read-delete`. If it is not merged and
   the user wants to continue anyway, branch from `feat/post-create`. Don't use the `gh` API heavily
   if it is rate limited; `git` over SSH is unaffected.
2. Read `AGENTS.md`, then ARCHITECTURE §7.0 (the batch note), §7.1 (create post, delete post), §7.2,
   §8.1, §8.2, §8.4 and §10.1, then `db/queries.ts` (`createPost()`, `PostRow`), `serialize.ts`
   (`serializePost()`) and `test/posts.test.ts`.
3. `vp test` should report 620 passing before you change anything (606 on a `main` without Slice 2).
   Use `mise run dev` only if you need a live server; check port 5173 first (`lsof -ti :5173`),
   because one may already be running, and never kill a server you didn't start.
4. Follow the Slice 3 section above. Select into `PostRow` (join `bots` for `username`) and reuse
   `serializePost()`. Reads use `readDb()`. Remember: batch items must be query builders, not raw
   `sql` statements (§7.0). Seed posts with `createPost()` or a direct insert, and reactions by hand.
5. Ask the user before touching `wrangler.jsonc` bindings.
6. Done when `vp check`, `vp test` and `vp run -r build` pass, ARCHITECTURE matches the code, this
   file's Slice 3 is `[x]` with the exact commands under Working Notes, and `Next Slice` points at
   Slice 4.
