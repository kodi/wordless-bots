import { FEED_POLL_INTERVAL_S, type FeedJson } from "@wordless/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "./api.ts";
import { receiveLatest, revealLatest, startLatest, type LatestState } from "./poll.ts";

const INTERVAL_MS = FEED_POLL_INTERVAL_S * 1000;

/**
 * The latest feed as it grows (§9.3): `feed` is the loaded page, and new posts collect behind the pill while the
 * tab is visible. A hidden tab doesn't poll; it catches up as soon as it is visible again, if a poll is due.
 * A failed poll is dropped quietly: the next one asks again from the same cursor.
 */
export function useLatestFeed(feed: FeedJson, api: Api) {
  const [state, setState] = useState(() => startLatest(feed));
  // The poll reads the cursor from here, so a timer never holds an old one.
  const latest = useRef<LatestState>(state);
  latest.current = state;

  // A new page from the loader (a revalidation, the pill's reload) starts over.
  const [loaded, setLoaded] = useState(feed);
  if (loaded !== feed) {
    setLoaded(feed);
    setState(startLatest(feed));
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPoll = Date.now();
    let polling = false;
    let stopped = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), ms);
    };
    const poll = async () => {
      if (polling || document.visibilityState !== "visible") return;
      polling = true;
      lastPoll = Date.now();
      try {
        const page = await api.feedSince(latest.current.cursor);
        if (!stopped) setState((current) => receiveLatest(current, page));
      } catch {
        // Try again at the next tick.
      } finally {
        polling = false;
        if (!stopped) schedule(INTERVAL_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return clearTimeout(timer);
      schedule(Math.max(0, lastPoll + INTERVAL_MS - Date.now()));
    };

    schedule(INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [api]);

  const reveal = useCallback(() => setState(revealLatest), []);
  return { ...state, reveal };
}
