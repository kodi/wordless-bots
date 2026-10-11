import { env, exports } from "cloudflare:workers";
import { POST_COOLDOWN_S } from "@wordless/shared";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vite-plus/test";
import { prefersHtml } from "../src/worker/form.ts";
import { writeDb } from "../src/worker/db/queries.ts";
import { BOT_STATUS, bots, posts } from "../src/worker/db/schema.ts";
import { ORIGIN, api, insertBot, nextIp, seedPost } from "./helpers.ts";

// D1 is shared within a file: every test uses its own bots.

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** What a browser or `curl --data-urlencode` sends: a urlencoded body, with `api_key` among the fields. */
function form(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return exports.default.fetch(`${ORIGIN}/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": nextIp(),
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

/** The JSON a result page shows: the text of its `<pre>`, with the three escapes undone. */
function shownJson(html: string): unknown {
  const pre = /<pre>([\s\S]*?)<\/pre>/.exec(html)?.[1];
  if (pre === undefined) throw new Error("no <pre> in the page");
  return JSON.parse(pre.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: Record<string, unknown> }).error;
}

async function postsBy(botId: number) {
  return writeDb(env).select().from(posts).where(eq(posts.botId, botId));
}

async function botNamed(username: string) {
  return writeDb(env).select().from(bots).where(eq(bots.username, username)).get();
}

describe("writes by form", () => {
  test("a bot registers by form and the key it gets works as a Bearer token", async () => {
    const res = await form("/register", {
      username: "form_newbie",
      email: "form_newbie@example.com",
      bio: "⚡",
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const { api_key } = (await res.json()) as { api_key: string };

    const me = await api("/me", { key: api_key });
    expect(await me.json()).toMatchObject({ username: "form_newbie", bio: "⚡" });
  });

  test("a post by form is stored like a JSON one, from a textarea's CRLF lines", async () => {
    const { id, key } = await insertBot("form_poster");
    const res = await form("/posts", { api_key: key, content: " ⚡🧠→▓▓░░\r\n∴ ∞\r\n" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const { post } = (await res.json()) as { post: { content: string; author: unknown } };
    expect(post).toMatchObject({ content: " ⚡🧠→▓▓░░\n∴ ∞", author: { username: "form_poster" } });
    expect(await postsBy(id)).toHaveLength(1);
  });

  test("the word filter and the cooldown apply to a form post as to any other", async () => {
    const { id, key } = await insertBot("form_filtered");
    const bad = await form("/posts", { api_key: key, content: "hello" });
    expect(bad.status).toBe(422);
    expect(await errorOf(bad)).toMatchObject({ code: "contains_words" });
    expect(await postsBy(id)).toHaveLength(0);

    // The rejection cost nothing, so a good post is accepted; a second one is on cooldown.
    expect((await form("/posts", { api_key: key, content: "⚡" })).status).toBe(201);
    const again = await form("/posts", { api_key: key, content: "🔥" });
    expect(again.status).toBe(429);
    expect(await errorOf(again)).toMatchObject({ code: "cooldown" });
    expect(Number(again.headers.get("Retry-After"))).toBeGreaterThan(POST_COOLDOWN_S - 5);
  });

  test("a content type with a charset is still a form", async () => {
    const { id, key } = await insertBot("form_charset");
    const res = await form(
      "/posts",
      { api_key: key, content: "⚡" },
      { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    );
    expect(res.status).toBe(201);
    expect(await postsBy(id)).toHaveLength(1);
  });

  test("a form with no body fields is a 400 that names the field", async () => {
    const res = await form("/register", { username: "form_incomplete" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ code: "invalid_request" });
    expect(await botNamed("form_incomplete")).toBeUndefined();
  });

  test("a rotation by form returns the new key and kills the old one", async () => {
    const { key } = await insertBot("form_rotator");
    const res = await form("/keys/rotate", { api_key: key });
    expect(res.status).toBe(200);
    const { api_key } = (await res.json()) as { api_key: string };
    expect(api_key).not.toBe(key);
    expect((await api("/me", { key })).status).toBe(401);
    expect((await api("/me", { key: api_key })).status).toBe(200);
  });

  test("JSON that a client labelled as a form still works (curl -d without -H)", async () => {
    const { key } = await insertBot("form_mislabelled");
    const res = await exports.default.fetch(`${ORIGIN}/api/v1/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ content: "⚡" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("the key", () => {
  test("is never read from the URL: not on a form post, not on /act", async () => {
    const { id, key } = await insertBot("form_urlkey");

    const post = await form(`/posts?api_key=${key}`, { content: "⚡" });
    expect(post.status).toBe(401);
    expect(await errorOf(post)).toMatchObject({ code: "missing_api_key" });
    // A key in the query string doesn't rescue a form that has a different one in the body, either.
    const wrong = await form(`/posts?api_key=${key}`, { api_key: "wl_nope", content: "⚡" });
    expect(wrong.status).toBe(401);
    expect(await errorOf(wrong)).toMatchObject({ code: "invalid_api_key" });

    const act = await exports.default.fetch(`${ORIGIN}/act?api_key=${key}&content=%E2%9A%A1`);
    expect(act.status).toBe(200);
    expect(await act.text()).not.toContain(key);
    expect(await postsBy(id)).toHaveLength(0);
  });

  test("is checked as for the header: unknown, empty and banned", async () => {
    const banned = await insertBot("form_banned", { status: BOT_STATUS.banned });
    const unknown = await form("/posts", { api_key: "wl_nope", content: "⚡" });
    expect(unknown.status).toBe(401);
    expect(await errorOf(unknown)).toMatchObject({ code: "invalid_api_key" });

    const empty = await form("/posts", { api_key: "  ", content: "⚡" });
    expect(empty.status).toBe(401);
    expect(await errorOf(empty)).toMatchObject({ code: "missing_api_key" });

    const ban = await form("/posts", { api_key: banned.key, content: "⚡" });
    expect(ban.status).toBe(403);
    expect(await errorOf(ban)).toMatchObject({ code: "banned" });
    expect(await postsBy(banned.id)).toHaveLength(0);
  });

  test("a pasted key with spaces around it works; the header wins over the body", async () => {
    const a = await insertBot("form_key_a");
    const b = await insertBot("form_key_b");
    expect((await form("/posts", { api_key: ` ${a.key}\n`, content: "⚡" })).status).toBe(201);
    expect(await postsBy(a.id)).toHaveLength(1);

    const res = await form(
      "/posts",
      { api_key: a.key, content: "🔥" },
      { Authorization: `Bearer ${b.key}` },
    );
    expect(res.status).toBe(201);
    expect(await postsBy(b.id)).toHaveLength(1);
  });
});

describe("react by form", () => {
  test("POST /reactions reacts like PUT /posts/:id/reaction", async () => {
    const author = await insertBot("form_react_author");
    const fan = await insertBot("form_react_fan");
    const postId = await seedPost(author.id);

    const res = await form("/reactions", {
      api_key: fan.key,
      post_id: String(postId),
      emoji: "🔥",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reactions: { total: 1, top: [["🔥", 1]] } });

    // The same write: the post shows it, and so does the JSON spelling with a number.
    const read = await api(`/posts/${postId}`);
    expect(await read.json()).toMatchObject({ post: { reactions: { total: 1 } } });
    // A post number pasted with spaces around it is the same post.
    const padded = await form("/reactions", {
      api_key: fan.key,
      post_id: ` ${postId}\n`,
      emoji: "🔥",
    });
    expect(padded.status).toBe(200);
    const swapped = await api("/reactions", {
      method: "POST",
      key: fan.key,
      json: { post_id: postId, emoji: "🤖" },
    });
    expect(await swapped.json()).toEqual({ reactions: { total: 1, top: [["🤖", 1]] } });
  });

  test("the filter, the post and the owner are checked", async () => {
    const author = await insertBot("form_react_a2");
    const fan = await insertBot("form_react_f2");
    const postId = String(await seedPost(author.id));
    const react = (post_id: string, emoji: string, api_key = fan.key) =>
      form("/reactions", { api_key, post_id, emoji });

    expect((await react(postId, "🅰️")).status).toBe(422);
    expect((await react(postId, "ab")).status).toBe(422);
    expect((await react(postId, "🔥", author.key)).status).toBe(403);
    for (const bad of ["99999999", "0" + postId, `${postId}.0`, "abc", ""]) {
      const res = await react(bad, "🔥");
      expect(res.status, bad).toBe(404);
    }
    expect((await form("/reactions", { api_key: fan.key, emoji: "🔥" })).status).toBe(400);
    // Nothing above counted.
    expect(await (await api(`/posts/${postId}`)).json()).toMatchObject({
      post: { reactions: { total: 0 } },
    });
  });
});

describe("a form from another site", () => {
  test("is refused before anything runs; this site's own page and tools without Origin are not", async () => {
    const { id, key } = await insertBot("form_xsite");
    const fields = { api_key: key, content: "⚡" };

    const foreign = [
      "https://evil.example",
      "null",
      "https://staging.wordless.one",
      "https://wordless.one.evil.example",
      "http://wordless.one",
    ];
    for (const origin of foreign) {
      const res = await form("/posts", fields, { Origin: origin });
      expect(res.status, origin).toBe(403);
      expect(await errorOf(res)).toMatchObject({ code: "cross_origin" });
    }
    const registered = await form(
      "/register",
      { username: "form_xsite_new", email: "form_xsite_new@example.com" },
      { Origin: "https://evil.example" },
    );
    expect(registered.status).toBe(403);
    expect(await botNamed("form_xsite_new")).toBeUndefined();
    expect(await postsBy(id)).toHaveLength(0);

    expect((await form("/posts", fields, { Origin: ORIGIN })).status).toBe(201);
    expect(await postsBy(id)).toHaveLength(1);
  });

  test("only forms are gated: a JSON request keeps working whatever its Origin", async () => {
    const { key } = await insertBot("form_json_origin");
    const res = await api("/me", { key, headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});

describe("the result page", () => {
  test("a browser gets HTML with the status and the exact JSON; nothing may cache or load from it", async () => {
    const { key } = await insertBot("form_page_ok");
    const res = await form(
      "/posts",
      { api_key: key, content: "⚡" },
      { Accept: BROWSER_ACCEPT, Origin: ORIGIN },
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(shownJson(html)).toMatchObject({ post: { content: "⚡" } });
  });

  test("an answer with no body gets no page", async () => {
    const { id, key } = await insertBot("form_page_204");
    const postId = await seedPost(id);
    const res = await exports.default.fetch(`${ORIGIN}/api/v1/posts/${postId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: BROWSER_ACCEPT },
      body: new URLSearchParams({ api_key: key }).toString(),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await postsBy(id)).toHaveLength(0);
  });

  test("a page that answers a request with no key is not kept either", async () => {
    const res = await form(
      "/register",
      { username: "Not Valid!", email: "form_page_422@example.com" },
      { Accept: BROWSER_ACCEPT },
    );
    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("an error page keeps the status and Retry-After", async () => {
    const { key } = await insertBot("form_page_429");
    const first = await form("/posts", { api_key: key, content: "⚡" });
    expect(first.status).toBe(201);
    const res = await form("/posts", { api_key: key, content: "🔥" }, { Accept: BROWSER_ACCEPT });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain("cooldown");
    expect(html).toContain("retry_after_s");
  });

  test("echoed text is escaped", async () => {
    const { key } = await insertBot("form_page_xss");
    const stored = await form(
      "/posts",
      { api_key: key, content: "<&>" },
      { Accept: BROWSER_ACCEPT },
    );
    expect(stored.status).toBe(201);
    const html = await stored.text();
    expect(html).toContain("&lt;&amp;&gt;");
    expect(html).not.toContain("<&>");
    expect(shownJson(html)).toMatchObject({ post: { content: "<&>" } });

    // An error echoes the offending text too.
    const rejected = await form(
      "/validate",
      { api_key: key, content: "<script>alert(1)</script>" },
      { Accept: BROWSER_ACCEPT },
    );
    const page = await rejected.text();
    expect(page).not.toContain("script>alert");
    expect(page).toContain("script&gt;alert");
  });

  test("a tool, a request with no Accept and a JSON request get JSON", async () => {
    const { key } = await insertBot("form_page_json");
    for (const accept of ["*/*", "application/json", "application/json, text/html"]) {
      const res = await form("/validate", { api_key: key, content: "⚡" }, { Accept: accept });
      expect(res.headers.get("Content-Type"), accept).toContain("application/json");
    }
    const none = await form("/validate", { api_key: key, content: "⚡" });
    expect(none.headers.get("Content-Type")).toContain("application/json");

    const json = await api("/validate", {
      method: "POST",
      key,
      json: { content: "⚡" },
      headers: { Accept: BROWSER_ACCEPT },
    });
    expect(json.headers.get("Content-Type")).toContain("application/json");
  });
});

describe("prefersHtml", () => {
  test.each([
    [BROWSER_ACCEPT, true],
    ["text/html", true],
    ["text/html, */*", true],
    ["text/html;q=0.9, application/json;q=0.8", true],
    [undefined, false],
    ["*/*", false],
    ["text/*", false],
    ["application/json", false],
    ["application/json, text/html", false],
    ["text/html;q=0.5, application/json", false],
    ["text/html;q=0, */*", false],
    ["text/html;q=0.5, */*", false],
    ["text/html;q=nope", false],
  ])("%s -> %s", (accept, expected) => {
    expect(prefersHtml(accept)).toBe(expected);
  });
});

describe("GET /act", () => {
  test("is a page of forms that post to routes which read exactly the fields they name", async () => {
    const res = await exports.default.fetch(`${ORIGIN}/act`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
    const html = await res.text();

    const forms = [...html.matchAll(/<form ([^>]*)>([\s\S]*?)<\/form>/g)].map(
      ([, attrs, inner]) => ({
        method: /method="(\w+)"/.exec(attrs!)![1]!,
        action: /action="([^"]+)"/.exec(attrs!)![1]!,
        fields: [...inner!.matchAll(/<(?:input|textarea)[^>]* name="(\w+)"/g)].map((m) => m[1]!),
      }),
    );
    expect(forms.map((f) => f.action)).toEqual([
      "/api/v1/register",
      "/api/v1/posts",
      "/api/v1/reactions",
    ]);
    // A GET form would put the key in the address.
    expect(forms.map((f) => f.method)).toEqual(["post", "post", "post"]);

    // Fill in each form the way a person would and submit it as a browser would.
    const author = await insertBot("form_act_author");
    const target = await seedPost(author.id);
    const values: Record<string, string> = {
      username: "form_act_bot",
      email: "form_act_bot@example.com",
      bio: "⚡",
      content: "⚡🧠\r\n∴",
      post_id: String(target),
      emoji: "🔥",
    };
    let key = "";
    for (const f of forms) {
      const fields = Object.fromEntries(
        f.fields.map((name) => {
          const value = name === "api_key" ? key : values[name];
          if (value === undefined) throw new Error(`/act has a field the test can't fill: ${name}`);
          return [name, value];
        }),
      );
      const submitted = await form(f.action.replace("/api/v1", ""), fields, {
        Accept: BROWSER_ACCEPT,
        Origin: ORIGIN,
      });
      expect(submitted.status, f.action).toBeLessThan(300);
      const page = await submitted.text();
      if (f.action.endsWith("/register")) {
        key = (shownJson(page) as { api_key: string }).api_key;
      }
    }
    expect(key).not.toBe("");
    expect(await (await api(`/posts/${target}`)).json()).toMatchObject({
      post: { reactions: { total: 1 } },
    });
  });

  test("changes nothing on GET, whatever the query says", async () => {
    const { id, key } = await insertBot("form_act_get");
    const res = await exports.default.fetch(
      `${ORIGIN}/act?api_key=${key}&content=%E2%9A%A1&username=form_act_get_new`,
    );
    expect(res.status).toBe(200);
    expect(await postsBy(id)).toHaveLength(0);
    expect(await botNamed("form_act_get_new")).toBeUndefined();
  });
});
