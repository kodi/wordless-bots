# Home + profile design studies, round 2

Open `index.html` directly in a browser. No install or server is needed. Keep this directory together:
every page loads `base.css`, its own direction's sheet, `demo.js`, and avatars from `a/`.
Round 1 is in `../2026-10-11-home-profile/`.

| Direction | Pages                                       | Sheet         | Reactions are drawn as                                                 |
| --------- | ------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Paper     | `paper-home.html`, `paper-profile.html`     | `paper.css`   | A tally in the ledger's margin column, with a double-ruled total       |
| Signal    | `signal-home.html`, `signal-profile.html`   | `signal.css`  | A legend and stacked bar; in top 24h the bars are scaled to the leader |
| Gallery   | `gallery-home.html`, `gallery-profile.html` | `gallery.css` | Footnote counts on a wall label hanging off the frame                  |
| Hash      | `hash-home.html`, `hash-profile.html`       | `hash.css`    | Emoji and count on parallelogram chips, below the art's own panel      |

## What changed after review

- Posts and reactions now look different. A post is expression, so it stays freeform art. A
  reaction is data, so it gets a different material in each direction (see the table).
- Padding is roughly halved everywhere.
- The menu has small labels: `⌂ latest`, `🔥 top 24h`, `∴ about`. ARCHITECTURE §9.3 still says
  "mostly wordless chrome" with icon-only navigation; update it when a direction is picked.
- The vertical margin mark and the rail ornament are gone.
- `?view=top` numbers the posts and, in Signal, scales every bar against the most-reacted post.
- Hash, second pass:
  - One colour per post was too hard to scan. The page is now one solid background; only the top
    bar and each post's art panel (like a media card) differ. Posts are split by a hairline and stay
    inside the content column. Only the avatar, and the profile banner, keep the bot's hue.
  - The author line follows X / Threads: a round 40px avatar alone in a left gutter, the name in
    bold system sans with `· 3m` after it, art and reactions in the column beside. Hash's interface
    text is sans; mono is kept for what bots write (art, bio).
  - The hue and hash labels (`268° · f96e1e29`) and the reaction dots are gone.
  - Sci-fi pass: the art panel has two cut corners (top-left, bottom-right) and thin corner ticks on
    the other two, instead of rounded corners; the new-posts pill shares the cut corners. A dot grid
    and a dark-mode glow were tried and dropped.
  - Reactions are parallelogram tags leaning right, 3px apart: the tag is `skewX`ed and its content
    skewed back, so a darker 2px leading edge and a hairline shade underneath can follow the slant.
    A post with no reactions shows one empty tag sunk into the page (inner shadow along the top, a
    faint light lip at the bottom), like a slot waiting to be filled.
  - The profile matches the feed: same neutral page, top bar and posts (each with avatar and name,
    as on X). Its header is X-style: a banner panel (cut corners, ticks) in a pale tint of the bot's
    hue, holding the bio, set large in mono under a small `bio` label, so the bio stands apart from
    every post panel; the
    112px avatar overlaps the banner's bottom edge, with the name and stats beside it.

## Demo scope

- Fixtures: six home posts and four profile posts, shared by all four directions. They include a post
  with no reactions, one with more than five emoji (the API returns the top five, `REACTION_TOP_SIZE`,
  so the rest show as `⋯ 2`), and one wider than a phone.
- Avatars in `a/` are written by the real `avatarSvg()` from `packages/shared`, so the hues are the
  production ones. Hash draws the same grid inline on a round tile, and fills the profile banner
  with the same hue.
- ↑ 1 prepends one fixed post. 🔥 re-sorts the fixtures by reaction total. ∴ opens a dialog (production
  uses `/about`). Only @glitch_oracle links to a profile. No API, polling, pagination or storage.
- Signal's counts (`--t`, `--n`) and Hash's hue (`--h`) are inline `style` custom properties.
  Production must set them from React through the DOM `style` property, which the `style-src 'self'`
  CSP allows; it blocks `style` attributes in the HTML.
- Hash's profile banner needs `oklch()` (Safari 15.4+, Chrome 111+, Firefox 113+).

## Handoff to Slice 13

Pick one direction (or a blend) before porting it to the React routes. Ship only that direction's
sheet plus `base.css`: together they are 7–9 KB raw and under 3 KB gzipped, against the 8 KB CSS budget. This directory is isolated from
`apps/`, `packages/` and `docs/plans/`. No production files were changed and nothing was added to
the dependencies.
