import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatShortDate, formatWeekdayDate } from "@/domain/dates";
import { compactCount, formatCount } from "@/domain/numbers";
import { plural } from "@/domain/plural";
import type { UsageHeatmap } from "@/domain/golive-types";
import { ChartKeys } from "./chart-keys";
import { hbarsMinHeight } from "./geometry";

/*
 * Small SVG charts drawn from plain numbers, no chart library, all server-rendered. Each mark that
 * can be read carries a shadcn Tooltip.
 *
 * No value is hover-only. In the heatmap, the stacked bars and the rate line, the readable marks are one
 * Tab stop with arrow keys between them (`ChartKeys`): each shows its tooltip on focus and names its
 * values. Every chart whose values aren't printed is followed by an sr-only table of them (`ChartTable`).
 *
 * Colour: amounts (the heatmap, the single-series charts) use the one teal family (brand-1…4) and the
 * taupe "empty" step. Series (which channel, which version) use series-1…4: distinct hues in a fixed
 * order, so they are told apart by more than lightness, with a legend that names them.
 *
 * Sizing: a chart's HEIGHT is fixed in px (so nothing shifts while the page streams) and its WIDTH is
 * whatever its card gives it. Marks are placed in percentages of that width and in px of the height, and
 * the axis text is HTML or SVG text at a fixed 11px, so the type never scales with the card. The
 * only scaled drawings are the gauge and the heatmap's squares, which carry no text.
 */

/** The props of a chart's `i`th readable mark, for `ChartKeys`: the first is the chart's one Tab stop. */
function markProps(i: number, label: string) {
  return { "data-mark": "", tabIndex: i === 0 ? 0 : -1, role: "img", "aria-label": label } as const;
}

/** A mark's hit area: invisible, tinted while hovered or focused (the focus ring is the global one). */
const HIT = "fill-transparent hover:fill-foreground/5 focus-visible:fill-foreground/5";

/** A chart's values as a table only a screen reader reads, after the chart. */
function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: { key: string; head: string; cells: string[] }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.head}</th>
            {r.cells.map((c, i) => (
              <td key={i}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tip({
  children,
  title,
  value,
}: {
  children: React.ReactElement<Record<string, unknown>>;
  title: string;
  value?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>
        <span className="flex flex-col gap-0.5">
          <span className="text-background/70">{title}</span>
          {value ? <span className="tabular-nums">{value}</span> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Gauge ────────────────────────────────────────────────────────────────────

/** A semicircle with a thick round-capped stroke. `children` sits in the bowl. */
export function Gauge({
  pct,
  label,
  className,
  children,
}: {
  pct: number | null;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const fill = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className={cn("relative mx-auto w-full max-w-[15rem]", className)}>
      <svg viewBox="0 0 240 136" role="img" aria-label={label} className="block w-full">
        <path d="M24 120 A96 96 0 0 1 216 120" fill="none" strokeWidth={26} strokeLinecap="round" className="stroke-hairline-strong" />
        {fill > 0 ? (
          <path
            d="M24 120 A96 96 0 0 1 216 120"
            pathLength={100}
            strokeDasharray={`${fill} 100`}
            fill="none"
            strokeWidth={26}
            strokeLinecap="round"
            className="stroke-brand-4"
          />
        ) : null}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-tight">{children}</div>
    </div>
  );
}

// ── Horizontal bars ──────────────────────────────────────────────────────────

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** 0–1 of the card's total; printed inside the bar. */
  share: number;
  href?: string;
}

/** Bars sized to the largest row, with the share inside, like Flow's "Desktop usage". */
export function HBars({
  rows,
  className,
  labelSide = "top",
  minRows,
}: {
  rows: BarRow[];
  className?: string;
  labelSide?: "right" | "top";
  /** Keep the list as tall as this many rows (labelled bars), so the card doesn't change height with the data. */
  minRows?: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-4 p-0", className)} style={minRows ? { minHeight: hbarsMinHeight(minRows) } : undefined}>
      {rows.map((r, i) => {
        const pct = Math.round(r.share * 100);
        const width = Math.max(14, (r.value / max) * 100);
        const bar = (
          <Tip title={r.label} value={`${plural(r.value, "render")} · ${pct}%`}>
            <div
              className={cn(
                "flex h-9 items-center rounded-md px-3 text-[14px] font-medium tabular-nums",
                // White on the darkest step, ink on the lighter one: both clear 4.5:1.
                i === 0 ? "bg-brand-4 text-white" : "bg-brand-3 text-text",
              )}
              style={{ width: `${width}%` }}
            >
              {pct}%
            </div>
          </Tip>
        );
        const name = r.href ? (
          <Link href={r.href as Route} className="truncate rounded-sm text-[13px] text-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {r.label}
          </Link>
        ) : (
          <span className="truncate text-[13px] text-text">{r.label}</span>
        );
        return labelSide === "top" ? (
          <li key={r.key} className="flex min-w-0 flex-col gap-1.5">
            <span className="flex h-[1.125rem] min-w-0 items-baseline justify-between gap-3 leading-[1.125rem]">
              {name}
              <span className="shrink-0 text-[13px] text-text-muted tabular-nums">{formatCount(r.value)}</span>
            </span>
            {bar}
          </li>
        ) : (
          <li key={r.key} className="flex min-w-0 items-center gap-4">
            <div className="w-[55%] shrink-0">{bar}</div>
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="caps-label shrink-0 tabular-nums">{formatCount(r.value)}</span>
              {name}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Calendar heatmap ─────────────────────────────────────────────────────────

const HEAT_CELL = 18;
const HEAT_GAP = 4;
const HEAT_PITCH = HEAT_CELL + HEAT_GAP;
const HEAT_FILL = ["fill-heat-empty", "fill-brand-1", "fill-brand-2", "fill-brand-3", "fill-brand-4"] as const;
const HEAT_BG = ["bg-heat-empty", "bg-brand-1", "bg-brand-2", "bg-brand-3", "bg-brand-4"] as const;
const WEEKDAY_LABELS: [number, string][] = [
  [1, "Mon"],
  [3, "Wed"],
  [5, "Fri"],
];

/** The heatmap's height for a given column count, as the width the squares are drawn at: used by the skeleton too. */
export function heatmapBox(weeks: number) {
  return { width: weeks * HEAT_PITCH - HEAT_GAP, height: 7 * HEAT_PITCH - HEAT_GAP };
}

/**
 * A column per week, a row per weekday (Sunday on top), rounded squares. The squares scale with the
 * card; the month and weekday labels are HTML laid out by percentage, so their type stays 11px.
 * The days in range run unbroken in date order, so from the keyboard Up and Down are a day and Left and
 * Right a week.
 */
export function Heatmap({ heat }: { heat: UsageHeatmap }) {
  const weeks = heat.weeks.length;
  const { width, height } = heatmapBox(weeks);
  /** Each day in range, by date: its place among the marks. */
  const order = new Map(
    heat.weeks
      .flat()
      .filter((c) => c.inRange)
      .map((c, i) => [c.date, i]),
  );
  return (
    <>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] grid-rows-[1.25rem_auto]">
        <div />
        <div aria-hidden className="relative h-5">
          {heat.months.map((m) => (
            <span key={`${m.label}-${m.week}`} className="absolute top-0 text-[11px] leading-4 text-text-muted" style={{ left: `${((m.week * HEAT_PITCH) / width) * 100}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        <div aria-hidden className="relative">
          {WEEKDAY_LABELS.map(([row, label]) => (
            <span key={label} className="absolute left-0 -translate-y-1/2 text-[11px] leading-4 text-text-muted" style={{ top: `${((row * HEAT_PITCH + HEAT_CELL / 2) / height) * 100}%` }}>
              {label}
            </span>
          ))}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Daily renders, last 18 weeks" className="block h-auto w-full">
          <ChartKeys rows={7}>
            {heat.weeks.flatMap((week, col) =>
              week.map((cell, row) => {
                if (!cell.inRange) return null;
                const value = cell.count === 0 ? "No renders" : plural(cell.count, "render");
                return (
                  <Tip key={cell.date} title={formatWeekdayDate(cell.date)} value={value}>
                    <rect
                      {...markProps(order.get(cell.date) ?? -1, `${formatWeekdayDate(cell.date)}: ${value}`)}
                      x={col * HEAT_PITCH}
                      y={row * HEAT_PITCH}
                      width={HEAT_CELL}
                      height={HEAT_CELL}
                      rx={4}
                      className={HEAT_FILL[cell.level]}
                    />
                  </Tip>
                );
              }),
            )}
          </ChartKeys>
        </svg>
      </div>
      <ChartTable
        caption="Renders by week"
        columns={["Week of", "Renders", "Busiest day"]}
        rows={heat.weeks.map((week) => {
          const days = week.filter((c) => c.inRange);
          const busiest = days.reduce<(typeof days)[number] | null>((b, c) => (c.count > (b?.count ?? 0) ? c : b), null);
          return {
            key: week[0]!.date,
            head: formatShortDate(week[0]!.date),
            cells: [formatCount(days.reduce((sum, c) => sum + c.count, 0)), busiest ? `${formatShortDate(busiest.date)}, ${formatCount(busiest.count)}` : "None"],
          };
        })}
      />
    </>
  );
}

export function HeatLegend({ thresholds, className }: { thresholds: UsageHeatmap["thresholds"]; className?: string }) {
  const range = (lo: number, hi: number) => (hi <= lo ? String(lo) : `${lo} to ${hi}`);
  const ranges = [
    "No",
    range(1, thresholds[0]),
    range(thresholds[0] + 1, thresholds[1]),
    range(thresholds[1] + 1, thresholds[2]),
    range(thresholds[2] + 1, thresholds[3]),
  ];
  // "No renders in a day", "1 render in a day", "2 to 9 renders in a day".
  const sentence = (l: number) => `${ranges[l]} ${ranges[l] === "1" ? "render" : "renders"} in a day`;
  return (
    <div className={cn("flex items-center gap-2 text-[13px] text-text-muted", className)}>
      Less
      {HEAT_BG.map((bg, l) => (
        <Tip key={bg} title={sentence(l)}>
          <span aria-hidden className={cn("size-4 rounded-[4px]", bg)} />
        </Tip>
      ))}
      More
    </div>
  );
}

// ── Shared axes ──────────────────────────────────────────────────────────────

const X_AXIS = 24;
const PLOT_TOP = 8;
const GUTTER = "w-10";

/** Four gaps of 0.25/0.5/1/1.5/2/2.5 × a power of ten: tick labels stay round. */
function niceMax(v: number) {
  if (v <= 0) return 4; // no data: 0, 1, 2, 3, 4
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const max = ([1, 2, 4, 6, 8, 10].find((s) => n <= s) ?? 10) * pow;
  // Under 100 the ticks must still be whole numbers: a multiple of four.
  return max < 100 ? Math.ceil(max / 4) * 4 : max;
}

/** The y axis's tick labels: drawn for the eye; the chart's table carries the numbers for a screen reader. */
function YLabels({ ticks, y, format }: { ticks: number[]; y: (v: number) => number; format: (v: number) => string }) {
  return (
    <div aria-hidden className={cn("relative shrink-0", GUTTER)}>
      {ticks.map((t) => (
        <span key={t} className="absolute right-2 -translate-y-1/2 text-[11px] leading-4 text-text-muted tabular-nums" style={{ top: y(t) }}>
          {format(t)}
        </span>
      ))}
    </div>
  );
}

// ── Stacked bars ─────────────────────────────────────────────────────────────

export interface StackSeries {
  label: string;
  /** Both spellings written out so the class scanner sees them: one of the series-1…5 hues. */
  fill: string;
  bg: string;
}

/**
 * The series hues in their fixed order, both spellings written out so the class scanner sees them. Five:
 * one per channel (decision 0014).
 */
export const SERIES = [
  { fill: "fill-series-1", bg: "bg-series-1" },
  { fill: "fill-series-2", bg: "bg-series-2" },
  { fill: "fill-series-3", bg: "bg-series-3" },
  { fill: "fill-series-4", bg: "bg-series-4" },
  { fill: "fill-series-5", bg: "bg-series-5" },
] as const;

export interface StackDatum {
  /** The x tick ("Nov 3"). */
  label: string;
  /** The tooltip's title ("Week of Nov 3"). */
  title: string;
  parts: number[];
  /** The period isn't over yet: its column is drawn lighter and the tooltip says "so far". */
  partial?: boolean;
}

/**
 * Time as stacked columns, one series per hue, with a `Legend` beside it. Hover or focus a column for its
 * numbers; its table lists them all. The y axis has four gaps.
 */
export function StackedBars({
  data,
  series,
  height = 220,
  tickEvery = 2,
  label,
  periodHeader,
}: {
  data: StackDatum[];
  series: StackSeries[];
  height?: number;
  tickEvery?: number;
  label: string;
  /** The table's first column, whose rows are headed by each datum's `label` ("Week of" … "Nov 3"). */
  periodHeader: string;
}) {
  const plotH = height - X_AXIS - PLOT_TOP;
  const total = (d: StackDatum) => d.parts.reduce((a, b) => a + b, 0);
  const max = niceMax(Math.max(0, ...data.map(total)));
  const n = Math.max(1, data.length);
  const y = (v: number) => PLOT_TOP + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const col = 100 / n;
  const barW = col * 0.62;
  const title = (d: StackDatum) => (d.partial ? `${d.title} (so far)` : d.title);
  const values = (d: StackDatum) => series.map((s, k) => `${s.label} ${formatCount(d.parts[k] ?? 0)}`).join(", ");
  return (
    <>
      <div className="flex" style={{ height }}>
        <YLabels ticks={ticks} y={y} format={compactCount} />
        <svg role="group" aria-label={label} width="100%" height={height} className="block min-w-0 flex-1">
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100%" y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-hairline-strong" : "stroke-hairline"} strokeWidth={1} />
          ))}
          {data.map((d, i) => {
            let acc = 0;
            const x = i * col + (col - barW) / 2;
            const top = d.parts.map((p, s) => (p > 0 ? s : -1)).filter((s) => s >= 0).pop();
            return (
              <g key={`${d.label}-${i}`}>
                {d.parts.map((p, s) => {
                  const yTop = y(acc + p);
                  const h = y(acc) - yTop;
                  acc += p;
                  return h > 0 ? (
                    <rect key={s} x={`${x}%`} y={yTop} width={`${barW}%`} height={h} rx={s === top ? 3 : 0} className={cn(series[s]?.fill, d.partial && "opacity-55")} />
                  ) : null;
                })}
                {i % tickEvery === 0 ? (
                  <text aria-hidden x={`${i * col + col / 2}%`} y={height - 6} textAnchor="middle" className="fill-text-muted text-[11px]">
                    {d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <ChartKeys>
            {data.map((d, i) => (
              <Tip
                key={`${d.label}-${i}`}
                title={title(d)}
                value={
                  <span className="flex flex-col gap-0.5">
                    {series.map((s, k) => (
                      <span key={s.label}>
                        {s.label}: {formatCount(d.parts[k] ?? 0)}
                      </span>
                    ))}
                  </span>
                }
              >
                <rect {...markProps(i, `${title(d)}: ${values(d)}`)} x={`${i * col}%`} y={0} width={`${col}%`} height={PLOT_TOP + plotH} className={HIT} />
              </Tip>
            ))}
          </ChartKeys>
        </svg>
      </div>
      <ChartTable
        caption={label}
        columns={[periodHeader, ...series.map((s) => s.label), "Total"]}
        rows={data.map((d, i) => ({
          key: `${d.label}-${i}`,
          head: d.partial ? `${d.label} (so far)` : d.label,
          cells: [...series.map((_, k) => formatCount(d.parts[k] ?? 0)), formatCount(total(d))],
        }))}
      />
    </>
  );
}

/** Names each series beside its swatch, in stacking order: the swatch is the bars' own shape and hue. */
export function Legend({ series, className }: { series: StackSeries[]; className?: string }) {
  return (
    <ul className={cn("m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[13px] text-text-muted", className)}>
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-[3px]", s.bg)} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// ── Line (rate over time) ────────────────────────────────────────────────────

export interface RatePoint {
  /** The tooltip's title. */
  title: string;
  /** Percent, 0–100. */
  pct: number;
  /** "3 of 1,204 renders failed" / "No renders". */
  detail: string;
}

/**
 * A rate per day as a line over a soft area, the worst day marked. Axis labels are fixed-size text.
 * Hover or focus a day for its numbers; its table lists them all.
 */
export function RateLine({ points, startLabel, midLabel, endLabel, height = 190, label }: { points: RatePoint[]; startLabel: string; midLabel: string; endLabel: string; height?: number; label: string }) {
  const plotH = height - X_AXIS - PLOT_TOP;
  const top = Math.max(0, ...points.map((p) => p.pct));
  const max = Math.max(2, Math.ceil(top / 2) * 2);
  const n = points.length;
  const pad = 1.5;
  const x = (i: number) => (n < 2 ? 50 : pad + ((100 - 2 * pad) * i) / (n - 1));
  const yIn = (v: number) => plotH - (v / max) * plotH;
  const y = (v: number) => PLOT_TOP + yIn(v);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${yIn(p.pct).toFixed(2)}`).join(" ");
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(2)} ${plotH} L${x(0).toFixed(2)} ${plotH} Z` : "";
  const worst = top > 0 ? points.findIndex((p) => p.pct === top) : -1;
  const colW = n < 2 ? 100 : (100 - 2 * pad) / (n - 1);
  const ticks = [0, max / 2, max];
  const rate = (p: RatePoint) => `${p.pct.toFixed(1)}%`;
  return (
    <>
      <div className="flex" style={{ height }}>
        <YLabels ticks={ticks} y={y} format={(v) => `${v}%`} />
        <svg role="group" aria-label={label} width="100%" height={height} className="block min-w-0 flex-1">
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100%" y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-hairline-strong" : "stroke-hairline"} />
          ))}
          {n > 1 ? (
            <svg x="0" y={PLOT_TOP} width="100%" height={plotH} viewBox={`0 0 100 ${plotH}`} preserveAspectRatio="none" overflow="visible">
              <path d={area} className="fill-brand-1/60" />
              <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-brand-4" />
            </svg>
          ) : null}
          {worst >= 0 ? <circle cx={`${x(worst)}%`} cy={y(points[worst].pct)} r={4} className="fill-danger stroke-surface-tinted" strokeWidth={2} /> : null}
          <g aria-hidden>
            <text x="0" y={height - 6} textAnchor="start" className="fill-text-muted text-[11px]">{startLabel}</text>
            <text x="50%" y={height - 6} textAnchor="middle" className="fill-text-muted text-[11px]">{midLabel}</text>
            <text x="100%" y={height - 6} textAnchor="end" className="fill-text-muted text-[11px]">{endLabel}</text>
          </g>
          <ChartKeys>
            {points.map((p, i) => (
              <Tip key={i} title={p.title} value={`${rate(p)} failed · ${p.detail}`}>
                <rect {...markProps(i, `${p.title}: ${rate(p)} failed, ${p.detail}`)} x={`${x(i) - colW / 2}%`} y={0} width={`${colW}%`} height={PLOT_TOP + plotH} className={HIT} />
              </Tip>
            ))}
          </ChartKeys>
        </svg>
      </div>
      <ChartTable
        caption={label}
        columns={["Day", "Failure rate", "Failed"]}
        rows={points.map((p, i) => ({ key: String(i), head: p.title, cells: [rate(p), p.detail] }))}
      />
    </>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

/** One consumer's last 30 days, drawn at its real size (the table gives it a fixed column). */
export function Sparkline({ values, width = 80, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const max = Math.max(...values, 1);
  const last = values.length - 1;
  const x = (i: number) => 2 + (last <= 0 ? 0.5 : i / last) * (width - 4);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <Tip title={label} value="Renders a day, last 30 days">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}, last 30 days`} className="block">
        <path d={d} fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="stroke-brand-4" />
        {last >= 0 ? <circle cx={x(last)} cy={y(values[last])} r={2.5} className="fill-brand-4" /> : null}
      </svg>
    </Tip>
  );
}

// ── Channel mix ──────────────────────────────────────────────────────────────

/**
 * One bar split by channel, its legend printing each share. `parts` come in the order of the channel
 * series (PDF, Web, Email), so each channel wears the hue it has in "Renders over time". The counts, in
 * the tooltips, are in its table too.
 */
export function ChannelMix({ parts, className }: { parts: { label: string; value: number }[]; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 100));
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-heat-empty">
        {parts.map((p, i) =>
          p.value > 0 ? (
            <Tip key={p.label} title={p.label} value={`${formatCount(p.value)} · ${pct(p.value)}%`}>
              <span className={SERIES[i]?.bg} style={{ width: `${(p.value / total) * 100}%` }} />
            </Tip>
          ) : null,
        )}
      </div>
      <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-text-muted">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", SERIES[i]?.bg)} />
            {p.label} <span className="text-text tabular-nums">{pct(p.value)}%</span>
          </li>
        ))}
      </ul>
      <ChartTable
        caption="Renders by channel"
        columns={["Channel", "Renders", "Share"]}
        rows={parts.map((p) => ({ key: p.label, head: p.label, cells: [formatCount(p.value), `${pct(p.value)}%`] }))}
      />
    </div>
  );
}
