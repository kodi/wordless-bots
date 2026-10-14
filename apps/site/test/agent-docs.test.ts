import { exports } from "cloudflare:workers";
import {
  BIO_MAX_GRAPHEMES,
  POST_MAX_GRAPHEMES,
  POST_MAX_LINE_GRAPHEMES,
  POST_MAX_LINES,
  REACTION_MAX_BYTES,
} from "@wordless/shared";
import { checkBio, checkContent, checkReaction } from "@wordless/wordfilter";
import { describe, expect, test } from "vite-plus/test";
import { renderAgentDoc, renderDoc, type AgentDoc } from "../src/worker/agent-docs.ts";

const DOCS: [AgentDoc, string][] = [
  ["llms.txt", "text/plain; charset=utf-8"],
  ["skill.md", "text/markdown; charset=utf-8"],
  ["heartbeat.md", "text/markdown; charset=utf-8"],
];

const LIMITS = {
  maxGraphemes: POST_MAX_GRAPHEMES,
  maxLines: POST_MAX_LINES,
  maxLineGraphemes: POST_MAX_LINE_GRAPHEMES,
};

const get = (origin: string, doc: string) => exports.default.fetch(`${origin}/${doc}`);

describe("serving", () => {
  test.each(DOCS)("/%s is served with its type and cannot be cached", async (doc, type) => {
    const res = await get("https://wordless.one", doc);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(type);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await res.text();
    expect(text).not.toContain("{{");
    expect(text).toContain("https://wordless.one/");
  });

  test.each(DOCS)("/%s links to the origin that served it, never to production", async (doc) => {
    const text = await (await get("https://staging.wordless.one", doc)).text();
    expect(text).toContain("https://staging.wordless.one/");
    expect(text).not.toContain("https://wordless.one");
  });

  test("API responses point X-Wordless-Docs at the environment's own skill.md", async () => {
    const res = await exports.default.fetch("https://staging.wordless.one/api/v1/health");
    expect(res.headers.get("X-Wordless-Docs")).toBe("https://staging.wordless.one/skill.md");
  });

  test("a placeholder with no value fails loudly instead of shipping as text", () => {
    expect(() => renderDoc("{{NOT_A_LIMIT}}", "https://wordless.one")).toThrow(/NOT_A_LIMIT/);
  });
});

describe("what the documents promise matches the filter", () => {
  const skill = renderAgentDoc("skill.md", "https://wordless.one");

  const examples = [...skill.matchAll(/^- (✅|❌) `(.+)`/gmu)].map(
    ([, mark, text]) => [mark === "✅", text!] as const,
  );

  test("the list of examples is not empty", () => {
    expect(examples.filter(([ok]) => ok).length).toBeGreaterThan(5);
    expect(examples.filter(([ok]) => !ok).length).toBeGreaterThan(5);
  });

  test.each(examples)("allowed=%s: %s", (allowed, text) => {
    const verdict = checkContent(text, LIMITS);
    expect(verdict.ok).toBe(allowed);
  });

  test("every example request body passes the filter for the field it fills", () => {
    const bodies = [...renderAgentDocs().matchAll(/-d '(\{.*?\})'/gu)].map(([, json]) =>
      JSON.parse(json!),
    );
    const filtered = bodies.filter((b) => "content" in b || "bio" in b || "emoji" in b);
    expect(filtered.length).toBeGreaterThanOrEqual(4);
    for (const body of filtered) {
      if ("content" in body) {
        expect(checkContent(body.content, LIMITS).ok, body.content).toBe(true);
      }
      if ("bio" in body && body.bio !== "") {
        expect(checkBio(body.bio, { maxGraphemes: BIO_MAX_GRAPHEMES }).ok, body.bio).toBe(true);
      }
      if ("emoji" in body) {
        expect(checkReaction(body.emoji, { maxBytes: REACTION_MAX_BYTES }).ok, body.emoji).toBe(
          true,
        );
      }
    }
  });
});

test("every form-field example (--data-urlencode) passes the filter for the field it fills", () => {
  const fields = [...renderAgentDocs().matchAll(/--data-urlencode '(content|bio|emoji)=(.*?)'/gu)];
  expect(fields.length).toBeGreaterThanOrEqual(1);
  for (const [, name, value] of fields) {
    const verdict =
      name === "content"
        ? checkContent(value!, LIMITS)
        : name === "bio"
          ? checkBio(value!, { maxGraphemes: BIO_MAX_GRAPHEMES })
          : checkReaction(value!, { maxBytes: REACTION_MAX_BYTES });
    expect(verdict.ok, value).toBe(true);
  }
});

function renderAgentDocs(): string {
  return DOCS.map(([doc]) => renderAgentDoc(doc, "https://wordless.one")).join("\n");
}
