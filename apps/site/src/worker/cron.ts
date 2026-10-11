// The `scheduled` handler's work, every minute (docs/ARCHITECTURE.md §10.3).
import {
  RECONCILE_BOTS_PER_STATEMENT,
  RECONCILE_HOUR_UTC,
  RECOVERY_WINDOW_S,
} from "@wordless/shared";
import { deleteStaleRecoveryTokens, reconcileBotCounters } from "./db/maintenance.ts";
import { writeDb } from "./db/queries.ts";
import { rebuildLatest, rebuildTop24 } from "./db/snapshots.ts";

/** Which of the slower jobs a run at `scheduledTime` (unix ms) is due to do, by its UTC clock. */
export function dueJobs(scheduledTime: number): { hourly: boolean; nightly: boolean } {
  const at = new Date(scheduledTime);
  const hourly = at.getUTCMinutes() === 0;
  return { hourly, nightly: hourly && at.getUTCHours() === RECONCILE_HOUR_UTC };
}

/**
 * One cron run: rebuild both snapshots, and on the hour delete stale recovery tokens, and at night
 * reconcile the bots' counters. The jobs are independent, so one failing doesn't stop the others; each
 * failure is logged and the run then fails, so Workers records it as a failed invocation.
 *
 * It calls `rebuildLatest()`, not `rebuildAndPurgeLatest()`: there is no request here, so no origin to
 * name the cache entry by. The colo that serves reads converges within the TTL (§10.2). Refreshing the
 * reaction counts in `latest` is the point of the rebuild, since a reaction doesn't rebuild it (§7.2).
 *
 * A job skipped because a run was missed is picked up by the next run that is due, an hour or a day
 * later. All of them are repairs or cleanups, safe to run late and to repeat.
 */
export async function runScheduled(env: Env, scheduledTime: number): Promise<void> {
  const db = writeDb(env);
  const due = dueJobs(scheduledTime);
  const jobs: [name: string, run: () => Promise<unknown>][] = [
    ["rebuild latest", () => rebuildLatest(db)],
    ["rebuild top24", () => rebuildTop24(db)],
  ];
  if (due.hourly) {
    jobs.push([
      "delete stale recovery tokens",
      () => deleteStaleRecoveryTokens(db, Date.now(), RECOVERY_WINDOW_S * 1000),
    ]);
  }
  if (due.nightly) {
    jobs.push([
      "reconcile bot counters",
      async () => {
        const fixed = await reconcileBotCounters(db, RECONCILE_BOTS_PER_STATEMENT);
        if (fixed > 0) console.warn(`cron: reconcile corrected the counters of ${fixed} bots`);
      },
    ]);
  }

  const results = await Promise.allSettled(jobs.map(([, run]) => run()));
  const failed = results.flatMap((result, n) => {
    if (result.status === "fulfilled") return [];
    console.error(`cron: ${jobs[n]![0]} failed`, result.reason);
    return [jobs[n]![0]];
  });
  if (failed.length > 0) throw new Error(`cron: ${failed.join(", ")} failed`);
}
