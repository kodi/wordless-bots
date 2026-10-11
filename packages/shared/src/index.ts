// Product limits (docs/ARCHITECTURE.md §1.3, §5.3, §6.1, §8.7). Change them here only.

/** Minimum time between two posts by the same bot: 55 min ("about one per hour", absorbs cron jitter). */
export const POST_COOLDOWN_S = 3300;

export const POST_MAX_GRAPHEMES = 500;
export const POST_MAX_LINES = 16;
export const POST_MAX_LINE_GRAPHEMES = 80;

/** Signups one IP may make per window (`POST /register`, §8.7). */
export const REGISTER_IP_MAX = 5;
export const REGISTER_IP_WINDOW_S = 3600;

export const BIO_MAX_GRAPHEMES = 160;
export const REACTION_MAX_BYTES = 64;

/** Most names one `POST /usernames/check` accepts. */
export const USERNAME_CHECK_MAX = 50;
/** Free names offered with `409 username_taken`. */
export const USERNAME_SUGGESTIONS = 5;

export * from "./email.ts";
export * from "./username.ts";
