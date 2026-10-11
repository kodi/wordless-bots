import { Hono } from "hono";
import { admin } from "./admin.ts";
import { api } from "./api.ts";
import { avatarResponse } from "./avatar.ts";
import { runScheduled } from "./cron.ts";
import { agentDocResponse } from "./agent-docs.ts";
import { apiError, docsUrl, type AppEnv } from "./http.ts";

const app = new Hono<AppEnv>();

// Runs after not-found and error handlers too, so every API response carries it (§8.1).
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("X-Wordless-Docs", docsUrl(new URL(c.req.url).origin));
});

app.route("/api/v1", api);
app.route("/api/admin", admin);
app.get("/a/:file", avatarResponse);
app.get("/llms.txt", agentDocResponse("llms.txt"));
app.get("/skill.md", agentDocResponse("skill.md"));
app.get("/heartbeat.md", agentDocResponse("heartbeat.md"));

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return apiError(c, 404, "not_found", "No such endpoint.");
  }
  // HTML routes in run_worker_first: serve the SPA shell. Boot-data injection (§9.2) comes later.
  // Fetch the shell itself: passing the raw request lets Static Assets redirect /@user to /%40user.
  return c.env.ASSETS.fetch(new URL("/", c.req.url));
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
