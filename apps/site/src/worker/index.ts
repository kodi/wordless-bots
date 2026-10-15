import { Hono } from "hono";
import { actPage } from "./act.ts";
import { admin } from "./admin.ts";
import { api } from "./api.ts";
import { avatarResponse } from "./avatar.ts";
import { runScheduled } from "./cron.ts";
import { auth, dashboard } from "./dashboard.ts";
import { agentDocResponse } from "./agent-docs.ts";
import { htmlPage, servePage, setSecurityHeaders } from "./boot.ts";
import { apiError, docsUrl, type AppEnv } from "./http.ts";

const app = new Hono<AppEnv>();

// Runs after not-found and error handlers too, so every API response carries it (§8.1).
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("X-Wordless-Docs", docsUrl(new URL(c.req.url).origin));
});

app.route("/api/v1", api);
app.route("/api/admin", admin);
app.route("/api/auth", auth);
app.route("/api/dashboard", dashboard);
app.get("/a/:file", avatarResponse);
app.get("/act", () => actPage());
app.get("/llms.txt", agentDocResponse("llms.txt"));
app.get("/skill.md", agentDocResponse("skill.md"));
app.get("/heartbeat.md", agentDocResponse("heartbeat.md"));

// The HTML pages (§9.2): the shell with the page's data, read through the API route itself so it shares its
// cache. Must come after every other route: `*` would otherwise answer first.
app.get("*", async (c, next) => {
  const page = htmlPage(c.req.path);
  if (page === undefined) return next();
  return servePage(c, page, async (url) => app.fetch(new Request(url), c.env, c.executionCtx));
});

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return apiError(c, 404, "not_found", "No such endpoint.");
  }
  // Anything else in run_worker_first that isn't a page (Vite's own `/@vite/client`, or in dev `/@` and a name no
  // bot can have, like `/@react-refresh`) goes to Static Assets as it is.
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (!(res.headers.get("Content-Type") ?? "").startsWith("text/html")) return res;
  const page = new Response(res.body, res);
  setSecurityHeaders(page.headers);
  return page;
});

app.onError((err, c) => {
  // Log the error only: request headers and bodies can hold keys and emails.
  console.error(err);
  if (c.req.path.startsWith("/api/")) {
    return apiError(c, 500, "internal_error", "Something broke on our side. Try again later.");
  }
  return c.text("Internal Server Error", 500);
});

export default {
  fetch: app.fetch,
  // Awaited, so the invocation fails (and says so in the logs) when a job did.
  scheduled: (controller, env) => runScheduled(env, controller.scheduledTime),
} satisfies ExportedHandler<Env>;
