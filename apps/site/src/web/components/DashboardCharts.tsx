import type { DashboardDayJson } from "@wordless/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { labelledDays, niceAxis, shortDay } from "../chart.ts";

/** The dashboard's charts (§8.8): one series each, drawn in ink, so they need no legend; the title names them. */

const EXACT = new Intl.NumberFormat("en-GB");
const HEIGHT = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

type Metric = Exclude<keyof DashboardDayJson, "date">;

/** The width the chart gets, so text in the SVG stays its own size (no `viewBox` scaling). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column from the baseline up, its top corners rounded, square at the baseline. */
function column(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type Frame = {
  days: DashboardDayJson[];
  metric: Metric;
  title: string;
  /** The figure in the corner: the range's sum, or the last day's value. */
  headline: number;
  kind: "columns" | "area";
};

/** One chart in a panel: title and headline, hairline grid, the marks, day labels, and a tooltip on hover. */
export function DayChart({ days, metric, title, headline, kind }: Frame) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const values = days.map((day) => day[metric]);
  const axis = niceAxis(Math.max(0, ...values));
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / days.length;
  const xMid = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + plotH - (v / axis.top) * plotH;
  const shown = labelledDays(days.length, Math.floor(plotW / 44));

  const barW = Math.max(1, Math.min(BAR_MAX, band - GAP));
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${xMid(i)},${y(v)}`).join("");
  const area = `${line}L${xMid(days.length - 1)},${y(0)}L${xMid(0)},${y(0)}Z`;
  const last = values.length - 1;
  const hovered = hover === null ? undefined : days[hover];

  return (
    <figure className="panel cut flex min-w-0 flex-col gap-2 px-4 pt-3 pb-2 [--cut:12px]">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{title}</span>
        <span className="text-xl font-semibold">{EXACT.format(headline)}</span>
      </figcaption>
      <div ref={ref} className="relative overflow-hidden" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={title} className="block">
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[11px] tabular-nums"
              >
                {tick}
              </text>
            </g>
          ))}
          {days.map((day, i) =>
            shown.has(i) ? (
              <text
                key={day.date}
                x={xMid(i)}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted text-[11px] tabular-nums"
              >
                {shortDay(day.date)}
              </text>
            ) : null,
          )}

          {kind === "columns" ? (
            values.map((v, i) =>
              v > 0 ? (
                <path
                  key={days[i]!.date}
                  d={column(xMid(i) - barW / 2, y(v), barW, y(0) - y(v))}
                  className={hover === null || hover === i ? "fill-ink" : "fill-ink/35"}
                />
              ) : null,
            )
          ) : (
            <>
              <path d={area} className="fill-ink/10" />
              <path
                d={line}
                fill="none"
                className="stroke-ink"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {hover !== null && (
                <line
                  x1={xMid(hover)}
                  x2={xMid(hover)}
                  y1={PAD.top}
                  y2={y(0)}
                  className="stroke-edge"
                  strokeWidth={1}
                />
              )}
              <circle
                cx={xMid(hover ?? last)}
                cy={y(values[hover ?? last]!)}
                r={4}
                className="fill-ink stroke-panel"
                strokeWidth={2}
              />
            </>
          )}

          {/* Hit targets: the whole height of each day's band, bigger than any mark. */}
          {days.map((day, i) => (
            <rect
              key={day.date}
              x={PAD.left + band * i}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
        {hovered !== undefined && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 border border-line bg-surface px-2 py-1 text-xs whitespace-nowrap shadow-sm"
            style={{ left: Math.min(Math.max(xMid(hover), 48), width - 48) }}
          >
            <span className="text-muted">{hovered.date}</span>{" "}
            <span className="font-semibold tabular-nums">{hovered[metric]}</span>
          </div>
        )}
      </div>
    </figure>
  );
}

const COLUMNS: [Metric, string][] = [
  ["new_bots", "new bots"],
  ["total_bots", "all bots"],
  ["posts", "posts"],
  ["active_bots", "bots posting"],
  ["reactions", "reactions"],
];

/** Every number the charts draw, as a table: the view that needs neither colour nor a pointer. */
export function DayTable({ days }: { days: DashboardDayJson[] }) {
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted hover:text-ink">table view</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full tabular-nums">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-4 font-normal">day (UTC)</th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} className="py-1 pr-4 text-right font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.date} className="border-t border-line">
                <td className="py-1 pr-4">{day.date}</td>
                {COLUMNS.map(([key]) => (
                  <td key={key} className="py-1 pr-4 text-right">
                    {day[key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
