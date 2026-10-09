import Link from "next/link";
import type { Route } from "next";
import { WS } from "@/components/workspace/workspace-grid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatShortDate } from "@/domain/dates";
import { errorText } from "@/domain/golive/usage";
import { formatCount } from "@/domain/numbers";
import { plural } from "@/domain/plural";
import { CHANNEL_LABELS } from "@/domain/render/errors";
import type { TemplateUsageData } from "@/domain/golive-types";
import { cn } from "@/lib/utils";
import { now } from "@/server/clock";
import { getTemplateUsage } from "@/server/queries/usage";
import { StatCard, StatLabel, StatTrend, StatValue } from "@/components/primitives/stat-card";
import { Legend, SERIES, StackedBars, type StackSeries } from "./charts";
import { ConsumersTable } from "./consumers-table";
import { formatLastRender } from "./format";
import { Panel, PanelHead } from "./panel";

// The workspace's Usage tab: which consumers render which version of this template. One chart, two
// numbers, one table, and the last failures when there are any. The same rows feed the consequence line
// in the approve, sunset and revoke dialogs.
//
// Layout: this tab has no rail, so its cell takes the rail's reserved column too (the grid's second
// column) and its left edge stays on the header's: the header is centred in column 1 at the document
// width, so the cell starts half of (both columns less document width less rail) in. It is as wide as the
// two columns less the canvas's side padding, which the grid bleeds through there, so it keeps a 48px
// inset from the panel's right edge, up to the document width plus the rail column. Below the canvas
// width where the grid pads its own right side, it is the grid area, as every tab is.

export const TEMPLATE_BARS_HEIGHT = 210;
/** Classes of the tab's cell, shared with the skeleton. */
export const USAGE_CELL = cn(
  WS.doc,
  "col-end-3 w-[min(calc(100%-var(--canvas-pad-x)),calc(var(--doc-width)+22.5rem-var(--canvas-pad-x)))] max-w-none justify-self-start ml-[max(0px,calc((100%-var(--doc-width)-22.5rem)/2))] @max-[51.25rem]/canvas:w-full",
);
export const USAGE_COLUMNS = "grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]";

// The newest version takes the first series hue, the one before it the second, and so on; past the
// fourth, older versions are taupe.
const OLDEST = { fill: "fill-heat-empty", bg: "bg-heat-empty" };

function versionSeries(versions: number[]): StackSeries[] {
  return versions.map((v, i) => {
    const age = versions.length - 1 - i;
    return { label: `v${v}`, ...(SERIES[age] ?? OLDEST) };
  });
}

function RecentFailures({ errors, nowDate }: { errors: TemplateUsageData["recentErrors"]; nowDate: Date }) {
  const head = "h-10 text-[11px] font-medium tracking-[0.08em] text-label uppercase";
  return (
    <Panel className="mt-6">
      <PanelHead title="Recent failures" size="md" />
      <Table aria-label="Recent failures" className="mt-3 text-[14px]">
        <TableHeader>
          <TableRow className="border-hairline hover:bg-transparent">
            <TableHead className={head}>Consumer</TableHead>
            <TableHead className={head}>Version</TableHead>
            <TableHead className={head}>Channel</TableHead>
            <TableHead className={head}>When</TableHead>
            <TableHead className={head}>What happened</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {errors.map((e, i) => (
            <TableRow key={`${e.at}-${i}`} className="h-12 border-hairline hover:bg-hover/50">
              <TableCell className="font-medium text-text">{e.consumer.name}</TableCell>
              <TableCell className="font-mono text-[13px] text-text">{e.versionNumber === null ? "—" : `v${e.versionNumber}`}</TableCell>
              <TableCell className="text-text">{CHANNEL_LABELS[e.channel]}</TableCell>
              <TableCell className="whitespace-nowrap text-text-muted">{formatLastRender(e.at, nowDate)}</TableCell>
              <TableCell className="text-text">{errorText(e.code)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

export async function TemplateUsageContent({ params }: { params: Promise<{ team: string; templateId: string }> }) {
  const { team, templateId } = await params;
  const d = await getTemplateUsage(team, templateId);
  const nowDate = await now();
  // No version has ever been Active: nothing can have rendered it, so one calm line instead of empty charts.
  if (d.versions.length === 0) {
    return (
      <section data-slot="usage" aria-label="Usage" className={USAGE_CELL}>
        <p className="py-10 text-[15px] text-text-muted">
          Not live yet.{" "}
          <Link
            href={`/${team}/templates/${templateId}/versions` as Route}
            className="rounded-sm text-text underline underline-offset-4 outline-none hover:text-text-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            Versions
          </Link>
        </p>
      </section>
    );
  }
  const series = versionSeries(d.weeklyVersions);
  const still = d.stillOn.slice(0, 2);
  return (
    <section data-slot="usage" aria-label="Usage" className={USAGE_CELL}>
      <div className={USAGE_COLUMNS}>
        <Panel>
          <PanelHead title="Renders by version" size="md" aside="Last 13 weeks" />
          <Legend className="mt-2 h-5" series={series} />
          <div className="mt-4">
            <StackedBars
              label="Renders by version, by week"
              periodHeader="Week of"
              height={TEMPLATE_BARS_HEIGHT}
              series={series}
              data={d.weekly.map((w, i) => ({
                label: formatShortDate(w.weekStart),
                title: `Week of ${formatShortDate(w.weekStart)}`,
                parts: d.weeklyVersions.map((v) => w.byVersion[v] ?? 0),
                partial: i === d.weekly.length - 1 && d.today < addDays(w.weekStart, 6),
              }))}
            />
          </div>
        </Panel>
        <div className="grid grid-rows-[auto_1fr] gap-6">
          <StatCard>
            <StatValue
              value={formatCount(d.stats.renders.value)}
              trend={d.stats.renders.trendPct === null ? null : <StatTrend pct={d.stats.renders.trendPct} />}
            />
            <StatLabel tip="Live renders only. Previews aren't counted." className="mt-3">
              Renders · 30 days
            </StatLabel>
          </StatCard>
          <StatCard>
            <StatValue value={d.success.pct === null ? "—" : `${d.success.pct}%`} />
            <StatLabel className="mt-3">Succeeded</StatLabel>
            <div className="mt-4 flex flex-col gap-1 border-t border-hairline pt-3 text-[13px] text-text-muted">
              {d.success.errors > 0 ? (
                <span>
                  {formatCount(d.success.errors)} of {plural(d.stats.renders.value, "render")} failed
                </span>
              ) : null}
              {still.length === 0 ? (
                <span>None on older versions</span>
              ) : (
                still.map((s) => <span key={s.versionNumber}>{s.pct}% still on v{s.versionNumber}</span>)
              )}
            </div>
          </StatCard>
        </div>
      </div>

      <Panel className="@container/usage mt-6">
        <PanelHead title="Who renders it" size="md" />
        <ConsumersTable rows={d.rows} nowIso={nowDate.toISOString()} name="Who renders it" showTemplate={false} className="mt-3" />
      </Panel>

      {d.recentErrors.length > 0 ? <RecentFailures errors={d.recentErrors} nowDate={nowDate} /> : null}
    </section>
  );
}
