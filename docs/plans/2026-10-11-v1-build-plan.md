# wordless.one v1 build plan

Handoff record between sessions. `docs/ARCHITECTURE.md` stays the source of truth for product rules,
the API, the data model and infra. This file only tracks the order of work, what was learned, and
what to do next.

Last updated: 2026-10-11 (end of the Slice 4.1 session: the cache layers).

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
- #6 `POST /posts` (squash-merged as `1573a94`): `createPost()`, `serializePost()`, `PostRow`.
- #7 `GET` and `DELETE /posts/:id` (squash-merged as `1aade79`): `findPost()`, `deletePost()`,
  `parseId()`, `publicCache()`.
- #8 `GET /feed` and the `latest` snapshot (squash-merged as `012c78a`): `rebuildLatest()`,
  `readLatest()`, `latestPage()`, `EDGE_TTL_S`, and `private, no-store` on everything behind a key.

Open: the Slice 4.1 PR #9 `feat(cache): add L0 and L1 read caches with a local purge on writes` (branch
`feat/cache`, from `012c78a`). Check with `git fetch origin && git log origin/main --oneline -3` before
branching (see Next Slice).

Worker layout (`apps/site/src/worker/`): `index.ts` (Hono app, error handlers),
`api.ts` (all `/api/v1` routes so far), `auth.ts`, `http.ts`, `keys.ts`, `credentials.ts`,
`ip-hash.ts`, `serialize.ts` (`iso()`, `serializePost()`), `feed.ts` (`latestPage()`, the pure paging
and gap rules), `cache.ts` (L0 and L1: `readLatestCached()`, `cachedResponse()`, `purgeLatest()`,
`purgePost()`, `rebuildAndPurgeLatest()` and the `latestKey()`, `feedBeforeKey()`, `postKey()` builders),
`db/schema.ts`, `db/queries.ts` (`createPost()`, `findPost()`, `deletePost()`,
`visiblePosts()`, `olderPosts()`, `PostRow`) and `db/snapshots.ts` (`rebuildLatest()`, `readLatest()`).
Tests are in `apps/site/test/` with helpers `insertBot()` (accepts `lastPostAt`, `status`, `bio`,
`createdAt`, `regIpHash`), `seedPost()` (a post through `createPost()` with no cooldown wait),
`insertPosts()` (bulk insert, no counters; use it to fill a feed), `clearFeed()` (also purges the cached
snapshot: isolate memory and the Cache API outlive a test), `rebuild()` (what a post or delete does after
its response: rebuild `latest`, then purge; use it instead of calling `rebuildLatest()` and then reading),
`lateDb()` (a `Db` whose answers arrive late; for stale-write races), `gatedDb()` (a `Db` whose statements
wait for `release()`; for what happens before a write lands), `ORIGIN`, `api()` and `nextIp()` in
`helpers.ts`. `http.ts` has
`apiError()`, `readJson()`, `readQuery()` and `intParam()` (zod query params in canonical spelling),
`tooManyRequests()` (`429` with `Retry-After` and `retry_after_s`; reuse it for `429 cooldown` and
reaction limits), `parseId()` (canonical row id from a URL segment) and `publicCache(c, ttlS)` (the
§10.1 `Cache-Control` for public JSON). `packages/shared` holds the feed limits, `EDGE_TTL_S` (the L1 TTL of each
public route) and `ISOLATE_TTL_S` (the L0 TTL).

Baseline: `vp test` runs 702 tests (49 shared, 506 wordfilter, 147 worker) on the Slice 4.1 branch.
On `main` at `012c78a` (before Slice 4.1) it is 687.

Not built yet: top, reactions, profiles, key rotation, `PATCH /me`, recovery, email, admin, form
fallback, cron, the `top24` snapshot, burst rate
limits (the register hourly limit exists), agent docs (`/skill.md` etc.), all of the real UI,
Analytics Engine events.

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

Done on branch `feat/post-create` (PR #6), branched from `main` at `765be6d` (PR #5 was merged). Merged as `1573a94`.

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
  caches anyway). Worth a one-line fix in `requireBot` some time; ask first. (Done in Slice 4, PR #8.)
- Not touched, as instructed: `wrangler.jsonc`, tests-in-CI (Slice A), burst limits (Slice 1.1).

### 2026-10-11, Slice 3 session (`GET` and `DELETE /posts/:id`)

Done on branch `feat/post-read-delete`, branched from `main` at `1573a94` (PR #6 was merged). Merged as `1aade79` (PR #7).

- Design: `deletePost(db, botId, postId)` (`db/queries.ts`) is one `db.batch()` of three query builders:
  `UPDATE bots SET post_count = post_count - 1, reactions_received = reactions_received - (SELECT
  reaction_total FROM posts WHERE <mine>) WHERE id = ? AND EXISTS (SELECT 1 FROM posts WHERE
  <mine>)`, then `DELETE FROM posts WHERE <mine> RETURNING id`, then `SELECT id FROM posts WHERE id =
  ?`. `<mine>` is `id = ? AND bot_id = ?`, so both writes share one predicate. The counters go first
  because they read the post the delete removes. A returned row means `204`; otherwise the read-back
  says `403 not_owner` (post still there) or `404`. `last_post_at` is never in the `SET`. Result:
  `{deleted: true} | {deleted: false, reason: "not_found" | "not_owner"}`.
- `findPost(db, id)` selects into `PostRow` (inner join `bots`, `hidden = 0`). The route returns
  `{post: serializePost(...)}` with `Cache-Control: public, max-age=5, s-maxage=30` on the `200` only.
  `publicCache()` in `http.ts` builds that header for later routes. The TTL (30) is a local constant in
  `api.ts`; Slice 4.1 should gather the per-route TTLs.
- `parseId()` accepts only `^[1-9][0-9]*$` that is a safe integer: `/posts/012` and `/posts/12.0` are `404`
  even though post 12 exists, so one post has one cache key (§10.1). It applies to `DELETE` too.
- Tests (15 new): `post-read.test.ts` (6), `post-delete.test.ts` (8), and a cascade test in
  `schema.test.ts`. Reactions are seeded by hand in `post-delete.test.ts` (`addReactions()` inserts the
  rows and bumps `posts.reaction_*` and `bots.reactions_received`, the way §7.1's React batch will).

Verified (all run from the repo root):

- `vp check`: clean (42 files linted and type-checked, 62 formatted).
- `vp test`: 18 files, **635 passed** (620 baseline + 15 new). The 17 tests in the three touched files
  passed 10 runs in a row (`vp test apps/site/test/post-delete.test.ts apps/site/test/post-read.test.ts
  apps/site/test/schema.test.ts`).
- `vp run -r build`: passed (Worker 91.81 kB gzip, SPA 94.96 kB gzip).
- Mutation checks, each reverted afterwards (the three files above):
  - Owner check dropped (`<mine>` without `bot_id`): the `403 not_owner` test fails.
  - `post_count` not decremented: 4 tests fail. `reactions_received` not decremented: 2 fail.
  - `last_post_at` set to `null` in the update: the cooldown test fails.
  - `EXISTS` guard dropped from the update: 4 tests fail. A missing id gives `500` (`NOT NULL constraint
    failed: bots.reactions_received`, because `x - NULL` is `NULL`); someone else's post is wrongly decremented.
  - Delete placed before the counters: 4 tests fail.
  - `deletePost` rewritten as read-then-write (separate `SELECT`, unconditional batch): **only** the
    direct `Promise.all` test fails. The HTTP race test passes it, as ARCHITECTURE §15 warns.
  - `ON DELETE cascade` removed from `0000_init.sql` (temporarily): the schema cascade test and 2 delete
    tests fail.
  - `hidden = 0` dropped from `findPost`: the hidden-post test fails.
  - `parseId` with leading zeros allowed, or no validation: the canonical-spelling test fails.
  - `publicCache()` call removed, or the TTL changed: the cacheable-read test fails.
- Live check on a second dev server (started with `cd apps/site && vp dev --port 5174 --strictPort`,
  stopped afterwards; the server on :5173, pid 42248, was left alone): `GET /posts/2` anonymous returned
  `200` with `cache-control: public, max-age=5, s-maxage=30` and the same body as `POST /posts`;
  another bot's `DELETE` gave `403 not_owner`, no key gave `401`, the owner's gave `204` with no body,
  then `GET` and a second `DELETE` gave `404`, `/me` showed `post_count: 0` with `last_post_at` and
  `next_post_at` unchanged, and a new post was `429 cooldown`. `abc`, `02` and `1.5` were `404`. The local
  D1 was empty before; the probe bots and posts and the `posts` `sqlite_sequence` row were deleted
  afterwards (`pnpm exec wrangler d1 execute DB --local --command "..."` from `apps/site`).

Findings:

- **`vp dev` at the repo root is plain Vite, not the site.** It prints "You are running `vp dev` as a
  Vite+ built-in command", serves no Worker, and every `/api` request is an empty `404`. Run it from
  `apps/site` (`cd apps/site && vp dev --port 5174 --strictPort`) or use `mise run dev`. The Slice 1 and
  2 notes give the command without saying which directory.
- `wrangler` is not on PATH outside a mise shell. Use `pnpm exec wrangler ...` from `apps/site`.
- Junk ids (`abc`, `-1`, `1e3`, `1e20`) are `404` even with no validation at all, because D1 binds them and
  finds no row. The validation is there for the cache key (canonical spelling), and that is what is tested.
- **For Slice 5:** `reactions_by_bot` counts live `reactions` rows, so deleting a post removes the reactions
  on it and the reactors get that part of their hourly quota back. Decide whether that matters (a bot could
  re-react after its friend deletes and reposts) and note it in §8.7 if it is accepted.
- A hidden post can still be deleted by its author (`deletePost` ignores `hidden`). In v1 only a ban hides
  posts and a banned bot can't authenticate, so this is unreachable until an admin hide exists. Revisit
  with Slice 11 if admin gets a per-post hide.
- Not changed, as instructed: the missing `Cache-Control: private, no-store` on authed responses (`/me`,
  `POST /posts`, `DELETE /posts/:id`; ask the user first), `wrangler.jsonc`, tests-in-CI (Slice A), burst
  limits (Slice 1.1). (The header was added in Slice 4, PR #8, once the user approved.)

### 2026-10-11, decision after PR #7: public ids

- The user decided: the integer `AUTOINCREMENT` ids stay the public ids (permalinks, `since` and `before`
  cursors). There is **no `public_id` column**. Reasons: the ids are the cursors, every post is public
  anyway, and nothing is deployed yet. Recorded as decision 36 in ARCHITECTURE §18. Don't reopen it.

### 2026-10-11, Slice 4 session (`latest` snapshot and `GET /feed`)

Done on branch `feat/feed`, branched from `main` at `1aade79` (PR #7 was merged). Merged as `012c78a` (PR #8).

- Design: `rebuildLatest(db)` (`db/snapshots.ts`) is **one statement**, `INSERT INTO snapshots ... SELECT
  json_group_array(json_object(...)) FROM (<newest 100 visible posts>) WHERE true ON CONFLICT (name) DO
  UPDATE`, run on the primary outside a batch (raw `sql` is fine there). Rows are read and written at one
  instant, so a slow rebuild can't put an older view over a newer one (no `updated_at` guard needed).
  `readLatest(db)` reads the one row; with no row (fresh DB, or posts that predate the first rebuild) it
  reads the same newest 100 live, so the feed never answers "empty" wrongly. A read never writes.
- **Origin:** the snapshot stores `PostRow`s (`id, username, content, createdAt, reactionTotal,
  reactionTop` as the stored JSON string), with no `url`. `serializePost()` adds the request's origin at
  read time, so the cron (no request) can rebuild it. Changing the stored shape needs a rebuild right
  after the deploy (the Slice 6 cron does one a minute); `readLatest` trusts the shape.
- `GET /feed` (`api.ts`): zod on the three known params (`intParam()` in `http.ts`, canonical spelling
  only). **Malformed or out of range is `400 invalid_request`, never clamped**; `since` with `before` is
  `400`; unknown params are ignored; `limit` is 1 to 100 (default 50); `since` may be `0`; `before` is 1+.
  Answers `{posts, cursor, next}` plus `gap` when `since` is given. Posts are newest first.
  - `cursor` = newest id in `posts`; **Open Question 6 decided:** with no posts it echoes the caller's
    `since`, or `0` with none. The cursor of a `before` page is that page's newest id, so a bot must save
    `cursor` only from a request without `before`.
  - `gap` = a **full** snapshot (100 posts) with `since < oldest id - 1`. One below the oldest id is no
    gap (the bot has seen everything under it). This is one stricter than "since below the oldest id" in
    the handoff; it is covered by `feed-page.test.ts`. A full snapshot can't tell a missing post from a
    deleted id, so it may report a gap with no post in it.
  - `next` = `…/feed?before=<oldest id returned>`, or `null`. With `since`, `next` is non-null only if
    posts newer than `since` are missing from `posts` (a gap, or cut off by `limit`); the older posts are
    the ones the bot already has. From the first page, `next` is `null` only for a snapshot short of full
    that was not cut off; a full one can't know, so its `next` may lead to an empty page.
  - `before` pages are `FEED_BEFORE_PAGE_SIZE` (50) posts and ignore `limit` (one cache key per id,
    §7.2). `olderPosts()` reads 51 rows to know whether a next page exists.
- Constants moved to `packages/shared`: `LATEST_SNAPSHOT_SIZE` 100, `FEED_DEFAULT_LIMIT` 50,
  `FEED_MAX_LIMIT` 100, `FEED_BEFORE_PAGE_SIZE` 50 and `EDGE_TTL_S = {post: 30, feed: 10, feedBefore:
  60}` (replaces `POST_READ_TTL_S` in `api.ts`). Slice 4.1 should read its L1 TTLs from `EDGE_TTL_S` too.
- Wiring: `refreshLatest()` in `api.ts` calls `ctx.waitUntil(rebuildLatest(...).catch(log))` after a
  successful post create and delete. A failed rebuild is logged and the snapshot stays until the next
  write or the cron. Both places keep a `TODO(§10.2)` for the cache purge (Slice 4.1).
- `visiblePosts()` in `db/queries.ts` is the one `PostRow` select with `hidden = 0`; `findPost()`,
  `olderPosts()` and the snapshot all start from it.
- Tests (52 new): `feed-page.test.ts` (the pure gap and `more` matrix), `feed.test.ts` (fresh DB, no
  snapshot row, snapshot-vs-live, post shape, origin, a 190-post walk through the snapshot-to-table seam
  at three limits, `before` boundaries, `since`, gap filling, limits, 15 bad queries, cache headers),
  `snapshot.test.ts` (rebuild contents and order, replace, empty, the late-answer race, and the
  create and delete wiring through `vi.waitFor`); `auth.test.ts` has one more test: every response behind a
  key (200, 201, 204, a handler's 429, the middleware's 401 and 403) is `private, no-store`.
- `requireBot` (`auth.ts`) sets `Cache-Control: private, no-store` before it checks the key (added after the
  user approved it on 2026-10-11, in the same PR). `POST /register` already set it itself.

Verified (all run from the repo root):

- `vp check`: clean (47 files linted and type-checked, 67 formatted).
- `vp test`: 21 files, **687 passed** (635 baseline + 52 new). The full suite passed 5 runs in a row, and
  `vp test apps/site/test/snapshot apps/site/test/feed` (51 tests) passed 15 runs in a row.
- `vp run -r build`: passed (Worker 96.13 kB gzip, up from 91.81; SPA 94.96 kB gzip).
- Mutation checks, each reverted with `git checkout` afterwards (tests: `apps/site/test/feed` and
  `apps/site/test/snapshot`, plus `post-read` for the hidden filter):
  - `since`: `>` to `>=`: 4 fail. `before`: `<` to `<=`: 5 fail (the walks and the boundary test).
  - Hidden filter dropped from `visiblePosts()`: 6 fail (3 walks, `before`, the snapshot rebuild, the
    `post-read` hidden test).
  - Gap rule: `since < oldest - 1` to `since < oldest`: 2 fail; young snapshot not exempt: 2 fail; never a
    gap: 5 fail.
  - Order: snapshot picks the oldest 100 (`orderBy` ascending): 11 fail; the aggregate fed oldest first
    (`ORDER BY id` in a wrapping subquery): 10 fail, so SQLite does hand `json_group_array` its input in
    order and the test pins it; `before` pages ascending: 5 fail.
  - Limit: upper bound dropped from `intParam`: 2 fail (`limit=101`, a 20-digit `since`); `limit` ignored on
    the first page: 4 fail; ignored with `since`: 1 fail (the unit test only); default limit set to the max: 1.
  - Wiring: no rebuild after create, or after delete: 1 fail each (they time out in `vi.waitFor`).
  - No snapshot row answers empty instead of reading live: 1 fail. Cursor not echoing `since`: 2 fail.
  - `olderPosts`: `more` as `>=` instead of `>` **survived** until I added "a before page links on only
    when older posts remain beyond it"; now 1 fails. Reading `size` instead of `size + 1` rows: 3 fail.
  - Auth header (`auth.test.ts`, 1 test each): the line removed, moved below the key check (so the 401 and
    403 lack it), or weakened to `no-store`: 1 fails each.
  - Head `more` ignoring a full snapshot: 2 fail. `ON CONFLICT` updating only `updated_at`: 4 fail.
    Snapshot of 50 instead of 100: 4 fail.
  - Stale write: a read-then-write rebuild **passed my first concurrency test 10 of 10 runs** (12 tasks,
    each insert then rebuild, in a `Promise.all`). With equal latency D1 runs statements in arrival order,
    so a rebuild's write can't land after a newer rebuild's. The test was replaced by "a rebuild that hears
    back late can't put an older view over a newer one", which uses `lateDb(60)` (statements run at once,
    the caller hears back 60 ms later). The read-then-write version fails it 10 of 10 runs; the real one
    passes.
- Live check against the already running `mise run dev` server on :5173 (no new server started, nothing
  killed): the empty feed answered `{"posts":[],"cursor":0,"next":null}`; the validation cases gave `400`
  and the `Cache-Control` headers were `s-maxage=10` / `60`. Then register (with its own
  `CF-Connecting-IP`), `POST /posts`, `GET /feed` (the post, with `http://localhost:5173/p/1`), `since=1`
  (empty, `cursor: 1`, `gap: false`), `since=0` (the post), `before=1` (empty), `DELETE` (`204`), and
  `GET /feed` (empty again). The `snapshots` row held `[]` with an `updated_at` after the delete, so both
  `waitUntil` rebuilds ran. The local D1 was empty before; the probe bot, post, snapshot row and `posts`
  `sqlite_sequence` row were deleted afterwards (`pnpm exec wrangler d1 execute DB --local ...` from
  `apps/site`).

Findings:

- **An equal-latency `Promise.all` can't catch a stale-write race.** It catches check-then-write (Slices 2
  and 3: both calls read before either writes), but not "an old read lands its write after a newer
  rebuild", because D1 serializes statements in arrival order. Use `lateDb()` for that shape. Recorded in
  ARCHITECTURE §15. Slice 5 (reactions) and Slice 6 (`top24`) should use it if they add a rebuild.
- `waitUntil` works under `exports.default.fetch` in `@cloudflare/vitest-plugin` (`c.executionCtx` is a
  real context), but it can't be awaited, so the wiring tests poll the feed with `vi.waitFor`. They need a
  snapshot row to exist first, or the no-row fallback would show the new post without any rebuild.
- Hono's `c.executionCtx` is typed narrower than the global `ExecutionContext`; `refreshLatest()` takes
  `Pick<ExecutionContext, "waitUntil">`.
- D1 allows 100 bound variables per statement. Drizzle binds the column defaults too, so a `posts` row is 6
  variables, and `insertPosts()` inserts 12 rows per statement (72 variables).
- A 400 on `limit` over 100 (rather than clamping) means a bot that asks for 200 gets an error naming the
  bound. If that proves too strict in practice, it is one line in `intParam()`.
- Not changed, as instructed: `wrangler.jsonc`, tests-in-CI (Slice A), burst limits (Slice 1.1), the cache
  layers (Slice 4.1).

### 2026-10-11, Slice 4.1 session (cache layers)

Done on branch `feat/cache` (PR #9), branched from `main` at `012c78a` (PR #8 was merged). Not merged yet.

- Design (`cache.ts`):
  - **What is cached.** L0 (a `Map` slot in isolate memory, `ISOLATE_TTL_S` = 2) and L1 (`caches.default`,
    `EDGE_TTL_S.feed` = 10) hold the **snapshot rows** under one fixed internal key (`<origin>/_cache/latest`);
    `limit` and `since` are cut from them in memory by `latestPage()`, so neither makes an entry. L1 also
    holds the **whole response** of `GET /feed?before=<id>` and `GET /posts/:id`, one key per id.
  - **Keys come from parsed values, never the raw URL**, and start with the request's origin. The origin is
    there because staging and prod can share one zone's cache and each has its own D1; a host-less key
    would serve one the other's snapshot. L0 has no host (a Worker has one database).
  - **Only a `200` is stored** (`cachedResponse()`), on top of the Cache API refusing a response with no
    TTL. A hit is returned as `new Response(hit.body, hit)`: a cached response's headers are read-only and
    `index.ts` adds `X-Wordless-Docs` to every API response.
  - **Where the purge lives:** `rebuildAndPurgeLatest(db, origin)` in `cache.ts`, not `rebuildLatest()`.
    The L1 key needs an origin, and the Slice 6 cron has none; it also doesn't need a purge (its colo
    converges within the TTL). So **the cron calls `rebuildLatest()` and purges nothing.** `refreshLatest()`
    in `api.ts` wraps `rebuildAndPurgeLatest()` in `waitUntil`. A failed rebuild purges nothing.
  - **Order:** rebuild, then purge (purging first lets a read in the gap refill the cache from the old
    snapshot for a full TTL). The deleted post's own entry has no rebuild to wait for, so `purgePost()` is
    awaited before the `204`. A create purges only the snapshot: the new id has no entry (ids are never
    reused and a 404 is never kept).
  - **Stale fills:** a module counter, `purges`, goes up on every purge. A read fills a layer only if it
    didn't move while the read ran, so a read that began before a purge can't undo it. This guards one
    isolate; another isolate in the colo can still fill after a purge, bounded by the TTL.
  - Fills are **awaited**, not `waitUntil`: a purge that follows a response can't be overtaken by that
    response's fill, and tests need no polling. The Cache API never fails a request: `match`, `put` and
    `delete` errors are logged and the request is a miss.
  - `ISOLATE_TTL_S` is a separate export from `EDGE_TTL_S` in `packages/shared`: `EDGE_TTL_S` values go to
    `publicCache()` as `s-maxage`, and L0's is not one.
- **Staleness adds up.** L0 can copy the snapshot from L1 just before L1's entry expires and keep it 2 s more,
  so the first page and `since` can be up to **12 s** behind, not 10 (§10.2 says so). If 10 s must hold, cap
  L0's expiry at the L1 entry's age (store the fill time in the L1 body): about six lines and a test.
- Not purged, by design (§10.2): other isolates' L0 (up to 2 s), other colos and hostnames, `before` pages that
  still list a deleted post (keys can't be named; up to 60 s), and the author's profile (`TODO(§10.2)` in both
  write routes until Slice 7 adds the profile entry).
- Tests: 15 new in `test/cache.test.ts`. Changed: `helpers.ts` (`ORIGIN`, `rebuild()`, `gatedDb()`, `clearFeed()`
  purges, and `lateDb()` and `gatedDb()` share one `intercept()` proxy), `feed.test.ts` (uses `rebuild()`),
  `post-read.test.ts` (the hidden-post test no longer reads the post as visible first: a second read would be
  cached). `snapshot.test.ts` is unchanged, and its two wiring tests now also cover the purge.
- `mise run db:reset` also removes `apps/site/.wrangler/state/v3/cache` (not run: it would wipe the cache of a
  dev server I don't own). ARCHITECTURE §4.1 says so too.

Verified (all run from the repo root):

- `vp check`: clean (49 files linted and type-checked, 69 formatted).
- `vp test`: 22 files, **702 passed** (687 baseline + 15 new), 3 full runs in a row. The five files that touch
  the caches (`vp test apps/site/test/cache.test.ts apps/site/test/feed.test.ts apps/site/test/snapshot.test.ts
  apps/site/test/post-read.test.ts apps/site/test/post-delete.test.ts`, 64 tests) passed 10 runs in a row.
- `vp run -r build`: passed (Worker 97.34 kB gzip, up from 96.13; SPA 94.96 kB gzip).
- Mutation checks, each reverted with `git checkout` afterwards, whole suite run. All 22 were caught:
  - Key from the raw URL: before page (1: the junk-params test), snapshot (13), post (1: the junk-params-on-a-post
    test). Origin left out of the key (1: the origin test).
  - Snapshot purge removed on create (2), on delete (2). Post purge removed on delete (4). Post purge left to
    `waitUntil` (1: "the DELETE waits for the post's entry to go, however slow the cache is").
  - Purge before rebuild (1: "a read in the gap before the rebuild lands can't keep the old snapshot").
  - L0 never expires (1), L0 absent (1), L0 TTL hardcoded at 60 s (1), purge leaves L0 (18). Snapshot never
    stored in L1 (1), snapshot purge doesn't touch L1 (19).
  - Stale-fill guard removed: snapshot L0 only, L1 only, or both (1 each), whole responses (1).
  - A 404 kept (status guard dropped **and** the 404 given a TTL, since the Cache API refuses a response with no
    TTL on its own) (1). A hit returned as stored, with read-only headers (4).
  - `/me` wrapped in `cachedResponse()` with a TTL (14, incl. "what is behind a key is not kept"). Contrived:
    `requireBot`'s `private, no-store` and the Cache API both refuse it already, so this test guards only
    against someone caching an authed route on purpose.
  - Three survived the first round and got tests: the post key from the raw URL, the stale-fill guard on whole
    responses, and the post purge left to `waitUntil`.
- Live check against the already running `mise run dev` server on :5173 (nothing started on it, nothing
  killed): the empty feed, then register two bots (own `CF-Connecting-IP` each) and `POST /posts`. A's post was in
  `/feed` at once; after B posted, `/feed` showed `[2,1]` within 150 ms (the purge). `GET /posts/2` was `200`,
  then `404` right after B's `DELETE`, and the feed dropped it. Then both posts and the `snapshots` row were
  deleted in D1 underneath: `GET /posts/1` still answered `200` (`cache-control: public, max-age=5,
  s-maxage=30` and `x-wordless-docs` intact) and `/feed` still `[1]`; 33 s later `/posts/1` was `404` and the
  feed `[]`. A post that never existed stayed `404`.
- Restart check on my own server (`cd apps/site && vp dev --port 5174 --strictPort`, stopped afterwards): filled
  `/feed?before=4` (`[3]`), stopped the server, deleted the posts in D1, restarted: it still answered `[3]`,
  while a `before` never asked for answered `[]`. **Local cache state outlives a restart.** The probe bots,
  posts, snapshot row and `sqlite_sequence` rows were deleted afterwards (the local D1 was empty before).

Findings:

- **`vp test` prints its `FAIL` lines on stderr.** A script that wants test names must capture both streams
  (`stderr=subprocess.STDOUT`); mine saw only the counts in the first mutation round.
- Under `@cloudflare/vitest-plugin` the tests and `exports.default.fetch` share module state, so a test can reach
  L0 (`purgeLatest()` clears the Worker's `Map`). `caches.default` is one stable object, so
  `vi.spyOn(caches.default, "delete")` works. `vi.useFakeTimers({ toFake: ["Date"] })` moves L0's clock while D1 and
  the Cache API keep real time.
- **`lateDb()` can't test a purge that comes too early.** It delays the answer, so its write has landed by the time
  anything else happens. `gatedDb()` holds the statement back until `release()`, which makes the gap in which a
  read refills the cache. Use it for any later "do X before the write lands" test.
- Hono: setting a header on a response that came from the Cache API fails (read-only), so copy it.
- Dev: the Cache API works under `vp dev` and persists in `apps/site/.wrangler/state/v3/cache`.
- A read replica that hasn't caught up with the rebuild can refill right after the purge. Nothing handles
  it (the TTL bounds it); the fix would be to carry the write's D1 bookmark into the next read.
- For Slice 5: if a reaction rebuilds `latest`, call `rebuildAndPurgeLatest()`, not `rebuildLatest()`. For Slice 6:
  the cron calls `rebuildLatest()` (no origin, no purge). For Slice 7: profiles are a new cached key; add it to the
  two `TODO(§10.2)` purges and give it a `cachedResponse()` key builder in `cache.ts`.
- Not changed, as instructed: `wrangler.jsonc`, tests-in-CI (Slice A), burst limits (Slice 1.1), response shapes
  and TTL values.

### 2026-10-11, decisions before Slice 5 (reactions)

The user approved both recommendations. Recorded as decisions 37 and 38 in ARCHITECTURE §18. Don't reopen them.

- **What counts toward 60/hour:** live rows in `reactions_by_bot` inside the window.
  - A swap refreshes `created_at`, so it costs a slot only if the old row had aged out of the window. The quota check on a swap
    counts the window **excluding the bot's own row**, so a bot at 60 can still change an emoji it set a minute ago.
  - Sending the same emoji again is a no-op and uses no quota.
  - Unreacting, or the author deleting the post, refunds quota. Accepted: the lasting effect stays capped at 60 per hour, and
    only churn is possible, which the 20/min burst limit (Slice 1.1) bounds. Say so in §8.7 when the code lands.
  - No event table.
- **Reactions and `latest`:** a reaction does `await purgePost(origin, id)` before it responds, and does **not** rebuild `latest`.
  Snapshot reaction counts lag until the next post, delete or cron run (Slice 6); say so in §7.2 and §10.2. If fresher counts are
  wanted later, use `rebuildAndPurgeLatest()` in `waitUntil`, never plain `rebuildLatest()`.
- Not asked, planned (say it in the PR): keep the filter's codes (`contains_words`, `invalid_characters`, `empty`, `too_long`) with
  the `POST /posts` 422 body and fix §8.4; `DELETE` of a reaction that isn't there is `200` with the current counts; decide new
  versus swap in SQL (no pre-read).

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
6. ~~What `cursor` is when the feed is empty.~~ Resolved in Slice 4: it echoes the caller's `since`, or
   `0` with none (ARCHITECTURE §8.1).
7. **`Cache-Control: private, no-store` on authed responses** (`/me`, `POST /posts`, `DELETE /posts/:id`;
   §10.1 says they carry it, the code didn't). Resolved in Slice 4 (PR #8): the user approved, and
   `requireBot` now sets it first, so `/me`, `/validate`, `POST /posts`, `DELETE /posts/:id` and the
   401/403 the middleware answers carry it.
8. ~~What counts toward the 60/hour reaction limit.~~ Resolved 2026-10-11: live rows in the window, a swap refreshes
   `created_at`, the same emoji is a free no-op, unreacting refunds, no event table (§18 decision 37).
9. ~~Whether a reaction rebuilds `latest`.~~ Resolved 2026-10-11: no, it purges `/posts/:id`; the cron refreshes the
   snapshot's counts (§18 decision 38).

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

Status: `[x]` Done and verified. Merged as `1573a94` (PR #6). See Working Notes 2026-10-11,
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

Status: `[x]` Done and verified. Merged as `1aade79` (PR #7). See Working Notes
2026-10-11, Slice 3 session. Differences from the sketch below: `GET` answers `{post}` (like `POST
/posts`), ids must be in canonical spelling, and the delete batch ends with a read-back that tells
`403 not_owner` from `404`.

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

Status: `[x]` Done and verified. Merged as `012c78a` (PR #8). See Working Notes 2026-10-11,
Slice 4 session. Differences from the sketch below: the snapshot stores rows without `url` (serialized
at read time), the rebuild is one `INSERT ... SELECT json_group_array(...)` statement, `before` pages
ignore `limit`, bad params are `400` (never clamped), and a missing snapshot row falls back to a live read.

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

Status: `[x]` Done and verified on `feat/cache` (PR #9, not merged yet). See Working Notes 2026-10-11,
Slice 4.1 session. Differences from the sketch below: L0 and L1 cache the snapshot **rows** (not a response)
and `limit` and `since` are applied in memory; `before` pages and `/posts/:id` are cached whole; the L1 keys
start with the origin; the purge is `rebuildAndPurgeLatest()` (rebuild, then purge) and the cron won't purge;
a purge counter keeps reads that began before a purge from filling afterwards.

- L0 isolate memory (2 s, snapshots only), L1 Cache API with canonical keys (known params only),
  local purge on writes (§10.1, §10.2). Test that junk query strings don't create new cache entries.
- Started from what Slice 4 left: `EDGE_TTL_S` in `packages/shared` (used for the L1 TTLs), the two
  `TODO(§10.2)` lines in `api.ts`, `readQuery()` and the `FeedQuery` schema, and `refreshLatest()`.

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
  Slice 1.1 exists. Constants in `packages/shared`. The counting rules are decided (Working Notes, "decisions before Slice 5").
- No `latest` rebuild after a reaction: purge `/posts/:id` and leave the snapshot's counts to the cron (decided).

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

**Slice 5: reactions.** Slice A (tests in CI) is still deferred by the user and Slice 1.1 still waits on the
Rate Limiting binding (Open Question 1). `AGENTS.md` is deliberately unchanged, so the user will point you at
this file.

Start here:

1. `git fetch origin && git switch main && git pull`, then `git switch -c feat/reactions`. Slice 4.1 should be
   merged by then; check with `git log origin/main --oneline -3`. If it isn't and the user wants to continue
   anyway, branch from `feat/cache`. Don't use the `gh` API heavily if it is rate limited; `git` over SSH is
   unaffected.
2. Read `AGENTS.md`, the Cross-slice rules, the "Slice 2", "Slice 3" and "Slice 4.1" Working Notes and the Slice 5
   section above. Then ARCHITECTURE §7.1 (React), §8.4, §8.7 and §15, and `db/queries.ts` (`createPost()`,
   `deletePost()`: the batch pattern to copy; raw `sql` items with parameters can't go in a D1 batch). The
   open questions the earlier notes left for this slice: the `422 invalid_emoji` vs `checkReaction` codes
   mapping, and whether deleting a post should give the reactors their hourly quota back (Slice 3 notes).
3. `vp test` should report 702 passing before you change anything. If a reaction rebuilds `latest`, use
   `rebuildAndPurgeLatest()` (Slice 4.1 notes). Test concurrency with `Promise.all` on the query function, and
   any stale-write rebuild with `lateDb()`.
   For a live server, a `mise run dev` one may already be running on :5173: reuse it, it reloads on changes.
   Otherwise run `cd apps/site && vp dev --port 5174 --strictPort`: `vp dev` at the repo root serves no Worker.
   Never kill a server you didn't start. The local Cache API persists across restarts (`mise run db:reset`
   clears it).
4. Ask the user before touching `wrangler.jsonc` bindings.
5. Done when `vp check`, `vp test` and `vp run -r build` pass, ARCHITECTURE matches the code, this file's
   Slice 5 is `[x]` with the exact commands under Working Notes, and `Next Slice` points at Slice 6.
