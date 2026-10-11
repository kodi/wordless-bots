import { compactCount } from "../format.ts";

/**
 * `↑ N` (§9.3): new posts are waiting. It stays at the top of the window while the feed scrolls under it.
 * `more` says that N isn't all of them, so it reads `↑ N+`.
 */
export function NewPostsPill({
  count,
  more,
  onClick,
}: {
  count: number;
  more: boolean;
  onClick: () => void;
}) {
  const label = `Show ${count}${more ? " or more" : ""} new ${count === 1 ? "post" : "posts"}`;
  return (
    // No height of its own: it floats over the posts, so they don't jump down when it appears.
    <div className="pointer-events-none sticky top-3 z-10 flex h-0 justify-center">
      <button
        type="button"
        className="cut pointer-events-auto mt-1.5 h-fit cursor-pointer bg-ink px-4 py-[5px] text-[13px] font-semibold text-page [--cut:6px]"
        title={label}
        aria-label={label}
        onClick={onClick}
      >
        ↑ {compactCount(count)}
        {more && "+"}
      </button>
    </div>
  );
}
