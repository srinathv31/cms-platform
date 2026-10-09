"use client";

import { useState } from "react";
import { PageHeader } from "@/components/primitives/page-header";
import { Button } from "@/components/ui/button";
import { ChannelMix, Gauge, HBars, HeatLegend, Heatmap, Legend, RateLine, StackedBars } from "./charts";
import { InfoDot, Panel, PanelHead, TabRow, TrendPill } from "./bits";
import { ConsumersTable } from "./consumers-table";
import { BY_CONSUMER, DAYS, ON_ACTIVE_PCT, ON_SUPERSEDED, STATS, TOP_TEMPLATES, WEEKS } from "./data";
import { formatCount } from "@/domain/numbers";

/*
 * A: Insights. The layout of Unknown.png carried over: three stat cards (numeral over a caps label,
 * a hairline, then two plain lines), a gauge, "Desktop usage"-style bars next to a calendar heatmap,
 * and a wide row for time and errors. Two text tabs, like "Your usage | Your voice".
 */

type Tab = "overview" | "consumers";

const CHANNELS = [
  { label: "PDF", className: "fill-brand-4" },
  { label: "Web", className: "fill-brand-3" },
  { label: "Email", className: "fill-brand-2" },
];

function Stat({ value, label, tip, trend, children }: { value: string; label: string; tip?: string; trend?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Panel className="min-h-[17.25rem] lg:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="numeral text-text">{value}</div>
        {trend}
      </div>
      <div className="caps-label mt-3">
        {label} {tip ? <InfoDot tip={tip} /> : null}
      </div>
      {children}
    </Panel>
  );
}

function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-5 border-t border-hairline-strong pt-4">
      {rows.map(([a, b]) => (
        <div key={a} className="flex items-center justify-between gap-3 py-1.5 text-[16px] text-text">
          <span>{a}</span>
          <span className="text-text-muted">{b}</span>
        </div>
      ))}
    </div>
  );
}

export function VariantA() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="pt-6 pb-4">
      <PageHeader title="Usage" className="pb-5" action={<Button variant="outline" size="lg">Last 90 days</Button>} />
      <TabRow<Tab> tabs={[{ id: "overview", label: "Overview" }, { id: "consumers", label: "Consumers" }]} value={tab} onChange={setTab} />
      {tab === "overview" ? (
        <div className="mt-9 grid gap-6 lg:grid-cols-6">
          <Stat value={formatCount(STATS.month)} label="Renders this month" trend={<TrendPill>{STATS.trendPct}% vs December</TrendPill>}>
            <div className="mt-6 border-t border-hairline-strong pt-5">
              <ChannelMix
                parts={[
                  { label: "PDF", value: STATS.channels.pdf },
                  { label: "Web", value: STATS.channels.web },
                  { label: "Email", value: STATS.channels.email },
                ]}
              />
            </div>
          </Stat>

          <Panel className="min-h-[17.25rem] lg:col-span-2">
            <div className="numeral text-text">{ON_ACTIVE_PCT}%</div>
            <div className="caps-label mt-3">
              Renders on active versions <InfoDot tip="Live renders only. Previews aren't counted." />
            </div>
            <Gauge pct={ON_ACTIVE_PCT} className="mt-4 max-w-[13rem]">
              <span className="text-[14px] text-text-muted">On v1</span>
              <span className="text-[22px] text-text tabular-nums">{formatCount(ON_SUPERSEDED)}</span>
            </Gauge>
          </Panel>

          <Stat value={String(STATS.activeTemplates)} label="Active templates">
            <Lines rows={[["Consumers", String(STATS.consumers)], ["Nearing sunset", `${STATS.nearingSunset} version`]]} />
            <div className="mt-2 text-[13px] text-text-muted">Balance Transfer Intro v1 sunsets in 21 days</div>
          </Stat>

          <Panel className="lg:col-span-3">
            <PanelHead title="Top templates" aside={`Total templates | ${STATS.activeTemplates}`} />
            <HBars className="mt-7" rows={TOP_TEMPLATES.slice(0, 5).map((t) => ({ label: t.key, value: t.renders }))} labelSide="top" />
          </Panel>

          <Panel className="lg:col-span-3">
            <PanelHead title="Daily renders" aside={`Busiest day | ${formatCount(STATS.busiest)}`} />
            <div className="mt-6">
              <Heatmap days={DAYS} />
            </div>
            <div className="mt-auto flex items-center justify-between pt-4">
              <HeatLegend />
              <span className="text-[13px] text-text-muted">Nov 3 to Jan 31</span>
            </div>
          </Panel>

          <Panel className="lg:col-span-4">
            <PanelHead title="Renders over time" aside="By week" />
            <div className="mt-5">
              <StackedBars
                data={WEEKS.map((w) => ({ label: w.label, parts: [w.channels.pdf, w.channels.web, w.channels.email] }))}
                series={CHANNELS}
                width={640}
                height={230}
                tickEvery={2}
              />
            </div>
            <Legend className="mt-3" series={CHANNELS} />
          </Panel>

          <Panel className="lg:col-span-2">
            <PanelHead title="Failures" aside={`${STATS.successPct}% succeeded`} />
            <div className="mt-6">
              <RateLine points={DAYS.map((d) => Math.round((d.failed / d.total) * 1000) / 10)} labels={DAYS.map((d) => d.label)} width={300} height={190} />
            </div>
          </Panel>
        </div>
      ) : (
        <div className="mt-9 grid gap-6">
          <Panel>
            <PanelHead title="Renders by consumer" aside="Last 30 days" />
            <HBars className="mt-7" rows={BY_CONSUMER.map((c) => ({ label: c.key, value: c.renders }))} />
          </Panel>
          <Panel>
            <PanelHead title="Consumers" aside={`Total consumers | ${STATS.consumers}`} />
            <ConsumersTable className="mt-5" />
          </Panel>
        </div>
      )}
    </div>
  );
}
