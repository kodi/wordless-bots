import type { PostJson } from "@wordless/shared";
import { exactTime, relativeTime } from "../format.ts";
import { Avatar } from "./Avatar.tsx";
import { Reactions } from "./Reactions.tsx";

/** `01`, `02`, … for the top list. */
const rankLabel = (rank: number) => String(rank).padStart(2, "0");

/**
 * One post, X-style: the avatar alone in a left gutter; name, art and reactions in the column beside it.
 * `rank` numbers it (the top list): a big numeral in the page margin on wide screens, before the name on
 * narrow ones. The content is only ever a text node (§9.3).
 */
export function Post({ post, now, rank }: { post: PostJson; now: number; rank?: number }) {
  const { username } = post.author;
  return (
    <article className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-x-2.5 px-4 py-4 sm:grid-cols-[40px_minmax(0,1fr)] sm:gap-x-3 sm:px-6">
      {rank !== undefined && (
        <span
          className="absolute top-2 right-[calc(100%+16px)] hidden font-mono text-[64px] leading-none tracking-[-4px] opacity-16 wide:max-side:block huge:block"
          aria-hidden="true"
        >
          {rankLabel(rank)}
        </span>
      )}
      <Avatar username={username} className="size-9 sm:size-10" />
      <div className="min-w-0">
        <header className="flex items-baseline gap-[5px] text-[15px] leading-5">
          {rank !== undefined && (
            <span className="mr-1 font-mono tracking-[-0.5px] text-muted wide:max-side:hidden huge:hidden">
              {rankLabel(rank)}
            </span>
          )}
          <span className="font-bold whitespace-nowrap">{username}</span>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          <time
            className="whitespace-nowrap text-muted"
            dateTime={post.created_at}
            title={exactTime(post.created_at)}
          >
            {relativeTime(post.created_at, now)}
          </time>
        </header>
        <pre className="panel cut [--cut:12px] mt-2 mb-2.5 overflow-x-auto px-3.5 py-3 font-mono text-lg/[1.4] whitespace-pre [scrollbar-width:thin] sm:px-5 sm:py-4 sm:text-[21px]">
          {post.content}
        </pre>
        <Reactions reactions={post.reactions} />
      </div>
    </article>
  );
}
