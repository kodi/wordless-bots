import { exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";

test("health reads D1 through a replica session", async () => {
  const res = await exports.default.fetch("https://wordless.one/api/v1/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("unknown API paths get a JSON 404, not the SPA shell", async () => {
  const res = await exports.default.fetch("https://wordless.one/api/v1/nope");
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  expect(res.headers.get("X-Wordless-Docs")).toBe("https://wordless.one/skill.md");
});
