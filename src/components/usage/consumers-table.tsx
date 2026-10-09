"use client";

import Link from "next/link";
import type { Route } from "next";
import { Segmented } from "@/components/primitives/segmented";
import { StatusBadge } from "@/components/primitives/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { UsageRow, UsageTag } from "@/domain/golive-types";
import { formatCount } from "@/domain/numbers";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts";
import { formatLastRender } from "./format";

// Who renders what, on which version: consumer, template, version, renders, a 30-day sparkline, the
// last render and a note. The version is a StatusBadge, as everywhere (it already says "Superseded" and
// the sunset date), so the note only adds the extra fact on one line ("sunset in 21 days", "3 failed
// renders", "renders fail").

const HEAD = "h-10 px-2 text-[11px] font-medium tracking-[0.08em] text-label uppercase";

const TAG_TONE: Record<UsageTag["tone"], string> = {
  neutral: "border-chip-border bg-chip text-chip-text",
  warning: "border-warning-border bg-warning-soft text-warning-text",
  danger: "border-transparent bg-danger-soft text-danger-text",
  positive: "border-transparent bg-positive-soft text-positive",
};

function TagChip({ tag }: { tag: UsageTag }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-[12px] leading-4 font-medium whitespace-nowrap", TAG_TONE[tag.tone])}>
      {tag.text}
    </span>
  );
}

type Filter = "all" | "superseded" | "failing";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "superseded", label: "On superseded" },
  { value: "failing", label: "Failing" },
];

const FILTER_EMPTY: Record<Filter, string> = {
  all: "No consumers have rendered in the last 30 days.",
  superseded: "No consumers are on a superseded version.",
  failing: "No renders have failed in the last 30 days.",
};

/** All / On superseded / Failing. Controlled by the table's card, which puts it in its heading row. */
export function ConsumerFilter({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  return <Segmented label="Show" value={value} options={FILTERS} onChange={onChange} />;
}

function matches(row: UsageRow, filter: Filter): boolean {
  if (filter === "superseded") return row.versionState === "superseded";
  if (filter === "failing") return row.errors30d > 0;
  return true;
}

export function ConsumersTable({
  rows,
  nowIso,
  name,
  showTemplate = true,
  filter = "all",
  className,
}: {
  rows: UsageRow[];
  nowIso: string;
  /** The table's accessible name. */
  name: string;
  showTemplate?: boolean;
  filter?: Filter;
  className?: string;
}) {
  const now = new Date(nowIso);
  const shown = rows.filter((r) => matches(r, filter));
  const columns = showTemplate ? 7 : 6;
  // With the Template column in, the table is tight below about 58rem of card: "Last render" gives way
  // first (the sparkline still shows recency), so a note never wraps for want of room.
  const lastCol = showTemplate ? "@max-[58rem]/usage:hidden" : "";
  return (
    <Table aria-label={name} className={cn("text-[14px]", className)}>
      <TableHeader>
        <TableRow className="border-hairline hover:bg-transparent">
          <TableHead className={HEAD}>Consumer</TableHead>
          {showTemplate ? <TableHead className={HEAD}>Template</TableHead> : null}
          <TableHead className={HEAD}>Version</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Renders (30d)</TableHead>
          <TableHead className={HEAD}>Trend</TableHead>
          <TableHead className={cn(HEAD, lastCol)}>Last render</TableHead>
          <TableHead className={HEAD}>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.length === 0 ? (
          <TableRow className="h-14 border-hairline hover:bg-transparent">
            <TableCell colSpan={columns} className="text-text-muted">
              {FILTER_EMPTY[filter]}
            </TableCell>
          </TableRow>
        ) : (
          shown.map((r) => (
            <TableRow key={`${r.consumer.id}:${r.template.id}:${r.versionNumber}`} className="h-14 border-hairline hover:bg-hover/50">
              <TableCell className="font-medium text-text">{r.consumer.name}</TableCell>
              {showTemplate ? (
                <TableCell className="max-w-[16rem] truncate">
                  <Link
                    href={`/${r.template.teamSlug}/templates/${r.template.id}/usage` as Route}
                    title={r.template.name}
                    className="rounded-sm text-text outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {r.template.name}
                  </Link>
                </TableCell>
              ) : null}
              <TableCell>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[13px] text-text">v{r.versionNumber}</span>
                  <StatusBadge state={r.versionState} sunsetDay={r.sunsetDay} now={now} />
                </span>
              </TableCell>
              <TableCell className="text-right text-text tabular-nums">{formatCount(r.renders30d)}</TableCell>
              <TableCell>
                <Sparkline values={r.spark} width={72} label={`${r.consumer.name}, ${r.template.name} v${r.versionNumber}`} />
              </TableCell>
              <TableCell className={cn("whitespace-nowrap text-text-muted", lastCol)}>{formatLastRender(r.lastRenderAt, now)}</TableCell>
              <TableCell>
                <span className="flex gap-1">
                  {r.tags.map((t) => (
                    <TagChip key={t.text} tag={t} />
                  ))}
                </span>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
