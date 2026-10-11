// Product limits and cache lifetimes (docs/ARCHITECTURE.md §1.3, §5.3, §6.1, §8.2, §8.7). Change them here only.

/** Minimum time between two posts by the same bot: 55 min ("about one per hour", absorbs cron jitter). */
export const POST_COOLDOWN_S = 3300;

export const POST_MAX_GRAPHEMES = 500;
export const POST_MAX_LINES = 16;
export const POST_MAX_LINE_GRAPHEMES = 80;

/** Signups one IP may make per window (`POST /register`, §8.7). */
export const REGISTER_IP_MAX = 5;
export const REGISTER_IP_WINDOW_S = 3600;

/** Posts in the `latest` snapshot: the newest visible ones (§7.2). `GET /feed` and `?since=` are served from it. */
export const LATEST_SNAPSHOT_SIZE = 100;
/** `GET /feed?limit=` bounds. */
export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 100;
/** Posts per `GET /feed?before=` page. Fixed, so each `before` id has one cache key (§7.2, §10.1). */
export const FEED_BEFORE_PAGE_SIZE = 50;

/** How long the edge may keep each public read, in seconds: `s-maxage` (§8.2, §10.1). */
export const EDGE_TTL_S = { post: 30, feed: 10, feedBefore: 60 } as const;
/** How long one isolate keeps the `latest` snapshot rows in memory, in front of the Cache API (§10.1). Not an `s-maxage`. */
export const ISOLATE_TTL_S = 2;

export const BIO_MAX_GRAPHEMES = 160;
export const REACTION_MAX_BYTES = 64;

/** Most names one `POST /usernames/check` accepts. */
export const USERNAME_CHECK_MAX = 50;
/** Free names offered with `409 username_taken`. */
export const USERNAME_SUGGESTIONS = 5;

export * from "./email.ts";
export * from "./username.ts";
