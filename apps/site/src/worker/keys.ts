// API keys (docs/ARCHITECTURE.md §6.2). Keys are shown once and never logged; only the hash is stored.
import { RECOVERY_TOKEN_RE } from "@wordless/shared";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_BYTES = 32;
/** ceil(256 / log2(62)): every 32-byte value fits, so keys have a fixed length. */
const BODY_LENGTH = 43;
const PREFIX_LENGTH = 10;
const KEY_RE = /^wl_[0-9A-Za-z]{43}$/;

export type NewApiKey = { key: string; hash: Uint8Array; prefix: string };

/** Big-endian base62, left-padded with "0" to the full width. */
export function base62(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(BODY_LENGTH, "0");
}

export async function generateApiKey(): Promise<NewApiKey> {
  const key = `wl_${base62(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))}`;
  return { key, hash: await hashApiKey(key), prefix: key.slice(0, PREFIX_LENGTH) };
}

/** Plain SHA-256 is enough: the key has full entropy, so there's nothing to brute-force. */
export async function hashApiKey(key: string): Promise<Uint8Array> {
  return sha256(key);
}

/**
 * The admin dashboard's stored password (§8.8): SHA-256 in hex. Plain SHA-256 for the reason a key's is: the
 * password is a random secret (at least `ADMIN_PASSWORD_MIN_LENGTH` characters), not something a person chose.
 */
export async function hashAdminPassword(password: string): Promise<string> {
  return Array.from(await sha256(password), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * Whether two secrets are equal, in time that doesn't depend on where they differ. Both are hashed first,
 * so the comparison is of equal-length digests whatever the lengths of the inputs.
 */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}

export type NewRecoveryToken = { token: string; hash: Uint8Array };

/**
 * A one-time recovery token (§2.4): 32 random bytes in base62, 43 characters, like a key's body. Only its
 * hash is stored; the token itself goes into the email link and nowhere else.
 */
export async function generateRecoveryToken(): Promise<NewRecoveryToken> {
  const token = base62(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
  return { token, hash: await hashRecoveryToken(token) };
}

/** The same plain SHA-256 as a key's, for the same reason. */
export function hashRecoveryToken(token: string): Promise<Uint8Array> {
  return sha256(token);
}

/** Cheap shape check, so malformed tokens never reach D1. */
export function looksLikeRecoveryToken(token: string): boolean {
  return RECOVERY_TOKEN_RE.test(token);
}

/** Cheap shape check, so malformed tokens never reach D1. */
export function looksLikeApiKey(token: string): boolean {
  return KEY_RE.test(token);
}
