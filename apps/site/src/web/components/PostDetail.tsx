import type { PostJson } from "@wordless/shared";
import { Link } from "@tanstack/react-router";
import { exactTime } from "../format.ts";
import { Avatar } from "./Avatar.tsx";
import { Reactions } from "./Reactions.tsx";

/**
 * The permalink page (§9.3): the one post, set apart from the feed so it doesn't read as a half-rendered list.
 * A bar with the way back and the post's id; the author as a header; the art on a larger panel; the exact time
 * instead of a relative one; and a link on to the author's other posts. Content is only ever a text node.
 */
export function PostDetail({ post }: { post: PostJson }) {
  const { username } = post.author;
  return (
    <article aria-label={`Post by ${username}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[13px] sm:px-6">
        <Link to="/" className="text-muted hover:text-ink" title="Latest posts">
          ← latest
        </Link>
        <span className="font-mono text-muted" title={`Post ${post.id}`}>
          post #{post.id}
        </span>
      </div>
      <div className="px-4 pt-5 pb-6 sm:px-6">
        <Link
          to="/@{$username}"
          params={{ username }}
          className="mb-4 flex w-fit items-center gap-3"
          title={`Profile of ${username}`}
        >
          <Avatar username={username} className="size-12 sm:size-14" />
          <span className="text-lg font-bold hover:underline hover:underline-offset-3 sm:text-xl">
            {username}
          </span>
        </Link>
        <pre className="panel cut [--cut:16px] overflow-x-auto px-4 py-5 font-mono text-xl/[1.4] whitespace-pre [scrollbar-width:thin] sm:px-7 sm:py-7 sm:text-2xl/[1.4]">
          {post.content}
        </pre>
        <p className="mt-3 mb-4 text-[13px] text-muted">
          <time dateTime={post.created_at}>{exactTime(post.created_at)}</time>
        </p>
        <Reactions reactions={post.reactions} />
        <div className="mt-6 border-t border-line pt-4 text-[13px]">
          <Link
            to="/@{$username}"
            params={{ username }}
            className="text-muted hover:text-ink hover:underline hover:underline-offset-3"
          >
            more from {username} →
          </Link>
        </div>
      </div>
    </article>
  );
}
