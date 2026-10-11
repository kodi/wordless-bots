// The cache layers in front of D1 for public reads (docs/ARCHITECTURE.md §10.1, §10.2).
//
//   L0  the `latest` snapshot rows, in isolate memory, for `ISOLATE_TTL_S`
//   L1  the Cache API (`caches.default`), per colo, for the route's `EDGE_TTL_S`
//
// Every key is built from parsed values, never from the raw URL, so a junk query string can't make an
// entry. The host is part of every L1 key: staging and prod may share a zone's cache, and each has its
// own database.
import { EDGE_TTL_S, ISOLATE_TTL_S } from "@wordless/shared";
import type { Db, PostRow } from "./db/queries.ts";
import { rebuildLatest } from "./db/snapshots.ts";

/** The `latest` snapshot rows: one entry whatever `limit` and `since` ask for, since those are applied in memory. */
export const latestKey = (origin: string) => `${origin}/_cache/latest`;
/** `GET /feed?before=<id>`: the page is the same size whatever `limit` says, so `before` is the whole key. */
export const feedBeforeKey = (origin: string, before: number) =>
  `${origin}/api/v1/feed?before=${before}`;
/** `GET /top`: it takes no params, so the origin is all there is to key by. */
export const topKey = (origin: string) => `${origin}/api/v1/top`;
/** `GET /posts/:id`, in the canonical spelling of the id. */
export const postKey = (origin: string, id: number) => `${origin}/api/v1/posts/${id}`;
/** `GET /bots/:username`, by the normalized username, so `Glitch` and `glitch` are one entry. */
export const profileKey = (origin: string, username: string) => `${origin}/api/v1/bots/${username}`;
/** `GET /bots/:username/posts?before=<id>`: the page is always the same size, so `before` is all there is. */
export const profileBeforeKey = (origin: string, username: string, before: number) =>
  `${origin}/api/v1/bots/${username}/posts?before=${before}`;

/**
 * How many purges there have been. A read that began before a purge may be holding what the write it
 * followed was meant to replace, and filling a layer with that would undo the purge for a full TTL. So a
 * read fills only if no purge happened while it ran.
 */
let purges = 0;

let l0: { rows: PostRow[]; expiresAt: number } | undefined;

/** The snapshot's L1 entry is stored only to expire: it never reaches a client. */
const snapshotTtl = `public, s-maxage=${EDGE_TTL_S.feed}`;

// The Cache API is a shortcut, never a dependency: when it fails the request is a miss, or stays unfilled.
async function lookup(key: string): Promise<Response | undefined> {
  try {
    return await caches.default.match(key);
  } catch (err) {
    console.error(err);
    return undefined;
  }
}

async function store(key: string, response: Response): Promise<void> {
  try {
    await caches.default.put(key, response);
  } catch (err) {
    console.error(err);
  }
}

async function drop(key: string): Promise<void> {
  try {
    await caches.default.delete(key);
  } catch (err) {
    console.error(err);
  }
}

/**
 * The `latest` snapshot rows, from L0, else L1, else `load()`. Whatever answered fills the layers above
 * it. Fills are awaited rather than left to `waitUntil`, so a purge that follows a response can never
 * be overtaken by that response's fill.
 */
export async function readLatestCached(
  origin: string,
  load: () => Promise<PostRow[]>,
): Promise<PostRow[]> {
  const now = Date.now();
  if (l0 !== undefined && l0.expiresAt > now) return l0.rows;

  const seen = purges;
  const key = latestKey(origin);
  const hit = await lookup(key);
  let rows = hit === undefined ? undefined : ((await hit.json()) as PostRow[]);
  if (rows === undefined) {
    rows = await load();
    if (purges === seen) {
      const headers = { "Content-Type": "application/json", "Cache-Control": snapshotTtl };
      await store(key, new Response(JSON.stringify(rows), { headers }));
    }
  }
  if (purges === seen) l0 = { rows, expiresAt: now + ISOLATE_TTL_S * 1000 };
  return rows;
}

/**
 * A cached `200`, else what `produce()` makes, kept if it is a `200`. Anything else (a `404` for a post
 * that doesn't exist yet, say) is passed on and not kept, so it can't outlive the thing it reported.
 */
export async function cachedResponse(
  key: string,
  produce: () => Promise<Response>,
): Promise<Response> {
  const hit = await lookup(key);
  // A copy: the headers of a cached response are read-only, and the app adds its own to every response.
  if (hit !== undefined) return new Response(hit.body, hit);

  const seen = purges;
  const response = await produce();
  if (response.status === 200 && purges === seen) await store(key, response.clone());
  return response;
}

/** Drops the snapshot from this isolate and from this colo's cache under `origin`. */
export async function purgeLatest(origin: string): Promise<void> {
  purges++;
  l0 = undefined;
  await drop(latestKey(origin));
}

/** Drops one post's entry from this colo's cache under `origin`. */
export async function purgePost(origin: string, id: number): Promise<void> {
  purges++;
  await drop(postKey(origin, id));
}

/**
 * Drops a bot's profile (its first page) from this colo's cache under `origin`. The profile's `before`
 * pages can't be named, so they run out their TTL (§10.2).
 */
export async function purgeProfile(origin: string, username: string): Promise<void> {
  purges++;
  await drop(profileKey(origin, username));
}

/**
 * Rewrites the `latest` snapshot, then drops the local copies of the old one. In that order: purging
 * first leaves a gap in which a read refills the cache from the old snapshot, for a full TTL.
 *
 * Only this isolate's L0 is dropped. Another isolate in the colo keeps its rows for up to
 * `ISOLATE_TTL_S`, and other colos for the TTL: the cron (no request, so no `origin`) relies on that too.
 */
export async function rebuildAndPurgeLatest(db: Db, origin: string): Promise<void> {
  await rebuildLatest(db);
  await purgeLatest(origin);
}
