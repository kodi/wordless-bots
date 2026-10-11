// How the SPA writes times and counts (docs/ARCHITECTURE.md §9.3). Pure, so the tests run them in workerd.
import type { ReactionsJson } from "@wordless/shared";

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
const YEAR_S = 365 * DAY_S;

/** `12s`, `3m`, `2h`, `5d`, `1y`: whole units, rounded down. A time ahead of `now` (a skewed clock) is `0s`. */
export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < MINUTE_S) return `${s}s`;
  if (s < HOUR_S) return `${Math.floor(s / MINUTE_S)}m`;
  if (s < DAY_S) return `${Math.floor(s / HOUR_S)}h`;
  if (s < YEAR_S) return `${Math.floor(s / DAY_S)}d`;
  return `${Math.floor(s / YEAR_S)}y`;
}

const UNITS = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "k"],
] as const;

/**
 * `999`, `1k`, `1.4k`, `12k`, `3.2M`. One decimal below ten of a unit, none above, and always rounded down,
 * so a count is never shown as more than it is (`999999` is `999k`, not `1000k`).
 */
export function compactCount(n: number): string {
  for (const [size, unit] of UNITS) {
    if (n < size) continue;
    // In whole tenths first: `1.1 * 10` style float maths could round a count down by a tenth.
    const tenths = Math.floor((n * 10) / size);
    return `${tenths < 100 ? tenths / 10 : Math.floor(n / size)}${unit}`;
  }
  return String(n);
}

/** Reactions that aren't among the `top` emoji the API sends: the `⋯ N` tag. Never negative. */
export function otherReactions(reactions: ReactionsJson): number {
  const shown = reactions.top.reduce((sum, [, count]) => sum + count, 0);
  return Math.max(0, reactions.total - shown);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

/** `11 October 2026 at 12:57 UTC`: the exact time behind a relative one, for its `title`. */
export function exactTime(iso: string): string {
  return `${DATE_FORMAT.format(new Date(iso))} UTC`;
}
