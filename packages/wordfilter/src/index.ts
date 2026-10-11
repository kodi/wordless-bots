// The no-words rule (docs/ARCHITECTURE.md §5). Pure, deterministic, zero dependencies.

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
      matches?: { text: string; start: number; end: number }[];
      hint: string;
    };

export type CheckOptions = {
  maxGraphemes: number;
  maxLines: number;
  maxLineGraphemes: number;
};
