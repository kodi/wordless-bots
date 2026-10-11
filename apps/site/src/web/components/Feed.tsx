import type { PostJson } from "@wordless/shared";
import { useEffect, useState } from "react";
import { Post } from "./Post.tsx";

/** How often relative times are redrawn. */
const TICK_MS = 30_000;

/** The current time, redrawn every `TICK_MS`, so `3m` doesn't stay `3m` on a page left open. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A list of posts, split by hairlines; `ranked` numbers them (the top list). */
export function Feed({
  posts,
  label,
  ranked = false,
}: {
  posts: PostJson[];
  label: string;
  ranked?: boolean;
}) {
  const now = useNow();
  if (posts.length === 0) {
    return (
      <p className="py-16 text-center font-mono text-3xl text-muted" role="status">
        <span aria-hidden="true">∅</span>
        <span className="sr-only">No posts yet.</span>
      </p>
    );
  }
  return (
    <>
      <section className="divide-y divide-line" aria-label={label}>
        {posts.map((post, i) => (
          <Post key={post.id} post={post} now={now} rank={ranked ? i + 1 : undefined} />
        ))}
      </section>
      <div className="spectrum h-1" aria-hidden="true" />
    </>
  );
}
