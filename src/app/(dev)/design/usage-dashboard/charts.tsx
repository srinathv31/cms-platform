import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCount } from "@/domain/numbers";
import type { Day } from "./data";

/*
 * Small SVG charts, drawn from plain numbers with no chart library. Each mark that can be read
 * carries a shadcn Tooltip. Colour comes from the one teal family (brand-1…4) and the taupe
 * "empty" step; nothing else is introduced. All of it is server-renderable: no hooks.
 */

export function Tip({ children, title, value }: { children: React.ReactElement<Record<string, unknown>>; title: string; value?: React.ReactNode }) {
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

/** A semicircle with a thick round-capped stroke, like Flow's. `children` sits in the bowl. */
export function Gauge({ pct, className, children }: { pct: number; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-[15rem]", className)}>
      <svg viewBox="0 0 240 136" role="img" aria-label={`${pct}%`} className="block w-full">
        <path d="M24 120 A96 96 0 0 1 216 120" fill="none" strokeWidth={26} strokeLinecap="round" className="stroke-hairline-strong" />
        <path d="M24 120 A96 96 0 0 1 216 120" pathLength={100} strokeDasharray={`${Math.min(100, pct)} 100`} fill="none" strokeWidth={26} strokeLinecap="round" className="stroke-brand-4" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-tight">{children}</div>
    </div>
  );
}

// ── Horizontal bars ──────────────────────────────────────────────────────────

export interface BarRow {
  label: string;
  value: number;
  /** Shown in the tooltip and right of the label, e.g. "UC-5T6K1B". */
  detail?: string;
}

/** Bars sized to the largest row, with the share of the total inside, like Flow's "Desktop usage". */
export function HBars({ rows, total, className, labelSide = "right" }: { rows: BarRow[]; total?: number; className?: string; labelSide?: "right" | "top" }) {
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-4 p-0", className)}>
      {rows.map((r, i) => {
        const pct = Math.round((r.value / sum) * 100);
        const width = Math.max(14, (r.value / max) * 100);
        const bar = (
          <Tip title={r.label} value={`${formatCount(r.value)} renders · ${pct}%`}>
            <div
              className={cn("flex h-9 items-center rounded-md px-3 text-[14px] font-medium text-white tabular-nums", i === 0 ? "bg-brand-4" : "bg-brand-3")}
              style={{ width: `${labelSide === "right" ? width * 0.55 : width}%` }}
            >
              {pct}%
            </div>
          </Tip>
        );
        return (
          <li key={r.label} className={labelSide === "right" ? "flex items-center gap-4" : "flex flex-col gap-1.5"}>
            {labelSide === "top" ? <span className="truncate text-[13px] text-text">{r.label}</span> : null}
            <div className={labelSide === "right" ? "w-[55%] shrink-0" : "w-full"}>{bar}</div>
            {labelSide === "right" ? (
              <span className="caps-label min-w-0 truncate">{formatCount(r.value)} · {r.label}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ── Calendar heatmap ─────────────────────────────────────────────────────────

const HEAT = ["fill-heat-empty", "fill-brand-1", "fill-brand-2", "fill-brand-3", "fill-brand-4"] as const;

function level(v: number, max: number) {
  const r = v / max;
  return r < 0.12 ? 0 : r < 0.4 ? 1 : r < 0.65 ? 2 : r < 0.85 ? 3 : 4;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** GitHub-style grid: a column per week, a row per weekday (Sun at the top), 4px-rounded squares. */
export function Heatmap({ days, cell = 18, gap = 6, labels = true, grow = 1.3 }: { days: Day[]; cell?: number; gap?: number; labels?: boolean; grow?: number }) {
  const max = Math.max(...days.map((d) => d.total));
  const first = new Date(Date.UTC(2026, 10, 3 + days[0].i));
  const offset = first.getUTCDay();
  const cols = Math.ceil((days.length + offset) / 7);
  const left = labels ? 34 : 0;
  const top = 22;
  const W = left + cols * (cell + gap);
  const H = top + 7 * (cell + gap);
  const monthMarks: { col: number; label: string }[] = [];
  days.forEach((d, k) => {
    const date = new Date(Date.UTC(2026, 10, 3 + d.i));
    const col = Math.floor((k + offset) / 7);
    if (date.getUTCDate() <= 7 && date.getUTCDay() === 0 && !monthMarks.some((m) => m.col === col)) monthMarks.push({ col, label: MONTHS[date.getUTCMonth()] });
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily renders" className="block w-full" style={{ maxWidth: W * grow }}>
      {monthMarks.map((m) => (
        <text key={m.col} x={left + m.col * (cell + gap)} y={11} className="fill-text-muted text-[11px]">{m.label}</text>
      ))}
      {labels
        ? WEEKDAYS.map((w, r) => (
            <text key={w} x={0} y={top + r * (cell + gap) + cell * 0.72} className="fill-text-muted text-[11px]">{w}</text>
          ))
        : null}
      {days.map((d, k) => {
        const col = Math.floor((k + offset) / 7);
        const row = (k + offset) % 7;
        return (
          <Tip key={d.i} title={d.long} value={`${formatCount(d.total)} renders`}>
            <rect x={left + col * (cell + gap)} y={top + row * (cell + gap)} width={cell} height={cell} rx={4} className={HEAT[level(d.total, max)]} />
          </Tip>
        );
      })}
    </svg>
  );
}

export function HeatLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-[13px] text-text-muted", className)}>
      Less
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className={cn("size-4 rounded-[4px]", ["bg-heat-empty", "bg-brand-1", "bg-brand-2", "bg-brand-3", "bg-brand-4"][l])} />
      ))}
      More
    </div>
  );
}

// ── Stacked bars ─────────────────────────────────────────────────────────────

export interface StackDatum {
  label: string;
  parts: number[];
}

export interface StackSeries {
  label: string;
  className: string;
}

function niceMax(v: number) {
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Time series as stacked columns. Hover a column for its values; the y axis has four gridlines. */
export function StackedBars({
  data,
  series,
  width = 760,
  height = 220,
  tickEvery = 1,
}: {
  data: StackDatum[];
  series: StackSeries[];
  width?: number;
  height?: number;
  tickEvery?: number;
}) {
  const left = 40;
  const bottom = 24;
  const plotW = width - left - 4;
  const plotH = height - bottom - 8;
  const max = niceMax(Math.max(...data.map((d) => d.parts.reduce((a, b) => a + b, 0))));
  const colW = plotW / data.length;
  const barW = Math.max(2, colW * 0.62);
  const y = (v: number) => 8 + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Renders over time" className="block w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-hairline-strong" : "stroke-hairline"} strokeWidth={1} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-text-muted text-[11px] tabular-nums">{formatCount(t)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        let acc = 0;
        const x = left + i * colW + (colW - barW) / 2;
        return (
          <g key={d.label}>
            {d.parts.map((p, s) => {
              const top = y(acc + p);
              const h = y(acc) - top;
              acc += p;
              return h > 0 ? <rect key={s} x={x} y={top} width={barW} height={h} rx={s === d.parts.length - 1 ? Math.min(3, barW / 2) : 0} className={series[s].className} /> : null;
            })}
            {i % tickEvery === 0 ? (
              <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-text-muted text-[11px]">{d.label.replace("Week of ", "")}</text>
            ) : null}
            <Tip
              title={d.label}
              value={
                <span className="flex flex-col gap-0.5">
                  {series.map((s, k) => <span key={s.label}>{s.label}: {formatCount(d.parts[k])}</span>)}
                </span>
              }
            >
              <rect x={left + i * colW} y={0} width={colW} height={plotH + 8} className="fill-transparent hover:fill-foreground/5" />
            </Tip>
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ series, className }: { series: StackSeries[]; className?: string }) {
  return (
    <ul className={cn("m-0 flex list-none items-center gap-4 p-0 text-[13px] text-text-muted", className)}>
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-[3px]", s.className.replace("fill-", "bg-"))} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// ── Line (rate over time) ────────────────────────────────────────────────────

/** A rate per day as a line with a dashed reference. Values are percentages. */
export function RateLine({ points, labels, threshold = 1, width = 520, height = 150 }: { points: number[]; labels: string[]; threshold?: number; width?: number; height?: number }) {
  const left = 34;
  const bottom = 22;
  const plotW = width - left - 6;
  const plotH = height - bottom - 8;
  const max = Math.max(2, Math.ceil(Math.max(...points)));
  const x = (i: number) => left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => 8 + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  const worst = points.indexOf(Math.max(...points));
  const colW = plotW / (points.length - 1);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Failed renders over time" className="block w-full">
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={left} x2={width - 6} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-hairline-strong" : "stroke-hairline"} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-text-muted text-[11px] tabular-nums">{t}%</text>
        </g>
      ))}
      <line x1={left} x2={width - 6} y1={y(threshold)} y2={y(threshold)} strokeDasharray="4 4" className="stroke-text-subtle" />
      <path d={area} className="fill-brand-1/60" />
      <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-brand-4" />
      <circle cx={x(worst)} cy={y(points[worst])} r={4} className="fill-danger stroke-surface-tinted" strokeWidth={2} />
      {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
        <text key={i} x={x(i)} y={height - 5} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="fill-text-muted text-[11px]">{labels[i]}</text>
      ))}
      {points.map((p, i) => (
        <Tip key={i} title={labels[i]} value={`${p.toFixed(1)}% failed`}>
          <rect x={x(i) - colW / 2} y={0} width={colW} height={plotH + 8} className="fill-transparent hover:fill-foreground/5" />
        </Tip>
      ))}
    </svg>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────

export function Sparkline({ values, width = 80, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const max = Math.max(...values, 1);
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <Tip title={label} value="Last 30 days">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="block">
        <path d={d} fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="stroke-brand-4" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5} className="fill-brand-4" />
      </svg>
    </Tip>
  );
}

// ── Channel mix ──────────────────────────────────────────────────────────────

const MIX = ["bg-brand-4", "bg-brand-3", "bg-brand-2"] as const;

export function ChannelMix({ parts, className }: { parts: { label: string; value: number }[]; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.map((p, i) => (
          <Tip key={p.label} title={p.label} value={`${formatCount(p.value)} · ${Math.round((p.value / total) * 100)}%`}>
            <span className={MIX[i]} style={{ width: `${(p.value / total) * 100}%` }} />
          </Tip>
        ))}
      </div>
      <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-text-muted">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", MIX[i])} />
            {p.label} <span className="tabular-nums text-text">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
