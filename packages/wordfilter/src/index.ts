// The no-words rule (docs/ARCHITECTURE.md §5). Pure, deterministic, zero dependencies.

import { findWords, hasLetters, type Match } from "./skeleton.ts";

export type VerdictCode =
  | "contains_words"
  | "invalid_characters"
  | "empty"
  | "too_long"
  | "too_many_lines"
  | "line_too_long";

export type Verdict =
  | { ok: true; content: string }
  | {
      ok: false;
      code: VerdictCode;
      matches?: Match[];
      hint: string;
    };

export type CheckOptions = {
  maxGraphemes: number;
  maxLines: number;
  maxLineGraphemes: number;
};

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const toGraphemes = (s: string) => Array.from(segmenter.segment(s), (x) => x.segment);

// C0/C1 controls except \n, line/paragraph separators, bidi overrides and isolates, private use,
// unassigned code points and lone surrogates.
const INVALID =
  // oxlint-disable-next-line no-control-regex -- matching controls is the point
  /[\0-\x09\x0B-\x1F\x7F-\x9F\u2028\u2029\u202A-\u202E\u2066-\u2069\p{Co}\p{Cn}\p{Cs}]/u;
const TAG = /[\u{E0000}-\u{E007F}]/u;
const TAG_SEQUENCE = /^\p{RGI_Emoji_Tag_Sequence}$/v;
const VISIBLE = /[^\s\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/u;
const EMOJI = /^\p{RGI_Emoji}$/v;

const fail = (code: VerdictCode, hint: string, matches?: Match[]): Verdict =>
  matches ? { ok: false, code, matches, hint } : { ok: false, code, hint };

const codePoints = (s: string) =>
  Array.from(s, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(
    " ",
  );

const utf8Length = (s: string) =>
  Array.from(s).reduce((n, c) => {
    const cp = c.codePointAt(0)!;
    return n + (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  }, 0);

/** §5.1 step 1: the form that gets stored. */
function canonicalize(input: string): string {
  const lines = input
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end).join("\n");
}

/** Checks post content (§5.1). Match offsets are grapheme indices into the canonical content. */
export function checkContent(input: string, opts: CheckOptions): Verdict {
  const content = canonicalize(input);
  if (!VISIBLE.test(content))
    return fail("empty", "Post at least one visible symbol, emoji or digit.");

  const graphemes = toGraphemes(content);
  const invalid: Match[] = [];
  graphemes.forEach((g, i) => {
    if (INVALID.test(g) || (TAG.test(g) && !TAG_SEQUENCE.test(g))) {
      invalid.push({ text: g, start: i, end: i + 1 });
    }
  });
  if (invalid.length > 0) {
    return fail(
      "invalid_characters",
      `Remove control, bidi, private-use, unassigned and tag characters (first: ${codePoints(invalid[0]!.text)} at ${invalid[0]!.start}).`,
      invalid,
    );
  }

  if (graphemes.length > opts.maxGraphemes) {
    return fail("too_long", `${graphemes.length} graphemes; the limit is ${opts.maxGraphemes}.`);
  }

  const lines: Match[] = [];
  let lineStart = 0;
  graphemes.forEach((g, i) => {
    if (g !== "\n") return;
    lines.push({ text: graphemes.slice(lineStart, i).join(""), start: lineStart, end: i });
    lineStart = i + 1;
  });
  lines.push({
    text: graphemes.slice(lineStart).join(""),
    start: lineStart,
    end: graphemes.length,
  });
  if (lines.length > opts.maxLines) {
    return fail("too_many_lines", `${lines.length} lines; the limit is ${opts.maxLines}.`);
  }
  const long = lines.filter((line) => line.end - line.start > opts.maxLineGraphemes);
  if (long.length > 0) {
    return fail(
      "line_too_long",
      `Lines are limited to ${opts.maxLineGraphemes} graphemes each.`,
      long,
    );
  }

  const words = findWords(graphemes);
  if (words.length > 0) {
    return fail(
      "contains_words",
      `No words in any script or disguise: ${words.map((w) => w.text).join(", ")}. Use symbols, emoji, digits or kaomoji. At most 2 letters in a row (spaces and single symbols don't break a run), and no CJK or Hangul at all.`,
      words,
    );
  }
  return { ok: true, content };
}

/** Bio (§5.3): the post filter on a single line. */
export function checkBio(input: string, opts: { maxGraphemes: number }): Verdict {
  return checkContent(input, {
    maxGraphemes: opts.maxGraphemes,
    maxLines: 1,
    maxLineGraphemes: opts.maxGraphemes,
  });
}

/** Reaction (§5.3): exactly one RGI emoji whose skeleton has no letters. */
export function checkReaction(input: string, opts: { maxBytes: number }): Verdict {
  const emoji = input.normalize("NFC");
  if (emoji === "") return fail("empty", "Send one emoji.");
  if (utf8Length(emoji) > opts.maxBytes) {
    return fail("too_long", `Reactions are limited to ${opts.maxBytes} UTF-8 bytes.`);
  }
  const graphemes = toGraphemes(emoji);
  if (graphemes.length !== 1 || !EMOJI.test(emoji)) {
    return fail(
      "invalid_characters",
      "A reaction is exactly one fully-qualified RGI emoji, with no spaces or other characters.",
    );
  }
  if (hasLetters(emoji)) {
    return fail("contains_words", "Letter emoji (🅰️, 🆒, ℹ️, Ⓜ️, lone 🇦) can't be reactions.", [
      { text: emoji, start: 0, end: 1 },
    ]);
  }
  return { ok: true, content: emoji };
}
