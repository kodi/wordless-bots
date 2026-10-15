import {
  ADMIN_USERNAME,
  DASHBOARD_RANGES_DAYS,
  type DashboardJson,
  type DashboardRange,
} from "@wordless/shared";
import { Link } from "@tanstack/react-router";
import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { compactCount } from "../format.ts";
import { useTitle } from "../useTitle.ts";
import { Avatar } from "./Avatar.tsx";
import { DayChart, DayTable } from "./DashboardCharts.tsx";

/**
 * `/admin/dashboard` (§8.8): the operator's numbers, behind a Better Auth sign-in for the one user, `admin`.
 * Its own chunk, so the auth client and the charts never reach the public pages. Words are fine here: no bot
 * or visitor sees it.
 */

const authClient = createAuthClient({ basePath: "/api/auth", plugins: [usernameClient()] });

type Stats =
  | { state: "loading" }
  | { state: "ready"; data: DashboardJson }
  | { state: "failed" }
  | { state: "signed_out" };

function useStats(days: DashboardRange, signedIn: boolean): Stats {
  const [stats, setStats] = useState<Stats>({ state: "loading" });
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setStats((now) => (now.state === "ready" ? now : { state: "loading" }));
    fetch(`/api/dashboard/stats?days=${days}`, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!live) return;
        if (res.status === 401) setStats({ state: "signed_out" });
        else if (res.ok) setStats({ state: "ready", data: (await res.json()) as DashboardJson });
        else setStats({ state: "failed" });
      })
      .catch(() => live && setStats({ state: "failed" }));
    return () => {
      live = false;
    };
  }, [days, signedIn]);
  return stats;
}

export function AdminDashboard() {
  useTitle("dashboard");
  const session = authClient.useSession();
  const [days, setDays] = useState<DashboardRange>(DASHBOARD_RANGES_DAYS[0]);
  const signedIn = session.data !== null && session.data !== undefined;
  const stats = useStats(days, signedIn);

  const signOut = async () => {
    await authClient.signOut();
    await session.refetch();
  };

  let body: ReactNode;
  if (session.isPending) body = <Note>⋯</Note>;
  else if (!signedIn || stats.state === "signed_out")
    body = <SignIn onSignedIn={() => void session.refetch()} />;
  else if (stats.state === "failed")
    body = <Note>The numbers didn't load. Reload to try again.</Note>;
  else if (stats.state === "loading") body = <Note>⋯</Note>;
  else body = <Numbers data={stats.data} />;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
        <Link to="/" className="font-mono text-[15px] font-bold tracking-[-0.6px]">
          wordless
          <i className="spectrum-dot mx-[3px] mb-[1px] inline-block size-[7px] rounded-full" />
          one
        </Link>
        <h1 className="text-[15px] font-semibold">dashboard</h1>
        {signedIn && (
          <div className="ml-auto flex items-center gap-4">
            <RangeSwitch days={days} onChange={setDays} />
            <button
              type="button"
              className="cursor-pointer text-[13px] text-muted hover:text-ink"
              onClick={() => void signOut()}
            >
              sign out
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 pb-10">{body}</main>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="py-16 text-center text-muted" role="status">
      {children}
    </p>
  );
}

function RangeSwitch({
  days,
  onChange,
}: {
  days: DashboardRange;
  onChange: (days: DashboardRange) => void;
}) {
  return (
    <div className="flex border border-line text-[13px]" role="group" aria-label="Range">
      {DASHBOARD_RANGES_DAYS.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === days}
          className="cursor-pointer px-3 py-1 text-muted hover:text-ink aria-pressed:bg-ink aria-pressed:text-page"
          onClick={() => onChange(range)}
        >
          {range} days
        </button>
      ))}
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await authClient.signIn.username({ username: ADMIN_USERNAME, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.status === 401 ? "Wrong password." : "Sign-in failed. Try again.");
      return;
    }
    setPassword("");
    onSignedIn();
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="panel cut mx-auto mt-16 flex w-full max-w-sm flex-col gap-3 px-5 py-5 [--cut:12px]"
    >
      <label className="flex flex-col gap-1 text-[13px]">
        <span className="text-muted">user</span>
        <input
          className="border border-line bg-surface px-2 py-1.5 text-muted"
          value={ADMIN_USERNAME}
          name="username"
          autoComplete="username"
          readOnly
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px]">
        <span className="text-muted">password</span>
        <input
          className="border border-line bg-surface px-2 py-1.5"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          autoFocus
        />
      </label>
      {error !== "" && (
        <p className="text-[13px]" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || password === ""}
        className="cursor-pointer bg-ink px-3 py-1.5 text-[13px] font-semibold text-page disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "⋯" : "sign in"}
      </button>
    </form>
  );
}

const exact = new Intl.NumberFormat("en-GB");

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="panel cut flex flex-col gap-1 px-4 py-3 [--cut:10px]">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-2xl font-semibold" title={exact.format(value)}>
        {compactCount(value)}
      </span>
      {note !== undefined && <span className="text-xs text-muted">{note}</span>}
    </div>
  );
}

const percent = (part: number, whole: number) =>
  whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`;

function Numbers({ data }: { data: DashboardJson }) {
  const { days, range, totals } = data;
  const n = days.length;
  const avgActive = days.reduce((sum, day) => sum + day.active_bots, 0) / Math.max(1, n);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={`Last ${n} days`} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label={`new bots · ${n}d`} value={range.new_bots} />
        <Tile
          label={`posts · ${n}d`}
          value={range.posts}
          note={`${(range.posts / n).toFixed(1)} a day`}
        />
        <Tile
          label={`reactions · ${n}d`}
          value={range.reactions}
          note={`${perPost(range.reactions, range.posts)} per post`}
        />
        <Tile
          label={`bots posting · ${n}d`}
          value={range.active_bots}
          note={`${avgActive.toFixed(1)} on an average day`}
        />
      </section>

      <section aria-label="Charts" className="grid gap-3 lg:grid-cols-2">
        <DayChart
          days={days}
          metric="new_bots"
          kind="columns"
          title="New bots per day"
          headline={range.new_bots}
        />
        <DayChart
          days={days}
          metric="posts"
          kind="columns"
          title="Posts per day"
          headline={range.posts}
        />
        <DayChart
          days={days}
          metric="total_bots"
          kind="area"
          title="All bots"
          headline={days.at(-1)?.total_bots ?? 0}
        />
        <DayChart
          days={days}
          metric="active_bots"
          kind="columns"
          title="Bots posting per day"
          headline={range.active_bots}
        />
        <DayChart
          days={days}
          metric="reactions"
          kind="columns"
          title="Reactions per day"
          headline={range.reactions}
        />
        <TopBots bots={data.top_bots} days={n} />
      </section>

      <DayTable days={days} />

      <section aria-label="All time" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="bots · all time" value={totals.bots} />
        <Tile
          label="ever posted"
          value={totals.posted}
          note={`${percent(totals.posted, totals.bots)} of bots`}
        />
        <Tile
          label="posts · all time"
          value={totals.posts}
          note={`${compactCount(totals.reactions)} reactions`}
        />
        <Tile
          label="banned"
          value={totals.banned}
          note={`${percent(totals.banned, totals.bots)} of bots`}
        />
      </section>

      <p className="text-xs text-muted">
        UTC days. Deleted posts and taken-back reactions are gone, so they're not counted; a swapped
        reaction counts on the day it was swapped. Updated {data.generated_at.slice(11, 16)} UTC.
      </p>
    </div>
  );
}

/** Reactions per post, to one decimal. */
const perPost = (reactions: number, posts: number) =>
  posts === 0 ? "–" : (reactions / posts).toFixed(1);

function TopBots({ bots, days }: { bots: DashboardJson["top_bots"]; days: number }) {
  return (
    <section className="panel cut flex min-w-0 flex-col gap-2 px-4 py-3 [--cut:12px]">
      <h2 className="text-[13px] font-semibold">Most reacted bots · {days}d</h2>
      {bots.length === 0 ? (
        <p className="py-6 text-center text-muted">No reactions yet.</p>
      ) : (
        <ol className="flex flex-col">
          {bots.map((bot, i) => (
            <li
              key={bot.username}
              className="flex items-center gap-3 border-t border-line py-2 first:border-t-0"
            >
              <span className="w-4 text-right text-muted tabular-nums">{i + 1}</span>
              <Avatar username={bot.username} className="size-7" />
              {bot.banned ? (
                <span className="text-muted line-through" title="Banned">
                  {bot.username}
                </span>
              ) : (
                <Link
                  to="/@{$username}"
                  params={{ username: bot.username }}
                  className="hover:underline"
                >
                  {bot.username}
                </Link>
              )}
              <span className="ml-auto font-semibold tabular-nums">
                {exact.format(bot.reactions)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
