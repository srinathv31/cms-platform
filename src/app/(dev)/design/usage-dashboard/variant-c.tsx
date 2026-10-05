"use client";

import { useState } from "react";
import { PageHeader } from "@/components/primitives/page-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HBars, Legend, RateLine, StackedBars } from "./charts";
import { InfoDot, Panel, PanelHead, TrendPill } from "./bits";
import { BY_CONSUMER, DAYS, ERROR_REASONS, STATS, TOP_TEMPLATES, WEEKS, fmt } from "./data";
import { cn } from "@/lib/utils";

/*
 * C: Over time first. One wide chart is the page. Its three headline numbers are the tabs that
 * switch what the chart plots (renders by channel, failed renders, renders by consumer), and the
 * breakdowns sit below as three small cards.
 */

type Metric = "renders" | "errors" | "consumers";
type Grain = "week" | "day";

const CHANNELS = [
  { label: "PDF", className: "fill-brand-4" },
  { label: "Web", className: "fill-brand-3" },
  { label: "Email", className: "fill-brand-2" },
];
const CONSUMER_SERIES = [
  { label: "Coral", className: "fill-brand-4" },
  { label: "Deposits Online", className: "fill-brand-2" },
];

const TRACK = "h-8 rounded-lg border border-hairline bg-surface p-0.5";
const SEGMENT =
  "h-6 min-w-0 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text aria-pressed:hover:bg-selected";

function MetricTab({ on, onClick, label, value, children }: { on: boolean; onClick: () => void; label: string; value: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn("relative -mb-px flex min-w-0 cursor-pointer flex-col items-start gap-2 px-6 pt-5 pb-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset", on ? "text-text" : "text-text-muted hover:bg-hover/40")}
    >
      <span className="caps-label">{label}</span>
      <span className="flex items-center gap-3">
        <span className="numeral text-[2rem] text-text">{value}</span>
        {children}
      </span>
      {on ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-text" /> : null}
    </button>
  );
}

export function VariantC({ initialMetric }: { initialMetric?: string }) {
  const [metric, setMetric] = useState<Metric>(initialMetric === "errors" || initialMetric === "consumers" ? initialMetric : "renders");
  const [grain, setGrain] = useState<Grain>("week");
  const days = DAYS;
  const stackData =
    grain === "week"
      ? WEEKS.map((w) => ({ label: w.label, parts: metric === "consumers" ? [w.consumers.coral, w.consumers.deposits] : [w.channels.pdf, w.channels.web, w.channels.email] }))
      : days.map((d) => ({ label: d.long, parts: metric === "consumers" ? [d.consumers.coral, d.consumers.deposits] : [d.channels.pdf, d.channels.web, d.channels.email] }));
  return (
    <div className="pt-6 pb-4">
      <PageHeader title="Usage" className="pb-6" />

      <Panel className="p-0">
        <div role="tablist" className="grid grid-cols-3 divide-x divide-hairline border-b border-hairline">
          <MetricTab on={metric === "renders"} onClick={() => setMetric("renders")} label="Renders this month" value={fmt.format(STATS.month)}>
            <TrendPill>{STATS.trendPct}%</TrendPill>
          </MetricTab>
          <MetricTab on={metric === "errors"} onClick={() => setMetric("errors")} label="Failed renders" value={`${(100 - STATS.successPct).toFixed(1)}%`}>
            <span className="text-[13px] text-text-muted">{fmt.format(STATS.failed)} of {fmt.format(STATS.month)}</span>
          </MetricTab>
          <MetricTab on={metric === "consumers"} onClick={() => setMetric("consumers")} label="Consumers" value={String(STATS.consumers)}>
            <span className="text-[13px] text-text-muted">{STATS.activeTemplates} active templates</span>
          </MetricTab>
        </div>
        <div className="p-6">
          <div className="flex items-center justify-between gap-4">
            {metric === "errors" ? <span className="text-[13px] text-text-muted">Share of renders that failed, by day</span> : <Legend series={metric === "consumers" ? CONSUMER_SERIES : CHANNELS} />}
            {metric === "errors" ? null : (
              <ToggleGroup
                aria-label="Grain"
                value={[grain]}
                onValueChange={(next) => {
                  const picked = next[0] as Grain | undefined;
                  if (picked) setGrain(picked);
                }}
                spacing={0.5}
                className={TRACK}
              >
                <ToggleGroupItem value="week" className={SEGMENT}>Weekly</ToggleGroupItem>
                <ToggleGroupItem value="day" className={SEGMENT}>Daily</ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
          <div className="mt-5">
            {metric === "errors" ? (
              <RateLine points={days.map((d) => Math.round((d.failed / d.total) * 1000) / 10)} labels={days.map((d) => d.label)} width={1180} height={256} />
            ) : (
              <StackedBars data={stackData} series={metric === "consumers" ? CONSUMER_SERIES : CHANNELS} width={1180} height={256} tickEvery={grain === "week" ? 1 : 10} />
            )}
          </div>
        </div>
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHead title="Top templates" size="md" aside="Last 30 days" />
          <HBars className="mt-6" rows={TOP_TEMPLATES.slice(0, 4).map((t) => ({ label: t.key, value: t.renders }))} labelSide="top" />
        </Panel>
        <Panel>
          <PanelHead title="By consumer" size="md" aside="Last 30 days" />
          <HBars className="mt-6" rows={BY_CONSUMER.map((c) => ({ label: c.key, value: c.renders }))} labelSide="top" />
        </Panel>
        <Panel>
          <PanelHead title="Why renders failed" size="md" aside={<>This month <InfoDot tip="Live renders only. Previews aren't counted." /></>} />
          <ul className="m-0 mt-6 flex list-none flex-col gap-4 p-0">
            {ERROR_REASONS.map((e) => (
              <li key={e.label} className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between text-[14px]"><span className="text-text">{e.label}</span><span className="tabular-nums text-text-muted">{e.count}</span></span>
                <span className="h-1.5 rounded-full bg-heat-empty/40"><span className="block h-full rounded-full bg-brand-3" style={{ width: `${e.share * 100}%` }} /></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
