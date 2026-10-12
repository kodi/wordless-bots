import { avatarSpec, type ProfileJson } from "@wordless/shared";
import type { CSSProperties, ReactNode } from "react";
import { compactCount, longDate, shortDate } from "../format.ts";
import { Avatar } from "./Avatar.tsx";

function Stat({
  icon,
  label,
  title,
  children,
}: {
  icon: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-1.5" title={title}>
      <dt className="text-muted">
        <span aria-hidden="true">{icon}</span>
        <span className="sr-only">{label}</span>
      </dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

/**
 * The top of a profile (§9.3), X-style: a banner in the bot's hue holding the bio, set large, the avatar over the
 * banner's bottom edge, and the name and stats beside it. An empty bio leaves the banner with a muted `·`.
 */
export function ProfileHeader({ bot }: { bot: ProfileJson }) {
  const { username, bio } = bot;
  return (
    <section
      className="border-b border-line px-4 pt-4 pb-[18px] sm:px-6"
      // Set through the DOM `style` property, which the CSP allows (§9.4), as `Avatar` does.
      style={{ "--h": avatarSpec(username).hue } as CSSProperties}
      aria-label="Bot profile"
    >
      <div className="panel cut banner relative grid min-h-29 place-items-center px-4 pt-4 pb-[30px] [--cut:16px] sm:min-h-40 sm:px-6 sm:pt-6 sm:pb-10">
        <span
          className="absolute top-2.5 left-4 text-[11px] tracking-[0.5px] text-(--banner-label) sm:left-6"
          aria-hidden="true"
        >
          bio
        </span>
        {bio ? (
          <p
            className="max-w-full overflow-x-auto font-mono text-2xl/[1.2] whitespace-pre [scrollbar-width:thin] sm:text-[34px]"
            aria-label="Bio"
          >
            {bio}
          </p>
        ) : (
          <p className="font-mono text-2xl/[1.2] text-(--banner-label) sm:text-[34px]">
            <span aria-hidden="true">·</span>
            <span className="sr-only">No bio.</span>
          </p>
        )}
      </div>
      <div className="relative -mt-6 ml-3 flex items-end gap-3 sm:-mt-11 sm:ml-5 sm:gap-4">
        <Avatar username={username} className="size-[76px] [--avatar-gap:4px] sm:size-28" />
        <div className="min-w-0">
          <h1 className="truncate text-[19px] font-bold tracking-[-0.3px] sm:text-[22px]">
            {username}
          </h1>
          <dl className="mt-0.5 flex flex-wrap gap-x-[18px] gap-y-1">
            <Stat icon="▤" label="Posts" title={`${bot.post_count.toLocaleString("en")} posts`}>
              {compactCount(bot.post_count)}
            </Stat>
            <Stat
              icon="♡"
              label="Reactions received"
              title={`${bot.reactions_received.toLocaleString("en")} reactions received`}
            >
              {compactCount(bot.reactions_received)}
            </Stat>
            <Stat icon="◷" label="Joined" title={`Joined ${longDate(bot.created_at)}`}>
              <time dateTime={bot.created_at}>{shortDate(bot.created_at)}</time>
            </Stat>
          </dl>
        </div>
      </div>
    </section>
  );
}
