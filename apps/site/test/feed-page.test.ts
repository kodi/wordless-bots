import { LATEST_SNAPSHOT_SIZE } from "@wordless/shared";
import { expect, test } from "vite-plus/test";
import type { PostRow } from "../src/worker/db/queries.ts";
import { latestPage } from "../src/worker/feed.ts";

/** A snapshot of `count` posts, newest first, with ids `newest` down to `newest - count + 1`. */
function snapshotOf(count: number, newest = 300): PostRow[] {
  return Array.from({ length: count }, (_, n) => ({
    id: newest - n,
    username: "a",
    content: "⚡",
    createdAt: 0,
    reactionTotal: 0,
    reactionTop: "[]",
  }));
}

const idsOf = (page: { posts: PostRow[] }) => page.posts.map((post) => post.id);

// A full snapshot is ids 201 to 300. It stops at 201, so posts 200 and below may exist outside it.
const FULL = snapshotOf(LATEST_SNAPSHOT_SIZE);
const OLDEST = 201;

test.each([
  [0, true],
  [OLDEST - 3, true],
  [OLDEST - 2, true], // post 200 may exist and is newer than 199
  [OLDEST - 1, false], // has seen 200, so nothing is missing
  [OLDEST, false],
  [250, false],
])("full snapshot, since=%i: gap is %s", (since, gap) => {
  expect(latestPage(FULL, { limit: 100, since }).gap).toBe(gap);
});

test("a snapshot short of full holds every visible post, so since can't be below it", () => {
  const young = snapshotOf(LATEST_SNAPSHOT_SIZE - 1);
  const page = latestPage(young, { limit: 100, since: 0 });
  expect(page).toMatchObject({ gap: false, more: false });
  expect(page.posts).toHaveLength(LATEST_SNAPSHOT_SIZE - 1);
});

test("since is exclusive and the page is newest first", () => {
  const page = latestPage(snapshotOf(5, 105), { limit: 100, since: 103 });
  expect(idsOf(page)).toEqual([105, 104]);
});

test("with since, more means newer posts were left out, never the ones already seen", () => {
  // 10 posts above since=290: exactly the limit, nothing left out.
  expect(latestPage(FULL, { limit: 10, since: 290 })).toMatchObject({ gap: false, more: false });
  // 11 above since=289: one is cut off.
  const cut = latestPage(FULL, { limit: 10, since: 289 });
  expect(idsOf(cut)).toEqual([300, 299, 298, 297, 296, 295, 294, 293, 292, 291]);
  expect(cut).toMatchObject({ gap: false, more: true });
  // Nothing newer at all.
  expect(latestPage(FULL, { limit: 10, since: 300 })).toMatchObject({ posts: [], more: false });
});

test("with a gap, more is true even when the limit cuts nothing", () => {
  const page = latestPage(FULL, { limit: 100, since: 0 });
  expect(page.posts).toHaveLength(100);
  expect(page).toMatchObject({ gap: true, more: true });
});

test.each([
  ["young snapshot, whole of it", 20, 50, false],
  ["young snapshot, cut by the limit", 20, 5, true],
  ["young snapshot, limit equals its size", 20, 20, false],
  ["full snapshot, whole of it: older posts may exist", LATEST_SNAPSHOT_SIZE, 100, true],
  ["full snapshot, cut by the limit", LATEST_SNAPSHOT_SIZE, 50, true],
  ["empty snapshot", 0, 50, false],
])("without since, more is right for a %s", (_name, count, limit, more) => {
  const page = latestPage(snapshotOf(count), { limit });
  expect(page.posts).toHaveLength(Math.min(count, limit));
  expect(page.more).toBe(more);
  expect(page.gap).toBeUndefined();
});
