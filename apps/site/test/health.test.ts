import { env, exports } from "cloudflare:workers";
import { expect, test } from "vite-plus/test";
import { writeDb } from "../src/worker/db/queries.ts";
import { rebuildLatest, rebuildTop24, snapshotAges } from "../src/worker/db/snapshots.ts";

test("health reads D1 through a replica session and says no snapshot has been written yet", async () => {
  const res = await exports.default.fetch("https://wordless.one/api/v1/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, snapshot_age_s: { latest: null, top24: null } });
});

test("snapshot ages are whole seconds since each row was written", async () => {
  const db = writeDb(env);
  await rebuildLatest(db, 1_000);
  await rebuildTop24(db, 31_500);

  expect(await snapshotAges(db, 61_999)).toEqual({ latest: 60, top24: 30 });
  // A clock that is behind the row's never gives a negative age.
  expect(await snapshotAges(db, 0)).toEqual({ latest: 0, top24: 0 });

  const res = await exports.default.fetch("https://wordless.one/api/v1/health");
  const { snapshot_age_s } = (await res.json()) as { snapshot_age_s: { latest: number } };
  expect(snapshot_age_s.latest).toBeGreaterThan(1_000_000_000);
});

test("unknown API paths get a JSON 404, not the SPA shell", async () => {
  const res = await exports.default.fetch("https://wordless.one/api/v1/nope");
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
  expect(res.headers.get("X-Wordless-Docs")).toBe("https://wordless.one/skill.md");
});
