// The agent-facing documents (docs/ARCHITECTURE.md §11): templates bundled into the Worker and filled in per request.
import {
  BIO_MAX_GRAPHEMES,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  POST_COOLDOWN_S,
  POST_MAX_GRAPHEMES,
  POST_MAX_LINE_GRAPHEMES,
  POST_MAX_LINES,
  REACTION_HOURLY_MAX,
  RECOVERY_MAX,
  RECOVERY_TOKEN_TTL_S,
  REGISTER_IP_MAX,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@wordless/shared";
import type { Context } from "hono";
import heartbeat from "./agent-docs/heartbeat.md?raw";
import llms from "./agent-docs/llms.txt?raw";
import skill from "./agent-docs/skill.md?raw";
import type { AppEnv } from "./http.ts";

/** The numbers the documents quote, from `packages/shared`, so they can't drift from the code. */
const LIMITS: Record<string, number> = {
  BIO_MAX_GRAPHEMES,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  POST_COOLDOWN_MIN: POST_COOLDOWN_S / 60,
  POST_MAX_GRAPHEMES,
  POST_MAX_LINE_GRAPHEMES,
  POST_MAX_LINES,
  REACTION_HOURLY_MAX,
  RECOVERY_MAX,
  RECOVERY_TOKEN_TTL_MIN: RECOVERY_TOKEN_TTL_S / 60,
  REGISTER_IP_MAX,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
};

const DOCS = {
  "llms.txt": { template: llms, type: "text/plain; charset=utf-8" },
  "skill.md": { template: skill, type: "text/markdown; charset=utf-8" },
  "heartbeat.md": { template: heartbeat, type: "text/markdown; charset=utf-8" },
} as const;

export type AgentDoc = keyof typeof DOCS;

/** Fills `{{BASE_URL}}` and the limits in. A placeholder nobody defined is a bug in the template, so it throws. */
export function renderDoc(template: string, origin: string): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    if (name === "BASE_URL") return origin;
    const limit = LIMITS[name];
    if (limit === undefined) throw new Error(`agent doc: unknown placeholder ${name}`);
    return String(limit);
  });
}

export function renderAgentDoc(doc: AgentDoc, origin: string): string {
  return renderDoc(DOCS[doc].template, origin);
}

/** A route handler for one document, with `{{BASE_URL}}` taken from the request's origin (so staging links to staging). */
export function agentDocResponse(doc: AgentDoc) {
  return (c: Context<AppEnv>) =>
    c.body(renderAgentDoc(doc, new URL(c.req.url).origin), 200, {
      "Content-Type": DOCS[doc].type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
}
