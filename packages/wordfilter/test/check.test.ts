import { BIO_MAX_GRAPHEMES, REACTION_MAX_BYTES } from "@wordless/shared";
import { describe, expect, test } from "vite-plus/test";
import { checkBio, checkContent, checkReaction } from "../src/index.ts";

const SMALL = { maxGraphemes: 12, maxLines: 3, maxLineGraphemes: 4 };
const LARGE = { maxGraphemes: 500, maxLines: 16, maxLineGraphemes: 80 };

describe("canonicalization", () => {
  test("stores LF line endings, NFC, no trailing whitespace and no surrounding blank lines", () => {
    expect(checkContent(" \r\n\n  ┌─┐ \u{3000}\r└─┘\r\n\t \n", LARGE)).toEqual({
      ok: true,
      content: "  ┌─┐\n└─┘",
    });
    expect(checkContent("(e\u{301}_e\u{301})", LARGE)).toEqual({
      ok: true,
      content: "(\u{E9}_\u{E9})",
    });
  });

  test("keeps interior blank lines", () => {
    expect(checkContent("★\n\n\n★", LARGE)).toEqual({ ok: true, content: "★\n\n\n★" });
  });

  test.for(["", " \n \r\n\t", "\u{200B}", "\u{2800}\u{2800}", "\u{3164}\n\u{FEFF}"])(
    "nothing visible in %j is empty",
    (input) => {
      expect(checkContent(input, LARGE)).toMatchObject({ ok: false, code: "empty" });
    },
  );
});

describe("invalid characters", () => {
  test.for([
    ["tab", "★\t★"],
    ["C0 control", "★\u{7}"],
    ["C1 next line", "★\u{85}★"],
    ["line separator", "★\u{2028}★"],
    ["bidi override", "★\u{202E}★"],
    ["bidi isolate", "★\u{2067}★"],
    ["private use", "\u{E000}"],
    ["unassigned", "\u{378}"],
    ["noncharacter", "\u{FFFE}"],
    ["lone surrogate", "★\u{D800}"],
    ["tag characters outside a flag", "★\u{E0068}\u{E0069}"],
    [
      "tag characters on a non-flag base",
      "🏳\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    ],
  ])("rejects %s", ([, input]) => {
    expect(checkContent(input!, LARGE)).toMatchObject({ ok: false, code: "invalid_characters" });
  });

  test("reports each offending grapheme and names the first code point", () => {
    expect(checkContent("☆\u{202E}☆\u{E000}", LARGE)).toEqual({
      ok: false,
      code: "invalid_characters",
      matches: [
        { text: "\u{202E}", start: 1, end: 2 },
        { text: "\u{E000}", start: 3, end: 4 },
      ],
      hint: expect.stringContaining("U+202E at 1"),
    });
  });

  test("invalid characters win over length limits", () => {
    expect(checkContent(`${"★".repeat(600)}\u{7}`, LARGE)).toMatchObject({
      code: "invalid_characters",
    });
  });
});

describe("structural limits", () => {
  test("counts graphemes, newlines included, against maxGraphemes", () => {
    expect(checkContent("👨‍👩‍👧‍👦👍🏽🇯🇵1\n★★\n★★★", SMALL)).toMatchObject({ ok: true });
    expect(checkContent("👍👍👍👍\n👍👍👍👍\n👍👍👍", SMALL)).toMatchObject({
      ok: false,
      code: "too_long",
    });
  });

  test("limits the number of lines", () => {
    expect(checkContent("1\n2\n3", SMALL)).toMatchObject({ ok: true });
    expect(checkContent("1\n2\n3\n4", SMALL)).toMatchObject({ ok: false, code: "too_many_lines" });
  });

  test("trailing blank lines don't count towards the line limit", () => {
    expect(checkContent("1\n2\n3\n\n\n", SMALL)).toMatchObject({ ok: true });
  });

  test("reports every line that is too long as a grapheme span", () => {
    expect(checkContent("★★★★\n★★★★★\n🇯🇵🇯🇵🇯🇵🇯🇵🇯🇵", { ...SMALL, maxGraphemes: 50 })).toEqual({
      ok: false,
      code: "line_too_long",
      matches: [
        { text: "★★★★★", start: 5, end: 10 },
        { text: "🇯🇵🇯🇵🇯🇵🇯🇵🇯🇵", start: 11, end: 16 },
      ],
      hint: expect.any(String),
    });
  });

  test("structural limits are checked before words", () => {
    expect(checkContent("lol\nx\nx\nx", SMALL)).toMatchObject({ code: "too_many_lines" });
  });
});

describe("word matches", () => {
  test("are grapheme spans into the canonical content", () => {
    const verdict = checkContent("\n\n  👨‍👩‍👧 h̷e̷y̷ ★ ok ★★ ｃａｔ  \n", LARGE);
    expect(verdict).toMatchObject({
      ok: false,
      code: "contains_words",
      matches: [
        { text: "h̷e̷y̷", start: 4, end: 7 },
        { text: "ｃａｔ", start: 16, end: 19 },
      ],
    });
  });

  test("a bridged run spans its separators", () => {
    expect(checkContent("☆h.e.y☆", LARGE)).toMatchObject({
      matches: [{ text: "h.e.y", start: 1, end: 6 }],
    });
  });

  test("a run continues across a line break", () => {
    expect(checkContent("★★X\nD★★", LARGE)).toMatchObject({ ok: true });
    expect(checkContent("★★XD\nD★★", LARGE)).toMatchObject({
      matches: [{ text: "XD\nD", start: 2, end: 6 }],
    });
  });
});

describe("checkBio", () => {
  const opts = { maxGraphemes: BIO_MAX_GRAPHEMES };

  test("accepts one line and stores it canonicalized", () => {
    expect(checkBio("  🤖⚙️ ∞  ", opts)).toEqual({ ok: true, content: "  🤖⚙️ ∞" });
  });

  test("rejects a second line", () => {
    expect(checkBio("🤖\n⚙️", opts)).toMatchObject({ ok: false, code: "too_many_lines" });
  });

  test("rejects words", () => {
    expect(checkBio("🤖 bot", opts)).toMatchObject({ ok: false, code: "contains_words" });
  });

  test("limits graphemes", () => {
    expect(checkBio("★".repeat(BIO_MAX_GRAPHEMES), opts)).toMatchObject({ ok: true });
    expect(checkBio("★".repeat(BIO_MAX_GRAPHEMES + 1), opts)).toMatchObject({
      ok: false,
      code: "too_long",
    });
  });
});

describe("checkReaction", () => {
  const opts = { maxBytes: REACTION_MAX_BYTES };

  test.for(["👍", "❤️", "🇯🇵", "1️⃣", "👍🏽", "👨‍👩‍👧‍👦", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"])("accepts %s", (emoji) => {
    expect(checkReaction(emoji, opts)).toEqual({ ok: true, content: emoji });
  });

  test.for(["🅰️", "🆒", "ℹ️", "Ⓜ️", "🈁", "🈚"])("rejects the letter emoji %s", (emoji) => {
    expect(checkReaction(emoji, opts)).toMatchObject({ ok: false, code: "contains_words" });
  });

  test.for(["🇦", "👍👍", "👍 ", " 👍", "❤", "★", "a", "🇭🇮"])(
    "rejects %j as not one RGI emoji",
    (input) => {
      expect(checkReaction(input, opts)).toMatchObject({ ok: false, code: "invalid_characters" });
    },
  );

  test("rejects an empty reaction", () => {
    expect(checkReaction("", opts)).toMatchObject({ ok: false, code: "empty" });
  });

  test("limits UTF-8 bytes", () => {
    // 4 + 3 + 4 + 3 + 4 + 3 + 4 = 25 bytes
    expect(checkReaction("👨‍👩‍👧‍👦", { maxBytes: 25 })).toMatchObject({ ok: true });
    expect(checkReaction("👨‍👩‍👧‍👦", { maxBytes: 24 })).toMatchObject({ ok: false, code: "too_long" });
  });
});
