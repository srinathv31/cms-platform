"use client";

import { useState } from "react";
import { PageHeader } from "@/components/primitives/page-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChannelMix, HeatLegend, Heatmap, Sparkline } from "./charts";
import { InfoDot, Panel, PanelHead, TrendPill } from "./bits";
import { ConsumersTable } from "./consumers-table";
import { DAYS, ERROR_REASONS, ROW_TOTALS, STATS } from "./data";
import { formatCount } from "@/domain/numbers";

/*
 * B: Table first. The numbers are one quiet strip, the consumers table is the page, and the charts
 * are three small cards under it. For the person who opens Usage to answer "who renders what".
 */

type Filter = "all" | "superseded" | "failing";

const TRACK = "h-8 rounded-lg border border-hairline bg-surface p-0.5";
const SEGMENT =
  "h-6 min-w-0 rounded-md border-0 px-2.5 text-[13px] font-medium text-text-muted hover:bg-hover hover:text-text aria-pressed:bg-selected aria-pressed:text-text aria-pressed:hover:bg-selected";

function Kpi({ label, value, sub, tip }: { label: string; value: string; sub?: React.ReactNode; tip?: string }) {
  return (
    <div className="flex flex-col gap-2 px-6 py-5">
      <div className="caps-label">{label} {tip ? <InfoDot tip={tip} /> : null}</div>
      <div className="numeral text-[2rem] text-text">{value}</div>
      <div className="min-h-6 text-[13px] text-text-muted">{sub}</div>
    </div>
  );
}

export function VariantB() {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = ROW_TOTALS.filter((r) => (filter === "all" ? true : filter === "superseded" ? r.state === "superseded" : r.failedCount / r.renders > 0.01));
  return (
    <div className="pt-6 pb-4">
      <PageHeader title="Usage" className="pb-6" />

      <Panel className="grid grid-cols-2 divide-hairline p-0 lg:grid-cols-4 lg:divide-x">
        <Kpi label="Renders this month" value={formatCount(STATS.month)} sub={<TrendPill>{STATS.trendPct}% vs December</TrendPill>} tip="Live renders only. Previews aren't counted." />
        <Kpi label="Active templates" value={String(STATS.activeTemplates)} sub="Across 2 consumers" />
        <Kpi label="Success rate" value={`${STATS.successPct}%`} sub={`${formatCount(STATS.failed)} failed renders`} />
        <Kpi label="Nearing sunset" value={String(STATS.nearingSunset)} sub="Balance Transfer Intro v1, in 21 days" />
      </Panel>

      <Panel className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <PanelHead title="Consumers" size="lg" />
          <ToggleGroup
            aria-label="Filter consumers"
            value={[filter]}
            onValueChange={(next) => {
              const picked = next[0] as Filter | undefined;
              if (picked) setFilter(picked);
            }}
            spacing={0.5}
            className={TRACK}
          >
            <ToggleGroupItem value="all" className={SEGMENT}>All</ToggleGroupItem>
            <ToggleGroupItem value="superseded" className={SEGMENT}>On superseded</ToggleGroupItem>
            <ToggleGroupItem value="failing" className={SEGMENT}>Failing</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <ConsumersTable className="mt-4" rows={rows} sparkline />
        {rows.length === 0 ? <p className="m-0 py-10 text-center text-[14px] text-text-muted">Nothing is failing.</p> : null}
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel>
          <PanelHead title="Daily renders" size="md" />
          <div className="mt-4"><Heatmap days={DAYS} cell={11} gap={4} labels={false} /></div>
          <HeatLegend className="mt-3 text-[12px]" />
        </Panel>
        <Panel>
          <PanelHead title="Channels" size="md" aside="Last 30 days" />
          <ChannelMix
            className="mt-6"
            parts={[
              { label: "PDF", value: STATS.channels.pdf },
              { label: "Web", value: STATS.channels.web },
              { label: "Email", value: STATS.channels.email },
            ]}
          />
          <div className="mt-6 flex items-center justify-between border-t border-hairline pt-4 text-[13px] text-text-muted">
            <span>Renders per day</span>
            <Sparkline values={DAYS.slice(-30).map((d) => d.total)} width={140} height={32} label="Renders per day" />
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Failed renders" size="md" aside={`${formatCount(STATS.failed)} this month`} />
          <ul className="m-0 mt-5 flex list-none flex-col gap-3 p-0">
            {ERROR_REASONS.map((e) => (
              <li key={e.label} className="flex items-center justify-between gap-3 text-[14px]">
                <span className="text-text">{e.label}</span>
                <span className="tabular-nums text-text-muted">{e.count}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
