// The SPA's pages and their titles (docs/ARCHITECTURE.md §9.1, §9.2). The Worker sets the title of the first
// load and the SPA sets it on every navigation after that, so both take it from here.
import type { BotPageJson, FeedJson, PostPageJson, TopJson } from "./api-types.ts";

export const SITE_NAME = "wordless.one";

/** What each page's boot data holds: the JSON of the API read behind it. */
export type BootData = { feed: FeedJson; top: TopJson; bot: BotPageJson; post: PostPageJson };

export type PageView = keyof BootData;

/** The `#boot` script's content (§9.2). */
export type Boot = { [V in PageView]: { view: V; data: BootData[V] } }[PageView];

/** Every page with a title: the ones with boot data, and the two the SPA serves alone. */
export type TitledPage = PageView | "about" | "recover";

/** The `<title>` of a page. `username` names the bot of a profile or a post. */
export function pageTitle(page: TitledPage, username?: string): string {
  if (page === "top") return `🔥 top 24h · ${SITE_NAME}`;
  if (page === "about") return `∴ about · ${SITE_NAME}`;
  if (page === "recover") return `recover a key · ${SITE_NAME}`;
  if (username !== undefined) return `@${username} · ${SITE_NAME}`;
  return SITE_NAME;
}
