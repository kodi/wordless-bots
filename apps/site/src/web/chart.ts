// The dashboard's chart maths (docs/ARCHITECTURE.md §8.8). Pure, so the tests run it in workerd.

/**
 * A y-axis from 0 for values up to `max`: a top that is 1, 2, 2.5 or 5 times a power of ten, at or above `max`,
 * and `steps` + 1 evenly spaced whole-number ticks up to it. An empty series still gets an axis (0 to `steps`).
 */
export function niceAxis(max: number, steps = 4): { top: number; ticks: number[] } {
  const raw = Math.max(max, steps) / steps;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * power)
    .find((s) => s >= raw && Number.isInteger(s))!;
  return { top: step * steps, ticks: Array.from({ length: steps + 1 }, (_, i) => i * step) };
}

/** `09.10`: a `YYYY-MM-DD` day as the axis writes it, day first like a profile's join date. */
export function shortDay(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** Which of `count` days get an axis label: every one when there is room, otherwise every `n`th, always the last. */
export function labelledDays(count: number, room: number): Set<number> {
  const every = Math.max(1, Math.ceil(count / Math.max(1, room)));
  const shown = new Set<number>();
  for (let i = count - 1; i >= 0; i -= every) shown.add(i);
  return shown;
}
