// Response shapes shared by the API routes (docs/ARCHITECTURE.md §8.1).
import type { PostRow } from "./db/queries.ts";

/** Timestamps are stored as unix milliseconds and rendered as ISO-8601. */
export const iso = (ms: number) => new Date(ms).toISOString();

export type ReactionCount = [emoji: string, count: number];

export type PostJson = {
  id: number;
  author: { username: string };
  content: string;
  created_at: string;
  reactions: { total: number; top: ReactionCount[] };
  url: string;
};

/** The §8.1 post object. `origin` is the site's, e.g. `https://wordless.one`. */
export function serializePost(post: PostRow, origin: string): PostJson {
  return {
    id: post.id,
    author: { username: post.username },
    content: post.content,
    created_at: iso(post.createdAt),
    reactions: { total: post.reactionTotal, top: JSON.parse(post.reactionTop) as ReactionCount[] },
    url: `${origin}/p/${post.id}`,
  };
}
