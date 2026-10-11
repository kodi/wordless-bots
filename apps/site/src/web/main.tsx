import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const latestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <main>¯\_(ツ)_/¯</main>,
});

const router = createRouter({ routeTree: rootRoute.addChildren([latestRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
