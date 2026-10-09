"use client";

import { StatusBadge } from "@/components/primitives/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Sparkline } from "./charts";
import { CONSUMERS, ROW_TOTALS, fmt, type RowTotals } from "./data";

/*
 * Consumer, template, version, renders, last render, and the tag. The version is a StatusBadge, as
 * everywhere; the tag only adds the consequence ("sunset in 21 days") for a superseded version.
 */

// The seed's demo clock starts Feb 1, 2027; v1's sunset is 21 days on.
export const SUNSET_DAY = "2027-02-22";

const HEAD = "h-10 text-[11px] font-medium tracking-[0.08em] text-label uppercase";

export function VersionCell({ row }: { row: RowTotals }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-mono text-[13px] text-text">v{row.version}</span>
      <StatusBadge state={row.state} sunsetDay={row.state === "superseded" ? SUNSET_DAY : null} />
    </span>
  );
}

export function ConsumersTable({ className, rows = ROW_TOTALS, sparkline = false, bars = false }: { className?: string; rows?: RowTotals[]; sparkline?: boolean; bars?: boolean }) {
  const max = Math.max(...rows.map((r) => r.renders));
  return (
    <Table className={cn("text-[14px]", className)}>
      <TableHeader>
        <TableRow className="border-hairline hover:bg-transparent">
          <TableHead className={HEAD}>Consumer</TableHead>
          <TableHead className={HEAD}>Template</TableHead>
          <TableHead className={HEAD}>Version</TableHead>
          <TableHead className={cn(HEAD, "text-right")}>Renders, 30 days</TableHead>
          {sparkline ? <TableHead className={HEAD}>Trend</TableHead> : null}
          <TableHead className={HEAD}>Last render</TableHead>
          <TableHead className={HEAD}>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="h-14 border-hairline hover:bg-hover/50">
            <TableCell className="font-medium text-text">{CONSUMERS[r.consumer]}</TableCell>
            <TableCell className="max-w-[13rem] truncate text-text">{r.template}</TableCell>
            <TableCell><VersionCell row={r} /></TableCell>
            <TableCell className="text-right tabular-nums text-text">
              {bars ? (
                <span className="relative inline-flex w-44 items-center justify-end">
                  <span className="absolute inset-y-1 left-0 rounded-md bg-brand-1" style={{ width: `${(r.renders / max) * 100}%` }} />
                  <span className="relative px-2">{fmt.format(r.renders)}</span>
                </span>
              ) : (
                fmt.format(r.renders)
              )}
            </TableCell>
            {sparkline ? <TableCell><Sparkline values={r.spark} label={`${CONSUMERS[r.consumer]}, ${r.template}`} /></TableCell> : null}
            <TableCell className="text-text-muted">{r.lastRender}</TableCell>
            <TableCell>
              {r.state === "superseded" ? (
                <span className="inline-flex h-6 items-center rounded-md border border-warning-border bg-warning-soft px-2 text-[12px] font-medium text-warning-text">
                  Sunset in {r.sunsetInDays} days
                </span>
              ) : r.failedCount / r.renders > 0.02 ? (
                <span className="inline-flex h-6 items-center rounded-md bg-danger-soft px-2 text-[12px] font-medium text-danger-text">Failing: {Math.round((r.failedCount / r.renders) * 100)}% of renders</span>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
