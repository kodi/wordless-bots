# wordless.one v1 build plan

Handoff record between sessions. `docs/ARCHITECTURE.md` stays the source of truth for product rules,
the API, the data model and infra. This file only tracks the order of work, what was learned, and
what to do next.

Last updated: 2026-10-11 (end of the `POST /register` session).

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

Open: **PR #4 `feat(api): add POST /register`** (branch `feat/register`). Check whether it merged
before branching (see Next Slice). It adds `parseEmail()` in `packages/shared`, `createBot()`,
`hashIp()`, `storeCredentials()`, the `IP_HASH_SECRET` secret and `.dev.vars` flow.

Worker layout (`apps/site/src/worker/`): `index.ts` (Hono app, error handlers),
`api.ts` (all `/api/v1` routes so far), `auth.ts`, `http.ts`, `keys.ts`, `credentials.ts`,
`ip-hash.ts`, `db/schema.ts`, `db/queries.ts`. Tests are in `apps/site/test/` with helpers
`insertBot()` and `api()` in `helpers.ts`.

Baseline: `vp test` runs 601 tests (49 shared, 506 wordfilter, 46 worker).

Not built yet: posts, feed, top, reactions, profiles, key rotation, `PATCH /me`, recovery, email,
admin, form fallback, snapshots, caching, cron, rate limits, agent docs (`/skill.md` etc.), all of
the real UI, Analytics Engine events.

Infra reality:

- No Worker is deployed. `wrangler secret list` fails for both prod and staging ("run `wrangler
  deploy` first"), so **`IP_HASH_SECRET` is not set remotely**. Command is in ARCHITECTURE §14.
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
  Not yet checked whether the Vite plugin sets it. Slice 1 has to deal with this.
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
- `wrangler secret put` against a Worker that doesn't exist was not run. `secret list` says "run
  `wrangler deploy` first".

## Open Questions

Ask the user rather than assuming:

1. **Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`): approved? The `TODO(§8.7)`
   comments in `api.ts` have been waiting on this. Blocks Slice 1.1 only.
2. **Cloudflare Email Service** (ARCHITECTURE §19.1): sending is enabled, but the user must add the
   DNS records (or provide a DNS-edit token) and confirm Workers Paid. Also confirm the `send_email`
   binding. Blocks Slice 9. Fallback is Resend behind the same `EmailSender` interface.
3. ~~JS budget vs React~~ Resolved 2026-10-11: React stays, budget is 130 KB gzip.
4. **First deploy** of staging and prod, and who sets the remote secrets. Not needed until Slice 14,
   but `/register` returns 500 on any deployed environment until `IP_HASH_SECRET` is set.
5. **Cron triggers** (`triggers.crons`, needed in Slice 6): treat as infra and confirm.
6. Minor, decide in Slice 4: what `cursor` is when the feed is empty.

## Slices

Status legend: `[ ]` not started, `[-]` in progress, `[x]` done (verified).

### Slice 0: `POST /register`

Status: `[x]` Done and verified, PR #4 open (not yet merged).

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

### Slice 1: register rate limits, hourly window in D1 (NEXT)

Status: `[ ]`

- Goal: at most 5 registrations per IP per hour (§8.7), answered with `429 rate_limited` and a
  `Retry-After` header.
- Why here: it finishes `/register`. It needs no new infra: the `bots_reg_ip(reg_ip_hash,
  created_at)` index already exists.
- Implement:
  - Add `REGISTER_MAX_PER_IP_PER_HOUR = 5` and the one-hour window to `packages/shared/src/index.ts`
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
- Dependencies: PR #4 merged (or branch from `feat/register`).

### Slice 1.1: burst limits with the Rate Limiting binding

Status: `[ ]` Blocked on Open Question 1.

- Add `ratelimits` bindings to `wrangler.jsonc` (top level and `env.staging`; bindings aren't
  inherited) and a small `limits.ts` wrapper. Apply: register 3/min/IP, `/usernames/check`
  10/min/IP, `/validate` 30/min per key (bot id) or IP. Remove the three `TODO(§8.7)` comments.
- First prove the binding is simulated inside `@cloudflare/vitest-plugin` tests. If it isn't,
  decide with the user how to test it.
- Never put a raw IP in a limiter key: use the hex of `hashIp()`.
- Document the bindings in §14 and run `pnpm --filter site cf-typegen`.

### Slice 2: `POST /posts`

Status: `[ ]`

- Goal: a bot can post. Cooldown enforced atomically (§7.1, §8.4).
- Why here: the core write. Reads (feed) come after there is something to read.
- Implement:
  - `createPost()` in `db/queries.ts` as one `db.batch()`: the conditional `INSERT ... SELECT ...
    WHERE EXISTS (...)  RETURNING id` and the guarded `UPDATE bots` from §7.1. No row returned
    means `429 cooldown`.
  - Route: `checkContent` with the `POST_MAX_*` limits (as `/validate` does), store the canonical
    content. Errors: `422` with the filter's code, `matches`, `hint`. A rejected post must not touch
    the cooldown. `429 cooldown {next_post_at, retry_after_s}` plus `Retry-After`.
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
  `429 rate_limited`. §8.4 says `422 invalid_emoji`, but `checkReaction` returns its own codes
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

**Slice 1: register rate limits (hourly window in D1).** Slice A (tests in CI) is deferred by the
user. `AGENTS.md` is deliberately unchanged, so the user will point you at this file.

Start here:

1. `git fetch origin`. If PR #4 is merged: `git switch main && git pull`. If not, and the user wants
   to continue anyway, branch from `feat/register`. Don't use the `gh` API heavily: its hourly rate
   limit was exhausted at the end of the last session, and `git` over SSH is unaffected.
2. Read `AGENTS.md`, then ARCHITECTURE §7.1, §8.3 and §8.7, then the register handler in
   `apps/site/src/worker/api.ts` (the `TODO(§8.7)` above `api.post("/register")`).
3. `mise run dev` (or `pnpm install && pnpm dev`) only if you need a live server. Check port 5173
   first. Baseline before you change anything: `vp test` should report 601 passing.
4. Follow the Slice 1 section above. Its first two edits are the shared constants and the count
   query in `db/queries.ts`; then update the `register()` helper in `test/register.test.ts` to send
   a distinct `CF-Connecting-IP` before adding the limit tests.
5. Ask the user before touching `wrangler.jsonc` bindings (Slice 1.1 needs Open Question 1 answered).
6. Done when `vp check`, `vp test` and `vp run -r build` pass, ARCHITECTURE §8.3/§8.7 match the code,
   this file's Slice 1 is `[x]` with the exact commands recorded under Working Notes, and `Next
   Slice` points at the following task.
