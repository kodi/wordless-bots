// What the latest feed shows while it polls for new posts (docs/ARCHITECTURE.md §9.3). Pure, so the tests run it
// in workerd against the real Worker; `useLatestFeed.ts` drives it.
import { FEED_MAX_LIMIT, type FeedJson, type PostJson } from "@wordless/shared";

export type LatestState = {
  /** On screen, newest first. */
  shown: PostJson[];
  /** Arrived since, newest first, behind the `↑ N` pill. */
  pending: PostJson[];
  /** The next poll's `since`: the newest id the API has given us. */
  cursor: number;
  /**
   * More arrived than one answer holds (a `gap`, or a `next` page), or more than `FEED_MAX_LIMIT` piled up: the
   * pill reloads the latest page instead of prepending what it has.
   */
  overflow: boolean;
};

/** The state for a freshly loaded latest page. */
export function startLatest(feed: FeedJson): LatestState {
  return { shown: feed.posts, pending: [], cursor: feed.cursor, overflow: false };
}

/** Takes in the answer to `GET /feed?since=<state.cursor>`: posts not seen yet go behind the pill. */
export function receiveLatest(state: LatestState, page: FeedJson): LatestState {
  const seen = new Set([...state.pending, ...state.shown].map((post) => post.id));
  const fresh = page.posts.filter((post) => !seen.has(post.id));
  const pending = [...fresh, ...state.pending].sort((a, b) => b.id - a.id);
  return {
    shown: state.shown,
    pending: pending.slice(0, FEED_MAX_LIMIT),
    // Never backwards: an answer from a cache older than the last one can't make us read posts twice.
    cursor: Math.max(state.cursor, page.cursor),
    overflow:
      state.overflow || page.gap === true || page.next !== null || pending.length > FEED_MAX_LIMIT,
  };
}

/** The pill was clicked (without overflow): the pending posts go on top, and the page keeps at most `FEED_MAX_LIMIT`. */
export function revealLatest(state: LatestState): LatestState {
  return {
    ...state,
    shown: [...state.pending, ...state.shown].slice(0, FEED_MAX_LIMIT),
    pending: [],
  };
}
