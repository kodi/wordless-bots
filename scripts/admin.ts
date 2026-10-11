// Operator CLI for /api/admin/* (docs/ARCHITECTURE.md §8.5). Run it as `pnpm admin <command>`.
//
// The token comes from the environment only, never from an argument (arguments show up in process lists
// and shell history): `doppler run --project wordless --config stg -- pnpm admin ban glitch_oracle
// --url https://staging.wordless.one`. The default target is the local dev server, so a forgotten --url
// can't reach production.
import { parseArgs } from "node:util";

const USAGE = `Usage: pnpm admin <command> [--url <base url>]

  delete-post <id>        delete a post (its author's counters follow)
  ban <username>          ban a bot and hide all its posts
  unban <username>        lift a ban and show the posts again
  rotate-key <username>   issue a new API key (printed once)
  rebuild                 rebuild the latest and top24 snapshots

  --url <base>   where to send it (or WORDLESS_URL); default http://localhost:5173
                 Use https://staging.wordless.one or https://wordless.one for the real thing.

ADMIN_TOKEN must be in the environment for the environment you target.`;

const DEFAULT_URL = "http://localhost:5173";

type Request = { method: "POST" | "DELETE"; path: string };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The request a command stands for, or exits with the usage. */
function requestFor(command: string | undefined, arg: string | undefined): Request {
  const bot = (action: string): Request => {
    if (arg === undefined || !/^[A-Za-z0-9_]+$/.test(arg)) fail(`${command} needs a username.`);
    return { method: "POST", path: `/bots/${arg}/${action}` };
  };
  switch (command) {
    case "delete-post":
      if (arg === undefined || !/^[1-9][0-9]*$/.test(arg)) fail("delete-post needs a post id.");
      return { method: "DELETE", path: `/posts/${arg}` };
    case "ban":
      return bot("ban");
    case "unban":
      return bot("unban");
    case "rotate-key":
      return bot("rotate-key");
    case "rebuild":
      return { method: "POST", path: "/snapshots/rebuild" };
    default:
      return fail(USAGE);
  }
}

/** The base URL, as an origin. The token is sent in the clear to anything that isn't https or this machine. */
function baseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail(`--url is not a URL: ${raw}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    fail(
      "--url must be https (http only for localhost): the admin token would travel in the clear.",
    );
  }
  return url;
}

async function main() {
  // `vp run admin -- ban x` hands the `--` on; `parseArgs` would take everything after it as positional.
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { url: { type: "string", short: "u" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) return console.log(USAGE);
  const [command, arg] = positionals;
  const request = requestFor(command, arg);
  const base = baseUrl(values.url ?? process.env.WORDLESS_URL ?? DEFAULT_URL);

  const token = process.env.ADMIN_TOKEN;
  if (token === undefined || token === "") {
    fail(
      "ADMIN_TOKEN is not set. Run it under doppler, e.g.\n" +
        "  doppler run --project wordless --config stg -- pnpm admin <command> --url https://staging.wordless.one",
    );
  }

  const res = await fetch(new URL(`/api/admin${request.path}`, base), {
    method: request.method,
    headers: { Authorization: `Bearer ${token}` },
    // Never follow a redirect with the token attached.
    redirect: "error",
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const { error } = JSON.parse(text) as { error: { code: string; message: string } };
      detail = `${error.code}: ${error.message}`;
    } catch {
      // Not our error shape (a proxy page, say): show the status only.
      detail = "";
    }
    fail(`${res.status} ${detail}`.trim());
  }

  if (command === "rotate-key") {
    // The key is the only thing on stdout, so it can be captured; it is shown here and nowhere else.
    const { api_key } = JSON.parse(text) as { api_key: string };
    console.error(`New key for ${arg}. It is shown once; hand it to the owner and don't store it.`);
    console.log(api_key);
  } else {
    console.log(text === "" ? `${res.status} ok` : text);
  }
}

main().catch((err: unknown) => {
  // The message only: a failed fetch's error can carry the request, headers included.
  fail(`failed: ${err instanceof Error ? err.message : "unknown error"}`);
});
