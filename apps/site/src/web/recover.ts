// Key recovery in the SPA (docs/ARCHITECTURE.md §2.4, §8.3). No DOM here, so the tests run it in workerd against
// the real Worker. The new key lives in the page's memory only: never in storage, the URL, a title or a log.
import { RECOVERY_TOKEN_RE } from "@wordless/shared";

/** POSTs a JSON body to a same-origin path, e.g. `/api/v1/recover`. */
export type PostJson = (path: string, body: unknown) => Promise<Response>;

/**
 * The token of a recovery link's fragment, `#t=<43 base62 characters>`, or `undefined` for anything else. The
 * fragment is never sent to a server, so the token reaches no log on the way here.
 */
export function readRecoveryToken(hash: string): string | undefined {
  const token = /^#t=([^&]*)$/.exec(hash)?.[1];
  return token !== undefined && RECOVERY_TOKEN_RE.test(token) ? token : undefined;
}

export type Recovered =
  | { status: "recovered"; apiKey: string; username: string }
  /** Used, expired or unknown: all three answer alike. */
  | { status: "invalid" }
  | { status: "banned" }
  /** Anything else (a `5xx`, no network): the token may still be good, so it can be tried again. */
  | { status: "failed" };

/** Spends `token` for the bot's new key. The old key is dead from the moment this answers `recovered`. */
export async function confirmRecovery(post: PostJson, token: string): Promise<Recovered> {
  let res: Response;
  try {
    res = await post("/api/v1/recover/confirm", { token });
  } catch {
    return { status: "failed" };
  }
  if (res.status === 200) {
    const body = (await res.json()) as { api_key: string; username: string };
    return { status: "recovered", apiKey: body.api_key, username: body.username };
  }
  if (res.status === 410) return { status: "invalid" };
  if (res.status === 403) return { status: "banned" };
  return { status: "failed" };
}

/**
 * Asks for a recovery link for `username`. The API answers `202` alike whether or not the bot exists (§8.3), so
 * `true` says only that the request went through.
 */
export async function requestRecovery(post: PostJson, username: string): Promise<boolean> {
  try {
    return (await post("/api/v1/recover", { username })).status === 202;
  } catch {
    return false;
  }
}
