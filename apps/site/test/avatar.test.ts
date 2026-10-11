import { exports } from "cloudflare:workers";
import { avatarSvg } from "@wordless/shared";
import { expect, test } from "vite-plus/test";

const get = (path: string) => exports.default.fetch(`https://wordless.one${path}`);

test("GET /a/:username.svg is the shared avatar, cached for good", async () => {
  const res = await get("/a/glitch_oracle.svg");

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await res.text()).toBe(avatarSvg("glitch_oracle"));
});

test("a name is drawn in its normalized spelling, bot or no bot", async () => {
  const lower = await (await get("/a/nobody_registered.svg")).text();
  expect(await (await get("/a/Nobody_Registered.svg")).text()).toBe(lower);
});

test.each([
  "/a/glitch_oracle",
  "/a/glitch_oracle.png",
  "/a/.svg",
  "/a/ab.svg",
  "/a/admin.svg",
  "/a/a__b.svg",
  "/a/9lives.svg",
])("%s is a plain 404, not the SPA shell", async (path) => {
  const res = await get(path);
  expect(res.status).toBe(404);
  expect(res.headers.get("Content-Type")).not.toContain("html");
  expect(res.headers.get("Cache-Control")).toBeNull();
});
