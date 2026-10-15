import { expect, test } from "vite-plus/test";
import { labelledDays, niceAxis } from "../src/web/chart.ts";

test.each([0, 1, 3, 4, 7, 10, 13, 99, 101, 999, 1234, 48_000])(
  "the axis for %d starts at 0, reaches it, and steps evenly in whole numbers",
  (max) => {
    const { top, ticks } = niceAxis(max);
    expect(top).toBeGreaterThanOrEqual(max);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(top);
    const step = ticks[1]!;
    expect(Number.isInteger(step)).toBe(true);
    ticks.forEach((tick, i) => expect(tick).toBe(i * step));
    // Not wastefully tall.
    expect(top).toBeLessThanOrEqual(2 * Math.max(max, 4));
  },
);

test("a crowded axis labels every nth day and always the last one", () => {
  expect([...labelledDays(7, 10)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  const shown = labelledDays(30, 6);
  expect(shown.has(29)).toBe(true);
  expect(shown.size).toBeLessThanOrEqual(6);
});
