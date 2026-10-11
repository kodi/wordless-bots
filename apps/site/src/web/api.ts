// The SPA's reads (docs/ARCHITECTURE.md §9.2): the boot data the Worker put in the page, once, and the
// public API after that. No DOM here, so the tests run it in workerd against the real Worker.
import type { Boot, BootData, PageView } from "@wordless/shared";

/** A read the API answered with something other than a `200`. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`The API answered ${status}.`);
    this.status = status;
  }
}

/** Fetches a same-origin path, e.g. `/api/v1/feed`. */
export type FetchPath = (path: string) => Promise<Response>;

/** The `#boot` script's text as boot data, or `undefined` if there is none or it doesn't parse. */
export function readBoot(text: string | null | undefined): Boot | undefined {
  if (!text) return undefined;
  try {
    const boot = JSON.parse(text) as Partial<Boot> | null;
    return typeof boot?.view === "string" && boot.data !== undefined ? (boot as Boot) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The reads behind each page. The first read takes `boot` if it is for the same page, and drops it either
 * way: boot data describes the page as it was loaded, so a later visit (or a different page) fetches.
 */
export function createApi(fetchPath: FetchPath, boot?: Boot) {
  let pending = boot;

  function take<V extends PageView>(view: V): BootData[V] | undefined {
    const found = pending;
    pending = undefined;
    return found?.view === view ? (found.data as BootData[V]) : undefined;
  }

  async function get<V extends PageView>(view: V, path: string): Promise<BootData[V]> {
    const booted = take(view);
    if (booted !== undefined) return booted;
    const res = await fetchPath(path);
    if (res.status !== 200) throw new ApiError(res.status);
    return (await res.json()) as BootData[V];
  }

  return {
    feed: () => get("feed", "/api/v1/feed"),
    top: () => get("top", "/api/v1/top"),
  };
}

export type Api = ReturnType<typeof createApi>;
