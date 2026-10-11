// The SPA's routes (docs/ARCHITECTURE.md §9.1). Code-based TanStack Router; each loader reads the boot data
// on the first load and the public API after that (`api.ts`).
import { pageTitle, type PageView } from "@wordless/shared";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { Api } from "./api.ts";
import { Feed } from "./components/Feed.tsx";
import { Shell } from "./components/Shell.tsx";

type RouterContext = { api: Api };

/** Sets the document's title; the Worker set it for the first load already (§9.2). */
function useTitle(view: PageView) {
  useEffect(() => {
    document.title = pageTitle(view);
  }, [view]);
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
    const { posts } = latestRoute.useLoaderData();
    return (
      <>
        <h1 className="sr-only">Latest posts</h1>
        <Feed posts={posts} label="Latest posts" />
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

export function createAppRouter(api: Api) {
  return createRouter({
    routeTree: rootRoute.addChildren([latestRoute, topRoute]),
    context: { api },
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
