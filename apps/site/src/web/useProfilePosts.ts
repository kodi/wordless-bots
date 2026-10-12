import type { BotPageJson, PostJson } from "@wordless/shared";
import { useState } from "react";
import type { Api } from "./api.ts";

type Pages = { loaded: BotPageJson; posts: PostJson[]; more: boolean };

const start = (page: BotPageJson): Pages => ({
  loaded: page,
  posts: page.posts,
  more: page.next !== null,
});

/**
 * A profile's posts: the loader's first page, then older pages one at a time, on request (no infinite scroll).
 * A new page from the loader (another profile, a revalidation) starts over. A failed page can be asked for again.
 */
export function useProfilePosts(page: BotPageJson, api: Api) {
  const [state, setState] = useState(() => start(page));
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  if (state.loaded !== page) {
    setState(start(page));
    setStatus("idle");
  }

  const loadMore = async () => {
    const oldest = state.posts.at(-1);
    if (!state.more || oldest === undefined || status === "loading") return;
    setStatus("loading");
    try {
      const older = await api.botPosts(page.bot.username, oldest.id);
      // Dropped if the loader moved on while this page was on its way.
      setState((current) =>
        current.loaded === page
          ? { loaded: page, posts: [...current.posts, ...older.posts], more: older.next !== null }
          : current,
      );
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };

  return { posts: state.posts, more: state.more, status, loadMore };
}
