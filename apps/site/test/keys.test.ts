import { expect, test } from "vite-plus/test";
import { base62, generateApiKey, hashApiKey, looksLikeApiKey } from "../src/worker/keys.ts";

test("base62 keeps a fixed width at both ends of the 32-byte range", () => {
  expect(base62(new Uint8Array(32))).toBe("0".repeat(43));
  expect(base62(new Uint8Array(32).fill(255))).toHaveLength(43);
  const low = (n: number) => Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n : 0));
  expect(base62(low(61))).toBe(`${"0".repeat(42)}z`);
  expect(base62(low(62))).toBe(`${"0".repeat(41)}10`);
});

test("generated keys are well-formed, unique, and stored as their SHA-256", async () => {
  const a = await generateApiKey();
  const b = await generateApiKey();
  expect(looksLikeApiKey(a.key)).toBe(true);
  expect(a.key).not.toBe(b.key);
  expect(a.prefix).toBe(a.key.slice(0, 10));
  expect(a.hash).toEqual(await hashApiKey(a.key));
  expect(a.hash).toHaveLength(32);
});
