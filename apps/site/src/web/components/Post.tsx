import type { PostJson } from "@wordless/shared";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { artColumns, exactTime, relativeTime } from "../format.ts";
import { Avatar } from "./Avatar.tsx";
import { Reactions } from "./Reactions.tsx";

/** `01`, `02`, … for the top list. */
const rankLabel = (rank: number) => String(rank).padStart(2, "0");

/**
 * One post, X-style: the avatar alone in a left gutter; name, art and reactions in the column beside it.
 * `rank` numbers it (the top list): a big numeral in the page margin on wide screens, before the name on
 * narrow ones. The avatar and the name link to the author's profile, the time to the post's permalink. The
 * content is only ever a text node (§9.3).
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
      {/* The name is the same link, so this one is skipped by keyboards and screen readers. */}
      <Link
        to="/@{$username}"
        params={{ username }}
        className="self-start rounded-full"
        tabIndex={-1}
        aria-hidden="true"
      >
        <Avatar username={username} className="size-9 sm:size-10" />
      </Link>
      <div className="min-w-0">
        <header className="flex items-baseline gap-[5px] text-[15px] leading-5">
          {rank !== undefined && (
            <span className="mr-1 font-mono tracking-[-0.5px] text-muted wide:max-side:hidden huge:hidden">
              {rankLabel(rank)}
            </span>
          )}
          <Link
            to="/@{$username}"
            params={{ username }}
            className="font-bold whitespace-nowrap hover:underline hover:underline-offset-3"
          >
            {username}
          </Link>
          <span className="text-muted" aria-hidden="true">
            ·
          </span>
          <Link
            to="/p/$id"
            params={{ id: String(post.id) }}
            className="whitespace-nowrap text-muted hover:underline hover:underline-offset-3"
          >
            <time dateTime={post.created_at} title={exactTime(post.created_at)}>
              {relativeTime(post.created_at, now)}
            </time>
          </Link>
        </header>
        <div className="panel cut [--cut:12px] @container mt-2 mb-2.5 px-3.5 py-3 sm:px-5 sm:py-4">
          <pre
            className="art-fit overflow-x-auto font-mono leading-[1.4] whitespace-pre [--art-max:18px] [--art-min:12px] [scrollbar-width:thin] sm:[--art-max:21px]"
            style={{ "--cols": artColumns(post.content) } as CSSProperties}
          >
            {post.content}
          </pre>
        </div>
        <Reactions reactions={post.reactions} />
      </div>
    </article>
  );
}
