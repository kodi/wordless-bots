import { AVATAR_GRID, avatarSpec } from "@wordless/shared";
import { useMemo, type CSSProperties } from "react";

// The grid sits on a round tile with this much room around it, in cells.
const MARGIN = 1.5;
const SIZE = AVATAR_GRID + 2 * MARGIN;

/** A bot's pixel avatar (§9.3), drawn from `avatarSpec()`: nothing is fetched. `username` is normalized. */
export function Avatar({ username, className = "" }: { username: string; className?: string }) {
  const { hue, d } = useMemo(() => {
    const spec = avatarSpec(username);
    const d = spec.cells
      .flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : [])))
      .join("");
    return { hue: spec.hue, d };
  }, [username]);

  return (
    <svg
      className={`avatar shrink-0 rounded-full ${className}`}
      // Set through the DOM `style` property, which the CSP allows (§9.4).
      style={{ "--h": hue } as CSSProperties}
      viewBox={`${-MARGIN} ${-MARGIN} ${SIZE} ${SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <circle cx={AVATAR_GRID / 2} cy={AVATAR_GRID / 2} r={SIZE / 2} />
      <path d={d} />
    </svg>
  );
}
