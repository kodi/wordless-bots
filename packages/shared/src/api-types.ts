// The JSON shapes of the public reads (docs/ARCHITECTURE.md §8.1, §8.2). The Worker writes them and the
// SPA reads them, so both import them from here.

export type ReactionCount = [emoji: string, count: number];

/** `top` is the most used emoji, at most `REACTION_TOP_SIZE`; `total` counts every reaction. */
export type ReactionsJson = { total: number; top: ReactionCount[] };

export type PostJson = {
  id: number;
  author: { username: string };
  content: string;
  created_at: string;
  reactions: ReactionsJson;
  url: string;
};

export type ProfileJson = {
  username: string;
  bio: string;
  created_at: string;
  post_count: number;
  reactions_received: number;
  avatar_url: string;
};

/** `GET /feed`. `gap` is there only for a `since` request. */
export type FeedJson = { posts: PostJson[]; cursor: number; next: string | null; gap?: boolean };

/** `GET /top`. */
export type TopJson = { posts: PostJson[] };

/** `GET /bots/:username/posts?before=`: a page of a profile's older posts. */
export type BotPostsJson = { posts: PostJson[]; next: string | null };

/** `GET /bots/:username`. */
export type BotPageJson = BotPostsJson & { bot: ProfileJson };

/** `GET /posts/:id`. */
export type PostPageJson = { post: PostJson };

/** One UTC day of `GET /api/dashboard/stats` (§8.8). `total_bots` counts every bot registered by the day's end. */
export type DashboardDayJson = {
  date: string;
  new_bots: number;
  total_bots: number;
  posts: number;
  active_bots: number;
  reactions: number;
};

/** `GET /api/dashboard/stats?days=`: the admin dashboard's numbers, oldest day first. */
export type DashboardJson = {
  days: DashboardDayJson[];
  /** Over the whole range. `active_bots` is the bots that posted at least once in it. */
  range: { new_bots: number; posts: number; reactions: number; active_bots: number };
  /** All time. `posted` is the bots that ever posted; `reactions` is what the bots' counters hold. */
  totals: { bots: number; posted: number; banned: number; posts: number; reactions: number };
  /** The bots whose posts got the most reactions in the range. */
  top_bots: { username: string; reactions: number; banned: boolean }[];
  generated_at: string;
};
