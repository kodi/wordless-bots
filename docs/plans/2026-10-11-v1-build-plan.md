# wordless.one v1 build plan

Handoff record between sessions. `docs/ARCHITECTURE.md` stays the source of truth for product rules,
the API, the data model and infra. This file only tracks the order of work, what was learned, and
what to do next.

Last updated: 2026-10-12 (end of the Slice 10 session: agent docs).

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

- #9 Slice 4.1, the cache layers (squash-merged as `4de2bab`): `cache.ts` (L0 and L1, purges),
  `rebuildAndPurgeLatest()`.
- `852bfae` docs: the Slice 5 reaction quota and snapshot decisions (§18 decisions 37 and 38).

- #10 Slice 5 reactions (squash-merged as `fbb6045`): `PUT` and `DELETE /posts/:id/reaction`, `reactToPost()`,
  `unreactToPost()`.

- #11 Slice 6 `top24`, `GET /top` and the cron (squash-merged as `ea90eb6`): `rebuildTop24()`, `readTop()`,
  `snapshotAges()`, `runScheduled()`, `GET /top`, `/health` ages, `triggers.crons`.

- #12 Slice 7 profiles and avatars (merged as `fd7e3ce`): `GET /bots/:username`,
  `GET /bots/:username/posts?before=`, `GET /a/:username.svg`, `findBotProfile()`, `botPosts()`, `purgeProfile()`, the
  avatar generator in `packages/shared`.

- #13 Slice 8 key rotation and `PATCH /me` (merged as `bd289f4`): `POST /keys/rotate`, `PATCH /me`, `rotateKey()`, `setBio()`.

- #14 Slice 9 key recovery and email (merged as `c8ddbf0`): `POST /recover`, `POST /recover/confirm`, `EmailSender`, the `EMAIL`
  binding, `issueRecoveryToken()`, `recoverKey()`.

- Slice 10 agent docs is on `feat/agent-docs` (PR in review): `/llms.txt`, `/skill.md`, `/heartbeat.md`, `agent-docs.ts`, `docsUrl()`.

Open: the Slice 10 PR (`feat/agent-docs`). Check with `git fetch origin && git log origin/main --oneline -3` before branching (see Next Slice).

Worker layout (`apps/site/src/worker/`): `index.ts` (Hono app, error handlers),
`api.ts` (all `/api/v1` routes so far, and `sendRecovery()`), `avatar.ts` (`avatarResponse()`, `GET /a/:file`), `auth.ts`, `http.ts`, `keys.ts`, `credentials.ts`,
`agent-docs.ts` (`renderDoc()`, `renderAgentDoc()`, `agentDocResponse()`; the templates are in `agent-docs/`), `ip-hash.ts` (`keys.ts` also has `generateRecoveryToken()` and `hashRecoveryToken()`), `serialize.ts` (`iso()`, `serializePost()`, `serializeReactions()`, `serializeProfile()`), `feed.ts` (`latestPage()`, the pure paging
and gap rules), `cache.ts` (L0 and L1: `readLatestCached()`, `cachedResponse()`, `purgeLatest()`,
`purgePost()`, `purgeProfile()`, `rebuildAndPurgeLatest()` and the `latestKey()`, `feedBeforeKey()`, `postKey()`, `topKey()`,
`profileKey()`, `profileBeforeKey()` builders),
`cron.ts` (`runScheduled()`, `dueJobs()`), `db/schema.ts`, `email.ts` (`EmailSender`, `cloudflareEmail()`, `recoveryMessage()`), `db/queries.ts` (`createPost()`, `findPost()`,
`deletePost()`, `rotateKey()`, `setBio()`, `issueRecoveryToken()`, `dropRecoveryToken()`, `recoverKey()`, `reactToPost()`, `unreactToPost()`, `visiblePosts()`, `olderPosts()`, `findBotProfile()`, `botPosts()`,
`botPostsQuery()`, `PostRow`, `postRowColumns`),
`db/snapshots.ts` (`rebuildLatest()`, `readLatest()`, `rebuildTop24()`, `readTop()`, `topPosts()`, `snapshotAges()`) and
`db/maintenance.ts` (`deleteStaleRecoveryTokens()`, `reconcileBotCounters()`).
Tests are in `apps/site/test/` with helpers `insertBot()` (accepts `lastPostAt`, `status`, `bio`,
`createdAt`, `regIpHash`), `seedPost()` (a post through `createPost()` with no cooldown wait),
`insertPosts()` (bulk insert, no counters; use it to fill a feed), `insertToken()` (a recovery token row; returns the raw token), `fakeEmail()` (an `EmailSender` that keeps what it sent) and `tokenIn()` (the token in a mail's link), `clearFeed()` (also purges the cached
snapshot and the cached `/top`: isolate memory and the Cache API outlive a test), `rebuild()` (what a post or delete does after
its response: rebuild `latest`, then purge; use it instead of calling `rebuildLatest()` and then reading),
`lateDb()` (a `Db` whose answers arrive late; for stale-write races), `gatedDb()` (a `Db` whose statements
wait for `release()`; for what happens before a write lands), `ORIGIN`, `api()` and `nextIp()` in
`helpers.ts`. `http.ts` has
`apiError()`, `readJson()`, `readQuery()` and `intParam()` (zod query params in canonical spelling),
`docsUrl(origin)` (the `X-Wordless-Docs` value), `tooManyRequests()` (`429` with `Retry-After` and `retry_after_s`; reuse it for `429 cooldown` and
reaction limits), `parseId()` (canonical row id from a URL segment), `parseUsername()` (the normalized username of a URL segment, or
`undefined`) and `publicCache(c, ttlS)` (the
§10.1 `Cache-Control` for public JSON). `packages/shared` holds the feed and profile limits, the avatar generator (`avatar.ts`), `EDGE_TTL_S` (the L1 TTL of each
public route) and `ISOLATE_TTL_S` (the L0 TTL).

Baseline: `vp test` runs 861 tests (57 shared, 506 wordfilter, 298 worker) on the Slice 10 branch; 830 (267 worker) on `main` at `c8ddbf0`; 809 (246 worker) on `main` at `bd289f4`; 795 (232 worker) at
`fd7e3ce`; 757 (202 worker) at `ea90eb6`. Before Slice 6 it was
737 (`fbb6045`), before Slice 5 702 (`4de2bab`), and before Slice 4.1 (`012c78a`) 687.

Not built yet: admin, form
fallback, burst rate limits (the register hourly limit exists), all of the real UI,
Analytics Engine events.

Infra reality:

- No code is deployed. The Workers `wordless` and `wordless-staging` exist only as empty
  placeholders that `wrangler secret put` created, and **`IP_HASH_SECRET` is set on both** (the user
  ran it on 2026-10-11; `wrangler secret list` shows it for prod with `--env=""` and for `--env
  staging`). Later secrets follow ARCHITECTURE §14.
- `wrangler.jsonc` has `DB`, `ASSETS`, `EMAIL` (`send_email`, since Slice 9, approved by the user on 2026-10-11, top level and `env.staging`), the `secrets.required` list, observability and (since Slice 6, approved by
  the user on 2026-10-11) `triggers.crons: ["* * * * *"]` at the top level and in `env.staging`. No `ratelimits` or
  `analytics_engine_datasets`.
- CI runs only `vp check`. **Tests and build are not in CI** (§14 says the PR pipeline should be
  check → test → build).
- The prod and staging D1 ids in `wrangler.jsonc` are filled in. Whether the databases hold the
  migrations is unverified.
- Email Sending is enabled for `wordless.one` (account tag `132abfb887f74b398992af69fad0eaed`), and
  its five DNS records (3 MX, SPF, DKIM, `_dmarc`) are in the zone and resolve (checked with `dig` against
  `henrik.ns.cloudflare.com` and 1.1.1.1 on 2026-10-11; ARCHITECTURE §12). The `EMAIL` binding exists (Slice 9).

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

Done on branch `feat/cache` (PR #9), branched from `main` at `012c78a` (PR #8 was merged). Merged as `4de2bab`.

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

### 2026-10-11, Slice 5 session (reactions)

Done on branch `feat/reactions`, branched from `main` at `852bfae` (Slice 4.1 and the decisions commit were
on `main`). PR #10, merged as `fbb6045`.

- Design (`db/queries.ts`): `reactToPost(db, {botId, postId, emoji, createdAt}, {max, windowMs})` and
  `unreactToPost(db, botId, postId)`, each one `db.batch()` of query builders (§7.1).
  - **PUT:** `UPDATE bots SET reactions_received = +1 WHERE <author> AND <may react> AND NOT EXISTS (own row)`,
    then the upsert as `INSERT ... SELECT ... FROM bots WHERE <may react> AND NOT EXISTS (same emoji) ON CONFLICT
    (post_id, bot_id) DO UPDATE SET emoji, created_at RETURNING`, then the recount, then four read-backs (post,
    bot status, own row, the oldest reaction in the window). `<may react>` is: bot active, post visible and not
    the bot's own, and the bot's _other_ reactions inside the window fewer than `max`.
  - **New versus swap is decided in SQL** (`NOT EXISTS` on the author counter, placed before the upsert), not from
    a pre-read, so two parallel first reactions from one bot add 1, not 2.
  - **Refusals write nothing**, because the two writes share `<may react>`. The recount is derived from the rows, so
    it runs unconditionally and rewrites identical values on a refusal.
  - **The read-back orders the reasons:** banned, missing or hidden (404), own post, same emoji already held (200),
    otherwise the window is full (`rate_limited` with `oldest`). `changed` (from the upsert's `RETURNING`) says
    whether to purge. A refusal with room in the window throws, since nothing else can refuse an active bot on a
    visible post.
  - **DELETE:** counters (`EXISTS` own row) first, then the delete, then the recount and read-backs. No reaction to
    take back is `200` with the current counts (decided here; §8.4 was silent).
  - Routes (`api.ts`): ids through `parseId()` (404), `readJson()` + zod (400), `checkReaction()` with
    `REACTION_MAX_BYTES` (422 with the filter's own code, in the `POST /posts` body shape), then the query.
    After a change, `await purgePost(origin, id)` before the response; `latest` is not rebuilt (decision 38).
  - `serializeReactions()` in `serialize.ts` builds `{total, top}` for both the post object and these answers.
  - `REACTION_HOURLY_MAX` (60), `REACTION_WINDOW_S` (3600) and `REACTION_TOP_SIZE` (5) are in `packages/shared`.
    `TODO(§8.7)` marks the 20/min burst (Slice 1.1 owns the binding). `wrangler.jsonc` is untouched; no migration.
- Error mapping, as asked, for the PR: the 422 codes are `contains_words` (letter emoji), `invalid_characters`
  (text, two emoji), `empty` and `too_long`, with `{matches, hint}` like `POST /posts`. §8.4 said `invalid_emoji`;
  that was wrong and is gone from the doc.
- Docs: §7.1 (React, Unreact, how new versus swap is decided), §7.2 and §10.2 (no `latest` rebuild, the lag, the
  post purge), §8.4 (codes, DELETE semantics), §8.7 (what the hourly count means, the refund), §15.
- Tests: 35 new in `test/reactions.test.ts` (702 to 737). `assertCounters()` recomputes the totals, tops (bytewise
  tie-break) and `reactions_received` of the test's own authors from the `reactions` rows; it is scoped per test
  because `clearFeed()` deletes posts without fixing their authors' counters, so these tests don't call it, and a
  global check would let one test's drift fail every test after it. The quota rules are tested through
  `reactToPost()` with a small limit and explicit `createdAt`s (rows inside, at and outside the window edge); one
  HTTP test uses the real 60.

Verified (all run from the repo root):

- `vp check`: clean (50 files linted and type-checked, 70 formatted).
- `vp test`: 23 files, **737 passed** (702 baseline + 35 new), 3 full runs in a row; `vp test
  apps/site/test/reactions.test.ts` passed 10 runs in a row.
- `vp run -r build`: passed (Worker 99.70 kB gzip, up from 97.34; SPA 94.96 kB gzip).
- Mutation checks, each reverted with `git checkout` afterwards, whole suite run. All 26 were caught:
  - `NOT EXISTS` dropped from the author counter (7 failing). Counter placed after the upsert (21).
  - Self check dropped (1). Hidden filter dropped from the write predicate (1) and from the PUT read-back (1).
  - Quota `<` to `<=` (6). Window dropped from the count (1: "older than the window ... at its edge"). Own row not
    excluded (2). The wait taken from the newest, not the oldest, row (2).
  - Swap not refreshing `created_at` (2). Same-emoji guard dropped (2). Top tie-break dropped (2).
  - Recount scoped to the wrong post: total (24), top (23), or updating every post (7).
  - New versus swap decided by a read before the batch (4: the parallel tests only; the HTTP race passes alone, as
    §15 warns).
  - Active-bot check dropped from the upsert (1), from the author counter alone (1: needed a banned bot's _first_
    reaction on a fresh post; a bot with an existing row is blocked by `NOT EXISTS` anyway), from unreact (1).
  - Unreact: `EXISTS` on the row dropped (2), counter after the delete (4), visible-post check dropped (1).
  - PUT purge removed (1). DELETE purge removed (1). PUT also rebuilding `latest` (1: "leaves the feed's counts as
    they were"). `checkReaction()` result ignored (5).
  - One survived the first round and got a test: the active-bot check on the author counter (above).
- Live check against the already running `mise run dev` server on :5173 (pid 53728, nothing started or killed):
  register three bots (own `CF-Connecting-IP` each), `POST /posts`, warm `GET /posts/1`, then `PUT` 🔥 (200
  `{total:1}`), the next `GET` showed it at once, a swap and a repeated emoji (200), `403 self_reaction`, `422
  invalid_characters` for `hi`, `400` for `{}`, `401`, `404` for an unknown id, `DELETE` twice (200 both, the author's
  `reactions_received` 2 then 1), and `/feed` still showing `0` for the post (the snapshot lag). The local D1 was
  empty before; the probe bots, post, reactions, snapshot row and `sqlite_sequence` row were deleted afterwards.

Findings:

- **`clearFeed()` and counters.** It deletes `posts` (the reactions cascade) but not the authors' counters, so any
  test that checks counters globally must not use it. `post-delete.test.ts` doesn't check them globally, so it is
  unaffected.
- drizzle-orm 0.45.4 _does_ take `onConflictDoUpdate()` on an `insert().select()` and `returning()` on both
  `insert` and `delete` as batch items. SQLite wants the select to have a `WHERE` (it has one: the predicate), or
  `ON CONFLICT` parses as the `ON` of a join. `.as("c")` on `count()` plus `orderBy(desc(sql`c`))` in a subquery
  builds the top-5 recount without a raw `sql` statement.
- A union member with several `reason` literals doesn't narrow after early returns in TypeScript; the route tests
  `rate_limited` first.
- **Refund by deletion.** The author deleting a post removes the reactors' rows, so they get the slots back
  (accepted, §8.7): it is the cost of counting live rows.
- Not changed, as instructed: `wrangler.jsonc`, tests-in-CI (Slice A), burst limits (Slice 1.1), `latest` rebuilds,
  response shapes of the existing routes.

### 2026-10-11, Slice 6 session (`top24`, `GET /top`, cron)

Done on branch `feat/top-cron`, branched from `main` at `fbb6045` (Slice 5 was merged). The user approved
`triggers.crons` before it was touched (Open Question 5); no other binding was added.

- Design:
  - `rebuildTop24(db, now)` (`db/snapshots.ts`) is built like `rebuildLatest()`: **one statement** that reads and writes
    (`INSERT ... SELECT json_group_array(... ORDER BY reaction_total DESC, id DESC) FROM (<top 50>) WHERE true ON
    CONFLICT DO UPDATE`), on the primary, outside a batch. The subquery, `topPosts()`, is also what `readTop()`
    reads live when there is no `top24` row yet, as `readLatest()` does. Rows are `PostRow`s with no `url`, like `latest`.
  - Qualifying posts: visible, `reaction_total > 0`, `created_at > now - TOP_WINDOW_S`. Order: `reaction_total` desc,
    then **id** desc (newest by id, as the feed's order is). The `WHERE` spells the partial index's terms, and a test
    reads `EXPLAIN QUERY PLAN` for `posts_reacted`. `TOP_SNAPSHOT_SIZE` (50), `TOP_WINDOW_S` and `EDGE_TTL_S.top` (60)
    are in `packages/shared`.
  - **`GET /top` caches the whole response**, like `/posts/:id`, under `topKey(origin)` (L1, 60 s), and not the snapshot
    rows like `latest`. Why: `latest` caches rows so that `limit` and `since` can be cut from one entry in memory and L0
    can sit in front of L1. `/top` takes no params, so there is one response per origin and nothing to cut, and a 60 s
    TTL leaves an isolate-memory layer nothing to add. It needs no purge function either: nothing purges it. A reaction
    purges only `/posts/:id`, and the cron has no origin, so `/top` lags a reaction by up to **the cron interval plus
    its TTL (about 2 minutes)**, a deleted post likewise (§7.2, §10.2).
  - **Cron** (`cron.ts`, `scheduled` in `index.ts`): `runScheduled(env, scheduledTime)` runs `rebuildLatest()` and
    `rebuildTop24()` every minute, deletes stale `recovery_tokens` on the hour (UTC minute 0) and reconciles bot
    counters at 03:00 UTC (`dueJobs()` is the pure schedule check). The jobs run side by side with
    `Promise.allSettled`; each failure is logged and the run then throws, so Workers records a failed invocation.
    **The cron calls `rebuildLatest()`, not `rebuildAndPurgeLatest()`**: no request, so no origin to purge by. Its colo
    converges within the TTL (Slice 4.1 notes). **This is what refreshes the reaction counts in `latest`**, which
    reactions deliberately don't rebuild (decision 38). `scheduled` awaits the run.
  - **Recovery tokens are kept for `RECOVERY_WINDOW_S` (1 hour) after they were made**, not deleted at expiry (30 min).
    `/recover` is 3/hour counted on `recovery_by_bot` (§8.7, Slice 9), so deleting a token at expiry would erase a row
    the limit still counts. The delete needs `expires_at < now` as well, so a live token is never deleted.
  - **Reconcile** (`db/maintenance.ts`): `UPDATE bots SET ... FROM (SELECT counts per bot) WHERE <differs>`, by ranges of
    `RECONCILE_BOTS_PER_STATEMENT` (500) bot ids, so no statement reads every post at once and only wrong bots are written.
    Hidden posts count (as in `deletePost()`). It is a repair job (the reaction race was fixed in SQL in Slice 5); each
    statement reads and writes at one instant, so it can't undo a concurrent write.
  - `/health` answers `{ok, snapshot_age_s: {latest, top24}}`: whole seconds since each row's `updated_at`, `null` before
    its first write. `ok` is still only about D1. `snapshotAges()` reads both rows from the replica session.
  - `visiblePosts()`'s column list moved to an exported `postRowColumns`, which `topPosts()` shares.
- Tests (20 new, 737 to 757): `top.test.ts` (13: order and tie-break, tie at the 50th place, the 24-hour edge, hidden,
  the 50 cut both ways, row shape, replace and empty, the stale-write race with `lateDb()`, the query plan, `GET /top`
  from the snapshot, the live fallback, snapshot over posts, the cache hit), `cron.test.ts` (6: the schedule, a run
  after a reaction refreshing `latest` and `top24` through the Worker's `scheduled` with a fake controller, token
  cleanup at the window edge, the nightly reconcile with hidden posts, the id-range walk, a failing job), and
  `health.test.ts` (one more: ages). `clearFeed()` in `helpers.ts` also drops the cached `/top`.
  - A failing job is made by a `BEFORE INSERT` trigger in D1 that raises (dropped in a `finally`), not by a mock.
  - Reconcile corrects **every** bot in the file's database, including those made by `insertPosts()`, which moves no
    counters. The cron tests therefore look at their own bots only.

Verified (all run from the repo root):

- `vp check`: clean (54 files linted and type-checked, 74 formatted).
- `vp test`: 25 files, **757 passed** (737 baseline + 20 new), 3 full runs in a row; `vp test apps/site/test/top
  apps/site/test/cron apps/site/test/health` (22 tests) passed 10 runs in a row.
- `vp run -r build`: passed (Worker 102.25 kB gzip, up from 99.70; SPA 94.96 kB gzip). The built `wrangler.json` has
  `triggers.crons`.
- Mutation checks, each reverted afterwards, whole suite run (a script that backs the file up and restores it). 31 mutants:
  - Caught: window `>=` and 48 h (1 each); hidden filter dropped (2, one is the plan test), reacted filter dropped (3);
    aggregate `ORDER BY id ASC` (4); limit 10 (1); fallback answering empty (1); wrong snapshot name (8); `/top` not
    cached (5), no cache header (2), wrong TTL (2); no latest rebuild in the cron (2), no top rebuild (2), hourly
    always (2), nightly every hour (2), first failure aborts the run (1), failures swallowed (1); `scheduled` not wired
    (4), not awaited (2); tokens: the window ignored (1); reconcile: hidden excluded (1), the first id of a range
    skipped (1), unchanged rows written (1), the last range skipped (2); health: names swapped, no clamp, `round`
    for `floor` (1 each).
  - Three survived the first round: the tie-break in the subquery (dropped, and reversed: the aggregate's own `ORDER BY`
    hid it, so the test "posts tied at the cut-off" was added; 1 fails each now) and `expires_at < now` dropped from the
    token delete (the window alone hid it; a valid token older than the window was added to the test).
  - Two survive and are equivalent here: the aggregate's own `ORDER BY` removed (SQLite hands the aggregate the
    subquery's order, which `latest` relies on too; the clause stays because it is the documented guarantee), and
    `hidden = ?` bound instead of a literal (**the planner still uses `posts_reacted` with a bound value in this
    SQLite**, so the plan test can't tell; I had first written a comment claiming it can't, and corrected it).
- Live check against the already running `mise run dev` server on :5173 (pid 53728, nothing started or killed):
  `GET /cdn-cgi/handler/scheduled` runs the Worker's `scheduled` under `vp dev` (200; both snapshot rows written, `/health`
  showed ages 1 and 1). Then two bots (own `CF-Connecting-IP` each), `POST /posts`, a cron run, `PUT` 🔥: `/feed` still
  showed 0 reactions, and after a second cron run and the 10 s TTL it showed 1. `/top` answered `{"posts":[]}`
  from my own earlier request for its 60 s, then the post with its 🔥 once that expired. The local D1 was empty before; the
  probe bots, post, reaction, snapshot rows and `sqlite_sequence` row were deleted afterwards.

Findings:

- **`GET /cdn-cgi/handler/scheduled` triggers `scheduled` under `vp dev`**, so the cron can be tried by hand
  (`curl localhost:5173/cdn-cgi/handler/scheduled`). It shares the local Cache API, which persists.
- **SQLite uses a partial index with a bound value** (`hidden = ?`) in this environment; do not rely on a claim that
  literals are required. What does break it is dropping a term of the index's `WHERE` (the plan becomes `SCAN`).
- `json_group_array(x ORDER BY ...)` (aggregate `ORDER BY`, SQLite 3.44+) works in D1 under workerd.
- The register response contains an escape that strict `json.load` rejects (`strict=False` works); mind it in curl scripts.
- drizzle's `db.delete().run()` returns the D1 result, so `meta.changes` gives the number of rows deleted or updated.
- `export default { scheduled: (controller, env) => ... } satisfies ExportedHandler<Env>` types `scheduled` with the
  parameters the arrow declares, so tests call `worker.scheduled(controller, env)`.
- Not changed, as instructed: the Rate Limiting binding (Slice 1.1) and the 20/min reaction burst, tests in CI (Slice A),
  the profile purge (Slice 7), and no other `wrangler.jsonc` change than `triggers.crons`.

### 2026-10-11, Slice 7 session (profiles and avatars)

Done on branch `feat/profiles` (PR #12, merged as `fd7e3ce`), branched from `main` at `ea90eb6` (Slice 6 was merged). No `wrangler.jsonc` change:
`/a/*` was already in `run_worker_first`. The first commit fixed the stale Slice 6 statuses and baseline in this file.

- Design:
  - **Routes** (`api.ts`): `GET /bots/:username` answers `{bot, posts, next}` and `GET /bots/:username/posts?before=` answers
    `{posts, next}` (§8.2). `bot` is `serializeProfile()`: username, bio, `created_at`, the two counters and `avatar_url`.
    Nothing else of `bots` is selected (`findBotProfile()` names its five columns), and a test pins the exact key set.
    The sketch gave no shape; `{bot, posts, next}` mirrors `{post}` and the feed's `next`.
  - **Posts** come from `botPostsQuery()`, which is `visiblePosts()` plus the username and `status = active`, newest first. `botPosts()`
    reads 51 rows and returns 50, the `olderPosts()` pattern. `PROFILE_PAGE_SIZE` (50) is in `packages/shared`.
    The bot row and the posts are read side by side (`Promise.all`), so one round trip: the `bots` row is also what tells an
    empty `before` page from an unknown bot. A test reads `EXPLAIN QUERY PLAN`: `posts_by_bot`, no temp b-tree.
  - **A banned bot's profile is a `404`** (the doc was silent; ARCHITECTURE §8.2 and decision 39 say so now), the same as for an
    unknown name, and so are its `before` pages. A ban hides its posts, so what would be left is a name, bio and counters. The
    posts query also tests `status`, so a ban that hid nothing yet still shows no posts.
  - **Names:** `parseUsername()` (`http.ts`) lowercases (`normalizeUsername`) and accepts only a valid, unreserved name, so `Glitch`
    and `glitch` are one cache key and junk never reaches D1. `before` is required and canonical (`intParam(1)`), so a missing or
    malformed one is `400`; the query is checked before the name.
  - **Cache** (`cache.ts`): `profileKey(origin, username)`, `profileBeforeKey(origin, username, before)`, both whole responses through
    `cachedResponse()` (L1 only, `EDGE_TTL_S.profile` 30 s and `profileBefore` 60 s). `purgeProfile(origin, username)` drops the first
    page and bumps the stale-fill counter. It is called, awaited before the response, from `POST /posts` and `DELETE /posts/:id`
    (the two `TODO(§10.2)` lines) and from `purgeReacted()`. The reactor's own profile is not touched.
  - **The author's username on a reaction:** `reactToPost()` and `unreactToPost()` read the post back joined to `bots` and return
    `author`. `purgeReacted(c, id, author)` takes it. `serializeReactions()` builds a new object, so `author` isn't in the response.
  - **Not purged**, by design: a profile's `before` pages (keys can't be named), and the profile after a ban or an admin hiding a post
    (nothing purges on those yet). The cron has no origin and purges nothing, so a profile lags it by its TTL.
  - **Avatar:** `packages/shared/src/avatar.ts`. `fnv1a()` (32 bit, over the characters; the `TextEncoder` type isn't in that package's
    lib, and usernames are ASCII), `avatarSpec()` (low 15 bits are the three left columns, column by column, mirrored; hue is
    `(hash >>> 15) % 360`) and `avatarSvg()` (a 7x7 viewBox with a one-cell margin, pale background, `crispEdges`). The SVG holds only numbers
    from the hash. `GET /a/:file` (`avatar.ts`, mounted in `index.ts`) normalizes the name, answers any valid name whether or not a bot has it,
    reads no database, and sends `immutable` for a year, `Content-Security-Policy: default-src 'none'` and `nosniff`. A bad name or a path
    without `.svg` is a plain-text `404` so the SPA shell can't answer for an image.
- Tests (38 new, 757 to 795): `packages/shared/test/avatar.test.ts` (8: the published FNV-1a vectors, mirror and hue range over 300 names,
  distinctness, a golden picture, the SVG's squares, a hostile name), `profile.test.ts` (21: public fields, own visible posts newest first,
  the exact page and `next` walk, before pages, five bad `before` values, banned and unknown names for both routes, a banned bot's posts, a 404
  not kept, spellings share an entry, junk params, a cached read, purge on create, delete, reaction, unreact, a repeat that doesn't purge, only
  the author's profile purged, the plan, the stale fill) and `avatar.test.ts` (9: headers and body, normalization, seven bad paths).
  - The golden avatar's expected values were computed with a separate Python FNV-1a, not with the generator.
  - Reaction and ban state are set through `insertBot()`, `register()` (a local helper: a real key and a fresh IP) and `setBot()` (a change
    underneath). No test uses `clearFeed()`.

Verified (all run from the repo root):

- `vp check`: clean (60 files linted and type-checked, 89 formatted).
- `vp test`: 28 files, **795 passed** (757 baseline + 38 new), 3 full runs in a row; `vp test apps/site/test/profile apps/site/test/avatar` (30
  tests) passed 10 runs in a row.
- `vp run -r build`: passed (Worker 104.32 kB gzip, up from 102.25; SPA 94.96 kB gzip).
- Mutation checks, each reverted afterwards, whole suite run (a script that backs the file up and restores it). 31 mutants, all caught:
  - Purges: create, delete and reaction each dropped (1 each); the wrong bot purged on a reaction (1); a reaction purging when nothing changed (1);
    `purgeProfile()` not bumping the stale-fill counter (1: the late-fill test).
  - Keys: profile key without the name (8), before key without the id (1), name not normalized (2), reserved names accepted (1).
  - Queries: banned profile shown (1), status test dropped from the posts (1), not filtered by bot (9), ascending (3), no extra row so `next` is
    wrong on an exact page (1), `before` inclusive (3).
  - Responses: both TTLs (1 each), `before` optional (1) or allowing 0 (1), avatar URL (1).
  - Avatar: extension optional (1), cache header (1), `nosniff` (1), route unwired (8); hue bits overlapping the pattern, no mirror, wrong FNV
    prime, hash left signed (1 to 3 each, all in `packages/shared`).
  - Two survived the first round: `purgeProfile()` without its counter bump (a test with a latch was added, as for posts) and the avatar cache
    header (a false alarm: my replacement hit the same word in a comment, so it was re-run on the header string and caught).
- Live check against the already running `mise run dev` server on :5173 (pid 53728, nothing started or killed): two bots (own `CF-Connecting-IP`
  each); `GET /bots/Live_Prof_A` (mixed case) was an empty profile; after `POST /posts` the profile at once showed `post_count: 1` and the post;
  after B's `PUT` 🔥 it showed `reactions_received: 1` and the post's counts; the before page had the post with its counts; no `before` was `400`;
  after the author's `DELETE` the profile was `0 0 []`. `/a/Live_Prof_A.svg` was `200` with the immutable, CSP and `nosniff` headers, and
  `/a/nope.png` a `404`. I rendered a few avatars with `qlmanage -t` and looked at one. The probe bots, posts, reactions, snapshot rows and
  `sqlite_sequence` rows were deleted afterwards (the local D1 was empty before).

Findings:

- **`PATCH /me {bio}` (Slice 8) must call `purgeProfile()`**: the bio is part of the cached profile. So must a ban (Slice 11), best effort.
  Both have an origin only if they run in a request; a ban from the admin CLI does too, since it goes through the Worker.
- `qlmanage -t -s 160 -o <dir> <file>.svg` renders an SVG to a PNG on macOS, which is enough to look at an avatar.
- In a mutation script, `str.replace(a, b, 1)` hits the first occurrence, comments included: check that a survivor isn't a mutation of
  a comment before writing a test for it.
- `packages/shared` has no DOM or Node lib, so `TextEncoder` doesn't type there.
- A 404 for an unknown route carries no `Cache-Control` at all, so `expect(header).not.toContain(...)` needs `?? ""`.
- Slice 13 should draw the SPA's avatar from `avatarSpec()` (React elements, no HTML string).
- Not changed, as instructed: the Rate Limiting binding (Slice 1.1) and the 20/min reaction burst, tests in CI (Slice A), `/top` purging,
  `wrangler.jsonc`.

### 2026-10-11, Slice 8 session (`POST /keys/rotate`, `PATCH /me`)

Done on branch `feat/keys-me`, branched from `main` at `fd7e3ce` (Slice 7 was merged). The first commit fixed the stale Slice 7
statuses and the baseline in this file. No new binding, dependency or migration; `wrangler.jsonc` untouched.

- Design:
  - **`rotateKey(db, bot, next)`** (`db/queries.ts`) is one `db.batch()`: `UPDATE bots SET key_hash, key_prefix WHERE id = ? AND key_hash = <the
    key the request used> AND status = 0 RETURNING id`, then a status read-back. The old-hash guard is what makes two parallel rotations
    from one key safe: one wins, the other is `stale_key` (`401 invalid_api_key`), so no response hands out a key that another already
    replaced. Without the guard both would answer `200` and the first caller's key would be dead. A ban between `requireBot` and the
    write is `banned` (`403`). `AuthedBot` gained `keyHash` (the hash of the key used, selected by `requireBot`; never in a response).
  - **`POST /keys/rotate`** answers `200 {api_key}` and nothing else. **No `store_credentials`** (it would send `since_cursor: null` and
    invite the agent to reset its feed cursor); §8.4 only ever said `{api_key}`. `private, no-store` comes from `requireBot`.
    It purges nothing.
  - **`PATCH /me {bio}`** answers `200 {bio}` (the stored, canonical form). Same filter and `422` body as register (`checkBio`,
    `BIO_MAX_GRAPHEMES`, `field: "bio"`). **Decision: `""` clears the bio**; a whitespace-only bio is `422 empty`, as at register (only an
    exact `""` is "no bio" there too). A missing or non-string `bio` is `400`. `setBio()` is one `UPDATE ... WHERE id = ? AND status = 0
    RETURNING`; no row is a ban after the key check (`403`). Then `await purgeProfile(origin, username)` before the response, as
    `POST /posts` does. A same-value bio still purges (cheap; no pre-read).
  - Docs: §6.2, §8.4 (the table, a `PATCH /me` and a rotate paragraph) and §10.2 (the bio bullet).
- Tests (14 new, 795 to 809): `test/keys-me.test.ts`. `PATCH /me` (6): canonical bio and headers, the cached profile dropped, `""` clears
  (profile too), five 422 codes leave the bio and the profile alone, bad bodies are 400, no key and a banned bot; plus `setBio()` on a banned
  bot. Rotation (7): the old key is `401 invalid_api_key` on the very next request while the new one works, and the row holds the new hash and
  prefix; the response has only `api_key`; two rotations in a row; nothing else of the bot changes and another bot's key still works; no key and
  banned; `rotateKey()` on a banned bot; **eight parallel `rotateKey()` calls give one winner and seven `stale_key`**, and six parallel HTTP
  requests give one `200` whose key works.

Verified (all run from the repo root):

- `vp check`: clean (61 files linted and type-checked, 90 formatted).
- `vp test`: 29 files, **809 passed** (795 baseline + 14 new), 3 full runs in a row; `vp test apps/site/test/keys-me` passed 10 runs in a row.
- `vp run -r build`: passed (Worker 104.88 kB gzip, up from 104.32; SPA 94.96 kB gzip).
- Mutation checks, each reverted afterwards, whole suite run (a script that backs the file up and restores it). 13 mutants, all caught:
  - Purge removed from `PATCH /me` (2); filter skipped (2); `""` not cleared, or the old bio kept (1 each); `setBio()` without the status guard (1).
  - Rotate: key guard dropped (1: the `rotateKey()` race test; the HTTP race passes alone, as §15 warns), status guard dropped (1), hash not
    written (4), prefix not written (1), refusal reasons swapped (2), an extra field in the response (1: it survived until the test pinned the key set),
    response made cacheable (1).
- Live check against the already running `mise run dev` server on :5173 (pid 53728, nothing started or killed): register with a bio (own
  `CF-Connecting-IP`), warm `GET /bots/:name`, `PATCH /me` (200, `{"bio":"⚡⚡"}`, `private, no-store`) and the profile showed it at once; a bio
  with words was `422 contains_words`; `""` answered `{"bio":""}` and the profile was empty; `POST /keys/rotate` was `200` with
  `private, no-store`, then the old key was `401 invalid_api_key` and the new one `200` on `/me`. The probe bots were deleted from the local D1
  afterwards (it was empty before).

Findings:

- **Parallel rotations need the old-hash guard**, and only a direct `Promise.all` on `rotateKey()` shows it; six parallel HTTP requests passed
  the unguarded version (§15).
- In a curl script, `api_key` appears twice in the register response (also in `store_credentials.file_format`): take the first match
  (`grep -o ... | head -1`). zsh's `echo` expands `\n` in the JSON; use `printf '%s'`.
- Recovery (Slice 9) will rotate a key too. It has no key to guard on, so it needs its own write; don't reuse `rotateKey()` as is.
- Not changed, as instructed: the Rate Limiting binding (Slice 1.1), tests in CI (Slice A), `/top` purging, `wrangler.jsonc`.

### 2026-10-12, Slice 9 session (`POST /recover`, `POST /recover/confirm`, email)

Done on branch `feat/recovery` (merged as `c8ddbf0`, #14), branched from `main` at `bd289f4` (Slice 8 was merged). The first commit fixed the stale Slice 8 statuses, the
baseline and the email DNS lines. New binding (approved): `send_email` named `EMAIL`, at the top level and in `env.staging`, then
`pnpm --filter site cf-typegen`. No migration (`recovery_tokens` was in `0000_init.sql`) and no new dependency or secret.

- Design:
  - **`POST /recover {username}`** answers `202 {status, message}`, `private, no-store`, for every well-formed request: a live bot, an unknown
    name, a banned bot, a bot over its limit, an invalid name. Only a body that isn't `{username: string}` is a `400`. The handler answers
    **before any database work or mail**: the work (`sendRecovery()`) runs in `ctx.waitUntil`, so the time says nothing either. A test holds
    `EMAIL.send` back and still gets the `202`; awaiting the work inline fails it.
  - **`issueRecoveryToken()`** is one batch: a query-builder `INSERT ... SELECT` from the active bot's row with the hourly count inside the
    `WHERE` (`RECOVERY_MAX` per `RECOVERY_WINDOW_S`, counted on `recovery_by_bot`, used and expired rows included), plus a read of the address.
    Atomic like register's IP limit. No row means unknown, banned or full, and the caller can't tell which.
  - **`recoverKey()`** is its own write, not `rotateKey()`: swap the key `WHERE status = 0 AND id = (SELECT bot_id FROM recovery_tokens WHERE
    token_hash = ? AND used_at IS NULL AND expires_at > now)`, then spend every unused token of the bot that now holds the new key hash, then
    read back. Swap first, because spending first would hide the token from the swap. A refused swap spends nothing.
  - **Tokens:** 32 random bytes, base62, 43 characters (`generateRecoveryToken()`); SHA-256 stored in `token_hash`. The raw token is only in
    the mail's link `<origin>/recover#t=<token>`. `POST /recover/confirm` reads it from the body only (the query string is never read); a token
    that isn't 43 base62 characters is `410` without a D1 call. Every response of the route is `private, no-store`.
  - **Banned bot decision:** a live token of a banned bot is `403 banned` and stays unspent; a used or expired one is `410`. Whoever holds a live
    token owns the address, so the `403` is not enumeration (ARCHITECTURE §8.3, decision 41).
  - **Failed send:** the token row is deleted, so an outage doesn't burn a bot's three links; the error is logged as `recover: failed <name>`
    only (a send error can name the recipient).
  - **Link origin** is the request's origin (staging links to staging). That is safe only while the routes are exact hostnames; see the Slice 14
    notes (a wildcard route would let the `Host` header choose the link).
  - Constants in `packages/shared`: `RECOVERY_MAX` 3, `RECOVERY_TOKEN_TTL_S` 1800 (`RECOVERY_WINDOW_S` existed). `TODO(§8.7)` marks the 3/min/IP
    limit for Slice 1.1.
  - The cron needed no change: Slice 6's cleanup keeps a row `RECOVERY_WINDOW_S` after it expired, which is what the count relies on.
  - Docs: §2.4, §6.3, §7.1 (request and recover, with the SQL), §8.3, §8.7 (unchanged row), §12 (binding, `waitUntil`, local dev, tests), §15, §18
    decisions 40 to 42, §19.1.
- Tests (21 new, 809 to 830): `test/recovery.test.ts`. Sending (6): mail address, link and hash-only storage; unknown and banned names send
  nothing; three an hour with the window edge and another bot unaffected; used and expired rows still count; **eight parallel `sendRecovery()`
  calls send exactly three**; a failing send takes the token back. `POST /recover` (5): one answer for eight kinds of name (status, headers,
  body), `400`s, the full flow through `vi.spyOn(env.EMAIL, "send")`, the `202` before the send, a failing send logs no address. Confirm
  (10): one use then `410`; bad, used, expired and malformed tokens answer alike; wrong shape never calls `DB.batch`; the exact expiry
  millisecond; body only, never the query string; `400`s; **eight parallel `recoverKey()` calls give one winner and the stored hash is the
  winner's**; six parallel HTTP confirms give one `200`; siblings spent and another bot's not; banned live token `403` and unspent.

Verified (all run from the repo root):

- `vp check --no-fmt`: clean (64 files linted and type-checked). `vp fmt --check` is clean on `apps`, `packages`, `docs/ARCHITECTURE.md` and
  `docs/plans`. **Plain `vp check` fails on the user's untracked `docs/design/` HTML files (8 files, formatting only); not mine, left alone.**
- `vp test`: 30 files, **830 passed** (809 baseline + 21 new), 3 full runs in a row.
- `vp run -r build`: passed (Worker 107.14 kB gzip, up from 104.88; SPA 94.96 kB gzip).
- Mutation checks, each reverted afterwards, whole suite run (a script that backs the file up and restores it). 26 mutants plus 2
  read-then-write ones, all caught in the end (counts in brackets are failing tests):
  - Issue: limit predicate dropped (3), window edge `>` to `>=` (1), window dropped (1), banned allowed (1), TTL in seconds (1), count not per bot
    (6), **read-then-write count with the insert unlimited (1: only the parallel `sendRecovery()` test, 3 runs of 3)**.
  - Recover: `used_at` not checked (5), expiry not checked (2), expiry `>` to `>=` (1), status check dropped (1), token never spent (4), spend not
    tied to the new key (4), only the presented token spent (1), banned reported as invalid (1) and the reverse (3), hash not written (5),
    **read-then-write validity check then an unconditional swap (1: only the parallel `recoverKey()` test, 3 runs of 3)**.
  - Route: mail awaited inline (1), failed send keeps the token (2), full error logged (1), token read from the query (2), confirm not `no-store`
    (2), extra response field (1), unknown name answers differently (1), link in the query string (2), shape check skipped (1), token stored raw (1).
  - Three looked like survivors in the first round. Two were real and got a better test or assertion: the shape check (now a `DB.batch` spy)
    and the full error logged (the first test serialised the `Error` to `{}`). The third, the inline await, was my mutant: it left a trailing
    comma in parentheses, a parse error, and my runner counted only failed tests, so a file that failed to compile read as a pass. The
    corrected mutant (`await Promise.resolve(...)`) is caught by "POST /recover answers before the mail is sent". Two more mutants (window
    edge and expiry `>=`) failed only on a missing `gte` import; they were redone with `or(gt, eq)` and are caught by the edge tests.
    Every other "caught" above failed on named tests.
- Live check on my own dev server (`cd apps/site && vp dev --port 5174 --strictPort`, stopped afterwards; the one on :5173, pid 53728, was
  left alone and does not have the new binding): register, then `POST /recover` for the bot and for an unknown name gave identical `202`s; the
  simulated `send_email` binding printed the sender and subject and wrote the bodies under `apps/site/.wrangler/tmp/email/`; the link was
  `http://localhost:5174/recover#t=<43 characters>`; the token in a query string gave `410`; the body token gave `200` with `private, no-store`
  and `{api_key, username}`; the same token again gave `410 token_invalid`; four more requests in the hour sent two more mails (3 mails for 5
  requests). The probe bot and its tokens were deleted from the local D1 (it was empty before) and the mail files removed.
- **Test mail:** `pnpm exec wrangler email sending send --from noreply@wordless.one --from-name "wordless.one" --to <the user's address>
  --subject "wordless.one test mail (Slice 9)" --text "..."` from `apps/site` printed `Queued for: <address>` (the API accepted it).
  Delivery was not confirmed from here. It does not show that sending to arbitrary recipients works (see Open Question 2).

Findings:

- **`vi.spyOn(env.EMAIL, "send")` works** under `@cloudflare/vitest-plugin`, and the Worker sees the spy, so the HTTP path is tested through the
  real `cloudflareEmail()` and the binding without a seam in the code. The miniflare binding exists in tests because `wrangler.jsonc` declares it.
- A `Promise.all` of `sendRecovery()` and of `recoverKey()` caught both read-then-write mutants every run, as §15 says it should; the HTTP race
  test is only the end-to-end check.
- drizzle's query-builder `INSERT ... SELECT` takes a `Uint8Array` param through ``sql`${bytes}`.as("token_hash")``, and a correlated
  subquery built with the builder (`eq(recoveryTokens.botId, bots.id)`) renders qualified names correctly.
- `wrangler dev` does not print a simulated mail's body, only file paths.
- `wrangler whoami` shows one account id, `9c3a154e...`, which is not the "account tag" `132abfb8...` recorded under Infra reality for Email
  Sending. Unexplained (they may be different identifiers); worth a look before Slice 14.
- The `email_in_use` hint had no "recover isn't built yet" caveat to remove; it already pointed at `/api/v1/recover`.
- A mistake of mine worth a line: a stray `sqlite3` in a shell one-liner read stdin and hung the command for two minutes. A second: a text anchor in
  a plan-editing script matched an older slice's identical sentence and wiped the Slice 5 to 8 notes from the plan; caught from the diff stat
  (399 deletions) before any PR, and redone with anchors asserted unique.
- Not changed, as instructed: the Rate Limiting binding (Slice 1.1), tests in CI (Slice A), `/top` purging, the other `wrangler.jsonc` bindings.

### 2026-10-12, Slice 10 session (agent docs)

Done on branch `feat/agent-docs`, branched from `main` at `c8ddbf0`. The first commit fixed the stale Slice 9 statuses and the baseline. No binding,
no dependency, no migration and no new var.

- Design:
  - **Templates are bundled, not assets.** `src/worker/agent-docs/{llms.txt,skill.md,heartbeat.md}` are imported with Vite's `?raw`
    (`raw.d.ts` types it) and rendered by `agent-docs.ts`. §11 said `apps/site/public/`; that would also ship the raw templates as static files
    and need an `ASSETS` fetch. The routes were already in `run_worker_first`; `index.ts` adds three `app.get` handlers.
  - **`{{BASE_URL}}` is the request origin**, like every other link the API builds, so staging documents link to staging. That is safe only
    while Worker routes are exact hostnames (Slice 14 notes). Cache-Control is `public, max-age=300, s-maxage=300`; no Cache API layer, because
    rendering is one string replace.
  - **Limits are placeholders** (`{{POST_COOLDOWN_MIN}}`, `{{POST_MAX_GRAPHEMES}}`, ...), filled from `packages/shared` (AGENTS.md: no
    hardcoded limits). An unknown placeholder throws.
  - **`DOCS_URL` is gone**: `docsUrl(origin)` in `http.ts`. Staging should differ (a staging response pointing at production docs would send
    its bots to production), and the origin does it with no new var.
  - The documents describe the API as built: register, store key, post, validate, feed, react, `/me`, `PATCH /me`, rotate, recover, confirm,
    every error code (read from `api.ts` and `auth.ts`, not the older sketches). They say the form fallback is not available yet (Slice 12).
- Scheduler syntax, checked against the current docs on 2026-10-12 (not from memory):
  - **OpenClaw renamed its CLI**: `openclaw automations create "<cron>" "<prompt>" --name ... --session isolated` (`openclaw cron` is an
    alias; `add` and `create` are aliases). Top-of-hour recurring jobs are staggered by up to 5 minutes unless `--exact`, so the docs use
    minute 17. List with `openclaw automations list`, delete with `remove <jobId>`. There is no flag to attach a skill, so the prompt points at
    `heartbeat.md`. Sources: docs.openclaw.ai/automation/cron-jobs and its `schedules`, `payloads`, `managing-jobs` pages.
  - **Hermes**: `hermes cron create "<schedule>" "<prompt>" --skill <name> --name <n>`, or `/cron add ...`. A cron expression, `every 1h` or
    `30m` all repeat. Jobs only fire while the gateway daemon runs (`hermes gateway install` or `hermes gateway`); `hermes cron list` and `status`
    check it. Source: hermes-agent.nousresearch.com/docs/user-guide/features/cron.
  - Not re-verified (stable tool interfaces): `claude -p ... --allowedTools`, `codex exec`, `schtasks /create /sc hourly /st`, a launchd
    `StartCalendarInterval` plist. Muse is still undocumented.
- **`ADMIN_TOKEN` (user's instruction, 2026-10-12):** generated locally with `openssl rand -hex 32` and saved with `doppler secrets set ADMIN_TOKEN
  --project wordless --config stg|prd`, piped through stdin so it never reached argv, history or output. Checked by name, length (64) and that the
  two differ, never by value. Both configs held only the three `DOPPLER_*` variables before. Nothing was pushed to Cloudflare and no repo file
  changed for it (Slice 11 does `secrets.required` and `.dev.vars.example`). ARCHITECTURE §14 and decision 43 record where it lives.
- Tests (31 new, 830 to 861): `test/agent-docs.test.ts`. Serving (8): type, cache and `nosniff` for each of the three, staging origin never
  falls back to production, `X-Wordless-Docs` follows the origin, an undefined placeholder throws. Filter agreement (23): every ✅ and ❌ line in
  skill.md against `checkContent`, and every `-d '{...}'` example body (`content`, `bio`, `emoji`) against its filter.

Verified (all from the repo root):

- `vp check --no-fmt`: clean (67 files). `vp fmt` run on `apps/site/src/worker`, `apps/site/test`, `docs/plans` and `docs/ARCHITECTURE.md` only.
  Plain `vp check` still fails on the user's untracked `docs/design/` files; not mine, left alone.
- `vp test`: 31 files, **861 passed** (830 + 31).
- `vp run -r build`: passed (Worker 115.82 kB gzip, up from 107.14 because of the documents; SPA 94.96 kB gzip).
- Mutation checks, each reverted, `vp test apps/site/test/agent-docs.test.ts` per mutant (a script that backs the file up and restores it): 8 of
  8 caught. A word marked allowed (1 failing), an allowed example marked rejected (1), a word in an example body (1), a word as the reaction
  example (1), a limit placeholder with no value (the file fails to collect), origin hardcoded in `renderDoc` (3), TTL changed (3),
  `X-Wordless-Docs` hardcoded (1).
- Live check on my own dev server (`cd apps/site && vp dev --port 5174 --strictPort`, stopped by pid afterwards; the user's :5173, pid 53728, was
  left alone): the three documents served with the right type and cache headers and `localhost:5174` links, `HEAD` works, the SPA still answers
  `/`. Then the documented flow with curl as two bots: register (keys in the response match skill.md), post, the `429 cooldown` with
  `Retry-After: 3300`, `contains_words` with offsets, `feed?since=0`, a reaction, `403 self_reaction`, `/me`, `PATCH /me` clearing the bio, a
  rotation (old key `invalid_api_key`, new key works), the heartbeat's `jq` cursor-save snippet, `POST /recover` (identical `202`s for a
  real and an unknown name), then the token from the simulated mail: `200` on the body, `410 token_invalid` on the second use.
  Cleanup: `docprobe_%` bots, their posts, reactions and tokens deleted from the local D1 with scoped statements, the `latest` snapshot row that
  held a probe post removed, the simulated mail files gone.

Findings and mistakes:

- A blanket `DELETE FROM` of every local table was refused by the permission classifier. It was broader than needed: the local D1 only held my
  probe rows, so scoped `WHERE username LIKE 'docprobe\_%'` statements did the job.
- My first live run printed `jq` parse errors: zsh's `echo` expanded the backslashes in `store_credentials`' Windows path. The API was fine; use
  `printf '%s'` when piping JSON in zsh. That run still created two probe bots, which the cleanup removed.
- `pkill -f "vp dev --port 5174"` did not match (the process is a `node` child); stop it by pid after checking its command line.
- The test finds `skill.md`'s examples with the regex `^- (✅|❌) ` plus text between backticks, one per line. Keep that shape when editing.
- The docs tell agents to keep their key in `~/.config/wordless/credentials.json`; the recovery page (`/recover`, Slice 13d) is not built, so skill.md
  also documents `POST /recover/confirm` with the token from the link for owners who can't use it.
- Not changed, as instructed: the Rate Limiting binding (Slice 1.1), tests in CI (Slice A), `/top` purging, DNS, any Cloudflare secret or binding.

## Open Questions

Ask the user rather than assuming:

1. **Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`): approved? Three `TODO(§8.7)`
   comments in `api.ts` (register 3/min, `/usernames/check`, `/validate`) are waiting on this.
   Blocks Slice 1.1 only.
2. **Cloudflare Email Service** (ARCHITECTURE §19.1): sending is enabled, the five DNS records are in the zone and the `EMAIL`
   binding exists (2026-10-11). **Still open: whether the account is on Workers Paid**, which sending to arbitrary recipients needs.
   The Slice 9 test mail went to the user's own address and was accepted ("Queued for"), which does **not** settle it: an account
   owner's address may be a verified destination on the free plan. Settle it in the dashboard (Billing) or with a mail to a
   second, unverified address. The fallback is Resend behind the same `EmailSender` interface; switching needs the user's go-ahead.
3. ~~JS budget vs React~~ Resolved 2026-10-11: React stays, budget is 130 KB gzip.
4. **First deploy** of staging and prod (Slice 14), and who sets any new remote secrets. `IP_HASH_SECRET` is already set on both.
   `ADMIN_TOKEN` is generated and in Doppler (`wordless`, `stg` and `prd`, 2026-10-12) but **not yet a Cloudflare secret**; ask before `wrangler secret put`.
5. ~~Cron triggers~~ Resolved 2026-10-11: the user approved `triggers.crons: ["* * * * *"]` (Slice 6).
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

Status: `[x]` Done and verified on `feat/cache`. Merged as `4de2bab` (PR #9). See Working Notes 2026-10-11,
Slice 4.1 session. Differences from the sketch below: L0 and L1 cache the snapshot **rows** (not a response)
and `limit` and `since` are applied in memory; `before` pages and `/posts/:id` are cached whole; the L1 keys
start with the origin; the purge is `rebuildAndPurgeLatest()` (rebuild, then purge) and the cron won't purge;
a purge counter keeps reads that began before a purge from filling afterwards.

- L0 isolate memory (2 s, snapshots only), L1 Cache API with canonical keys (known params only),
  local purge on writes (§10.1, §10.2). Test that junk query strings don't create new cache entries.
- Started from what Slice 4 left: `EDGE_TTL_S` in `packages/shared` (used for the L1 TTLs), the two
  `TODO(§10.2)` lines in `api.ts`, `readQuery()` and the `FeedQuery` schema, and `refreshLatest()`.

### Slice 5: reactions

Status: `[x]` Done and verified. Merged as `fbb6045` (PR #10). See Working Notes 2026-10-11,
Slice 5 session. Differences from the sketch below: new versus swap is decided in SQL, not from a pre-read
(no drift under parallel first reactions, so nothing for the nightly reconcile to repair there); the 422
codes are the filter's own (`invalid_emoji` was dropped from §8.4); the quota rules are decisions 37 and 38.

- `PUT` and `DELETE /posts/:id/reaction`: `checkReaction`, `403 self_reaction`, `404`,
  `429 rate_limited` (via `tooManyRequests()`). §8.4 says `422 invalid_emoji`, but `checkReaction` returns its own codes
  (`contains_words`, `invalid_characters`, `empty`, `too_long`). Decide the mapping and fix whichever
  side is wrong in the same PR.
- The §7.1 batch: upsert, recompute `reaction_total` and `reaction_top`, adjust `reactions_received`.
  (As built, the +1 is decided in SQL with `NOT EXISTS`, so concurrent PUTs from one bot don't drift.)
- Limits: 60/hour per bot counted in D1 (`reactions_by_bot`), 20/min burst via the binding once
  Slice 1.1 exists. Constants in `packages/shared`. The counting rules are decided (Working Notes, "decisions before Slice 5").
- No `latest` rebuild after a reaction: purge `/posts/:id` and leave the snapshot's counts to the cron (decided).

### Slice 6: `top24`, `GET /top`, cron

Status: `[x]` Done and verified; merged as `ea90eb6` (PR #11). See Working Notes 2026-10-11, Slice 6 session.
Differences from the sketch below: the recovery-token cleanup keeps rows for the `/recover` window, and the nightly
reconcile is chunked by bot id (both in the notes).

- `rebuildTop24()` over the `posts_reacted` partial index; `GET /top`; `scheduled()` every minute to
  rebuild both snapshots; hourly cleanup of expired `recovery_tokens`; nightly reconcile of
  `post_count` and `reactions_received`. `/health` also reports snapshot age.
- Needs the `triggers.crons` config: confirm first (Open Question 5).

### Slice 7: profiles and avatars

Status: `[x]` Done and verified; merged as `fd7e3ce` (PR #12). See Working Notes 2026-10-11, Slice 7 session.
Differences from the sketch below: a banned bot's profile is a `404`, the profile's `before` page takes `before` as required, and
`GET /a/:username.svg` is a Worker route that reads no database.

- `GET /bots/:username` (profile plus first 50 posts) and `/bots/:username/posts?before=`. Never
  expose email or IP data. Put the FNV-1a avatar generator in `packages/shared` so the SPA and
  `GET /a/:username.svg` share it.

### Slice 8: `POST /keys/rotate` and `PATCH /me`

Status: `[x]` Done and verified; merged as `bd289f4` (PR #13). See Working Notes 2026-10-11, Slice 8 session. Differences from the sketch
below: rotation is guarded by the old key's hash (parallel rotations: one wins, the rest are `401`), the response is `{api_key}` only, and an
empty bio clears it.

- Rotate: new key, old one dead on the next request (auth reads the primary). `PATCH /me {bio}` uses
  `checkBio` like register. Never log keys.

### Slice 9: key recovery and email

Status: `[x]` Done and verified, merged as `c8ddbf0` (#14). See Working Notes 2026-10-12, Slice 9 session. Differences from the sketch
below: `/recover` answers before any database work or mail (`waitUntil`), a confirm also spends the bot's other unused links, a live token
of a banned bot is `403 banned`, and a mail that fails to send deletes its token. The `email_in_use` hint needed no change (it already
pointed at `/recover` with no caveat).

- `EmailSender` interface plus the Cloudflare implementation (`send_email` binding: approved), `POST /recover` (always `202`, 3/hour per
  bot counted on `recovery_by_bot`), `POST /recover/confirm` (single-use, 30-minute tokens, `410 token_invalid`). Tests use a fake sender.

### Slice 10: agent docs

Status: `[x]` Done and verified on `feat/agent-docs` (PR in review). See Working Notes 2026-10-12, Slice 10 session. Differences from the
sketch below: the templates live in `src/worker/agent-docs/` (bundled with `?raw`), not in `public/`; the limits they quote are placeholders
filled from `packages/shared`; `DOCS_URL` became `docsUrl(origin)` (no new var).

- `llms.txt`, `skill.md`, `heartbeat.md` with `{{BASE_URL}}` templating, served by the Worker
  with 5-minute caching (§11). Check the OpenClaw and Hermes cron syntax against their current docs
  while writing (§11 note). Replace the hard-coded `DOCS_URL` in `http.ts` if staging should differ.

### Slice 11: admin endpoints and CLI

Status: `[ ]`

- `/api/admin/*` with `ADMIN_TOKEN` (add it to `secrets.required` and `.dev.vars.example`) and
  `scripts/admin.ts`. Ban hides all of the bot's posts and rebuilds snapshots.
- **The token exists already** (user's go-ahead, 2026-10-12): Doppler project `wordless`, configs `stg` and `prd`, secret `ADMIN_TOKEN`, a
  different 64-hex value in each, generated locally. Read it with `doppler secrets get ADMIN_TOKEN --project wordless --config stg --plain`
  (use `prd` for production) and never print it. `scripts/admin.ts` can read it from `doppler run` or the environment. The Cloudflare copy
  (`wrangler secret put ADMIN_TOKEN`, and `--env staging`) is not set yet: do it at the first deploy (Slice 14), piping the value from
  Doppler, and ask first. A local `.dev.vars` value stays a throwaway (nothing was added to the Doppler `dev` config).

### Slice 12: form fallback

Status: `[ ]`

- Form-encoded writes with `api_key` in the body, and the no-JS `GET /act` page (§8.6). Never accept
  keys in URLs.
- Update `skill.md` and `heartbeat.md` in the same PR: both now say a form fallback "is not available yet" (hosted-assistants paragraph
  in `heartbeat.md`, and §11 of ARCHITECTURE). `test/agent-docs.test.ts` checks their examples against the filter.

### Slice 13: the web UI (several PRs)

Status: `[ ]` React stays and the JS budget is 130 KB gzip (decided 2026-10-11).

- 13a router and feed view from the API; 13b `HTMLRewriter` boot-data injection, titles and OG tags,
  security headers (§9.2, §9.4); 13c polling and the `↑ N` pill; 13d profile, permalink, about and
  recover pages; 13e styles and the Playwright smoke test.

### Slice 14: deploy

Status: `[ ]`

- Staging deploy on push to `main`, prod on tag, remote migrations, first-deploy secrets, custom
  domains and DNS (§14). Needs the user's Cloudflare credentials in GitHub secrets.
- **Ask the user before touching DNS.** The zone still holds records that look left over from the old host (reported 2026-10-12; `dig` only
  shows Cloudflare's proxy IPs, so the origins aren't visible from outside): an apex `A` record `wordless.one` to `46.101.96.143` (proxied), a
  wildcard `*.wordless.one` to the same address, and a `www` `CNAME` to a GoDaddy host (the exact target wasn't recorded; read it in the
  dashboard). `dig` confirms every name resolves, `staging.wordless.one` and a made-up one included. They will conflict with a Workers
  custom domain at the apex, and the wildcard could swallow a staging hostname. ARCHITECTURE §14 says "wipe all old records", but don't do it
  without asking: the email records (3 MX, SPF, DKIM, `_dmarc`) live in the same zone and must stay.
- **Routes must be exact hostnames, never `*.wordless.one/*`.** The recovery mail links to the request's origin (Slice 9), so a wildcard route
  would let a forged `Host` header choose where a victim's link points. If staging needs a different mail origin anyway, add a `PUBLIC_ORIGIN`
  var (ask first).

### Slice 15: observability

Status: `[ ]`

- Analytics Engine dataset and events (§16), the 5 GB D1 alert. Needs the binding (ask first).

## Final verification (before calling v1 done)

`vp check`, `vp test`, `vp run -r build`, the Playwright smoke test against staging, and a manual
run of the §2.3 heartbeat with `curl` against staging.

## Next Slice

**Slice 11: admin endpoints and CLI.** It is unblocked: the user approved `ADMIN_TOKEN` on 2026-10-12 and the values already sit in Doppler (see the
Slice 11 section for where and how to read them). Add it to `secrets.required` (top level and `env.staging`) and `.dev.vars.example`, but ask
before running `wrangler secret put`. Slice 12 (form fallback) is also unblocked. Slice A (tests in CI) is still deferred by the user and Slice 1.1
still waits on the Rate Limiting binding (Open Question 1). Workers Paid is unverified (Open Question 2); it matters for production recovery mail.
`AGENTS.md` is deliberately unchanged, so the user will point you at this file.

Start here (Slice 11):

1. `git fetch origin && git switch main && git pull`, then branch. Slice 10 should be merged by then; check with `git log origin/main --oneline -3`.
2. Read `AGENTS.md`, the Cross-slice rules, the Slice 10 Working Notes, the Slice 11 section above, and ARCHITECTURE §8.5, §13, §7.1 (ban) and §6.2.
3. `vp test` should report 861 passing before you change anything.
4. Done when `vp check --no-fmt`, `vp test` and `vp run -r build` pass (plain `vp check` fails on the untracked `docs/design/` files until the user
   formats or commits them), ARCHITECTURE matches the code, this file's Slice 11 is `[x]` with the exact commands under Working Notes, and `Next Slice`
   points at Slice 12.
