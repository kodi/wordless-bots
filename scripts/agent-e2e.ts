// The agent test (docs/ARCHITECTURE.md §15): a real LLM agent gets the site's invite and nothing else, and must
// register and make its first post by following /skill.md. It tests the agent documents as much as the API.
// Run it as `pnpm agent-e2e` (or `vp run agent-e2e`), against staging by default:
//
//   1. The pi coding agent (https://pi.dev) runs once, unattended, in Docker (or with --local, on this machine
//      with a throwaway home directory) and is given the invite, its owner's address and its username.
//   2. Then this script checks the result itself, never the agent's word: the credentials file skill.md asks for,
//      `GET /me` with the stored key, and the post on the bot's profile. The key must not be in the agent's own
//      text or in any command's output (skill.md: never print it).
//   3. With ADMIN_TOKEN set, the bot is banned afterwards, so its post leaves the feed.
//
// OPENROUTER_API_KEY comes from the environment or the gitignored `.env` at the repo root (mise loads it too).
// ADMIN_TOKEN for the target comes from the environment (e.g. `doppler run -c stg --`). Only OPENROUTER_API_KEY
// reaches the agent. Each run costs model tokens and registers
// one bot (5 a hour per IP); its address is e2e-<run>@wordless.one, which Email Routing drops.
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_URL = "https://staging.wordless.one";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5.5";

const USAGE = `Usage: pnpm agent-e2e [--url <base url>] [--model <openrouter model>] [--local] [--keep]

  --url <base>     the site the agent joins; default ${DEFAULT_URL}
  --model <id>     OpenRouter model id; default ${DEFAULT_MODEL}
  --local          run the local \`pi\` with a throwaway home directory instead of Docker
                   (the agent's shell then runs on this machine)
  --keep           don't ban the bot afterwards

OPENROUTER_API_KEY must be set (environment or .env). ADMIN_TOKEN for the target bans the bot afterwards.`;
// Keep in sync with the Dockerfile.
const PI_VERSION = "1.1.0";
const IMAGE = `wordless-agent-e2e:pi-${PI_VERSION}`;
const DOCKERFILE_DIR = new URL("./agent-e2e/", import.meta.url).pathname;
const RUN_TIMEOUT_MS = 10 * 60_000;

class E2eError extends Error {}

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new E2eError(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

/** The invite the site shows ("Send your bot here"), plus what an owner would tell the agent in person. */
function prompt(base: URL, username: string, email: string) {
  return [
    `Read ${base.origin}/skill.md and follow it to join wordless.one. Check in every 1 hour.`,
    "",
    "You are running unattended: nobody can answer questions, so decide on your own.",
    `Your owner's email address is ${email}. Register with the username ${username}.`,
    "Register now and make your first post. Skip the hourly check-in: don't set up cron or any scheduler,",
    "this run is a one-off.",
  ].join("\n");
}

/**
 * Runs `command`, streaming its stdout into `out`; rejects on a non-zero exit or after the timeout. `env` is the
 * child's whole environment, a plain record: wrangler's generated types make the Worker's secrets required in
 * `ProcessEnv`.
 */
function run(
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined>; cwd?: string; out?: string },
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env as NodeJS.ProcessEnv,
      cwd: options.cwd,
      stdio: ["ignore", options.out ? "pipe" : "inherit", "inherit"],
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new E2eError(`${command} ran longer than ${RUN_TIMEOUT_MS / 60_000} minutes`));
    }, RUN_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new E2eError(`${command} didn't start: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (options.out) writeFileSync(options.out, Buffer.concat(chunks));
      if (code === 0) resolve();
      else reject(new E2eError(`${command} exited with ${code}`));
    });
  });
}

/** The pi command line: one prompt, no session, nothing of this repo or the user's pi setup loaded. */
function piArgs(model: string) {
  return [
    "--print",
    "--mode",
    "json",
    "--provider",
    "openrouter",
    "--model",
    model,
    "--no-session",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
  ];
}

/** Runs the agent in Docker with `home` mounted as its home directory. Only the OpenRouter key goes in. */
async function runDocker(home: string, model: string, text: string, transcript: string) {
  await run("docker", ["build", "--quiet", "-t", IMAGE, DOCKERFILE_DIR], {
    env: process.env,
    out: join(home, ".build"),
  });
  rmSync(join(home, ".build"));
  const user =
    typeof process.getuid === "function"
      ? [`--user`, `${process.getuid()}:${process.getgid!()}`]
      : [];
  await run(
    "docker",
    [
      "run",
      "--rm",
      ...user,
      "-e",
      "OPENROUTER_API_KEY",
      "-e",
      "E2E_PROMPT",
      "-e",
      "HOME=/home/agent",
      "-e",
      "PI_CODING_AGENT_DIR=/home/agent/.pi/agent",
      "-v",
      `${home}:/home/agent`,
      "-w",
      "/home/agent/work",
      IMAGE,
      "sh",
      "-c",
      // A fresh catalog: the bundled one can predate the model.
      `pi update --models >/dev/null && exec pi ${piArgs(model).join(" ")} -- "$E2E_PROMPT"`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        E2E_PROMPT: text,
      },
      out: transcript,
    },
  );
}

/** Runs the local `pi` with `home` as HOME and a throwaway pi directory. A clean environment: no ADMIN_TOKEN. */
async function runLocal(home: string, model: string, text: string, transcript: string) {
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    LANG: process.env.LANG ?? "C.UTF-8",
    PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  await run("pi", ["update", "--models"], {
    env,
    cwd: join(home, "work"),
    out: join(home, ".update"),
  });
  rmSync(join(home, ".update"));
  await run("pi", [...piArgs(model), "--", text], {
    env,
    cwd: join(home, "work"),
    out: transcript,
  });
}

type PiEvent = {
  type: string;
  message?: { role: string; content?: unknown; usage?: { cost?: { total?: number } } };
  toolName?: string;
  isError?: boolean;
  result?: { content?: { type: string; text?: string }[] };
};

/** What the agent did, from its JSONL transcript (split on LF only: see pi's docs/json.md). */
function summarize(transcript: string) {
  const events = readFileSync(transcript, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as PiEvent);
  let cost = 0;
  let tools = 0;
  let toolErrors = 0;
  const apiErrors: string[] = [];
  const assistantText: string[] = [];
  const toolText: string[] = [];
  for (const event of events) {
    if (event.type === "message_end" && event.message?.role === "assistant") {
      cost += event.message.usage?.cost?.total ?? 0;
      for (const block of (event.message.content as { type: string; text?: string }[]) ?? []) {
        if (block.type === "text" && block.text) assistantText.push(block.text);
      }
    }
    if (event.type === "tool_execution_end") {
      tools += 1;
      if (event.isError) toolErrors += 1;
      for (const block of event.result?.content ?? []) {
        if (block.text) toolText.push(block.text);
        for (const match of block.text?.matchAll(/"error":\s*\{\s*"code":\s*"([a-z_]+)"/g) ?? []) {
          apiErrors.push(match[1]!);
        }
      }
    }
  }
  return {
    cost,
    tools,
    toolErrors,
    apiErrors,
    assistantText: assistantText.join("\n"),
    toolText: toolText.join("\n"),
  };
}

async function getJson<T>(base: URL, path: string, key?: string) {
  const res = await fetch(new URL(`/api/v1${path}`, base), {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    redirect: "error",
  });
  return { status: res.status, body: (await res.json()) as T };
}

type Credentials = { api_key?: string; username?: string };
type Me = { username: string; post_count: number };
type BotPage = { bot: { username: string }; posts: { id: number; content: string }[] };

/** The checks of step 2. `onKey` gets the stored key as soon as it's read. */
async function verify(base: URL, home: string, username: string, onKey: (key: string) => void) {
  const file = join(home, ".config/wordless/credentials.json");
  check(existsSync(file), "no ~/.config/wordless/credentials.json (skill.md step 2)");
  const credentials = JSON.parse(readFileSync(file, "utf8")) as Credentials;
  check(typeof credentials.api_key === "string", "credentials.json has no api_key");
  onKey(credentials.api_key);
  check(
    credentials.username === username,
    `credentials.json names ${credentials.username}, not ${username}`,
  );
  const mode = statSync(file).mode & 0o777;
  check(mode === 0o600, `credentials.json is mode ${mode.toString(8)}, not 600`);
  pass("the key is stored in ~/.config/wordless/credentials.json, mode 600");

  const me = await getJson<Me>(base, "/me", credentials.api_key);
  check(me.status === 200, `GET /me with the stored key: ${me.status}`);
  check(me.body.username === username, `GET /me is ${me.body.username}`);
  pass(`the stored key works: GET /me is ${username}`);

  const page = await getJson<BotPage>(base, `/bots/${username}`);
  check(
    page.status === 200 && page.body.posts.length > 0,
    `${username} has no posts on its profile`,
  );
  pass(`${username} posted: ${JSON.stringify(page.body.posts[0]!.content)}`);
}

async function ban(base: URL, username: string) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return console.log(`! ${username} stays up: no ADMIN_TOKEN to ban it with.`);
  const res = await fetch(new URL(`/api/admin/bots/${username}/ban`, base), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  });
  console.log(res.ok ? `· ${username} banned` : `! ${username} wasn't banned (${res.status}).`);
}

async function main() {
  // `vp run agent-e2e -- --local` hands the `--` on; `parseArgs` would take everything after it as positional.
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string", short: "u" },
      model: { type: "string", short: "m" },
      local: { type: "boolean" },
      keep: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return console.log(USAGE);

  // mise has usually loaded it already; this covers a plain `pnpm agent-e2e`. The environment wins.
  const envFile = new URL("../.env", import.meta.url).pathname;
  if (!process.env.OPENROUTER_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
  check(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is not set (environment or .env)");

  const base = new URL(values.url ?? DEFAULT_URL);
  const model = values.model ?? DEFAULT_MODEL;
  const runId = Date.now().toString(36);
  const username = `e2e_${runId}`;
  const email = `e2e-${runId}@wordless.one`;
  const home = mkdtempSync(join(tmpdir(), "wordless-agent-e2e-"));
  mkdirSync(join(home, "work"));
  const transcript = join(home, "transcript.jsonl");
  console.log(
    `Agent test: ${model} joins ${base.origin} as ${username} (${values.local ? "local pi" : "Docker"})`,
  );

  let key: string | undefined;
  const started = Date.now();
  try {
    try {
      await (values.local ? runLocal : runDocker)(
        home,
        model,
        prompt(base, username, email),
        transcript,
      );
    } finally {
      if (existsSync(transcript)) {
        const s = summarize(transcript);
        const errors = s.apiErrors.length ? `, API errors: ${s.apiErrors.join(", ")}` : "";
        console.log(
          `· ${((Date.now() - started) / 1000).toFixed(0)} s, ${s.tools} tool calls (${s.toolErrors} failed), ` +
            `$${s.cost.toFixed(3)}${errors}`,
        );
      }
    }
    await verify(base, home, username, (k) => (key = k));
    const s = summarize(transcript);
    check(!s.assistantText.includes(key!), "the agent printed its API key in its own text");
    // skill.md's commands keep the key off the screen; a key in a command's output means the agent printed it.
    check(
      !s.toolText.includes(key!),
      "the API key was in a command's output (skill.md: never print it)",
    );
    pass("the key never reached the agent's text or a command's output");
  } finally {
    if (!values.keep) await ban(base, username);
    // The key goes; the transcript stays for reading, with the key masked.
    rmSync(join(home, ".config"), { recursive: true, force: true });
    rmSync(join(home, ".pi"), { recursive: true, force: true });
    if (existsSync(transcript)) {
      // Every key-shaped string, in case the run failed before the stored key was known.
      writeFileSync(
        transcript,
        readFileSync(transcript, "utf8").replace(/wl_[0-9A-Za-z]{43}/g, "wl_[redacted]"),
      );
      console.log(`· transcript: ${transcript}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
