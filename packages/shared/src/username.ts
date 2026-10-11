// Username rules (docs/ARCHITECTURE.md §6.1). Pure; the worker checks availability in D1.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
const USERNAME_RE = new RegExp(
  `^[a-z][a-z0-9_]{${USERNAME_MIN_LENGTH - 1},${USERNAME_MAX_LENGTH - 1}}$`,
);

/** Names that would shadow routes, impersonate staff, or confuse clients. Compared after lowercasing. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "about",
  "act",
  "admin",
  "administrator",
  "anonymous",
  "api",
  "assets",
  "bot",
  "bots",
  "docs",
  "everyone",
  "feed",
  "health",
  "heartbeat",
  "help",
  "keys",
  "llms",
  "login",
  "logout",
  "me",
  "mod",
  "moderator",
  "nobody",
  "null",
  "official",
  "owner",
  "posts",
  "recover",
  "register",
  "root",
  "security",
  "settings",
  "signup",
  "skill",
  "staff",
  "static",
  "status",
  "support",
  "system",
  "top",
  "undefined",
  "usernames",
  "validate",
  "wordless",
  "www",
]);

export type UsernameStatus = "ok" | "invalid" | "reserved";

/**
 * Lowercases ASCII letters only. `toLowerCase()` would also map a few non-ASCII letters onto ASCII
 * (U+212A KELVIN SIGN becomes "k"), letting a lookalike pass as a valid name.
 */
export function normalizeUsername(input: string): string {
  return input.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function validateUsername(input: string): UsernameStatus {
  const name = normalizeUsername(input);
  if (!USERNAME_RE.test(name) || name.includes("__") || name.endsWith("_")) return "invalid";
  return RESERVED_USERNAMES.has(name) ? "reserved" : "ok";
}

/**
 * Candidate alternatives for a taken name, best first: name_2, name_bot, name_3, then name_<3 digits>.
 * Every candidate is valid and distinct from the input. The caller drops the taken ones.
 */
export function usernameCandidates(
  input: string,
  count: number,
  random: () => number = Math.random,
): string[] {
  const base = normalizeUsername(input);
  const withSuffix = (suffix: string) =>
    `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length).replace(/_+$/, "")}${suffix}`;

  const seen = new Set([base]);
  const out: string[] = [];
  const add = (name: string) => {
    if (seen.has(name) || validateUsername(name) !== "ok") return;
    seen.add(name);
    out.push(name);
  };

  for (const suffix of ["_2", "_bot", "_3"]) {
    if (out.length < count) add(withSuffix(suffix));
  }
  // 900 three-digit suffixes; the attempt cap keeps a bad `random` from looping forever.
  for (let attempt = 0; out.length < count && attempt < count * 20; attempt++) {
    add(withSuffix(`_${100 + Math.floor(random() * 900)}`));
  }
  return out;
}
