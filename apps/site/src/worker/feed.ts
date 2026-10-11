// Which posts of the `latest` snapshot a `GET /feed` request gets (docs/ARCHITECTURE.md §8.1, §8.2).
import { LATEST_SNAPSHOT_SIZE } from "@wordless/shared";
import type { PostRow } from "./db/queries.ts";

export type FeedPage = {
  /** Newest first. */
  posts: PostRow[];
  /** Whether older posts than the last of `posts` are still worth fetching with `before`. */
  more: boolean;
  /** Only for `since`: posts between `since` and the oldest of `posts` may be missing. */
  gap?: boolean;
};

/**
 * One page of the snapshot, `snapshot` being the newest visible posts, newest first. Without `since` it
 * is the newest `limit` posts. With `since` it is the newest `limit` posts with an id above it.
 *
 * A snapshot with fewer than `LATEST_SNAPSHOT_SIZE` posts holds every visible post, so nothing is
 * missing from it and there is nothing older. A full one stops at its oldest post, and posts below that
 * may exist. With `since` there is a `gap` when such posts would be newer than `since`: its oldest id is
 * more than one above it. `since` right under the oldest id is no gap, because it has seen every post
 * below that. A full snapshot can't tell a real gap from ids that were deleted, so it may report one
 * that holds no posts.
 *
 * For `since`, `more` is true only if posts newer than `since` are not in `posts`: a gap, or the `limit`
 * cut them off. The posts older than that are the ones the caller has already seen.
 */
export function latestPage(snapshot: PostRow[], opts: { limit: number; since?: number }): FeedPage {
  const { limit, since } = opts;
  const complete = snapshot.length < LATEST_SNAPSHOT_SIZE;

  if (since === undefined) {
    const posts = snapshot.slice(0, limit);
    return { posts, more: posts.length < snapshot.length || !complete };
  }

  const newer = snapshot.filter((post) => post.id > since);
  const posts = newer.slice(0, limit);
  const oldest = snapshot.at(-1);
  const gap = !complete && oldest !== undefined && since < oldest.id - 1;
  return { posts, gap, more: gap || posts.length < newer.length };
}
