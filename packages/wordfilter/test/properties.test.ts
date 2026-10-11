import fc from "fast-check";
import { expect, test } from "vite-plus/test";
import { checkContent } from "../src/index.ts";
import { POST, WORDS } from "./fixtures.ts";

const fromCodePoint = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) => String.fromCodePoint(first + i));

// Letter-free symbols from long-assigned blocks (no dependence on recent Unicode data).
const SYMBOLS = [
  ..."!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""),
  ...fromCodePoint(0x2190, 0x21ff), // arrows
  ...fromCodePoint(0x2200, 0x22ff), // math operators
  ...fromCodePoint(0x2500, 0x25ff), // box drawing, blocks, geometric shapes
  ...fromCodePoint(0x2600, 0x26ff), // misc symbols
  ...fromCodePoint(0x2700, 0x27bf), // dingbats
  ...fromCodePoint(0x2801, 0x28ff), // braille patterns
];
const EMOJI = [
  ..."😀 🤖 🧠 ⚡ 🔥 💤 🐝 🍃 🌍 🚀 🎉 💻 📈 🛠️ ❤️ ✨".split(" "),
  "👍🏽",
  "👋🏿",
  "👨‍👩‍👧‍👦",
  "🏳️‍🌈",
  "🧑‍💻",
  "1️⃣",
  "#️⃣",
  "🇯🇵",
  "🇫🇷",
  "🇺🇳",
  "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
];
const DIGITS = "0123456789".split("");

const symbol = fc.constantFrom(...SYMBOLS, ...EMOJI, ...DIGITS);

test("strings of symbols, emoji and digits pass", () => {
  const line = fc
    .array(fc.oneof({ arbitrary: symbol, weight: 4 }, fc.constant(" ")), { maxLength: 30 })
    .map((tokens) => tokens.join(""));
  const post = fc
    .tuple(symbol, fc.array(line, { maxLength: POST.maxLines - 1 }))
    .map(([first, lines]) => [first, ...lines].join("\n"));

  fc.assert(
    fc.property(post, (input) => {
      expect(checkContent(input, POST)).toMatchObject({ ok: true });
    }),
  );
});

// Lookalike alphabets for ASCII letters (§15). Some only have capitals.
const shifted =
  (upper: number, lower = upper) =>
  (c: string) =>
    String.fromCodePoint(c >= "a" ? lower + c.charCodeAt(0) - 97 : upper + c.charCodeAt(0) - 65);
const STYLES: Record<string, (c: string) => string> = {
  plain: (c) => c,
  bold: shifted(0x1d400, 0x1d41a),
  sans: shifted(0x1d5a0, 0x1d5ba),
  monospace: shifted(0x1d670, 0x1d68a),
  fullwidth: shifted(0xff21, 0xff41),
  circled: shifted(0x24b6, 0x24d0),
  squared: (c) => shifted(0x1f130)(c.toUpperCase()),
  negativeCircled: (c) => shifted(0x1f150)(c.toUpperCase()),
  letterEmoji: (c) => `${shifted(0x1f170)(c.toUpperCase())}\u{FE0F}`,
};
const MARKS = fromCodePoint(0x300, 0x36f);
const IGNORABLES = [
  "\u{200B}",
  "\u{200C}",
  "\u{200D}",
  "\u{2060}",
  "\u{AD}",
  "\u{FE0F}",
  "\u{3164}",
];
const SEPARATORS = [" ", ".", "-", "_", "*", "·", "~", "/", "7", "0", "🔥", "★", "\n"];

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

const letter = fc.record({
  upper: fc.boolean(),
  marks: fc.array(fc.constantFrom(...MARKS), { maxLength: 3 }),
  ignorables: fc.array(fc.constantFrom(...IGNORABLES), { maxLength: 2 }),
  separator: fc.option(fc.constantFrom(...SEPARATORS), { freq: 3 }),
});

const disguised = fc.record({
  word: fc.constantFrom(...WORDS.map((w) => w.word)),
  style: fc.constantFrom(...Object.keys(STYLES)),
  letters: fc.array(letter, { minLength: 20, maxLength: 20 }),
  prefix: fc.array(symbol, { maxLength: 3 }),
  suffix: fc.array(symbol, { maxLength: 3 }),
});

test("common words in lookalike disguises are rejected", () => {
  fc.assert(
    fc.property(disguised, ({ word, style, letters, prefix, suffix }) => {
      const chars = Array.from(segmenter.segment(word), (g) => g.segment);
      const body = chars
        .map((c, i) => {
          const { upper, marks, ignorables, separator } = letters[i % letters.length]!;
          const cased = upper ? c.toUpperCase() : c;
          const shown = /^[A-Za-z]$/.test(cased) ? STYLES[style]!(cased) : cased;
          const gap = i < chars.length - 1 ? ignorables.join("") + (separator ?? "") : "";
          return shown + marks.join("") + gap;
        })
        .join("");
      const input = `${prefix.join("")}${body}${suffix.join("")}`;
      expect(checkContent(input, POST), JSON.stringify(input)).toMatchObject({
        ok: false,
        code: "contains_words",
      });
    }),
    { numRuns: 2000 },
  );
});

test("checkContent is idempotent on its own canonical output", () => {
  const piece = fc.oneof(
    symbol,
    fc.constantFrom(" ", "\n", "\r\n", "\r", "\u{3000}", "\u{200B}", "e\u{301}", "ｱ", "Ａ"),
    fc.string({ unit: "grapheme", maxLength: 3 }),
  );
  fc.assert(
    fc.property(fc.array(piece, { maxLength: 60 }), (pieces) => {
      const first = checkContent(pieces.join(""), POST);
      if (first.ok) expect(checkContent(first.content, POST)).toEqual(first);
    }),
    { numRuns: 2000 },
  );
});
