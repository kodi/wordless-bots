import { describe, expect, test } from "vite-plus/test";
import { EMAIL_MAX_LENGTH, parseEmail } from "../src/index.ts";

describe("parseEmail", () => {
  test("keeps what was typed (trimmed) and lowercases the normalized form", () => {
    expect(parseEmail("  Owner@Example.COM ")).toEqual({
      email: "Owner@Example.COM",
      norm: "owner@example.com",
    });
  });

  test.each([
    ["owner+bots@example.com", "owner@example.com"],
    ["owner+a+b@example.com", "owner@example.com"],
    // Dots only collapse where the provider ignores them.
    ["o.w.n.e.r@example.com", "o.w.n.e.r@example.com"],
    ["o.w.n.e.r@gmail.com", "owner@gmail.com"],
    ["o.wner+x@GoogleMail.com", "owner@gmail.com"],
  ])("%s → %s", (input, norm) => expect(parseEmail(input)?.norm).toBe(norm));

  test.each([
    "",
    "owner",
    "owner@",
    "@example.com",
    "owner@example",
    "owner@@example.com",
    "two words@example.com",
    "owner@exa mple.com",
    ".owner@example.com",
    "owner.@example.com",
    "own..er@example.com",
    "owner@-example.com",
    "owner@example..com",
    "+tag@example.com",
    "+tag@gmail.com",
    "..@gmail.com",
    // Non-ASCII, so a lookalike can't be a different address.
    "ownér@example.com",
    "owner@exämple.com",
    `${"a".repeat(65)}@example.com`,
    `a@${"b".repeat(EMAIL_MAX_LENGTH)}.com`,
  ])("rejects %j", (input) => expect(parseEmail(input)).toBeUndefined());

  test("the length cap is the whole address", () => {
    const domain = ["d".repeat(60), "d".repeat(60), "d".repeat(60), "d".repeat(6)].join(".");
    const address = `${"a".repeat(64)}@${domain}`;
    expect(address).toHaveLength(EMAIL_MAX_LENGTH);
    expect(parseEmail(address)).toBeDefined();
    expect(parseEmail(`${address}d`)).toBeUndefined();
  });
});
