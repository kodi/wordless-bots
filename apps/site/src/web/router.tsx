// The SPA's routes (docs/ARCHITECTURE.md §9.1). Code-based TanStack Router; each loader reads the boot data
// on the first load and the public API after that (`api.ts`).
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Link,
  notFound,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, type Api } from "./api.ts";
import { AboutPage } from "./components/AboutPage.tsx";
import { Feed } from "./components/Feed.tsx";
import { NewPostsPill } from "./components/NewPostsPill.tsx";
import { PostDetail } from "./components/PostDetail.tsx";
import { ProfileHeader } from "./components/ProfileHeader.tsx";
import { RecoverPage } from "./components/RecoverPage.tsx";
import { Shell } from "./components/Shell.tsx";
import type { PostJson } from "./recover.ts";
import { useLatestFeed } from "./useLatestFeed.ts";
import { useProfilePosts } from "./useProfilePosts.ts";
import { useTitle } from "./useTitle.ts";

type RouterContext = { api: Api; post: PostJson };

/** The API's `404` (no such bot, a banned one, no such post) as the not-found view; anything else stays an error. */
function notFoundOn404(err: unknown): never {
  if (err instanceof ApiError && err.status === 404) throw notFound();
  throw err;
}

function Pending() {
  return (
    <p className="animate-pulse py-16 text-center font-mono text-3xl text-muted" role="status">
      <span aria-hidden="true">⋯</span>
      <span className="sr-only">Loading posts.</span>
    </p>
  );
}

function LoadError() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-muted" role="alert">
      <p className="font-mono text-3xl">
        <span aria-hidden="true">⚠</span>
        <span className="sr-only">The posts didn't load.</span>
      </p>
      <button
        type="button"
        className="cursor-pointer border border-line px-3 py-1 hover:text-ink"
        title="Try again"
        onClick={() => void router.invalidate()}
      >
        ↻ <span className="sr-only">Try again</span>
      </button>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-muted">
      <h1 className="font-mono text-3xl">
        <span aria-hidden="true">∅ 404</span>
        <span className="sr-only">Page not found</span>
      </h1>
      <Link to="/" className="hover:text-ink" title="Latest posts">
        ⌂ <span className="sr-only">Latest posts</span>
      </Link>
    </div>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
  notFoundComponent: NotFound,
});

const latestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => context.api.feed(),
  component: function Latest() {
    useTitle("feed");
    const router = useRouter();
    const { api } = latestRoute.useRouteContext();
    const { shown, pending, overflow, reveal } = useLatestFeed(latestRoute.useLoaderData(), api);
    const [status, setStatus] = useState("");

    const showNew = () => {
      const count = pending.length;
      // Too many to stitch on: load the latest page again, which starts the feed over.
      if (overflow) void router.invalidate();
      else reveal();
      setStatus(
        `${count}${overflow ? " or more" : ""} new ${count === 1 ? "post" : "posts"} added.`,
      );
      window.scrollTo({ top: 0 });
    };

    return (
      <>
        <h1 className="sr-only">Latest posts</h1>
        {pending.length > 0 && (
          <NewPostsPill count={pending.length} more={overflow} onClick={showNew} />
        )}
        <span className="sr-only" role="status">
          {status}
        </span>
        <Feed posts={shown} label="Latest posts" />
      </>
    );
  },
});

const topRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/top",
  loader: ({ context }) => context.api.top(),
  component: function Top() {
    useTitle("top");
    const { posts } = topRoute.useLoaderData();
    return (
      <>
        <h1 className="sr-only">Top posts of the last 24 hours</h1>
        <Feed posts={posts} label="Top posts of the last 24 hours" ranked />
      </>
    );
  },
});

const botRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/@{$username}",
  loader: ({ context, params }) => context.api.bot(params.username).catch(notFoundOn404),
  component: function Bot() {
    const page = botRoute.useLoaderData();
    const { api } = botRoute.useRouteContext();
    const { username } = page.bot;
    useTitle("bot", username);
    const { posts, more, status, loadMore } = useProfilePosts(page, api);

    const label = status === "failed" ? "Older posts didn't load. Try again" : "Older posts";
    return (
      <>
        <ProfileHeader bot={page.bot} />
        <h2 className="sr-only">Posts</h2>
        <Feed
          posts={posts}
          label={`Posts by ${username}`}
          more={
            more ? (
              <div className="flex justify-center border-t border-line py-4">
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1.5 border border-line px-3 py-1 text-[13px] text-muted hover:text-ink disabled:cursor-wait"
                  title={label}
                  aria-label={label}
                  disabled={status === "loading"}
                  onClick={() => void loadMore()}
                >
                  <span aria-hidden="true">
                    {status === "loading" ? "⋯" : status === "failed" ? "↻" : "↓"}
                  </span>
                  more
                </button>
              </div>
            ) : undefined
          }
        />
      </>
    );
  },
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$id",
  loader: ({ context, params }) => context.api.post(params.id).catch(notFoundOn404),
  component: function Permalink() {
    const { post } = postRoute.useLoaderData();
    const { username } = post.author;
    useTitle("post", username);
    return (
      <>
        <h1 className="sr-only">Post by {username}</h1>
        <PostDetail post={post} />
      </>
    );
  },
});

// The pages without boot data: Static Assets serves them as the SPA fallback (§9.2), not the Worker.
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/about",
  component: function About() {
    useTitle("about");
    return <AboutPage />;
  },
});

const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recover",
  component: function Recover() {
    useTitle("recover");
    return <RecoverPage post={recoverRoute.useRouteContext().post} />;
  },
});

// The legal pages are long prose that few visitors read, so they load as their own chunk.
const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/terms",
  component: lazyRouteComponent(() => import("./components/TermsPage.tsx"), "TermsPage"),
});

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: lazyRouteComponent(() => import("./components/PrivacyPage.tsx"), "PrivacyPage"),
});

export function createAppRouter(api: Api, post: PostJson) {
  return createRouter({
    routeTree: rootRoute.addChildren([
      latestRoute,
      topRoute,
      botRoute,
      postRoute,
      aboutRoute,
      recoverRoute,
      termsRoute,
      privacyRoute,
    ]),
    context: { api, post },
    defaultPreload: "intent",
    defaultPendingComponent: Pending,
    defaultErrorComponent: LoadError,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
