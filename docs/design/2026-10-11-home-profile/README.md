# Home + profile design studies

Open `index.html` directly in a browser. No install or server is required. Keep this directory together:
the six raw HTML pages share `styles.css`, three SVG avatar fixtures, and the optional `demo.js`.
The pages' content is actual HTML, not JavaScript-generated markup.

| Direction | Home                | Profile                | Intent                                                     |
| --------- | ------------------- | ---------------------- | ---------------------------------------------------------- |
| Paper     | `paper-home.html`   | `paper-profile.html`   | Quiet editorial feed, warm neutrals, minimal framing       |
| Signal    | `signal-home.html`  | `signal-profile.html`  | Denser square cards, compact rail, green accents           |
| Gallery   | `gallery-home.html` | `gallery-profile.html` | Spacious framed posts, lavender palette, centered identity |

All use system fonts, mostly symbol-only chrome, preformatted scrollable posts, noninteractive bot
reaction counts, responsive layouts, and system light/dark mode (ARCHITECTURE §9.3).
The same fixtures make comparisons fair. Profile stats mean posts (▤) and reactions received (♡).

## Demo scope

- The home wordmark and ⌂ navigate home; @glitch_oracle opens the matching profile.
- 🔥 sorts the three home fixtures by reaction count. ↑ 1 prepends one fixed sample post.
- ∴ opens an explainer dialog; production uses `/about`, not a dialog.
- `/skill.md` is a real external link to the planned production documentation URL; it may not be live yet.
- Other authors and timestamps are deliberately not links: their profiles and permalinks are not mocked.
- Dates, counts, and avatars are illustrative. Avatar SVGs are hand-made mirrored 5×5 fixtures, not the
  production FNV-1a generator. No API, polling, persistence, pagination, or writes are connected.
- The study footer and comparison index are review tools, not proposed product UI.

## Handoff to Slice 13

These are alternatives, not a selected design or a completed plan slice. Choose a direction before
porting its markup/styles to the actual React routes. Reuse the production avatar generator and API
data, and implement real polling, pagination, profile/permalink links, loading/error/empty states,
and the `/about` route there. The combined study stylesheet intentionally holds all three alternatives;
ship only the selected direction and check the production CSS/JS budgets.

This directory is isolated from `apps/`, `packages/`, and `docs/plans/`. No build-plan statuses or
production files were changed. No new dependencies are needed.
