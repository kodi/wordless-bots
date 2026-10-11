// The generated avatar (docs/ARCHITECTURE.md §9.3). Pure, so the SPA and `GET /a/:username.svg` draw the same one.

/** The avatar is a square grid of this many cells, mirrored left to right. */
export const AVATAR_GRID = 5;
/** Cells that decide the picture: the left half and the middle column. The rest mirror them. */
const AVATAR_FREE_COLUMNS = (AVATAR_GRID + 1) / 2;
const PATTERN_BITS = AVATAR_FREE_COLUMNS * AVATAR_GRID;

/**
 * 32-bit FNV-1a over the characters of `input`, one byte each. Usernames are ASCII (§6.1), so a character
 * is a byte; any other character is still hashed, by its UTF-16 code unit.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

export type AvatarSpec = {
  /** 0 to 359. */
  hue: number;
  /** `AVATAR_GRID` rows of `AVATAR_GRID` cells, true where the cell is filled. */
  cells: boolean[][];
};

/**
 * What to draw for `username`, which the caller has normalized. The low 15 bits of the hash are the
 * pattern (column by column, left half first) and the bits above them are the hue, so the two don't
 * follow each other.
 */
export function avatarSpec(username: string): AvatarSpec {
  const hash = fnv1a(username);
  const hue = (hash >>> PATTERN_BITS) % 360;
  const cells = Array.from({ length: AVATAR_GRID }, (_, row) =>
    Array.from({ length: AVATAR_GRID }, (_, col) => {
      const free = Math.min(col, AVATAR_GRID - 1 - col);
      return ((hash >>> (free * AVATAR_GRID + row)) & 1) === 1;
    }),
  );
  return { hue, cells };
}

/** The avatar as a standalone SVG document. Nothing in it comes from the username except numbers. */
export function avatarSvg(username: string): string {
  const { hue, cells } = avatarSpec(username);
  const squares = cells.flatMap((line, row) =>
    line.flatMap((on, col) => (on ? [`<rect x="${col}" y="${row}" width="1" height="1"/>`] : [])),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${AVATAR_GRID + 2} ${AVATAR_GRID + 2}" shape-rendering="crispEdges">` +
    `<rect x="-1" y="-1" width="${AVATAR_GRID + 2}" height="${AVATAR_GRID + 2}" fill="hsl(${hue}, 40%, 92%)"/>` +
    `<g fill="hsl(${hue}, 60%, 45%)">${squares.join("")}</g></svg>`
  );
}
