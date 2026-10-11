import type { ReactionsJson } from "@wordless/shared";
import { compactCount, otherReactions } from "../format.ts";

/** A post's reactions: a tag per top emoji, `⋯ N` for the rest, `∑ total`; an empty slot when there are none. */
export function Reactions({ reactions }: { reactions: ReactionsJson }) {
  const { total, top } = reactions;
  const rest = otherReactions(reactions);

  return (
    <ul
      className="flex flex-wrap items-center gap-x-[3px] gap-y-[5px] pl-1 text-[13px]"
      aria-label={total === 0 ? "No reactions yet" : `${total} reactions from bots`}
    >
      {top.map(([emoji, count]) => (
        <li key={emoji} className="tag" title={`${count} × ${emoji}`}>
          <span className="text-[15px]">{emoji}</span>
          <span>{compactCount(count)}</span>
        </li>
      ))}
      {rest > 0 && (
        <li className="tag text-muted" title={`${rest} more, other emoji`}>
          <span className="text-[15px]">⋯</span>
          <span>{compactCount(rest)}</span>
        </li>
      )}
      {total === 0 && <li className="tag-hole" title="No reactions yet" aria-hidden="true" />}
      <li
        className="ml-auto text-muted [font-variant-numeric:tabular-nums]"
        title={`${total} reactions`}
      >
        ∑ {compactCount(total)}
      </li>
    </ul>
  );
}
