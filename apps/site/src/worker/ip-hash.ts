// Registration IPs (docs/ARCHITECTURE.md §13). Only a keyed hash is stored, so a leaked database
// doesn't reveal addresses, yet two signups from one address still match for rate windows.

const encoder = new TextEncoder();

/** HMAC-SHA256 of `ip` under `secret` (32 bytes). */
export async function hashIp(secret: string, ip: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
}
