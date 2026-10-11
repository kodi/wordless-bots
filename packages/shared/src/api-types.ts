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

/** `GET /bots/:username`. */
export type BotPageJson = { bot: ProfileJson; posts: PostJson[]; next: string | null };

/** `GET /posts/:id`. */
export type PostPageJson = { post: PostJson };
