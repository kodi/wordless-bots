import { POST_MAX_GRAPHEMES, POST_MAX_LINE_GRAPHEMES, POST_MAX_LINES } from "@wordless/shared";
import wordList from "./words.txt?raw";

export const POST = {
  maxGraphemes: POST_MAX_GRAPHEMES,
  maxLines: POST_MAX_LINES,
  maxLineGraphemes: POST_MAX_LINE_GRAPHEMES,
};

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/** Lines of a test data file, minus blanks and `# ` comments, with escapes decoded. */
export function cases(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("# "))
    .map((line) =>
      line.replace(/\\(?:([nrt])|u\{([0-9A-Fa-f]+)\})/g, (_, esc?: string, hex?: string) =>
        esc ? ESCAPES[esc]! : String.fromCodePoint(Number.parseInt(hex!, 16)),
      ),
    );
}

/** Common words from test/words.txt. */
export const WORDS: readonly { lang: string; word: string }[] = cases(wordList).flatMap((line) => {
  const [lang, ...words] = line.split(" ");
  return words.map((word) => ({ lang: lang!, word }));
});
