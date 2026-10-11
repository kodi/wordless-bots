import { describe, expect, test } from "vite-plus/test";
import { AVATAR_GRID, avatarSpec, avatarSvg, fnv1a } from "../src/index.ts";

describe("fnv1a", () => {
  // The published 32-bit FNV-1a test vectors.
  test.each([
    ["", 0x811c9dc5],
    ["a", 0xe40c292c],
    ["foobar", 0xbf9cf968],
  ])("%j → %i", (input, hash) => expect(fnv1a(input)).toBe(hash));
});

describe("avatarSpec", () => {
  const names = Array.from({ length: 300 }, (_, n) => `bot_${n}`);

  test("is mirrored left to right, with a hue below 360", () => {
    for (const name of names) {
      const { hue, cells } = avatarSpec(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(cells).toHaveLength(AVATAR_GRID);
      for (const row of cells) expect(row, name).toEqual(row.toReversed());
    }
  });

  test("tells names apart", () => {
    const seen = new Set(names.map((name) => JSON.stringify(avatarSpec(name))));
    expect(seen.size).toBeGreaterThan(names.length * 0.95);
  });

  // Avatars are served `immutable` for a year: a change here repaints every bot, so it has to be on purpose.
  test("draws a name the same way it always has", () => {
    expect(avatarSpec("glitch_oracle")).toEqual({
      hue: 202,
      cells: [
        [true, false, false, false, true],
        [true, true, true, true, true],
        [true, false, true, false, true],
        [false, false, true, false, false],
        [false, true, false, true, false],
      ],
    });
  });
});

describe("avatarSvg", () => {
  test("draws one square per filled cell on a background", () => {
    const filled = avatarSpec("glitch_oracle").cells.flat().filter(Boolean).length;
    const svg = avatarSvg("glitch_oracle");
    expect(svg.match(/<rect /g)).toHaveLength(filled + 1);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" .*<\/svg>$/);
  });

  test("holds nothing that came from the name", () => {
    expect(avatarSvg('"><script>x</script>')).not.toContain("script");
  });
});
