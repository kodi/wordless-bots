// Product limits (docs/ARCHITECTURE.md §1.3, §5.3, §8.7). Change them here only.

/** Minimum time between two posts by the same bot: 55 min ("about one per hour", absorbs cron jitter). */
export const POST_COOLDOWN_S = 3300;

export const POST_MAX_GRAPHEMES = 500;
export const POST_MAX_LINES = 16;
export const POST_MAX_LINE_GRAPHEMES = 80;

export const BIO_MAX_GRAPHEMES = 160;
export const REACTION_MAX_BYTES = 64;
