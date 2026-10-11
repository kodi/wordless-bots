// Skeleton building and run detection (docs/ARCHITECTURE.md §5.1 steps 4–5).

export type Match = { text: string; start: number; end: number };

/**
 * Letters common in kaomoji (§5.1 step 4.5). They're NEUTRAL unless bridged to another letter of
 * their own script, so `UωU` passes but `πως` doesn't. Changes need a corpus case.
 */
const KAOMOJI_ALLOWLIST: ReadonlySet<string> = new Set(
  // Eyes, mouths, arms, ears and whiskers by script.
  [
    "ツッシノヽヮロへヘっつづヅミ", // kana
    "ωДдεзσщ", // Greek, Cyrillic
    "ಠಥಡఠ", // Kannada, Telugu
    "ʖʘʕʔᴥᴗᶘᶅᵒᵔᵕòóÒÓ", // Latin
    "ᐛᗜᕕᕗᕙᕦᕤᗒᗕᗣᏊ", // Canadian syllabics, Cherokee
    "ㅅㅇㅂㅠㅜㆆㆁᆽ", // Hangul jamo
    "ع", // Arabic
    "益皿口彡乁", // Han
    "ง", // Thai
    "໒", // Lao
  ].join(""),
);

const SCRIPTS = [
  "Latin",
  "Greek",
  "Cyrillic",
  "Arabic",
  "Hiragana",
  "Katakana",
  "Han",
  "Hangul",
  "Kannada",
  "Telugu",
  "Lao",
  "Thai",
  "Canadian_Aboriginal",
  "Cherokee",
].map((name) => new RegExp(`^\\p{sc=${name}}$`, "u"));

/** The script of each allowlisted character, to tell `UωU` (neutral ω) from `πως` (a word). */
const ALLOWLIST_SCRIPT: ReadonlyMap<string, RegExp> = new Map(
  Array.from(KAOMOJI_ALLOWLIST, (c) => {
    const script = SCRIPTS.find((re) => re.test(c));
    if (!script) throw new Error(`Add the script of allowlisted ${c} to SCRIPTS`);
    return [c, script];
  }),
);

const alphabet = (first: number): [string, string][] =>
  Array.from({ length: 26 }, (_, i) => [
    String.fromCodePoint(first + i),
    String.fromCharCode(65 + i),
  ]);

/** Symbols that show letters but have no NFKC decomposition (§5.1 step 4.1). */
const LETTER_EMOJI: ReadonlyMap<string, string> = new Map([
  ...alphabet(0x1f150), // 🅐–🅩
  ...alphabet(0x1f170), // 🅰–🆉
  ["🆊", "P"],
  ["🆋", "IC"],
  ["🆌", "PA"],
  ["🆍", "SA"],
  ["🆎", "AB"],
  ["🆏", "WC"],
  ["🆑", "CL"],
  ["🆒", "COOL"],
  ["🆓", "FREE"],
  ["🆔", "ID"],
  ["🆕", "NEW"],
  ["🆖", "NG"],
  ["🆗", "OK"],
  ["🆘", "SOS"],
  ["🆙", "UP"],
  ["🆚", "VS"],
  ["🆛", "3D"],
  ["🆜", "2NDSCR"],
  ["🆝", "2K"],
  ["🆞", "4K"],
  ["🆟", "8K"],
  ["🆣", "60P"],
  ["🆤", "120P"],
  ["🆥", "D"],
  ["🆦", "HC"],
  ["🆧", "HDR"],
  ["🆨", "HIRES"],
  ["🆩", "LOSSLESS"],
  ["🆪", "SHV"],
  ["🆫", "UHD"],
  ["🆬", "VOD"],
  ["🉠", "福"],
  ["🉡", "禄"],
  ["🉢", "寿"],
  ["🉣", "喜"],
  ["🉤", "囍"],
  ["🉥", "财"],
]);

// Marks (zalgo), default-ignorables (ZWSP, ZWJ, variation selectors) and other format characters.
const INVISIBLE = /[\p{M}\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;
const FLAG = /^\p{RGI_Emoji_Flag_Sequence}$/v;
const REGIONAL_INDICATOR = /^\p{Regional_Indicator}$/u;
const EMOJI = /^\p{RGI_Emoji}$/v;
const LETTER = /^[\p{L}--\p{Lm}]$/v;
const HEAVY_SCRIPT = /^[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]$/u;

/** A skeleton unit. `weight` 0 is NEUTRAL; an allowlisted letter has `script` and may stay neutral. */
type Unit = { weight: number; char?: string; script?: RegExp };

const NEUTRAL: Unit = { weight: 0 };

function letterUnit(c: string): Unit {
  if (!LETTER.test(c)) return NEUTRAL;
  return { weight: HEAVY_SCRIPT.test(c) ? 3 : 1, char: c, script: ALLOWLIST_SCRIPT.get(c) };
}

/**
 * Units of text with no invisible characters. The allowlist is checked before and after NFKC, and
 * letter emoji or regional indicators glued into another grapheme (by ZWJ or a prepended sign)
 * still count.
 */
function textUnits(text: string): Unit[] {
  return Array.from(text).flatMap((cp) => {
    if (ALLOWLIST_SCRIPT.has(cp)) return [letterUnit(cp)];
    const mapped = LETTER_EMOJI.get(cp);
    if (mapped !== undefined) return textUnits(mapped);
    if (REGIONAL_INDICATOR.test(cp)) return [{ weight: 1, char: cp }];
    return Array.from(cp.normalize("NFKC").replace(INVISIBLE, ""), letterUnit);
  });
}

/**
 * Skeleton units of one grapheme. Consecutive neutrals collapse to one (`…`→`...` is a single
 * gap), and a grapheme with nothing visible (ZWSP) yields no units.
 */
function graphemeUnits(g: string): Unit[] {
  if (g === "\n") return [NEUTRAL];
  const bare = g.replace(INVISIBLE, "");
  if (bare === "") return [];

  let units: Unit[];
  if (FLAG.test(bare)) units = [NEUTRAL];
  // Emoji are NEUTRAL unless their base is a letter emoji or folds to letters (🈁→ココ, ℹ️→i).
  else if (EMOJI.test(g)) units = textUnits(String.fromCodePoint(bare.codePointAt(0)!));
  else units = textUnits(bare);

  return units.filter((u, i) => u.weight > 0 || units[i - 1]?.weight !== 0);
}

/** Whether a grapheme spells letters on its own, allowlisted letters included. */
export function hasLetters(g: string): boolean {
  return graphemeUnits(g).some((u) => u.weight > 0);
}

/** Letter runs of weight ≥ 3, bridging at most one neutral unit, as grapheme spans. */
export function findWords(graphemes: readonly string[]): Match[] {
  const units = graphemes.flatMap((g, i) => graphemeUnits(g).map((u) => ({ ...u, index: i })));

  // An allowlisted letter counts when it's bridged to a counting letter of its own script. One
  // sweep each way carries that along chains of allowlisted letters (`πωσε`, `σωπ`).
  const counts = units.map((u) => u.weight > 0 && !u.script);
  const sweep = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < units.length; i += step) {
      const { script } = units[i]!;
      if (!script || counts[i]) continue;
      const near = units[i - step]?.weight === 0 ? i - 2 * step : i - step;
      if (counts[near] && script.test(units[near]!.char!)) counts[i] = true;
    }
  };
  sweep(0, 1);
  sweep(units.length - 1, -1);

  const words: Match[] = [];
  let run: { start: number; end: number; weight: number } | undefined;
  let gap = 0;
  const close = () => {
    if (run && run.weight >= 3) {
      words.push({
        text: graphemes.slice(run.start, run.end).join(""),
        start: run.start,
        end: run.end,
      });
    }
  };
  units.forEach((u, i) => {
    if (!counts[i]) {
      gap++;
      return;
    }
    if (run && gap <= 1) {
      run.weight += u.weight;
      run.end = u.index + 1;
    } else {
      close();
      run = { start: u.index, end: u.index + 1, weight: u.weight };
    }
    gap = 0;
  });
  close();
  return words;
}
