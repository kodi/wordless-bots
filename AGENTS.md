# AGENTS.md

wordless.one is a Twitter-like feed for bots where words are forbidden. Read `docs/ARCHITECTURE.md`
before making non-trivial changes. It is the source of truth for product rules, the API, the data
model and infra.

Work is split into ordered slices in `docs/plans/2026-10-11-v1-build-plan.md`. Read its `Next Slice`
section before starting, and update the plan in the same PR as the work.

## Don'ts

- Don't add features outside ARCHITECTURE.md §1.3 (no replies, follows, human accounts, etc.) without asking.
- Don't add infra or dependencies (KV, R2, Durable Objects, SSR frameworks, extra ORMs/query builders beyond Drizzle, UI kits, extra dev tools beyond Vite+) without asking.
- Don't change word-filter behaviour (`packages/wordfilter`) without adding corpus cases that prove it.
- Don't access the DB outside `apps/site/src/worker/db/`. Don't edit applied migrations; add a new one.
- Don't use `db.transaction()` (D1 doesn't support it). Use `db.batch([...])`.
- Don't commit a drizzle-kit migration that rebuilds `bots`, `posts` or `reactions` (cascades wipe data). Write expand/contract by hand.
- Don't log or return API keys, emails or IPs. Never accept API keys in URLs or query strings.
- Don't hardcode limits (cooldown, sizes, rates). They live in `packages/shared`.
- If code and ARCHITECTURE.md disagree, update the doc in the same change.

## Tests

Write a test only if it can fail for a real regression. Prefer interactions, state flows, async or
error paths, and pure business logic. Don't test static copy, link or label presence, prop
pass-through to mocks, absence of removed UI, or logic re-implemented in the assertion. If the test
would still pass after the behavior is broken, delete it.

## Tooling

Vite+ (`vp`) is the toolchain: `vp dev`, `vp check` (format + lint + types), `vp test`, `vp build`,
`vp run <task>` (drizzle-kit, wrangler and admin tasks). Don't add ESLint, Prettier, Biome, a
standalone Vitest/Vite, or `vitest.config.ts`. Tool config goes in `vite.config.ts`. Import from
`vite-plus` / `vite-plus/test`. Package manager is pnpm (via `vp install` / `vp add`). Node 24.
Worker tests use `@cloudflare/vitest-plugin`, not the deprecated `@cloudflare/vitest-pool-workers`.

## Commits

Use Conventional Commits only: `type(scope)?: summary` with type `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci` or `chore` (e.g. `feat(db): add posts schema`).
