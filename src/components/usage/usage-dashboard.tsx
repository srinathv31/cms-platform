import { addDays, percent } from "@/domain/golive/usage";
import { cn } from "@/lib/utils";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import type { UsageDashboard } from "@/domain/golive-types";
import { now } from "@/server/clock";
import { getUsageDashboard } from "@/server/queries/usage";
import { renderCount } from "@/components/versions/format";
import { ChannelMix, Gauge, HBars, HeatLegend, Heatmap, Legend, RateLine, SERIES, StackedBars, type RatePoint, type StackSeries } from "./charts";
import { ConsumersCard } from "./consumers-card";
import { formatDayShort, sunsetPhrase, versionCount } from "./format";
import { BARS_HEIGHT, LEGEND_HEIGHT, LEGEND_ROW, RATE_HEIGHT, STAT_CARD, TOP_TEMPLATES } from "./geometry";
import { Panel, PanelHead, TrendPill } from "./panel";
import { Lines, Numeral, StatLabel } from "./stat";
import { UsageTabs } from "./usage-tabs";

// /[team]/usage. Overview: three stat cards, Top templates beside the Daily renders heatmap, then
// Renders over time and the failure rate. Consumers: renders by consumer and who renders what. The
// numbers are `getUsageDashboard`'s; this file only lays them out. Reads inside the page's <Stream>.

/** PDF, Web, Email: the same hues here and in the channel mix. */
const CHANNEL_SERIES: StackSeries[] = [
  { label: CHANNEL_LABELS.pdf, ...SERIES[0] },
  { label: CHANNEL_LABELS.web, ...SERIES[1] },
  { label: CHANNEL_LABELS.email, ...SERIES[2] },
];

const NF = new Intl.NumberFormat("en-US");

function Overview({ d }: { d: UsageDashboard }) {
  const { stats, onActive, heatmap } = d;
  const firstDay = heatmap.weeks[0]?.[0]?.date ?? d.today;
  const onOlder =
    onActive.otherVersions.length === 1 ? `On v${onActive.otherVersions[0].versionNumber}` : "On older versions";
  // `count` is every render that day (succeeded or failed); `errors` is the failed ones.
  const failurePoints: RatePoint[] = d.daily.slice(-30).map((day) => ({
    title: day.date === d.today ? `${formatDayShort(day.date)} (so far)` : formatDayShort(day.date),
    pct: percent(day.errors, day.count) ?? 0,
    detail: day.count === 0 ? "No renders" : `${NF.format(day.errors)} of ${renderCount(day.count)}`,
  }));
  const failFrom = d.daily.slice(-30)[0]?.date ?? d.today;
  const mid = d.daily.slice(-30)[Math.floor(Math.min(30, d.daily.length) / 2)]?.date ?? d.today;
  const soonest = stats.nearingSunset.soonest;
  return (
    <div className="grid gap-6 lg:grid-cols-6">
      <Panel className={STAT_CARD}>
        <Numeral
          value={NF.format(stats.renders.value)}
          trend={stats.renders.trendPct === null ? null : <TrendPill pct={stats.renders.trendPct} />}
        />
        <StatLabel tip="Live renders only. Previews aren't counted.">Renders · 30 days</StatLabel>
        <div className="mt-6 border-t border-hairline-strong pt-5">
          <ChannelMix
            parts={(["pdf", "web", "email"] as const).map((c) => ({ label: CHANNEL_LABELS[c], value: d.byChannel[c] }))}
          />
        </div>
      </Panel>

      <Panel className={STAT_CARD}>
        <Numeral value={onActive.pct === null ? "—" : `${onActive.pct}%`} />
        <StatLabel tip="Of the last 30 days' renders, the share on a version that is Active now.">
          Renders on active versions
        </StatLabel>
        <Gauge pct={onActive.pct} label={onActive.pct === null ? "No renders" : `${onActive.pct}% on active versions`} className="mt-4 max-w-[13rem]">
          <span className="text-[14px] text-text-muted">{onOlder}</span>
          <span className="text-[22px] text-text tabular-nums">{NF.format(onActive.other)}</span>
        </Gauge>
      </Panel>

      <Panel className={STAT_CARD}>
        <Numeral value={stats.activeTemplates.display} />
        <StatLabel>Active templates</StatLabel>
        <Lines
          rows={[
            ["Consumers", stats.consumers.display],
            ["Nearing sunset", versionCount(stats.nearingSunset.value)],
          ]}
        />
        <div className="mt-2 line-clamp-2 min-h-10 text-[13px] text-text-muted">
          {soonest ? `${soonest.templateName} v${soonest.versionNumber} ${sunsetPhrase(soonest.daysAway)}` : null}
        </div>
      </Panel>

      <Panel className="lg:col-span-3">
        <PanelHead title="Top templates" aside="Last 30 days" />
        <HBars
          className="mt-7"
          minRows={TOP_TEMPLATES}
          rows={d.byTemplate.slice(0, TOP_TEMPLATES).map((t) => ({
            key: t.template.id,
            label: t.template.name,
            value: t.renders,
            share: t.share,
            href: `/${t.template.teamSlug}/templates/${t.template.id}/usage`,
          }))}
        />
      </Panel>

      <Panel className="lg:col-span-3">
        <PanelHead title="Daily renders" aside={heatmap.busiest ? `Busiest day | ${NF.format(heatmap.busiest.count)}` : undefined} />
        <div className="flex flex-1 items-center py-6">
          <div className="w-full">
            <Heatmap heat={heatmap} />
          </div>
        </div>
        <div>
          <div className="flex h-5 items-center justify-between gap-3">
            <HeatLegend thresholds={heatmap.thresholds} />
            <span className="text-[13px] text-text-muted">
              {formatDayShort(firstDay)} to {formatDayShort(d.today)}
            </span>
          </div>
        </div>
      </Panel>

      <Panel className="lg:col-span-4">
        <PanelHead title="Renders over time" aside="By week" />
        <div className="mt-5">
          <StackedBars
            label="Renders over time, by channel"
            periodHeader="Week of"
            height={BARS_HEIGHT}
            series={CHANNEL_SERIES}
            data={d.weekly.map((w, i) => ({
              label: formatDayShort(w.weekStart),
              title: `Week of ${formatDayShort(w.weekStart)}`,
              parts: [w.channels.pdf, w.channels.web, w.channels.email],
              partial: i === d.weekly.length - 1 && d.today < addDays(w.weekStart, 6),
            }))}
          />
        </div>
        <Legend className={LEGEND_ROW} series={CHANNEL_SERIES} />
      </Panel>

      <Panel className="lg:col-span-2">
        <PanelHead title="Failures" aside={d.success.pct === null ? undefined : `${d.success.pct}% succeeded`} />
        <div className="mt-5">
          <RateLine
            label="Failed renders per day, last 30 days"
            height={RATE_HEIGHT - LEGEND_HEIGHT}
            points={failurePoints}
            startLabel={formatDayShort(failFrom)}
            midLabel={formatDayShort(mid)}
            endLabel={formatDayShort(d.today)}
          />
        </div>
        <p className={cn(LEGEND_ROW, "m-0 flex items-center text-[13px] text-text-muted")}>
          {d.success.pct === null
            ? "No renders in the last 30 days"
            : `${NF.format(d.success.errors)} failed of ${renderCount(d.success.ok + d.success.errors)}`}
        </p>
      </Panel>
    </div>
  );
}

function Consumers({ d, nowIso }: { d: UsageDashboard; nowIso: string }) {
  return (
    <div className="grid gap-6">
      <Panel>
        <PanelHead title="Renders by consumer" aside="Last 30 days" />
        <HBars
          className="mt-7"
          labelSide="right"
          rows={d.byConsumer.map((c) => ({ key: c.consumer.id, label: c.consumer.name, value: c.renders, share: c.share }))}
        />
      </Panel>
      <ConsumersCard rows={d.rows} nowIso={nowIso} />
    </div>
  );
}

export async function UsageDashboardContent({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { team } = await params;
  const { tab } = await searchParams;
  const d = await getUsageDashboard(team);
  const nowDate = await now();
  return <UsageTabs initial={tab === "consumers" ? "consumers" : "overview"} overview={<Overview d={d} />} consumers={<Consumers d={d} nowIso={nowDate.toISOString()} />} />;
}
