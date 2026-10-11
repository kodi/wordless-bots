import { describe, expect, test } from "vite-plus/test";
import {
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  usernameCandidates,
  validateUsername,
} from "../src/index.ts";

describe("validateUsername", () => {
  test.each(["abc", "glitch_oracle", "a1_b2", "x".repeat(24), "Glitch_Oracle"])(
    "%s is ok",
    (name) => expect(validateUsername(name)).toBe("ok"),
  );

  test.each([
    ["ab", "too short"],
    ["x".repeat(25), "too long"],
    ["1abc", "leading digit"],
    ["_abc", "leading underscore"],
    ["abc_", "trailing underscore"],
    ["ab__c", "double underscore"],
    ["ab-c", "hyphen"],
    ["ab c", "space"],
    [" abc", "surrounding whitespace"],
    ["\u{212A}ing", "KELVIN SIGN lowercases to k"],
    ["caf\u{E9}", "non-ASCII letter"],
  ])("%s is invalid (%s)", (name) => expect(validateUsername(name)).toBe("invalid"));

  test("reserved names are caught in any case", () => {
    expect(validateUsername("admin")).toBe("reserved");
    expect(validateUsername("ADMIN")).toBe("reserved");
    expect(validateUsername("admin_2")).toBe("ok");
  });

  test("normalization folds ASCII case only", () => {
    expect(normalizeUsername("Glitch_ORACLE")).toBe("glitch_oracle");
    expect(normalizeUsername("\u{212A}ing")).toBe("\u{212A}ing");
  });
});

describe("usernameCandidates", () => {
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

  test("leads with the readable variants, then random three-digit ones", () => {
    expect(usernameCandidates("Glitch", 5, seq(0, 0.5))).toEqual([
      "glitch_2",
      "glitch_bot",
      "glitch_3",
      "glitch_100",
      "glitch_550",
    ]);
  });

  test("skips duplicate random suffixes", () => {
    expect(usernameCandidates("abc", 5, seq(0.5, 0.5, 0.1))).toEqual([
      "abc_2",
      "abc_bot",
      "abc_3",
      "abc_550",
      "abc_190",
    ]);
  });

  test("long names are trimmed so every candidate stays valid", () => {
    // Cutting this to 20 chars for "_bot" leaves a trailing "_", which would make "s__bot".
    const base = "abcdefghijklmnopqrs_wxyz";
    const out = usernameCandidates(base, 8);
    expect(out).toHaveLength(8);
    for (const name of out) {
      expect(validateUsername(name)).toBe("ok");
      expect(name.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
    }
    expect(out).toContain("abcdefghijklmnopqrs_bot");
    expect(out).not.toContain(base);
  });

  test("a stuck random source can't loop forever", () => {
    expect(usernameCandidates("abc", 10, () => 0)).toEqual([
      "abc_2",
      "abc_bot",
      "abc_3",
      "abc_100",
    ]);
  });
});
