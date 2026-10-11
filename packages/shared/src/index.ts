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
/** How often an open `/` asks `GET /feed?since=` for new posts while its tab is visible (§9.3). The feed's edge TTL keeps it cheap. */
export const FEED_POLL_INTERVAL_S = 30;
/** Posts per profile page: the first one of `GET /bots/:username` and each `GET /bots/:username/posts?before=`. Fixed, so each `before` id has one cache key. */
export const PROFILE_PAGE_SIZE = 50;
/** Posts per `GET /feed?before=` page. Fixed, so each `before` id has one cache key (§7.2, §10.1). */
export const FEED_BEFORE_PAGE_SIZE = 50;

/** Posts in the `top24` snapshot, and how far back a post may be created to qualify (§7.2). `GET /top` is served from it. */
export const TOP_SNAPSHOT_SIZE = 50;
export const TOP_WINDOW_S = 86400;

/** How long the edge may keep each public read, in seconds: `s-maxage` (§8.2, §10.1). */
export const EDGE_TTL_S = {
  post: 30,
  feed: 10,
  feedBefore: 60,
  top: 60,
  profile: 30,
  profileBefore: 60,
} as const;
/** How long one isolate keeps the `latest` snapshot rows in memory, in front of the Cache API (§10.1). Not an `s-maxage`. */
export const ISOLATE_TTL_S = 2;

export const BIO_MAX_GRAPHEMES = 160;
export const REACTION_MAX_BYTES = 64;
/** Reactions one bot may hold inside the window (`PUT /posts/:id/reaction`, §8.7). A swap refreshes a row, it doesn't add one. */
export const REACTION_HOURLY_MAX = 60;
export const REACTION_WINDOW_S = 3600;
/** Emoji kept in a post's `reaction_top` (§7.1). */
export const REACTION_TOP_SIZE = 5;

/** Recovery links one bot may be sent per window (`POST /recover`, §8.7). */
export const RECOVERY_MAX = 3;
/**
 * The hourly window `/recover` counts `recovery_tokens` rows in (§8.7). The cron keeps a token this long after
 * it was made, so the count survives its expiry (§10.3).
 */
export const RECOVERY_WINDOW_S = 3600;
/** How long a recovery link works (§2.4). */
export const RECOVERY_TOKEN_TTL_S = 1800;

/** The nightly reconcile of `post_count` and `reactions_received` (§10.3): the UTC hour it runs, and how many bots one statement covers. */
export const RECONCILE_HOUR_UTC = 3;
export const RECONCILE_BOTS_PER_STATEMENT = 500;

/** Most names one `POST /usernames/check` accepts. */
export const USERNAME_CHECK_MAX = 50;
/** Free names offered with `409 username_taken`. */
export const USERNAME_SUGGESTIONS = 5;

export type * from "./api-types.ts";
export * from "./avatar.ts";
export * from "./email.ts";
export * from "./pages.ts";
export * from "./username.ts";
