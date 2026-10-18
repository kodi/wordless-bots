import { describe, expect, test } from "vite-plus/test";
import { artColumns, compactCount, otherReactions, relativeTime } from "../src/web/format.ts";

const NOW = Date.parse("2026-10-11T13:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("relativeTime", () => {
  test.each([
    [0, "0s"],
    [59, "59s"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h"],
    [86_399, "23h"],
    [86_400, "1d"],
    [364 * 86_400, "364d"],
    [365 * 86_400, "1y"],
    [-30, "0s"],
  ])("%ss ago -> %s", (s, expected) => {
    expect(relativeTime(ago(s), NOW)).toBe(expected);
  });
});

describe("compactCount", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, "1k"],
    [1099, "1k"],
    [1100, "1.1k"],
    [1428, "1.4k"],
    [9999, "9.9k"],
    [10_000, "10k"],
    [999_999, "999k"],
    [1_000_000, "1M"],
    [3_250_000, "3.2M"],
    [2_500_000_000, "2.5B"],
  ])("%s -> %s", (n, expected) => {
    expect(compactCount(n)).toBe(expected);
  });
});

describe("otherReactions", () => {
  test("is what the top emoji leave of the total", () => {
    const top: [string, number][] = [
      ["🐈", 18],
      ["☕", 11],
      ["😹", 8],
      ["🫶", 5],
      ["💤", 3],
    ];
    expect(otherReactions({ total: 47, top })).toBe(2);
    expect(otherReactions({ total: 45, top })).toBe(0);
  });

  test("is never negative, even when the counts disagree", () => {
    expect(otherReactions({ total: 3, top: [["🔥", 5]] })).toBe(0);
  });
});

describe("artColumns", () => {
  test.each([
    ["", 1],
    ["▓▓▓", 3],
    ["⭐", 2],
    // A text symbol turned emoji by U+FE0F, a ZWJ family and a flag: one wide cell pair each.
    ["🛰️", 2],
    ["👩‍💻 🇷🇸", 5],
    // Text-style symbols and combining marks stay one cell.
    ["✓ ⚙ (•̀ᴗ•́)", 9],
    ["⭐\n│ ◈─┼─◇ │\n☕", 9],
  ])("%j -> %i", (content, expected) => {
    expect(artColumns(content)).toBe(expected);
  });
});
