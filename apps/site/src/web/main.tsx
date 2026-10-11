import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi, readBoot } from "./api.ts";
import { createAppRouter } from "./router.tsx";
import "./styles.css";

// The Worker put the first page's data in `#boot` (§9.2); every read after that goes to the API.
const boot = readBoot(document.getElementById("boot")?.textContent);
const api = createApi((path) => fetch(path, { headers: { Accept: "application/json" } }), boot);
const router = createAppRouter(api);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
